import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { TaskRecord } from '@/api/types';

/**
 * 文件丢失检测行为验证（DESIGN.md §2.10）。
 * 跑纯工厂 createMissingFileChecker + 真实 store：`check_files` 是需求 2 的唯一
 * 数据源，失败必须留一条 warn（不能零日志静默失效），且绝不污染已有呈现态。
 */
const mocks = vi.hoisted(() => ({
  checkFiles: vi.fn(),
  listTasks: vi.fn(),
  pauseTask: vi.fn(),
  resumeTask: vi.fn(),
  retryTask: vi.fn(),
  removeTask: vi.fn(),
  setTaskSpeedLimit: vi.fn(),
}));

vi.mock('@/api/tasks', () => ({
  checkFiles: mocks.checkFiles,
  listTasks: mocks.listTasks,
  pauseTask: mocks.pauseTask,
  resumeTask: mocks.resumeTask,
  retryTask: mocks.retryTask,
  removeTask: mocks.removeTask,
  setTaskSpeedLimit: mocks.setTaskSpeedLimit,
}));

import { createMissingFileChecker } from './useMissingFileCheck';
import { useTasksStore } from '@/stores/tasks';

const completed = (id: string): TaskRecord => ({
  id,
  url: 'https://example.com/f.zip',
  finalUrl: 'https://example.com/f.zip',
  filename: `${id}.zip`,
  dir: 'D:/downloads',
  totalBytes: 1000,
  status: 'completed',
  speedLimit: null,
  error: null,
  retryCount: 0,
  downloadedBytes: 1000,
  createdAt: 1,
  updatedAt: 1,
});

type Store = ReturnType<typeof useTasksStore>;

function checkerFor(store: Store) {
  return createMissingFileChecker({
    taskIds: () => store.tasks.map((row) => row.id),
    check: (ids) => mocks.checkFiles(ids),
    apply: (ids) => store.setMissingFileIds(ids),
  });
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setActivePinia(createPinia());
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.listTasks.mockResolvedValue([]);
  mocks.checkFiles.mockResolvedValue([]);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => warn.mockRestore());

describe('成功 → 写入瞬时呈现态', () => {
  it('把 check_files 的字符串数组写入 store，且传的是全部 task id', async () => {
    const store = useTasksStore();
    store.tasks = [completed('t1'), completed('t2')];
    mocks.checkFiles.mockResolvedValue(['t1']);

    await checkerFor(store).check();

    expect(mocks.checkFiles).toHaveBeenCalledExactlyOnceWith(['t1', 't2']);
    expect(store.missingFileIds).toEqual(['t1']);
    expect(store.missingIdSet.has('t1')).toBe(true);
    expect(store.missingIdSet.has('t2')).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('失败 → warn 恰好 1 次 + 呈现态不变（零日志禁令）', () => {
  it('命令未注册/参数形状错时留一条 [check_files] warn，不弹 toast、不清空上次结果', async () => {
    const store = useTasksStore();
    store.tasks = [completed('t1')];
    store.setMissingFileIds(['t1']);
    store.toggleMissingOnly();
    const before = { ids: [...store.missingFileIds], only: store.missingOnly };
    mocks.checkFiles.mockRejectedValue(new Error('command check_files not found'));

    await checkerFor(store).check();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('[check_files]');
    expect(store.missingFileIds).toEqual(before.ids);
    expect(store.missingOnly).toBe(before.only);
    expect(store.missingIdSet.has('t1')).toBe(true);
  });

  it('首次检测就失败：呈现态保持空，不写入任何 id', async () => {
    const store = useTasksStore();
    store.tasks = [completed('t1')];
    mocks.checkFiles.mockRejectedValue(new Error('offline'));

    await checkerFor(store).check();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(store.missingFileIds).toEqual([]);
    expect(store.missingOnly).toBe(false);
  });
});

describe('文件放回后自动复原 / 并发收敛 / 卸载', () => {
  it('check_files 返回空数组 → 徽标与独立筛选一起复原', async () => {
    const store = useTasksStore();
    store.tasks = [completed('t1')];
    store.setMissingFileIds(['t1']);
    store.toggleMissingOnly();
    expect(store.missingIdSet.has('t1')).toBe(true);

    mocks.checkFiles.mockResolvedValue([]);
    await checkerFor(store).check();

    expect(store.missingFileIds).toEqual([]);
    expect(store.missingOnly).toBe(false);
    expect(store.missingIdSet.has('t1')).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('并发重查只认最后一次结果，旧响应不得覆盖新响应', async () => {
    const store = useTasksStore();
    store.tasks = [completed('t1')];
    let release: (value: string[]) => void = () => undefined;
    mocks.checkFiles
      .mockImplementationOnce(() => new Promise<string[]>((resolve) => { release = resolve; }))
      .mockResolvedValueOnce([]);

    const checker = checkerFor(store);
    const first = checker.check();
    const second = checker.check();
    release(['t1']); // 旧响应最后才回来
    await Promise.all([first, second]);

    expect(store.missingFileIds).toEqual([]);
  });

  it('dispose 后不再写入呈现态', async () => {
    const store = useTasksStore();
    store.tasks = [completed('t1')];
    mocks.checkFiles.mockResolvedValue(['t1']);
    const checker = checkerFor(store);

    checker.dispose();
    await checker.check();

    expect(store.missingFileIds).toEqual([]);
  });
});

describe('接线静态护栏：只在 fetch 成功与 window focus 查，不轮询', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./useMissingFileCheck.ts', import.meta.url)),
    'utf8',
  );
  // 注释里必须保留「为什么不挂 applyFrame」的说明，故负向断言只针对可执行代码
  const executable = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('watch fetchRevision + window focus 两个触发点', () => {
    expect(source).toContain('watch(() => tasksStore.fetchRevision');
    expect(source).toContain("window.addEventListener('focus', onFocus)");
    expect(source).toContain("window.removeEventListener('focus', onFocus)");
  });

  it('无 setInterval / 无 applyFrame（不挂 4Hz 进度帧、不轮询）', () => {
    expect(executable).not.toContain('setInterval');
    expect(executable).not.toContain('setTimeout');
    expect(executable).not.toContain('applyFrame');
  });

  it('失败分支 console.warn 恰好一处（不许零日志，也不许刷屏）', () => {
    expect(source.match(/console\.warn\('\[check_files\]/g)).toHaveLength(1);
    expect(executable).not.toContain('toast.push');
  });
});
