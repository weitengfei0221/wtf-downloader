import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  discardPendingUpdate: vi.fn(),
  getAppVersion: vi.fn(),
  hasPendingUpdate: vi.fn(),
  installUpdate: vi.fn(),
}));

// 只验证 store 行为，不依赖 Tauri 运行时：mock 掉整个 api/updater 层
vi.mock('@/api/updater', () => ({
  checkForUpdate: mocks.checkForUpdate,
  discardPendingUpdate: mocks.discardPendingUpdate,
  getAppVersion: mocks.getAppVersion,
  hasPendingUpdate: mocks.hasPendingUpdate,
  installUpdate: mocks.installUpdate,
}));

import { useUpdaterStore } from './updater';
import { useToastStore } from './toast';

const INFO = { version: '1.2.0', date: null, body: null };

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mocks.getAppVersion.mockResolvedValue('1.1.0');
  mocks.discardPendingUpdate.mockResolvedValue(undefined);
  mocks.hasPendingUpdate.mockReturnValue(true);
  mocks.installUpdate.mockResolvedValue(undefined);
  mocks.checkForUpdate.mockResolvedValue(null);
});

describe('启动自动检查：失败完全静默，但状态留在设置页', () => {
  it('失败不推任何 toast、不外抛，lastCheckFailed=true 且记录检查时刻', async () => {
    mocks.checkForUpdate.mockRejectedValue(new Error('endpoint not configured'));
    const store = useUpdaterStore();

    await expect(store.autoCheck()).resolves.toBeUndefined();

    expect(useToastStore().items).toEqual([]); // 零打扰
    expect(store.lastCheckFailed).toBe(true); // 设置页可显示「上次检查失败」
    expect(store.lastCheckedAt).not.toBeNull();
    expect(store.checking).toBe(false);
    expect(store.available).toBeNull();
  });

  it('自动检查发现新版本只亮状态栏按钮，不弹窗、绝不下载', async () => {
    mocks.checkForUpdate.mockResolvedValue(INFO);
    const store = useUpdaterStore();

    await store.autoCheck();

    // 用户裁决 2026-11-13：自动检查不打扰操作 → 只写 available，confirmOpen 保持 false
    expect(store.available).toEqual(INFO);
    expect(store.confirmOpen).toBe(false);
    expect(mocks.installUpdate).not.toHaveBeenCalled();
    expect(store.installing).toBe(false);
  });

  it('自动检查「已是最新」也不弹 toast（冷启动零打扰）', async () => {
    const store = useUpdaterStore();
    await store.autoCheck();
    expect(useToastStore().items).toEqual([]);
  });
});

describe('设置页手动检查：失败必须可见，与自动静默区分', () => {
  it('失败推一条 error toast（含原因），并同样记录失败状态', async () => {
    mocks.checkForUpdate.mockRejectedValue(new Error('network down'));
    const store = useUpdaterStore();

    await store.manualCheck();

    const items = useToastStore().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('error');
    expect(items[0]?.message).toContain('检查更新失败');
    expect(items[0]?.message).toContain('network down');
    expect(store.lastCheckFailed).toBe(true);
  });

  it('手动「已是最新」给可见 info toast，让用户知道点过且成功', async () => {
    const store = useUpdaterStore();
    await store.manualCheck();
    const items = useToastStore().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.message).toBe('已是最新版本');
  });

  it('成功后清掉上一次的失败标记', async () => {
    const store = useUpdaterStore();
    mocks.checkForUpdate.mockRejectedValueOnce(new Error('offline'));
    await store.autoCheck();
    expect(store.lastCheckFailed).toBe(true);
    await store.manualCheck();
    expect(store.lastCheckFailed).toBe(false);
  });
});

