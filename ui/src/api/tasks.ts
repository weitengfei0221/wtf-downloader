import { Channel } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from './invoke';
import type {
  NewTaskPayload,
  ProbeResult,
  ProgressFrame,
  StateChangedPayload,
  TaskFailedPayload,
  TaskFilter,
  TaskIdPayload,
  TaskRecord,
} from './types';

// 分层硬约束：组件层禁 import '@tauri-apps/api'，事件解绑类型经本层 re-export
export type { UnlistenFn };

// ---- Commands（SPEC.md §5.1） ----

/** 探测直链元数据（添加弹窗用，2 秒内返回，AC-01） */
export function probeUrl(url: string, headers?: Record<string, string>): Promise<ProbeResult> {
  return invoke<ProbeResult>('probe_url', { url, headers });
}

/** 创建任务并入队；返回任务 ID */
export function addTask(payload: NewTaskPayload): Promise<{ taskId: string }> {
  return invoke<{ taskId: string }>('add_task', { ...payload });
}

/**
 * 查询任务列表。传入 onFrame 时经 tauri ipc Channel 注册进度订阅——
 * 每次 list_tasks 调用以新 Channel 替换旧订阅（ARCHITECTURE.md §3.3 替换式注册），
 * 前端组件卸载/刷新时句柄释放即视为取消推送，无需手动 unlisten。
 * 进度节流在生产端（Rust 4Hz），此处不做前端节流（Spec §10 硬约束）。
 */
export function listTasks(
  filter?: TaskFilter,
  onFrame?: (frame: ProgressFrame) => void,
): Promise<TaskRecord[]> {
  let progress: Channel<ProgressFrame> | undefined;
  if (onFrame) {
    progress = new Channel<ProgressFrame>();
    progress.onmessage = onFrame;
  }
  return invoke<TaskRecord[]>('list_tasks', { filter, progress });
}

export function pauseTask(taskId: string): Promise<TaskRecord> {
  return invoke<TaskRecord>('pause_task', { taskId });
}

export function resumeTask(taskId: string): Promise<TaskRecord> {
  return invoke<TaskRecord>('resume_task', { taskId });
}

export function retryTask(taskId: string): Promise<TaskRecord> {
  return invoke<TaskRecord>('retry_task', { taskId });
}

/**
 * 删除任务。
 * - `deleteFiles: false`「仅删除任务」：只删记录；未完成任务的 `.part` 由后端清除，
 *   已完成任务的文件保留在磁盘上。
 * - `deleteFiles: true`「删除任务和文件」：连磁盘文件一起删（已完成任务的成品文件）。
 *
 * 两条路径的判定都在引擎 `http/ops.rs` 一处，前端只负责把用户选择传下去。
 */
export function removeTask(taskId: string, deleteFiles: boolean): Promise<null> {
  return invoke<null>('remove_task', { taskId, deleteFiles });
}

export function pauseAll(): Promise<null> {
  return invoke<null>('pause_all');
}

export function resumeAll(): Promise<null> {
  return invoke<null>('resume_all');
}

export function setTaskSpeedLimit(taskId: string, bytesPerSec: number | null): Promise<null> {
  return invoke<null>('set_task_speed_limit', { taskId, bytesPerSec });
}

export function openFileLocation(taskId: string): Promise<null> {
  return invoke<null>('open_file_location', { taskId });
}

/**
 * 检测已完成任务关联的正式文件是否仍在磁盘上（应用外被资源管理器/清理软件删除）。
 * 命令名保持 snake_case（契约冻结，永不做 camelCase 转换）；参数 { taskIds } 为
 * 当前 store.tasks 的全部 id；返回**文件不存在的已完成任务 id 列表**。
 *
 * 结果只作瞬时呈现态：不写 TaskRecord、不落库、不改 TaskStatus（见 DESIGN.md §2.10）。
 * 文件放回后再次调用即可自动复原，无需额外"解除标记"命令。
 */
export function checkFiles(taskIds: string[]): Promise<string[]> {
  return invoke<string[]>('check_files', { taskIds });
}

// ---- 事件（Rust emit → listen，SPEC.md §5.2） ----

export function onTaskStateChanged(cb: (p: StateChangedPayload) => void): Promise<UnlistenFn> {
  return listen<StateChangedPayload>('task:state-changed', (e) => cb(e.payload));
}

export function onTaskCreated(cb: (p: TaskIdPayload) => void): Promise<UnlistenFn> {
  return listen<TaskIdPayload>('task:created', (e) => cb(e.payload));
}

export function onTaskRemoved(cb: (p: TaskIdPayload) => void): Promise<UnlistenFn> {
  return listen<TaskIdPayload>('task:removed', (e) => cb(e.payload));
}

export function onTaskCompleted(cb: (p: TaskIdPayload) => void): Promise<UnlistenFn> {
  return listen<TaskIdPayload>('task:completed', (e) => cb(e.payload));
}

export function onTaskFailed(cb: (p: TaskFailedPayload) => void): Promise<UnlistenFn> {
  return listen<TaskFailedPayload>('task:failed', (e) => cb(e.payload));
}
