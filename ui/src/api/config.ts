import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from './invoke';
import type { Config } from './types';

/**
 * 设置读写。minimizeToTray 为 DESIGN.md §4.2「关闭窗口时最小化到托盘」对应键，
 * ARCHITECTURE.md §4 Config 契约暂未含此字段——后端补齐前该值仅在前端持有，
 * set_config 会随 Partial 一并下发（serde 忽略未知字段），后端补字段后自动生效。
 */
export type ConfigPatch = Partial<Config> & { minimizeToTray?: boolean };

export function getConfig(): Promise<Config> {
  return invoke<Config>('get_config');
}

/**
 * set_config 的实参形状：后端签名是单一结构体参数 `patch: ConfigPatchArg`
 * （crates/app/src/commands/config.rs），Tauri v2 按**参数名**取实参，
 * 因此必须包一层 `{ patch }`。铺平成 `{ ...patch }` 会得到
 * "command set_config missing required key patch"（2026-11 用户实测 P0）。
 * 与之相对，多标量参数的命令（pause_task/set_autostart…）才是平铺 `{ taskId }`。
 */
export function setConfig(patch: ConfigPatch): Promise<Config> {
  return invoke<Config>('set_config', { patch });
}

export function setAutostart(enabled: boolean): Promise<null> {
  return invoke<null>('set_autostart', { enabled });
}

export function setGlobalSpeedLimit(bytesPerSec: number | null): Promise<null> {
  return invoke<null>('set_global_speed_limit', { bytesPerSec });
}

/**
 * 清除本地统计。SPEC.md §5.1 命令清单（15 条）未含 clear_stats 命令——
 * 契约缺口，已回传 team-lead；后端落此命令后 UI 即可用。
 */
export function clearStats(): Promise<null> {
  return invoke<null>('clear_stats');
}

/** 系统目录选择器（tauri-plugin-dialog，后端需注册该插件） */
export async function pickDirectory(defaultPath?: string): Promise<string | null> {
  const selected = await openDialog({ directory: true, multiple: false, defaultPath });
  return typeof selected === 'string' ? selected : null;
}

/**
 * 用系统默认程序打开文件（已完成行「打开文件」按钮/菜单）。
 *
 * 走自定义命令 `open_path`（Rust 侧调 opener 插件 API），不走前端 `openPath()`：
 * 插件的 ACL 把可打开的路径限制在 capability 白名单的作用域内，用户下载目录
 * 千差万别，前端无从授权 → 必然 `Not allowed to open path ...`（2026-11 用户实测）。
 * 后端命令不受前端 capability 作用域约束，且命令缺失/失败会 reject，由调用方
 * 以 Toast 呈现（禁止静默失败）。
 */
export function openFile(path: string): Promise<void> {
  return invoke<void>('open_path', { path });
}
