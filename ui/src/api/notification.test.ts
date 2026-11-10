import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// mock 底层：通知一律经 Rust 命令 `notify_user` 发送（缺陷 4 / SPEC §13 归属修复）。
// JS 侧不再有权限门卫，也不再引用插件包（已从依赖中移除）。
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { t } from '@/locales/zh-CN';
import { sendTaskCompletedNotification, sendTaskFailedNotification } from './notification';

const send = vi.mocked(invoke);
let warn: ReturnType<typeof vi.spyOn>;

/** 取最后一次 invoke 的 (命令名, 参数)，避免测试里散落非空断言 */
function lastCall(): [string, Record<string, unknown>] {
  const call = send.mock.calls.at(-1);
  if (call == null) throw new Error('invoke 未被调用');
  return call as [string, Record<string, unknown>];
}

beforeEach(() => {
  vi.clearAllMocks();
  send.mockImplementation(async () => undefined);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('sendTaskCompletedNotification（P1-001）', () => {
  it('经 notify_user 发送，标题=事件语义、正文含文件名', async () => {
    await sendTaskCompletedNotification('ubuntu-24.04.iso');
    expect(send).toHaveBeenCalledExactlyOnceWith('notify_user', {
      title: '下载完成',
      body: '「ubuntu-24.04.iso」已下载完成',
    });
  });

  it('标题取自 notify.completedTitle（事件语义，不是应用名）', async () => {
    await sendTaskCompletedNotification('data.zip');
    const title = lastCall()[1].title;
    expect(title).toBe(t('notify.completedTitle'));
    // 气泡顶部的应用名行由 Windows 从 AUMID DisplayName 渲染，标题再写应用名就重复两行
    expect(title).not.toBe('wtf-downloader');
  });

  it('正文也不重复品牌串（有人把应用名塞进 body 会造成同样的"两行同名"）', async () => {
    await sendTaskCompletedNotification('ok.bin');
    expect(lastCall()[1].body).not.toContain('wtf-downloader');
  });

  it('命令名严格为 notify_user，参数平铺为 { title, body } 两个标量（不包对象）', async () => {
    await sendTaskCompletedNotification('data.zip');
    const [cmd, args] = lastCall();
    expect(cmd).toBe('notify_user');
    expect(Object.keys(args)).toEqual(['title', 'body']);
    expect(typeof args.title).toBe('string');
    expect(typeof args.body).toBe('string');
  });

  it('通知是辅助通道：命令失败时静默返回，不向调用方抛出', async () => {
    send.mockRejectedValue({ code: 'notification_failed', message: 'toast 发送失败' });
    await expect(sendTaskCompletedNotification('data.zip')).resolves.toBeUndefined();
    // 只留一条 warn 供排查（不弹 toast、不打断下载主流程）
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('sendTaskFailedNotification（失败必须通知）', () => {
  it('正文含文件名与错误摘要，标题=事件语义', async () => {
    await sendTaskFailedNotification('movie.mkv', 'http_status:404');
    expect(send).toHaveBeenCalledExactlyOnceWith('notify_user', {
      title: '下载失败',
      body: '「movie.mkv」下载失败：http_status:404',
    });
  });

  it('错误缺失：退化为无摘要文案', async () => {
    await sendTaskFailedNotification('movie.mkv');
    expect(send).toHaveBeenCalledExactlyOnceWith('notify_user', {
      title: '下载失败',
      body: '「movie.mkv」下载失败',
    });
  });

  it('错误为空字符串：同样退化为无摘要文案（不渲染空的"：…"）', async () => {
    await sendTaskFailedNotification('movie.mkv', '');
    expect(lastCall()[1].body).toBe('「movie.mkv」下载失败');
  });

  it('参数被后端拒绝（invalid_argument）：静默不外抛', async () => {
    send.mockRejectedValue({ code: 'invalid_argument', message: 'title 不能为空' });
    await expect(sendTaskFailedNotification('movie.mkv', 'io_error')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});

/**
 * 静态护栏（2026-11 归属修复的硬约束，改动不得回退）。
 */
describe('notification 契约护栏', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./notification.ts', import.meta.url)),
    'utf8',
  );
  /** 去掉注释后再断言：文件里**必须**保留这些"为什么不用"的说明文字 */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('可执行代码零 sendNotification（防双 toast）', () => {
    expect(code).not.toContain('sendNotification');
  });

  it('零权限判断（门卫会变成第二道静默开关）', () => {
    expect(code).not.toContain('isPermissionGranted');
    expect(code).not.toContain('requestPermission');
    expect(code).not.toContain('ensurePermission');
  });

  it('标题不得等于应用名：气泡顶部的应用名行由 AUMID 的 DisplayName 渲染，重复会显示两遍', () => {
    // 断言的是"值"而不是某个文案键名：标题不能是品牌串，源码也不许把品牌串写死
    expect(code).not.toContain('wtf-downloader');
    expect(t('notify.completedTitle')).not.toBe('wtf-downloader');
    expect(t('notify.failedTitle')).not.toBe('wtf-downloader');
  });

  it('五个文案模板里都不许出现品牌串：应用名只由 AUMID DisplayName 提供', () => {
    // 护栏下沉到 locales 层：只守住 notification.ts 不够——有人可以把品牌串塞进 body 模板
    // （'notify.completedBody': '{app}「{filename}」…'），那样源码断言仍绿，气泡却重复两行。
    const keys = [
      'notify.completedTitle',
      'notify.failedTitle',
      'notify.completedBody',
      'notify.failedBody',
      'notify.failedBodyNoReason',
    ] as const;
    for (const key of keys) expect(t(key)).not.toContain('wtf-downloader');
  });

  it('依赖清单里没有任何通知类插件（已卸载，不再需要）', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    expect(names.filter((name) => name.includes('notification'))).toEqual([]);
  });

  it("发送只经 invoke('notify_user', { title, body })", () => {
    expect(code).toContain("invoke<void>('notify_user', { title, body })");
  });
});
