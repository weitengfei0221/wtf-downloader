<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { t } from '@/locales/zh-CN';
import { addTask, onTaskCompleted, onTaskCreated, onTaskFailed, onTaskRemoved, onTaskStateChanged, type UnlistenFn } from '@/api/tasks';
import { sendTaskCompletedNotification, sendTaskFailedNotification } from '@/api/notification';
import { isResumeConflict } from '@/api/invoke';
import { useUiStore } from '@/stores/ui';
import { useTasksStore } from '@/stores/tasks';
import { useConfigStore } from '@/stores/config';
import { useToastStore } from '@/stores/toast';
import { useUpdaterStore } from '@/stores/updater';
import AddTaskDialog from '@/components/AddTaskDialog.vue';
import ToastHost from '@/components/ToastHost.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import UpdateDialogs from '@/components/UpdateDialogs.vue';

/**
 * 应用外壳：路由出口 + 全局模态（添加任务 / resume_conflict 冲突确认 / 更新确认与进度）+
 * Toast 宿主 + 全局快捷键（Ctrl+N）+ 任务事件接线（低频 listen，SPEC.md §5.2）+
 * 启动延迟自动检查更新（§4.4）。
 */
const uiStore = useUiStore();
const tasksStore = useTasksStore();
const configStore = useConfigStore();
const toast = useToastStore();
const updater = useUpdaterStore();

/** 冷启动不抢主线程：3s 后再检查，失败完全静默（端点未配置/断网都不弹错） */
const AUTO_CHECK_DELAY_MS = 3000;
let autoCheckTimer: number | undefined;

const conflictTask = computed(() =>
  uiStore.resumeConflictTaskId != null ? tasksStore.byId(uiStore.resumeConflictTaskId) : undefined,
);

function onCtrlN(e: KeyboardEvent): void {
  if (e.ctrlKey && (e.key === 'n' || e.key === 'N')) {
    e.preventDefault();
    uiStore.openAddDialog();
  }
}

/**
 * resume_conflict（AC-09）：用户确认重下 = remove(delete_files: true) + add(原 url)
 * 的组合（ARCHITECTURE.md §3.2 定案，不新增端点）。
 */
async function confirmRedownload(): Promise<void> {
  const task = conflictTask.value;
  uiStore.closeResumeConflict();
  if (!task) return;
  try {
    // 重新下载：旧成品文件一并删掉，避免半旧半新
    await tasksStore.remove(task.id, true);
    await addTask({ url: task.url, filename: task.filename, dir: task.dir });
    toast.push('success', 'add.addedToast', { params: { n: 1 } });
  } catch (e) {
    toast.pushError('toast.saveFailed', e);
  }
}

const unlisteners: UnlistenFn[] = [];

/** 事件载荷只含 taskId，文件名从本地 store 取（事件到达时记录仍在列表） */
function filenameOf(taskId: string): string {
  return tasksStore.byId(taskId)?.filename ?? t('notify.unknownFile');
}

onMounted(async () => {
  window.addEventListener('keydown', onCtrlN);
  if (configStore.config == null) void configStore.load();
  void updater.loadVersion();
  autoCheckTimer = window.setTimeout(() => void updater.autoCheck(), AUTO_CHECK_DELAY_MS);
  // 任务事件 → store（失败事件含 resume_conflict 时弹"是否重下"）
  unlisteners.push(
    await onTaskCreated(() => void tasksStore.refresh()),
    await onTaskRemoved(() => void tasksStore.refresh()),
    await onTaskStateChanged((p) => void tasksStore.onStateChanged(p)),
    await onTaskFailed((p) => {
      // AC-09（续传冲突 → 弹"是否重新下载"）判定收敛为单一实现 isResumeConflict：
      // 优先认事件载荷的 code，error 文本嗅探只作过渡兼容（后端 code 全量发布后删，见 OPEN-DECISIONS.md）
      if (isResumeConflict(p)) uiStore.openResumeConflict(p.taskId);
      // 失败必须通知，不受开关控制（PRD F9 语义）
      void sendTaskFailedNotification(filenameOf(p.taskId), p.error);
      void tasksStore.refresh();
    }),
    // 完成通知受 notifyOnComplete 开关控制（PRD F9 / Spec §7）
    await onTaskCompleted((p) => {
      if (configStore.config?.notifyOnComplete) {
        void sendTaskCompletedNotification(filenameOf(p.taskId));
      }
    }),
  );
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onCtrlN);
  if (autoCheckTimer !== undefined) window.clearTimeout(autoCheckTimer);
  for (const unlisten of unlisteners) unlisten();
});
</script>

<template>
  <div class="app">
    <RouterView />
    <AddTaskDialog />
    <ToastHost />
    <UpdateDialogs />

    <ConfirmDialog
      v-if="conflictTask"
      :title="t('conflict.title')"
      :message="t('conflict.message')"
      :actions="[
        { key: 'cancel', label: t('common.cancel'), variant: 'ghost', safe: true },
        { key: 'redownload', label: t('conflict.redownload'), variant: 'primary' },
      ]"
      @select="
        (key) => {
          if (key === 'redownload') void confirmRedownload();
          else uiStore.closeResumeConflict();
        }
      "
    />
  </div>
</template>

<style scoped>
.app {
  height: 100%;
}
</style>