describe('确认前不下载 / 确认后才安装（安装阶段自动退出）', () => {
  it('手动检查发现更新直接开确认框（用户主动点按钮，弹窗是预期）', async () => {
    mocks.checkForUpdate.mockResolvedValue(INFO);
    const store = useUpdaterStore();

    await store.manualCheck();

    expect(store.available).toEqual(INFO);
    expect(store.confirmOpen).toBe(true);
    expect(mocks.installUpdate).not.toHaveBeenCalled();
  });

  it('选「稍后」只关确认框：available 保留、pending 不销毁，可再次点开', async () => {
    mocks.checkForUpdate.mockResolvedValue(INFO);
    const store = useUpdaterStore();
    await store.autoCheck();
    store.openConfirm();
    expect(store.confirmOpen).toBe(true);

    store.closeConfirm();

    expect(store.confirmOpen).toBe(false);
    // 关键：不销毁 pending —— 否则状态栏按钮再点开时 confirmInstall() 会直接 return
    expect(store.available).toEqual(INFO);
    expect(mocks.discardPendingUpdate).not.toHaveBeenCalled();
    expect(mocks.hasPendingUpdate()).toBe(true);
    expect(mocks.installUpdate).not.toHaveBeenCalled();

    // 「稍后」之后仍可从状态栏再点开并真装
    store.openConfirm();
    expect(store.confirmOpen).toBe(true);
    await store.confirmInstall();
    expect(mocks.installUpdate).toHaveBeenCalledOnce();
  });

  it('openConfirm 在没有可用更新时是空操作（不弹空弹窗）', () => {
    const store = useUpdaterStore();
    store.openConfirm();
    expect(store.confirmOpen).toBe(false);
  });

  it('点「立即更新」→ 下载安装 → 保持退出提示态，进度写入 store', async () => {
    mocks.checkForUpdate.mockResolvedValue(INFO);
    mocks.installUpdate.mockImplementation(async (cb: (p: { downloaded: number; total: number | null }) => void) => {
      cb({ downloaded: 0, total: 100 });
      cb({ downloaded: 100, total: 100 });
    });
    const store = useUpdaterStore();
    await store.autoCheck();

    await store.confirmInstall();

    expect(mocks.installUpdate).toHaveBeenCalledOnce();
    expect(store.progress).toEqual({ downloaded: 100, total: 100 });
    expect(store.confirmOpen).toBe(false);
    // Windows 安装器接管后应用自动退出，installing 不复位，进度弹窗留到进程退出
    expect(store.installing).toBe(true);
  });

  it('没有待安装 handle 时 confirmInstall 是空操作（绝不凭空下载）', async () => {
    mocks.hasPendingUpdate.mockReturnValue(false);
    const store = useUpdaterStore();
    await store.confirmInstall();
    expect(mocks.installUpdate).not.toHaveBeenCalled();
  });

  it('下载安装失败：可见 toast，回到可重试状态', async () => {
    mocks.checkForUpdate.mockResolvedValue(INFO);
    mocks.installUpdate.mockRejectedValue(new Error('signature invalid'));
    const store = useUpdaterStore();
    await store.autoCheck();

    await store.confirmInstall();

    expect(useToastStore().items.some((i) => i.kind === 'error')).toBe(true);
    expect(store.installing).toBe(false);
    expect(store.available).toBeNull();
  });

  it('安装成功后不推错误 toast、不调用任何重启 API，保持退出提示态', async () => {
    mocks.checkForUpdate.mockResolvedValue(INFO);
    const store = useUpdaterStore();
    await store.autoCheck();

    await expect(store.confirmInstall()).resolves.toBeUndefined();
    expect(useToastStore().items).toEqual([]);
    expect(store.installing).toBe(true);
    // 裁决护栏：store 的**代码**不得引用任何重启能力（注释里的说明文字不算实现）
    const fs = await import('node:fs');
    const src = fs
      .readFileSync(new URL('./updater.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toContain('relaunch');
  });
});

describe('幂等与版本号', () => {
  it('checking 期间不重复发检查请求（用可控 deferred，不依赖定时器）', async () => {
    let release: (value: null) => void = () => undefined;
    const pending = new Promise<null>((resolve) => {
      release = resolve;
    });
    mocks.checkForUpdate.mockReturnValue(pending);
    const store = useUpdaterStore();

    const first = store.manualCheck();
    expect(store.checking).toBe(true);
    await store.manualCheck(); // 撞车：应直接返回
    expect(mocks.checkForUpdate).toHaveBeenCalledTimes(1);

    release(null);
    await first;
    expect(store.checking).toBe(false);
  });

  it('loadVersion 从 Tauri getVersion 取，不硬编码；失败保持空串由 UI 降级', async () => {
    const store = useUpdaterStore();
    await store.loadVersion();
    expect(store.currentVersion).toBe('1.1.0');

    store.$reset();
    mocks.getAppVersion.mockRejectedValue(new Error('not tauri'));
    await store.loadVersion();
    expect(store.currentVersion).toBe('');
  });
});
