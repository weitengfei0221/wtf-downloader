import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// 只验证「前端实参形状」，不依赖 Tauri 运行时：mock 掉 IPC 与插件包。
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import {
  getConfig,
  openFile,
  setAutostart,
  setConfig,
  setGlobalSpeedLimit,
} from './config';

const ipc = tauriInvoke as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  ipc.mockResolvedValue({});
});

/**
 * 防复发护栏（2026-11 用户实测 P0）：
 * 后端 `set_config(state, app, patch: ConfigPatchArg)` 是**单一结构体参数**，
 * Tauri v2 按参数名取实参 → 前端必须是 `{ patch: {...} }`。
 * 历史 bug：`{ ...patch }`（铺平）导致运行期
 * "command set_config missing required key patch"，设置页所有保存全部失败。
 */
describe('setConfig 实参形状（set_config 单一结构体参数）', () => {
  it('单字段：第二参严格等于 { patch: { defaultSegments } }', async () => {
    await setConfig({ defaultSegments: 10 });

    expect(ipc).toHaveBeenCalledExactlyOnceWith('set_config', {
      patch: { defaultSegments: 10 },
    });
  });

  it('禁止铺平形状：顶层不得直接出现配置字段', async () => {
    await setConfig({ globalSpeedLimitBps: 5_000_000 });

    const [, args] = ipc.mock.calls[0] as [string, Record<string, unknown>];
    expect(Object.keys(args)).toEqual(['patch']);
    expect(args).not.toHaveProperty('globalSpeedLimitBps');
    expect(args.patch).toEqual({ globalSpeedLimitBps: 5_000_000 });
  });

  it('多字段（含前端独有 minimizeToTray）全部收进 patch，不多不少', async () => {
    await setConfig({
      downloadDir: 'D:/Downloads',
      defaultSegments: 8,
      globalSpeedLimitBps: null,
      notifyOnComplete: false,
      minimizeToTray: true,
    });

    expect(ipc).toHaveBeenCalledExactlyOnceWith('set_config', {
      patch: {
        downloadDir: 'D:/Downloads',
        defaultSegments: 8,
        globalSpeedLimitBps: null,
        notifyOnComplete: false,
        minimizeToTray: true,
      },
    });
  });
});

/** 多标量参数的命令：平铺，不再包一层。与 set_config 形成对照，防止"一律包一层"的反向误改。 */
describe('多标量参数命令保持平铺', () => {
  it('set_global_speed_limit → { bytesPerSec }', async () => {
    await setGlobalSpeedLimit(1_048_576);
    expect(ipc).toHaveBeenCalledExactlyOnceWith('set_global_speed_limit', {
      bytesPerSec: 1_048_576,
    });
  });

  it('set_global_speed_limit(null) → { bytesPerSec: null }（解除限速）', async () => {
    await setGlobalSpeedLimit(null);
    expect(ipc).toHaveBeenCalledExactlyOnceWith('set_global_speed_limit', {
      bytesPerSec: null,
    });
  });

  it('set_autostart → { enabled }', async () => {
    await setAutostart(true);
    expect(ipc).toHaveBeenCalledExactlyOnceWith('set_autostart', { enabled: true });
  });

  it('get_config 无实参', async () => {
    await getConfig();
    expect(ipc).toHaveBeenCalledExactlyOnceWith('get_config', undefined);
  });
});

/**
 * 防复发护栏（2026-11 用户实测）：打开文件必须走自定义命令 `open_path`。
 * 前端 `openPath()` 受 opener 插件 ACL 路径作用域限制，用户下载目录不在
 * capability 白名单内时必然报 `Not allowed to open path ...`，且前端无法授权。
 */
describe('openFile 走 open_path 命令（绕开前端 opener ACL 作用域）', () => {
  it('openFile(path) → invoke("open_path", { path })', async () => {
    await openFile('D:/Downloads/ubuntu.iso');

    expect(ipc).toHaveBeenCalledExactlyOnceWith('open_path', {
      path: 'D:/Downloads/ubuntu.iso',
    });
  });
});
