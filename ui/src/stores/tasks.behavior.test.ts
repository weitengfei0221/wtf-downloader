import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

/**
 * 行为验证（不是源码字符串断言）：把 `@/api/tasks` 整体 mock 掉，直接跑 store，
 * 复现 2026-11 用户实测的三条路径：
 * 1) 设限速 → 立刻能在本地读到新 speedLimit（且不再多发一次 list_tasks）；
 * 2) 设不限速 → speedLimit 变 null（重开面板才会是空输入框）；
 * 3) 两次 fetch 同一批数据 → 任务对象身份保留（行不重建 + 不重放入场动画）；
 * 4) state-changed 事件 → 本地即时置状态，不多发 list_tasks（不闪）。
 */
const mocks = vi.hoisted(() => ({
  listTasks: vi.fn(),
  setTaskSpeedLimit: vi.fn(),
  pauseTask: vi.fn(),
  resumeTask: vi.fn(),
  retryTask: vi.fn(),
  removeTask: vi.fn(),
}));

vi.mock('@/api/tasks', () => ({
  listTasks: mocks.listTasks,
  setTaskSpeedLimit: mocks.setTaskSpeedLimit,
  pauseTask: mocks.pauseTask,
  resumeTask: mocks.resumeTask,
  retryTask: mocks.retryTask,
  removeTask: mocks.removeTask,
}));

import { useTasksStore } from './tasks';
import type { ProgressFrame, TaskRecord } from '@/api/types';

/** 第 0 行（noUncheckedIndexedAccess 下需显式断言，避免测试里散落 `!`） */
function first(store: ReturnType<typeof useTasksStore>): TaskRecord {
  const row = store.tasks[0];
  if (row == null) throw new Error('tasks 为空：期望至少一条任务');
  return row;
}

/** 当前列表的 id 序列（断言顺序/增删用） */
function ids(store: ReturnType<typeof useTasksStore>): string[] {
  return store.tasks.map((row) => row.id);
}

