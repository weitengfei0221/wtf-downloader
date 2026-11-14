import { computed, ref } from 'vue';
import { t } from '@/locales/zh-CN';
import { addTask } from '@/api/tasks';
import { deleteFilesFromKey } from '@/utils/bulk';
import type { ConfirmAction } from '@/utils/dialog';
import type { TaskRecord } from '@/api/types';
import { useTasksStore } from '@/stores/tasks';
import { useToastStore } from '@/stores/toast';

/**
 * 删除流程的**唯一实现**（DESIGN.md §2.5）。从 TaskListView.vue 抽出：
 * 视图只做接线（把 requestRemove 接到行内「删除」/ Delete 键，把 confirmRemove
 * 接到确认框的 @select），任何「删除确认框按状态派生」「撤销 toast」「.part 清理语义」
 * 都只在本文件里写一次，避免视图与菜单各写一份而分叉。
 */
export function useRemoveFlow() {
  const tasksStore = useTasksStore();
  const toast = useToastStore();
  const confirmTask = ref<TaskRecord | null>(null);

  /**
   * 删除流程（DESIGN.md §2.5）。两条路径语义不同，确认框按状态派生：
   * - 未完成：`.part` 无论按哪个键都由后端清除，所以只给「取消 / 删除」，
   *   多出来的「是否删文件」是假选项。
   * - 已完成：磁盘上有成品文件，必须让用户选「仅删除任务」还是「删除任务和文件」。
   */
  function requestRemove(task: TaskRecord): void {
    confirmTask.value = task;
  }

  const removeActions = computed<ConfirmAction[]>(() => {
    const cancel: ConfirmAction = {
      key: 'cancel',
      label: t('common.cancel'),
      variant: 'ghost',
      safe: true,
    };
    if (confirmTask.value?.status !== 'completed') {
      return [cancel, { key: 'remove', label: t('remove.confirm'), variant: 'destructive' }];
    }
    return [
      cancel,
      { key: 'task-only', label: t('remove.onlyTask'), variant: 'secondary', safe: true },
      { key: 'with-files', label: t('remove.withFiles'), variant: 'destructive' },
    ];
  });

  const removeMessage = computed(() => {
    const name = confirmTask.value?.filename ?? '';
    return t(
      confirmTask.value?.status === 'completed' ? 'remove.messageCompleted' : 'remove.message',
      { filename: name },
    );
  });

  /**
   * 已完成任务移除：`deleteFiles=false` 保留成品文件、给 5s 撤销；
   * `deleteFiles=true` 文件已删，撤销无从恢复，故不给撤销入口。
   */
  async function removeCompleted(task: TaskRecord, deleteFiles: boolean): Promise<void> {
    const payload = { url: task.url, filename: task.filename, dir: task.dir };
    try {
      await tasksStore.remove(task.id, deleteFiles);
      if (deleteFiles) {
        toast.push('info', 'remove.removedWithFileToast', {
          params: { filename: task.filename },
        });
        return;
      }
      toast.push('info', 'remove.removedToast', {
        params: { filename: task.filename },
        actionLabel: 'common.undo',
        durationMs: 5000,
        action: () => {
          void addTask(payload)
            .then(() => tasksStore.refresh())
            .catch((e: unknown) =>
              toast.pushError('add.addFailed', e),
            );
        },
      });
    } catch (e) {
      toast.pushError('toast.saveFailed', e);
    }
  }

  async function confirmRemove(key: string): Promise<void> {
    const task = confirmTask.value;
    confirmTask.value = null;
    if (!task || key === 'cancel') return;
    if (task.status === 'completed') {
      await removeCompleted(task, deleteFilesFromKey(key));
      return;
    }
    try {
      // 未完成任务：`.part` 由后端一律清除（AC-13），与按哪个键无关
      await tasksStore.remove(task.id, false);
    } catch (e) {
      toast.pushError('toast.saveFailed', e);
    }
  }

  return { confirmTask, removeActions, removeMessage, requestRemove, confirmRemove };
}
