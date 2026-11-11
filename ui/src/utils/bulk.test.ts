import { describe, expect, it } from 'vitest';
import type { TaskRecord, TaskStatus } from '@/api/types';
import { bulkTargetIds, deleteFilesFromKey } from './bulk';

/**
 * 行为验证：批量状态判据与删除语义都收敛在 `utils/bulk.ts` 一处。
 * 组件（TaskContextMenu 的 can.*）与编排（useBulkActions.run）共用这两个函数，
 * 这里守住「按状态决定可用性」与「按钮 key → deleteFiles」不出现第二份实现。
 */
const task = (id: string, status: TaskStatus): TaskRecord => ({
  id,
  url: 'https://example.com/f.zip',
  finalUrl: 'https://example.com/f.zip',
  filename: `${id}.zip`,
  dir: 'D:/downloads',
  totalBytes: 1000,
  status,
  speedLimit: null,
  error: null,
  retryCount: 0,
  downloadedBytes: 0,
  createdAt: 1,
  updatedAt: 1,
});

const mixed = [
  task('a', 'downloading'),
  task('b', 'paused'),
  task('c', 'failed'),
  task('d', 'completed'),
  task('e', 'pending'),
];

describe('bulkTargetIds：动作 → 状态判据（唯一实现）', () => {
  it('暂停只取 downloading', () => {
    expect(bulkTargetIds('pause', mixed)).toEqual(['a']);
  });

  it('继续只取 paused', () => {
    expect(bulkTargetIds('resume', mixed)).toEqual(['b']);
  });

  it('重试只取 failed', () => {
    expect(bulkTargetIds('retry', mixed)).toEqual(['c']);
  });

  it('无适用任务返回空数组（按钮禁用、零命令调用）', () => {
    expect(bulkTargetIds('pause', [task('x', 'completed')])).toEqual([]);
    expect(bulkTargetIds('resume', [task('x', 'downloading')])).toEqual([]);
    expect(bulkTargetIds('retry', [task('x', 'paused')])).toEqual([]);
  });

  it('多条适用任务保持传入顺序（即 visible 顺序）', () => {
    const rows = [task('p2', 'downloading'), task('p1', 'downloading'), task('p3', 'downloading')];
    expect(bulkTargetIds('pause', rows)).toEqual(['p2', 'p1', 'p3']);
  });
});

describe('deleteFilesFromKey：按钮 key → deleteFiles（唯一实现，默认不删）', () => {
  it('with-files → true（删除任务和文件）', () => {
    expect(deleteFilesFromKey('with-files')).toBe(true);
  });

  it('task-only → false（仅删除任务，文件保留）', () => {
    expect(deleteFilesFromKey('task-only')).toBe(false);
  });

  it('cancel / 未完成任务的单按钮 remove / 未知 key / 空串 → false（绝不误删文件）', () => {
    expect(deleteFilesFromKey('cancel')).toBe(false);
    expect(deleteFilesFromKey('remove')).toBe(false);
    expect(deleteFilesFromKey('with_files')).toBe(false);
    expect(deleteFilesFromKey('')).toBe(false);
  });
});