const task = (over: Partial<TaskRecord> = {}): TaskRecord => ({
  id: 't1',
  url: 'https://example.com/a.zip',
  finalUrl: 'https://example.com/a.zip',
  filename: 'a.zip',
  dir: 'D:/downloads',
  totalBytes: 2_000_000,
  status: 'downloading',
  speedLimit: null,
  error: null,
  retryCount: 0,
  downloadedBytes: 1000,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const frame = (over: Partial<ProgressFrame> = {}): ProgressFrame => ({
  taskId: 't1',
  downloadedBytes: 1200,
  totalBytes: 2_000_000,
  speedBps: 500_000,
  etaSecs: 2,
  segments: [],
  ...over,
});

beforeEach(() => {
  setActivePinia(createPinia());
  mocks.listTasks.mockReset();
  mocks.setTaskSpeedLimit.mockReset();
  mocks.setTaskSpeedLimit.mockResolvedValue(null);
});

describe('限速即时生效（缺陷 1 / 2）', () => {
  it('设限速后立刻本地可见，且不额外拉列表', async () => {
    mocks.listTasks.mockResolvedValueOnce([task()]);
    const store = useTasksStore();
    await store.fetch(true);
    expect(first(store).speedLimit).toBeNull();

    await store.setTaskLimit('t1', 2_000_000);

    expect(mocks.setTaskSpeedLimit).toHaveBeenCalledWith('t1', 2_000_000);
    expect(first(store).speedLimit).toBe(2_000_000); // 行内「限 X MB/s」立刻能读到
    expect(mocks.listTasks).toHaveBeenCalledTimes(1); // 只算首屏那次 → 没有 refresh
  });

  it('设不限速写 null（不是 0 / undefined），重开面板据此显示空输入', async () => {
    mocks.listTasks.mockResolvedValueOnce([task({ speedLimit: 2_000_000 })]);
    const store = useTasksStore();
    await store.fetch(true);

    await store.setTaskLimit('t1', null);

    expect(mocks.setTaskSpeedLimit).toHaveBeenLastCalledWith('t1', null);
    expect(first(store).speedLimit).toBeNull();
    expect(first(store).speedLimit).not.toBe(0);
  });

  it('命令失败时向上抛（调用方 toast），且不污染本地值', async () => {
    mocks.listTasks.mockResolvedValueOnce([task({ speedLimit: 1_000_000 })]);
    mocks.setTaskSpeedLimit.mockRejectedValueOnce(new Error('task_not_found'));
    const store = useTasksStore();
    await store.fetch(true);

    await expect(store.setTaskLimit('t1', 3_000_000)).rejects.toThrow('task_not_found');
    expect(first(store).speedLimit).toBe(1_000_000); // 保持服务端已知值
  });
});

describe('刷新不闪烁（缺陷 3）', () => {
  it('两次 fetch 同一批任务：对象身份保留，字段就地更新', async () => {
    mocks.listTasks.mockResolvedValueOnce([task({ status: 'downloading' })]);
    const store = useTasksStore();
    await store.fetch(true);
    const firstRef = first(store);

    mocks.listTasks.mockResolvedValueOnce([task({ status: 'paused', downloadedBytes: 5000 })]);
    await store.refresh();

    expect(first(store)).toBe(firstRef); // 同一对象 → 行组件不重建
    expect(firstRef.status).toBe('paused');
    expect(firstRef.downloadedBytes).toBe(5000);
  });

  it('服务端删掉的任务从列表移除，新增任务追加在服务端给出的位置', async () => {
    mocks.listTasks.mockResolvedValueOnce([task({ id: 't1' }), task({ id: 't2' })]);
    const store = useTasksStore();
    await store.fetch(true);

    mocks.listTasks.mockResolvedValueOnce([task({ id: 't3' }), task({ id: 't2' })]);
    await store.refresh();

    expect(ids(store)).toEqual(['t3', 't2']);
  });

  it('state-changed 事件本地置状态，不再多发 list_tasks（这是"闪一下"的来源）', async () => {
    mocks.listTasks.mockResolvedValueOnce([task({ status: 'downloading' })]);
    const store = useTasksStore();
    await store.fetch(true);
    store.applyFrame(frame());

    await store.onStateChanged({ taskId: 't1', from: 'downloading', to: 'completed' });

    expect(first(store).status).toBe('completed');
    expect(mocks.listTasks).toHaveBeenCalledTimes(1); // 无 refresh
    expect(store.frames.t1).toBeUndefined(); // 非下载态帧被清（防陈旧速度）
  });

  it('完成态补齐"不 refresh 就没人补"的字段：最后一帧字节数 + 完成时间', async () => {
    mocks.listTasks.mockResolvedValueOnce([task({ status: 'downloading', totalBytes: null })]);
    const store = useTasksStore();
    await store.fetch(true);
    store.applyFrame(frame({ downloadedBytes: 2_000_000, totalBytes: 2_000_000 }));
    const before = first(store).updatedAt;

    await store.onStateChanged({ taskId: 't1', from: 'downloading', to: 'completed' });

    const row = first(store);
    expect(row.downloadedBytes).toBe(2_000_000); // 来自最后一帧
    expect(row.totalBytes).toBe(2_000_000); // 未知大小由帧补上，完成行不再是 "--"
    expect(row.updatedAt).toBeGreaterThanOrEqual(before); // 「完成于」不能停在旧时间
    expect(row.updatedAt).toBeGreaterThan(before);
  });

  it('失败事件带原因则落到行内错误文案，恢复态清掉旧原因', async () => {
    mocks.listTasks.mockResolvedValueOnce([task({ status: 'downloading' })]);
    const store = useTasksStore();
    await store.fetch(true);

    await store.onStateChanged({
      taskId: 't1',
      from: 'downloading',
      to: 'failed',
      error: '服务器返回 404',
    });
    expect(first(store).error).toBe('服务器返回 404');

    await store.onStateChanged({ taskId: 't1', from: 'failed', to: 'pending' });
    expect(first(store).error).toBeNull();
  });

  it('本地缺该任务（漏了 created 事件）才兜底拉一次', async () => {
    mocks.listTasks.mockResolvedValueOnce([]);
    const store = useTasksStore();
    await store.fetch(true);

    mocks.listTasks.mockResolvedValueOnce([task({ id: 't9' })]);
    await store.onStateChanged({ taskId: 't9', from: 'pending', to: 'downloading' });

    expect(mocks.listTasks).toHaveBeenCalledTimes(2);
    expect(ids(store)).toEqual(['t9']);
  });

  it('合并过程中 4Hz 帧不被清空（pruneFrames 只清非下载态）', async () => {
    mocks.listTasks.mockResolvedValue([task({ status: 'downloading' })]);
    const store = useTasksStore();
    await store.fetch(true);
    store.applyFrame(frame());

    await store.refresh(); // 下载中任务，刷新仍应保留帧

    expect(store.frames.t1?.speedBps).toBe(500_000);
    expect(store.totalSpeedBps).toBe(500_000);
  });
});
