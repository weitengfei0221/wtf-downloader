import { defineStore } from 'pinia';

/**
 * 全局 UI 状态：添加任务弹窗开关（Ctrl+N 全局可达，含设置页）+
 * resume_conflict 冲突任务（resume 命令 reject 或 task:failed 事件触发，
 * 确认弹窗由 App.vue 统一托管）。
 */
export const useUiStore = defineStore('ui', {
  state: () => ({
    addDialogOpen: false,
    resumeConflictTaskId: null as string | null,
  }),

  actions: {
    openAddDialog(): void {
      this.addDialogOpen = true;
    },
    closeAddDialog(): void {
      this.addDialogOpen = false;
    },
    openResumeConflict(taskId: string): void {
      this.resumeConflictTaskId = taskId;
    },
    closeResumeConflict(): void {
      this.resumeConflictTaskId = null;
    },
  },
});
