// 与 Rust 侧 serde 结构体逐字段对齐（ARCHITECTURE.md §4，IPC camelCase）。
// 字段名与可空性为契约，不可擅改。

export type TaskStatus = 'pending' | 'downloading' | 'paused' | 'failed' | 'completed';
export type TaskFilter = 'all' | 'downloading' | 'completed' | 'failed';

export interface TaskRecord {
  id: string;
  url: string;
  finalUrl: string;
  filename: string;
  dir: string;
  totalBytes: number | null; // null = 未知（不显示百分比）
  status: TaskStatus;
  speedLimit: number | null; // bytes/s
  error: string | null;
  retryCount: number;
  downloadedBytes: number;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
}

export interface SegmentProgress {
  index: number;
  downloaded: number;
  total: number;
}

export interface ProgressFrame {
  taskId: string;
  downloadedBytes: number;
  totalBytes: number | null;
  speedBps: number;
  etaSecs: number | null;
  segments: SegmentProgress[];
}

export interface ProbeResult {
  filename: string;
  totalSize: number | null;
  acceptRanges: boolean;
  etag: string | null;
  lastModified: string | null;
  finalUrl: string;
}

export interface Config {
  downloadDir: string;
  defaultSegments: number; // 1-16
  globalSpeedLimitBps: number | null;
  notifyOnComplete: boolean;
  autostartEnabled: boolean; // OS 实时状态，非 DB 字段
  /** 主题三态偏好（契约已锁定，Rust 侧小写序列化）。后端字段落地前缺省 = 'system' */
  theme?: 'system' | 'light' | 'dark';
}

export interface AppErrorShape {
  // invoke reject 时 catch 到的形状（ARCHITECTURE.md §3.2 AppError）
  code: string; // invalid_url | invalid_argument | task_not_found | probe_failed |
  //          http_status:<code> | resume_conflict | io_error | db_error | engine_error
  message: string;
}

export interface NewTaskPayload {
  url: string;
  filename?: string;
  dir?: string;
  headers?: Record<string, string>;
  segments?: number;
}

// ---- 事件载荷（Rust emit，camelCase） ----

export interface TaskIdPayload {
  taskId: string;
}

export interface StateChangedPayload extends TaskIdPayload {
  from: TaskStatus;
  to: TaskStatus;
  error?: string | null;
}

export interface TaskFailedPayload extends TaskIdPayload {
  error: string;
  /**
   * 错误码（与命令 reject 的 `AppError.code` 同源同值），如 `resume_conflict`。
   * 可选：过渡期后端未发布该字段时缺失，前端须 `code 优先 + 文本嗅探兼容`
   * （见 `api/invoke.ts::isResumeConflict`）。
   */
  code?: string;
}

export type TaskEventListener<P> = (payload: P) => void;
