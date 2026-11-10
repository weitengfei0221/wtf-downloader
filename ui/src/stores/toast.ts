import { defineStore } from 'pinia';
import { isComposedError, errMessage } from '@/api/invoke';
import { t, type MessageKey } from '@/locales/zh-CN';

export interface ToastItem {
  id: number;
  kind: 'success' | 'error' | 'info';
  /** 已插值后的文案 */
  message: string;
  actionLabel?: string;
  action?: () => void;
  /** 自动消失时长（默认 4000ms；撤销等带操作的 toast 可延长，如 5000ms） */
  durationMs?: number;
}

export interface ToastOptions {
  params?: Record<string, string | number>;
  actionLabel?: MessageKey;
  action?: () => void;
  /** 去重键：windowMs 内同键推送被合并（如"设置已保存"） */
  dedupeKey?: string;
  windowMs?: number;
  durationMs?: number;
}

let nextId = 1;

export const useToastStore = defineStore('toast', {
  state: () => ({
    items: [] as ToastItem[],
    lastPushAt: {} as Record<string, number>,
  }),

  actions: {
    push(kind: ToastItem['kind'], key: MessageKey, options: ToastOptions = {}): void {
      const now = Date.now();
      if (options.dedupeKey) {
        const last = this.lastPushAt[options.dedupeKey] ?? 0;
        if (now - last < (options.windowMs ?? 2000)) return;
        this.lastPushAt[options.dedupeKey] = now;
      }
      const item: ToastItem = {
        id: nextId++,
        kind,
        message: t(key, options.params),
        actionLabel: options.actionLabel ? t(options.actionLabel) : undefined,
        action: options.action,
        durationMs: options.durationMs,
      };
      this.items.push(item);
      // 兜底上限：异常高频错误不至于堆满屏幕
      if (this.items.length > 6) this.items.splice(0, this.items.length - 6);
    },

    /**
     * 错误 toast 统一入口（DESIGN.md §6.4 文案契约，2026-11 项目总监裁决方案 A）：
     * - 后端 AppError 的 message 已是自包含完整中文句 → **原样展示，不叠加业务前缀**
     *   （否则「打开失败：文件不存在：…」「保存失败：开启开机自启失败: …」语义重复）；
     * - 非 AppError（前端运行时错误 / IPC 原始字符串 / 命令未注册）没有业务语义 →
     *   用调用点给的 key 补前缀（如 `toast.saveFailed` = "保存失败：{reason}"）。
     * 判定只此一处，调用点一律不自行拼前缀（文案键仍是唯一文案源）。
     */
    pushError(key: MessageKey, e: unknown, options: Omit<ToastOptions, 'params'> = {}): void {
      this.push('error', isComposedError(e) ? 'toast.asIs' : key, {
        ...options,
        params: { reason: errMessage(e) },
      });
    },

    dismiss(id: number): void {
      this.items = this.items.filter((item) => item.id !== id);
    },
  },
});
