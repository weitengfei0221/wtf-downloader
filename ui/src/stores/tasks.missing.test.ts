import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { ProgressFrame, TaskRecord, TaskStatus } from '@/api/types';

/**
 * 文件丢失「瞬时呈现态」的 store 行为验证（DESIGN.md §2.10）+ 契约护栏。
 * 核心：它不写 TaskRecord、不落库、不改 TaskStatus、不增删任务记录；
 * 独立筛选 missingOnly 与四值状态筛选是 AND 关系，不引入第五个 TaskFilter 值。
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

import { fileMissingIdsOf, useTasksStore } from './tasks';

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
  downloadedBytes: 1000,
  createdAt: 1,
  updatedAt: 1,
});

const frame = (over: Partial<ProgressFrame> = {}): ProgressFrame => ({
  taskId: 't1',
  downloadedBytes: 100,
  totalBytes: 1000,
  speedBps: 500,
  etaSecs: 2,
  segments: [],
  ...over,
});

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

beforeEach(() => {
  setActivePinia(createPinia());
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.listTasks.mockResolvedValue([]);
});

describe('fileMissingIdsOf：唯一判据（命中缺失集合 ∧ 当前仍 completed）', () => {
  it('只保留已完成任务，非完成态/幽灵 id 一律不算', () => {
    const rows = [task('a', 'completed'), task('b', 'downloading'), task('c', 'failed')];
    const missing = fileMissingIdsOf(rows, ['a', 'b', 'c', 'ghost']);
    expect([...missing]).toEqual(['a']);
  });

  it('任务不再是 completed 时徽标自动消失（本地状态先于检测结果变化）', () => {
    const rows = [task('a', 'paused')];
    expect(fileMissingIdsOf(rows, ['a']).size).toBe(0);
  });
});

describe('setMissingFileIds：唯一写入口，校验形状、去重、不落库', () => {
  it('只收字符串数组并去重', () => {
    const store = useTasksStore();
    store.setMissingFileIds(['a', 1, null, 'a', 'b']);
    expect(store.missingFileIds).toEqual(['a', 'b']);
  });

  it('非数组返回一律忽略，保留上一次呈现态', () => {
    const store = useTasksStore();
    store.setMissingFileIds(['a']);
    store.setMissingFileIds({ code: 'not_registered' });
    store.setMissingFileIds(null);
    expect(store.missingFileIds).toEqual(['a']);
  });

  it('绝不把标记写进 TaskRecord（逐字段契约一个字段都不加）', () => {
    const store = useTasksStore();
    store.tasks = [task('a', 'completed')];
    const before = Object.keys(store.tasks[0] ?? {}).sort();
    store.setMissingFileIds(['a']);
    const after = store.tasks[0];
    expect(Object.keys(after ?? {}).sort()).toEqual(before);
    expect(after).not.toHaveProperty('fileMissing');
    expect(after).not.toHaveProperty('missingFileIds');
    expect(after?.status).toBe('completed'); // 任务状态不动
    expect(store.tasks).toHaveLength(1); // 任务记录不删
  });

  it('空数组（文件都回来了）顺手关掉独立筛选，不留空筛选', () => {
    const store = useTasksStore();
    store.tasks = [task('a', 'completed')];
    store.setMissingFileIds(['a']);
    store.toggleMissingOnly();
    expect(store.missingOnly).toBe(true);

    store.setMissingFileIds([]);
    expect(store.missingIdSet.size).toBe(0);
    expect(store.missingOnly).toBe(false);
    expect(store.visible.map((row) => row.id)).toEqual(['a']);
  });
});

describe('可单独筛选：与四值状态筛选 AND，不破坏 TaskFilter 语义', () => {
  it('missingOnly 只显示「缺失 ∧ completed」的行', () => {
    const store = useTasksStore();
    store.tasks = [task('a', 'completed'), task('b', 'completed'), task('c', 'downloading')];
    store.setMissingFileIds(['a', 'c']);

    store.toggleMissingOnly();
    expect(store.missingOnly).toBe(true);
    expect(store.filter).toBe('all');
    expect(store.visible.map((row) => row.id)).toEqual(['a']);
  });

  it('toggleMissingOnly 可再点一次退出；无缺失时不可开启', () => {
    const store = useTasksStore();
    store.toggleMissingOnly();
    expect(store.missingOnly).toBe(false);

    store.tasks = [task('a', 'completed')];
    store.setMissingFileIds(['a']);
    store.toggleMissingOnly();
    store.toggleMissingOnly();
    expect(store.missingOnly).toBe(false);
    expect(store.visible.map((row) => row.id)).toEqual(['a']);
  });

  it('切任一状态 Tab 退出独立筛选（setFilter 单点），四值语义不变', () => {
    const store = useTasksStore();
    store.tasks = [task('a', 'completed'), task('b', 'downloading')];
    store.setMissingFileIds(['a']);
    store.toggleMissingOnly();

    store.setFilter('completed');
    expect(store.missingOnly).toBe(false);
    expect(store.visible.map((row) => row.id)).toEqual(['a']);
    store.setFilter('failed');
    expect(store.visible).toEqual([]);
  });

  it('搜索与 missingOnly 叠加仍是 AND', () => {
    const store = useTasksStore();
    store.tasks = [task('a', 'completed'), task('b', 'completed')];
    store.tasks[0]!.filename = 'alpha.zip';
    store.tasks[1]!.filename = 'beta.zip';
    store.setMissingFileIds(['a', 'b']);
    store.toggleMissingOnly();
    store.search = 'beta';
    expect(store.visible.map((row) => row.id)).toEqual(['b']);
  });
});

describe('检测时机：fetch 成功才重查，4Hz 帧与失败都不触发', () => {
  it('fetch 成功递增 fetchRevision；失败不递增（不拿陈旧 id 探测）', async () => {
    const store = useTasksStore();
    mocks.listTasks.mockResolvedValueOnce([task('a', 'completed')]);
    await store.fetch(true);
    expect(store.fetchRevision).toBe(1);

    mocks.listTasks.mockRejectedValueOnce(new Error('offline'));
    await store.fetch(false);
    expect(store.fetchRevision).toBe(1);
  });

  it('applyFrame（4Hz 进度帧）不递增 fetchRevision', () => {
    const store = useTasksStore();
    store.tasks = [task('a', 'downloading')];
    store.applyFrame(frame({ taskId: 'a' }));
    expect(store.fetchRevision).toBe(0);
    expect(store.frames.a?.speedBps).toBe(500);
  });
});

describe('契约护栏：TaskRecord / TaskStatus / TaskFilter 一个字段都不加', () => {
  const types = read('../api/types.ts');

  it('TaskStatus 五态与 TaskFilter 四值原样', () => {
    expect(types).toContain("export type TaskStatus = 'pending' | 'downloading' | 'paused' | 'failed' | 'completed';");
    expect(types).toContain("export type TaskFilter = 'all' | 'downloading' | 'completed' | 'failed';");
  });

  it('types.ts 不含任何文件丢失呈现态字段', () => {
    expect(types).not.toContain('fileMissing');
    expect(types).not.toContain('missingFileIds');
    expect(types).not.toContain('missingOnly');
  });
});
