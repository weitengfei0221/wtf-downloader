import type { TaskRecord, TaskStatus } from '@/api/types';

/**
 * 批量动作状态判据（**唯一实现**，DESIGN.md §2.9）：
 * 按钮可用性与实际执行的目标集合都从这个函数取，禁止在组件里再写一遍
 * `status === 'paused'` 之类的判断——两份判据必然随需求变更分叉。
 */
export type BulkActionKey = 'pause' | 'resume' | 'retry';

const TARGET_STATUS: Record<BulkActionKey, TaskStatus> = {
  pause: 'downloading',
  resume: 'paused',
  retry: 'failed',
};

/** 该动作在当前勾选集合中真正适用的任务 id（按传入顺序，即 visible 顺序） */
export function bulkTargetIds(kind: BulkActionKey, tasks: TaskRecord[]): string[] {
  return tasks
    .filter((task) => task.status === TARGET_STATUS[kind])
    .map((task) => task.id);
}

/**
 * 删除确认按钮 key → `deleteFiles` 语义（**唯一实现**）。
 *
 * 只认 `with-files` 一个 key 为 true；`cancel` / `remove`（未完成任务的单按钮）/
 * 未知 key 一律 false——**默认不删文件**，任何拼写漂移都不会误删磁盘数据。
 * 单文件删除（TaskListView）与批量删除（TaskContextMenu）共用本函数，
 * 不各自再写 `key === 'with-files'`。
 */
export function deleteFilesFromKey(key: string): boolean {
  return key === 'with-files';
}
