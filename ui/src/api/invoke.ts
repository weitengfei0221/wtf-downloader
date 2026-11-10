import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { AppErrorShape } from './types';

/** 后端 AppError 的前端映射（ARCHITECTURE.md §3.2 code 枚举） */
export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

function toApiError(raw: unknown): ApiError {
  if (typeof raw === 'object' && raw !== null && 'code' in raw && 'message' in raw) {
    const shape = raw as AppErrorShape;
    return new ApiError(String(shape.code), String(shape.message));
  }
  if (typeof raw === 'string' && raw.length > 0) {
    return new ApiError('engine_error', raw);
  }
  return new ApiError('engine_error', String(raw));
}

/**
 * 统一 invoke 封装：组件层禁止直接 import '@tauri-apps/api'，
 * 一切命令调用经由此函数（错误统一映射为 ApiError）。
 */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (e) {
    throw toApiError(e);
  }
}

/** 任意错误 → 人类可读消息（Toast/内联错误条用） */
export function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * 错误是否**自带可直接展示的完整文案**（DESIGN.md §6.4 文案契约，2026-11 判定）：
 * 后端 AppError 的 message 一律是自包含完整中文句（"文件不存在：D:/x.zip"、
 * "任务不存在: t1"、"开启开机自启失败: ..."），前端**不得再叠加业务前缀**——
 * 否则显示成「保存失败：开启开机自启失败: ...」的语义重复。
 * 非 ApiError（前端运行时 TypeError / IPC 层原始字符串 / 命令未注册）没有业务
 * 语义，需要前端补前缀（统一由 stores/toast.ts `pushError` 决策）。
 */
export function isComposedError(e: unknown): boolean {
  return e instanceof ApiError;
}

/** 续传冲突的错误码（后端 AppError.code 与 `task:failed` 事件载荷的 code 同源同值） */
const RESUME_CONFLICT = 'resume_conflict';

/**
 * resume_conflict 判定（**唯一实现**，拒绝路径与事件路径共用）。
 *
 * 输入形状有两种：`ApiError`（命令 reject）与 `TaskFailedPayload`（`task:failed` 事件）。
 * 判定顺序是 **code 优先**：只要存在 `code` 就只认 code，不再看文本——否则同一份语义会有
 * 两份判据，文案一改就分叉（历史上事件路径曾只嗅 `error` 文本，一旦引擎把该句中文化，
 * AC-09「是否重新下载」弹窗就会静默不出现）。
 *
 * 文本分支是**过渡兼容**：后端 `task:failed` 载荷尚未全量带 `code` 时，旧事件仍靠
 * `error` 文本里的 `resume_conflict` 标识。该分支应在后端全量发布后删除
 * （登记于 docs/decisions/OPEN-DECISIONS.md）。
 */
export function isResumeConflict(value: unknown): boolean {
  if (value instanceof ApiError) return value.code === RESUME_CONFLICT;
  if (typeof value === 'string') return value.includes(RESUME_CONFLICT);
  if (typeof value === 'object' && value !== null) {
    const shape = value as Partial<AppErrorShape> & { error?: unknown };
    // code 优先：有 code 就由 code 决定，文本不得翻案
    if (shape.code != null) return String(shape.code) === RESUME_CONFLICT;
    const text = typeof shape.error === 'string' ? shape.error : (shape.message ?? '');
    return text.includes(RESUME_CONFLICT); // 过渡兼容（见函数注释）
  }
  return false;
}
