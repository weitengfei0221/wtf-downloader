import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { TaskRecord, TaskStatus } from '@/api/types';

/**
 * 批量动作编排行为验证（DESIGN.md §2.9）：mock 掉整个 api/tasks，跑真实
 * composable + 真实 store，断言「不新增后端 API / 按状态调用 / 单条失败不中断 /
 * 部分失败可见 / 一次刷新 / deleteFiles 逐条传递 / resume_conflict 单点」。
 */
const mocks = vi.hoisted(() => ({
  listTasks: vi.fn(),
  pauseTask: vi.fn(),
  resumeTask: vi.fn(),
  retryTask: vi.fn(),
  removeTask: vi.fn(),
  setTaskSpeedLimit: vi.fn(),
}));

vi.mock('@/api/tasks', () => ({
  listTasks: mocks.listTasks,
  pauseTask: mocks.pauseTask,
  resumeTask: mocks.resumeTask,
  retryTask: mocks.retryTask,
  removeTask: mocks.removeTask,
  setTaskSpeedLimit: mocks.setTaskSpeedLimit,
}));

import { ApiError } from '@/api/invoke';
import { useToastStore } from '@/stores/toast';
import { useUiStore } from '@/stores/ui';
import { useBulkActions } from './useBulkActions';

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

beforeEach(() => {
  setActivePinia(createPinia());
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.listTasks.mockResolvedValue([]);
  mocks.pauseTask.mockResolvedValue(null);
  mocks.resumeTask.mockResolvedValue(null);
  mocks.retryTask.mockResolvedValue(null);
  mocks.removeTask.mockResolvedValue(null);
  mocks.setTaskSpeedLimit.mockResolvedValue(null);
});

describe('批量暂停/继续/重试：调用形状', () => {
  const mixed = [
    task('a', 'downloading'),
    task('b', 'paused'),
    task('c', 'failed'),
    task('d', 'completed'),
  ];

  it('暂停只对 downloading 调 pauseTask，其余命令零调用', async () => {
    const result = await useBulkActions().run('pause', mixed);
    expect(mocks.pauseTask).toHaveBeenCalledExactlyOnceWith('a');
    expect(mocks.resumeTask).not.toHaveBeenCalled();
    expect(mocks.retryTask).not.toHaveBeenCalled();
    expect(result).toEqual({ succeeded: ['a'], failed: 0, total: 1 });
  });

  it('继续只对 paused 调 resumeTask；重试只对 failed 调 retryTask', async () => {
    const bulk = useBulkActions();
    expect(await bulk.run('resume', mixed)).toEqual({ succeeded: ['b'], failed: 0, total: 1 });
    expect(mocks.resumeTask).toHaveBeenCalledExactlyOnceWith('b');
    expect(await bulk.run('retry', mixed)).toEqual({ succeeded: ['c'], failed: 0, total: 1 });
    expect(mocks.retryTask).toHaveBeenCalledExactlyOnceWith('c');
  });

  it('无适用任务 → 零命令、零刷新', async () => {
    const result = await useBulkActions().run('pause', [task('x', 'completed')]);
    expect(result).toEqual({ succeeded: [], failed: 0, total: 0 });
    expect(mocks.pauseTask).not.toHaveBeenCalled();
    expect(mocks.listTasks).not.toHaveBeenCalled();
  });

  it('N 条成功只 refresh 一次（循环内不做 N 次 list_tasks）', async () => {
    const rows = [task('a', 'downloading'), task('b', 'downloading'), task('c', 'downloading')];
    await useBulkActions().run('pause', rows);
    expect(mocks.pauseTask).toHaveBeenCalledTimes(3);
    expect(mocks.listTasks).toHaveBeenCalledTimes(1);
  });
});

describe('单条失败不中断 + 部分失败可见', () => {
  it('第一条失败后仍执行余下条目，失败计数与 succeeded 正确', async () => {
    mocks.pauseTask.mockRejectedValueOnce(new Error('task_not_found'));
    mocks.pauseTask.mockResolvedValueOnce(null);

    const rows = [task('a', 'downloading'), task('b', 'downloading')];
    const result = await useBulkActions().run('pause', rows);

    expect(mocks.pauseTask).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ succeeded: ['b'], failed: 1, total: 2 });
  });

  it('部分失败：既有单条错误 toast，也有汇总 toast（不静默吞）', async () => {
    mocks.pauseTask.mockRejectedValueOnce(new Error('boom'));
    mocks.pauseTask.mockResolvedValueOnce(null);

    await useBulkActions().run('pause', [task('a', 'downloading'), task('b', 'downloading')]);

    const items = useToastStore().items;
    expect(items.filter((i) => i.kind === 'error')).toHaveLength(1);
    expect(items.some((i) => i.kind === 'info' && i.message.includes('2 项中有 1 项未完成'))).toBe(true);
  });

  it('全失败时零刷新（没有成功条目就不必拉列表）', async () => {
    mocks.pauseTask.mockRejectedValue(new Error('offline'));
    const result = await useBulkActions().run('pause', [task('a', 'downloading')]);
    expect(result.succeeded).toEqual([]);
    expect(mocks.listTasks).not.toHaveBeenCalled();
  });

  it('resume_conflict 走 isResumeConflict 单点 → 打开冲突弹窗，不重复 toast', async () => {
    mocks.resumeTask.mockRejectedValueOnce(new ApiError('resume_conflict', '资源已变化'));
    const result = await useBulkActions().run('resume', [task('a', 'paused')]);

    expect(result.failed).toBe(1);
    expect(useUiStore().resumeConflictTaskId).toBe('a');
    expect(useToastStore().items.filter((i) => i.kind === 'error')).toHaveLength(0);
  });
});

describe('批量删除：deleteFiles 逐条原样传递 + 返回 succeeded 供清理勾选', () => {
  it('withFiles=true 时每条都传 true（含已完成任务，成品文件由后端删）', async () => {
    const rows = [task('a', 'downloading'), task('b', 'completed')];
    const result = await useBulkActions().remove(rows, true);

    expect(mocks.removeTask.mock.calls).toEqual([
      ['a', true],
      ['b', true],
    ]);
    expect(result.succeeded).toEqual(['a', 'b']);
    expect(mocks.listTasks).toHaveBeenCalledTimes(1);
  });

  it('withFiles=false 时每条都传 false（文件保留）', async () => {
    await useBulkActions().remove([task('a', 'completed')], false);
    expect(mocks.removeTask).toHaveBeenCalledExactlyOnceWith('a', false);
  });

  it('单条删除失败不中断其余，部分失败给汇总且只返回成功 id', async () => {
    mocks.removeTask.mockRejectedValueOnce(new Error('io_error'));
    mocks.removeTask.mockResolvedValueOnce(null);

    const result = await useBulkActions().remove([task('a', 'failed'), task('b', 'failed')], true);

    expect(mocks.removeTask).toHaveBeenCalledTimes(2);
    expect(result.succeeded).toEqual(['b']);
    expect(result.failed).toBe(1);
    expect(useToastStore().items.some((i) => i.message.includes('2 项中有 1 项未完成'))).toBe(true);
  });
});
