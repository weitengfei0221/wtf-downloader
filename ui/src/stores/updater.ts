import { defineStore } from 'pinia';
import {
  checkForUpdate,
  discardPendingUpdate,
  getAppVersion,
  hasPendingUpdate,
  installUpdate,
  type UpdateInfo,
  type UpdateProgress,
} from '@/api/updater';
import { useToastStore } from './toast';

/**
 * 更新状态（DESIGN.md §4.4，第十轮）：启动自动检查 + 设置页手动检查共用同一份状态。
 *
 * 两条检查路径唯一的差别是**失败反馈策略**：
 * - auto（启动 3s 后）：完全静默，不弹 toast、不外抛，只把 lastCheckFailed 留在设置页。
 *   网络不通 / 端点未配置是常态，冷启动弹错属于打扰用户。
 * - manual（设置页按钮）：失败给可见 error toast，让用户知道「点了没反应」的原因。
 *
 * 下载/安装只能由 confirmInstall() 触发（用户点「立即更新」之后），
 * checkUpdate() 绝不下载——Windows 安装会直接退出应用，必须先经确认框明示退出提示。
 *
 * 安装完成后不调用任何重启 API：Tauri v2 在 Windows 安装阶段会自动退出应用，
 * relaunch 不可达；installing 保持 true 让进度弹窗留到进程退出，由用户手动重开。
 */
export type CheckMode = 'auto' | 'manual';

export const useUpdaterStore = defineStore('updater', {
  state: () => ({
    /** 当前应用版本（Tauri getVersion()，不硬编码）；取不到时为空，UI 显示「版本未知」 */
    currentVersion: '' as string,
    /** 上次检查时刻（epoch ms）；null = 从未检查 */
    lastCheckedAt: null as number | null,
    lastCheckFailed: false,
    checking: false,
    /** 已发现但尚未确认安装的更新元数据 */
    available: null as UpdateInfo | null,
    confirmOpen: false,
    installing: false,
    progress: null as UpdateProgress | null,
  }),

  actions: {
    /** 静默读取版本号：Tauri 未就绪时保持空串，由 UI 显示降级文案，绝不阻塞启动。 */
    async loadVersion(): Promise<void> {
      if (this.currentVersion !== '') return;
      try {
        this.currentVersion = await getAppVersion();
      } catch {
        this.currentVersion = '';
      }
    },

    async autoCheck(): Promise<void> {
      await this.checkUpdate('auto');
    },

    async manualCheck(): Promise<void> {
      await this.checkUpdate('manual');
    },

    async checkUpdate(mode: CheckMode): Promise<void> {
      // 幂等守卫：重复点击 / 自动与手动撞车 / 安装进行中都不再发请求
      if (this.checking || this.installing || this.confirmOpen) return;
      this.checking = true;
      try {
        const info = await checkForUpdate();
        this.lastCheckedAt = Date.now();
        this.lastCheckFailed = false;
        if (info != null) {
          this.available = info;
          this.confirmOpen = true;
        } else if (mode === 'manual') {
          useToastStore().push('info', 'update.upToDate');
        }
      } catch (e) {
        this.lastCheckedAt = Date.now();
        this.lastCheckFailed = true;
        this.available = null;
        // auto 分支刻意完全静默：无 toast、无 console；状态已落在 lastCheckFailed。
        if (mode === 'manual') useToastStore().pushError('update.checkFailed', e);
      } finally {
        this.checking = false;
      }
    },

    /** 用户点「稍后」：关闭确认框并释放 Rust 侧 Update 资源。 */
    async dismissConfirm(): Promise<void> {
      this.confirmOpen = false;
      this.available = null;
      await discardPendingUpdate();
    },

    /** 用户点「立即更新」：唯一允许下载/安装的入口。 */
    async confirmInstall(): Promise<void> {
      if (this.available == null || !hasPendingUpdate() || this.installing) return;
      this.confirmOpen = false;
      this.installing = true;
      this.progress = { downloaded: 0, total: null };
      try {
        await installUpdate((progress) => {
          this.progress = { ...progress };
        });
      } catch (e) {
        useToastStore().pushError('update.installFailed', e);
        this.installing = false;
        this.available = null;
        await discardPendingUpdate();
        return;
      }
      // 安装器已接管：Windows 上应用随即自动退出，不做任何重启调用。
      // installing 保持 true，进度弹窗显示到进程退出；用户重新打开即完成更新。
    },
  },
});
