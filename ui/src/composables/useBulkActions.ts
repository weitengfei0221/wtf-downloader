import { isResumeConflict } from '@/api/invoke';
import { pauseTask, resumeTask, retryTask, removeTask } from '@/api/tasks';
import type { TaskRecord } from '@/api/types';
import { bulkTargetIds, type BulkActionKey } from '@/utils/bulk';
import { useTasksStore } from '@/stores/tasks';
import { useToastStore } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';

export interface BulkResult {
  /** 执行成功的 id（删除时用于清理勾选） */
  succeeded: string[];
  failed: number;
  total: number;
}

/**
 * 批量动作编排（DESIGN.md §2.9）。
 *
 * - **不新增后端 API**：循环复用现有 `pauseTask` / `resumeTask` / `retryTask` /
 *   `removeTask`，每条独立 try/catch；单条失败走 `toast.pushError` 且不中断其余条目。
 * - **一次刷新**：循环结束才 `refresh()` 一次，避免 N 条动作触发 N 次 `list_tasks`
 *   （性能盲区：循环内 IO 放大）。这也是不直接调 store.pause/resume/retry 的原因。
 * - **部分失败可见**：`failed > 0` 时额外推汇总 toast，不静默吞。
 */
export function useBulkActions() {
  const tasksStore = useTasksStore();
  const toast = useToastStore();
  const uiStore = useUiStore();

  async function run(kind: BulkActionKey, selected: TaskRecord[]): Promise<BulkResult> {
    // 状态判据只有一处：按钮可用性与这里的目标集合共用 bulkTargetIds
    const ids = bulkTargetIds(kind, selected);
    const succeeded: string[] = [];
    let failed = 0;
    for (const id of ids) {
      try {
        if (kind === 'pause') await pauseTask(id);
        else if (kind === 'resume') await resumeTask(id);
        else await retryTask(id);
        succeeded.push(id);
      } catch (e) {
        failed += 1;
        if (kind === 'resume' && isResumeConflict(e)) uiStore.openResumeConflict(id);
        else toast.pushError('toast.saveFailed', e);
      }
    }
    if (failed > 0) {
      toast.push('info', 'bulk.partialFailed', { params: { failed, total: ids.length } });
    }
    if (succeeded.length > 0) await tasksStore.refresh();
    return { succeeded, failed, total: ids.length };
  }

  /**
   * 批量删除：`deleteFiles` 逐条原样传递。
   * 语义单点在后端（AC-13）：`.part` 一律清；已完成任务的成品文件只在
   * `deleteFiles=true` 时删。
   */
  async function remove(selected: TaskRecord[], deleteFiles: boolean): Promise<BulkResult> {
    const succeeded: string[] = [];
    let failed = 0;
    for (const task of selected) {
      try {
        await removeTask(task.id, deleteFiles);
        succeeded.push(task.id);
      } catch (e) {
        failed += 1;
        toast.pushError('toast.saveFailed', e);
      }
    }
    if (failed > 0) {
      toast.push('info', 'bulk.partialFailed', { params: { failed, total: selected.length } });
    }
    if (succeeded.length > 0) await tasksStore.refresh();
    return { succeeded, failed, total: selected.length };
  }

  return { run, remove };
}
