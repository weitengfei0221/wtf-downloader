import { getVersion } from '@tauri-apps/api/app';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';

/**
 * 更新 API（DESIGN.md §4.4，第十轮）：**唯一**可直连 Tauri 更新插件的一层。
 * 更新走 plugin-updater 的 JS API，不经过 `api/invoke.ts` 的自定义命令封装，
 * 也不新增任何 IPC 命令名（check_contract.sh 的 19 命令契约不变）。
 *
 * **不提供任何重启能力**：Tauri v2 官方说明 Windows 上安装步骤执行时应用会自动退出，
 * `downloadAndInstall()` 之后的 relaunch 不可达；项目总监裁决不引入 process 插件，
 * 安装完成后由用户手动重新打开应用。
 *
 * 分层铁律：组件 / store / view 只 import 本文件的纯函数，绝不直接 import 插件包
 * （architecture.guard.test.ts 的 P0 分层护栏会扫）。
 *
 * 版本 2.14.1 的官方签名（已对照 node_modules 内 .d.ts 核实）：
 *   check(options?) → Promise<Update | null>；Update: version / date? / body? / downloadAndInstall / close
 *   DownloadEvent = Started{contentLength?} | Progress{chunkLength} | Finished
 *   getVersion() → Promise<string>
 */

/** 检查请求超时：启动自动检查不能因为网络不通把主线程请求挂住太久 */
const CHECK_TIMEOUT_MS = 10_000;

export interface UpdateInfo {
  version: string;
  /** RFC 3339 字符串或 null（服务端未提供时） */
  date: string | null;
  body: string | null;
}

/** 归一化后的下载进度：downloaded 累加字节，total 未知时为 null */
export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

/**
 * check() 返回的 Update 持有 Rust 侧资源，确认弹窗期间必须保活，
 * 否则用户点「立即更新」时 handle 已丢失。仅在 src/api/ 内保存，不外泄给组件层。
 */
let pendingUpdate: Update | null = null;

/** 丢弃待安装更新并释放 Rust 资源（用户选「稍后」/ 重新检查时调用）。 */
export async function discardPendingUpdate(): Promise<void> {
  const handle = pendingUpdate;
  pendingUpdate = null;
  if (handle) await handle.close().catch(() => undefined);
}

/** 是否有待安装更新（确认前绝不下载的唯一判据来源）。 */
export function hasPendingUpdate(): boolean {
  return pendingUpdate != null;
}

/** 检查更新：null = 已是最新；非 null = 元数据。失败原样抛出，由调用方决定静默/可见。 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  await discardPendingUpdate();
  const update = await check({ timeout: CHECK_TIMEOUT_MS });
  if (update == null) return null;
  pendingUpdate = update;
  return {
    version: update.version,
    date: update.date ?? null,
    body: update.body ?? null,
  };
}

/**
 * 下载并安装：把 Started / Progress / Finished 归一成 { downloaded, total } 回调。
 * Started 给 contentLength（可能缺失）；Progress 的 chunkLength 必须累加；Finished 收尾。
 * Windows 上执行安装时应用会自动退出，故调用方必须在**下载前**用确认框明确提示用户。
 */
export async function installUpdate(onProgress: (progress: UpdateProgress) => void): Promise<void> {
  const handle = pendingUpdate;
  if (handle == null) throw new Error('no pending update: installUpdate called before checkForUpdate');
  let downloaded = 0;
  let total: number | null = null;
  const emit = (): void => onProgress({ downloaded, total });
  await handle.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? null;
      emit();
    } else if (event.event === 'Progress') {
      downloaded += event.data.chunkLength;
      emit();
    } else {
      emit();
    }
  });
  pendingUpdate = null;
}

/** 当前应用版本号，取自 Tauri 配置（package.json 版本号只作构建输入，不在此硬编码）。 */
export async function getAppVersion(): Promise<string> {
  return getVersion();
}
