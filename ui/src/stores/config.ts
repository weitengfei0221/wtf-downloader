import { defineStore } from 'pinia';
import {
  clearStats,
  getConfig,
  setAutostart,
  setConfig,
  setGlobalSpeedLimit,
  type ConfigPatch,
} from '@/api/config';
import { errMessage } from '@/api/invoke';
import { useToastStore } from './toast';

/** Config 契约 + DESIGN.md §4.2 的托盘开关键（后端补字段前由前端持有，见 api/config.ts） */
export interface UiConfig {
  downloadDir: string;
  defaultSegments: number;
  globalSpeedLimitBps: number | null;
  notifyOnComplete: boolean;
  autostartEnabled: boolean;
  minimizeToTray: boolean;
}

function toUiConfig(raw: {
  downloadDir: string;
  defaultSegments: number;
  globalSpeedLimitBps: number | null;
  notifyOnComplete: boolean;
  autostartEnabled: boolean;
}): UiConfig {
  const extra = raw as UiConfig & { minimizeToTray?: unknown };
  return {
    ...raw,
    minimizeToTray:
      typeof extra.minimizeToTray === 'boolean' ? extra.minimizeToTray : true,
  };
}

export const useConfigStore = defineStore('config', {
  state: () => ({
    config: null as UiConfig | null,
    loadError: '' as string,
  }),

  actions: {
    async load(): Promise<void> {
      try {
        this.config = toUiConfig(await getConfig());
        this.loadError = '';
      } catch (e) {
        this.loadError = errMessage(e);
      }
    },

    /** 即时保存（DESIGN.md §4.2），成功/失败 toast（"设置已保存"2s 去重） */
    async patch(patch: ConfigPatch): Promise<boolean> {
      const toast = useToastStore();
      try {
        this.config = toUiConfig(await setConfig(patch));
        toast.push('success', 'toast.saved', { dedupeKey: 'saved', windowMs: 2000 });
        return true;
      } catch (e) {
        toast.pushError('toast.saveFailed', e);
        return false;
      }
    },

    async setAutostart(enabled: boolean): Promise<void> {
      const toast = useToastStore();
      try {
        await setAutostart(enabled);
        if (this.config) this.config.autostartEnabled = enabled;
        toast.push('success', 'toast.saved', { dedupeKey: 'saved', windowMs: 2000 });
      } catch (e) {
        toast.pushError('toast.saveFailed', e);
      }
    },

    /**
     * 全局限速热更新（set_global_speed_limit，后端落库 + 同步托盘菜单）。
     * announce = 设置页保存路径：成功要回"设置已保存"（2s 去重）；
     * 顶栏 chip 是即时开关，状态色/图标本身就是反馈，不加 toast 噪音。
     * 失败分支一律 toast（两条路径共用）。
     */
    async applyGlobalLimit(bps: number | null, announce = false): Promise<boolean> {
      const toast = useToastStore();
      try {
        await setGlobalSpeedLimit(bps);
        if (this.config) this.config.globalSpeedLimitBps = bps;
        if (announce) toast.push('success', 'toast.saved', { dedupeKey: 'saved', windowMs: 2000 });
        return true;
      } catch (e) {
        toast.pushError('toast.saveFailed', e);
        return false;
      }
    },

    async clearStats(): Promise<void> {
      const toast = useToastStore();
      try {
        await clearStats();
        toast.push('success', 'toast.clearedStats');
      } catch (e) {
        toast.pushError('toast.saveFailed', e);
      }
    },
  },
});
