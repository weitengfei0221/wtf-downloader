import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  getVersion: vi.fn(),
}));

// 插件与 Tauri 运行时在 node 环境下不可用：mock 掉，只验证本层的形状与归一逻辑。
vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.check }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: mocks.getVersion }));

import {
  checkForUpdate,
  discardPendingUpdate,
  getAppVersion,
  hasPendingUpdate,
  installUpdate,
  type UpdateProgress,
} from './updater';

/** 构造一个最小 Update 替身（只需 version/date/body/close/downloadAndInstall） */
function fakeUpdate(over: Record<string, unknown> = {}) {
  return {
    version: '1.2.0',
    date: '2026-11-07T08:00:00Z',
    body: '修复若干问题',
    close: vi.fn().mockResolvedValue(undefined),
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // 每个用例从「无待安装更新」开始，避免模块级 handle 跨用例泄漏
  void discardPendingUpdate();
  mocks.getVersion.mockResolvedValue('1.1.0');
});

describe('checkForUpdate：无更新 / 有更新元数据', () => {
  it('check() 返回 null → 返回 null，且没有待安装 handle', async () => {
    mocks.check.mockResolvedValue(null);

    expect(await checkForUpdate()).toBeNull();
    expect(hasPendingUpdate()).toBe(false);
  });

  it('有更新 → 归一成 { version, date, body }，handle 保活', async () => {
    mocks.check.mockResolvedValue(fakeUpdate());

    expect(await checkForUpdate()).toEqual({
      version: '1.2.0',
      date: '2026-11-07T08:00:00Z',
      body: '修复若干问题',
    });
    expect(hasPendingUpdate()).toBe(true);
  });

  it('服务端未提供 date / body → 归一为 null，不变成 undefined', async () => {
    mocks.check.mockResolvedValue(fakeUpdate({ date: undefined, body: undefined }));

    expect(await checkForUpdate()).toEqual({ version: '1.2.0', date: null, body: null });
  });

  it('check() 带 timeout，避免冷启动请求无限挂住', async () => {
    mocks.check.mockResolvedValue(null);
    await checkForUpdate();
    expect(mocks.check).toHaveBeenCalledWith({ timeout: expect.any(Number) });
  });

  it('重新检查会先 close 旧的 Update，释放 Rust 资源', async () => {
    const old = fakeUpdate();
    mocks.check.mockResolvedValueOnce(old).mockResolvedValueOnce(null);
    await checkForUpdate();
    await checkForUpdate();
    expect(old.close).toHaveBeenCalledOnce();
    expect(hasPendingUpdate()).toBe(false);
  });
});

describe('installUpdate：Started / Progress / Finished 归一为累加进度', () => {
  it('contentLength 作为 total，chunkLength 逐次累加，Finished 收尾', async () => {
    const update = fakeUpdate();
    update.downloadAndInstall.mockImplementation(async (cb: (e: unknown) => void) => {
      cb({ event: 'Started', data: { contentLength: 1000 } });
      cb({ event: 'Progress', data: { chunkLength: 300 } });
      cb({ event: 'Progress', data: { chunkLength: 250 } });
      cb({ event: 'Finished' });
    });
    mocks.check.mockResolvedValue(update);
    await checkForUpdate();

    const seen: UpdateProgress[] = [];
    await installUpdate((p) => seen.push(p));

    expect(seen).toEqual([
      { downloaded: 0, total: 1000 },
      { downloaded: 300, total: 1000 },
      { downloaded: 550, total: 1000 },
      { downloaded: 550, total: 1000 },
    ]);
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(hasPendingUpdate()).toBe(false);
  });

  it('Started 缺 contentLength → total 为 null，进度仍累加', async () => {
    const update = fakeUpdate();
    update.downloadAndInstall.mockImplementation(async (cb: (e: unknown) => void) => {
      cb({ event: 'Started', data: {} });
      cb({ event: 'Progress', data: { chunkLength: 64 } });
      cb({ event: 'Finished' });
    });
    mocks.check.mockResolvedValue(update);
    await checkForUpdate();

    const seen: UpdateProgress[] = [];
    await installUpdate((p) => seen.push(p));
    expect(seen[0]).toEqual({ downloaded: 0, total: null });
    expect(seen[1]).toEqual({ downloaded: 64, total: null });
  });

  it('确认前不下载：没有 checkForUpdate 就调 installUpdate 直接抛错，绝不下载', async () => {
    await expect(installUpdate(() => undefined)).rejects.toThrow(/no pending update/);
    expect(mocks.check).not.toHaveBeenCalled();
  });
});

describe('不提供重启能力 / getAppVersion / discardPendingUpdate', () => {
  it('裁决护栏：updater 层不导出任何 relaunch 函数，也不直连重启插件', async () => {
    const mod = await import('./updater');
    expect(Object.keys(mod)).not.toContain('relaunchApp');
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./updater.ts', import.meta.url), 'utf8'),
    );
    expect(source).not.toContain('plugin-process');
    expect(source).not.toContain('relaunch(');
  });

  it('getAppVersion 取 Tauri getVersion，不硬编码版本号', async () => {
    expect(await getAppVersion()).toBe('1.1.0');
    expect(mocks.getVersion).toHaveBeenCalledOnce();
  });

  it('选「稍后」discard 会 close handle 且清掉待安装状态', async () => {
    const update = fakeUpdate();
    mocks.check.mockResolvedValue(update);
    await checkForUpdate();
    await discardPendingUpdate();
    expect(update.close).toHaveBeenCalledOnce();
    expect(hasPendingUpdate()).toBe(false);
  });

  it('close 失败不外抛（资源释放是尽力而为）', async () => {
    const update = fakeUpdate({ close: vi.fn().mockRejectedValue(new Error('rid gone')) });
    mocks.check.mockResolvedValue(update);
    await checkForUpdate();
    await expect(discardPendingUpdate()).resolves.toBeUndefined();
  });
});
