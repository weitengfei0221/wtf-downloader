import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { TaskRecord, TaskStatus } from '@/api/types';
import { isInProgress, useTasksStore } from './tasks';

/**
 * 默认任务列表视图（2026-11 第七轮用户裁决）：「下载中」提到第一位并成为默认视图。
 * 行为单测证默认 filter 与 visible 派生；静态护栏证 tab 顺序 / 默认值 / 四值契约 /
 * 空态文案 / 「查看全部」回退路径都没被改坏。
 */
const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

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

beforeEach(() => setActivePinia(createPinia()));

describe('默认视图 = 下载中（行为验证，不是源码字符串断言）', () => {
  it('新建 store 的 filter 默认是 downloading', () => {
    expect(useTasksStore().filter).toBe('downloading');
  });

  it('默认筛选下 visible 只返回 downloading 行，已完成 / 失败行被隐藏', () => {
    const store = useTasksStore();
    store.tasks = [
      task('a', 'downloading'),
      task('b', 'completed'),
      task('c', 'failed'),
      task('d', 'downloading'),
    ];
    expect(store.visible.map((row) => row.id)).toEqual(['a', 'd']);
  });

  it('空态「查看全部」路径：setFilter(all) 仍能看到全部任务', () => {
    const store = useTasksStore();
    store.tasks = [task('a', 'downloading'), task('b', 'completed')];
    expect(store.visible.map((row) => row.id)).toEqual(['a']);
    store.setFilter('all');
    expect(store.visible.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('counts 与筛选解耦：默认视图下四个计数仍反映全量', () => {
    const store = useTasksStore();
    store.tasks = [task('a', 'downloading'), task('b', 'completed'), task('c', 'failed')];
    expect(store.counts).toEqual({ all: 3, downloading: 1, completed: 1, failed: 1 });
  });

  it('下载中视图含 pending / downloading / paused，排除 completed / failed', () => {
    const store = useTasksStore();
    store.tasks = [
      task('pending', 'pending'),
      task('active', 'downloading'),
      task('held', 'paused'),
      task('done', 'completed'),
      task('broken', 'failed'),
    ];
    expect(store.filter).toBe('downloading');
    expect(store.visible.map((row) => row.id)).toEqual(['pending', 'active', 'held']);
    expect(store.counts.downloading).toBe(3);
  });

  it('新增任务初始状态 pending 也在下载中视图内（新建后切视图不会看到空列表）', () => {
    const store = useTasksStore();
    store.tasks = [task('done', 'completed'), task('fresh', 'pending')];
    store.setFilter('downloading');
    expect(store.visible.map((row) => row.id)).toEqual(['fresh']);
  });

  it('isInProgress 是唯一判据：五态真值表', () => {
    const active: TaskStatus[] = ['pending', 'downloading', 'paused'];
    const terminal: TaskStatus[] = ['completed', 'failed'];
    expect(active.map(isInProgress)).toEqual([true, true, true]);
    expect(terminal.map(isInProgress)).toEqual([false, false]);
  });

  it('其它三值仍是精确状态匹配，不被分组判据污染', () => {
    const store = useTasksStore();
    store.tasks = [
      task('a', 'pending'),
      task('b', 'downloading'),
      task('c', 'paused'),
      task('d', 'completed'),
      task('e', 'failed'),
    ];
    store.setFilter('completed');
    expect(store.visible.map((row) => row.id)).toEqual(['d']);
    store.setFilter('failed');
    expect(store.visible.map((row) => row.id)).toEqual(['e']);
    store.setFilter('all');
    expect(store.visible).toHaveLength(5);
  });
});

describe('静态护栏：tab 顺序 / 默认字面量 / 契约 / 空态文案', () => {
  const store = read('./tasks.ts');
  const tabs = read('../components/FilterTabs.vue');
  const types = read('../api/types.ts');
  const empty = read('../components/EmptyState.vue');
  const locales = read('../locales/zh-CN.ts');
  const view = read('../views/TaskListView.vue');

  it('store 默认字面量是 downloading（不是 all）', () => {
    expect(store).toContain("filter: 'downloading' as TaskFilter");
    expect(store).not.toContain("filter: 'all' as TaskFilter");
  });

  it('FilterTabs 顺序：downloading 提到第一，其余保持原相对顺序', () => {
    const order = ["key: 'downloading'", "key: 'all'", "key: 'completed'", "key: 'failed'"]
      .map((marker) => tabs.indexOf(marker));
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order[0]).toBeLessThan(order[1]!);
    expect(order[1]).toBeLessThan(order[2]!);
    expect(order[2]).toBeLessThan(order[3]!);
  });

  it('TaskFilter 四值契约一个字段都不改（IPC / Rust serde 对齐）', () => {
    expect(types).toContain("export type TaskFilter = 'all' | 'downloading' | 'completed' | 'failed';");
  });

  it('默认 downloading 时空态文案通顺：filterName 覆盖下载中，副文案仍引导「全部」', () => {
    expect(empty).toContain("case 'downloading':");
    expect(empty).toContain("t('empty.noResultsTitle', { filter: filterName.value })");
    expect(locales).toContain("'empty.noResultsTitle': '没有{filter}的任务'");
    expect(locales).toContain("'empty.noResultsSub': '切换到「全部」查看所有任务'");
  });

  it('viewAll() 仍走 setFilter(all) 单点，空态「查看全部」不被改坏', () => {
    expect(view).toContain("tasksStore.setFilter('all')");
  });
});

describe('静态护栏：新建后切视图 + 分组判据单点化', () => {
  const store = read('./tasks.ts');
  const addDialog = read('../components/AddTaskDialog.vue');

  it('AddTaskDialog 只在提交成功路径切到下载中视图（失败分支不切）', () => {
    const start = addDialog.indexOf('async function submit');
    const body = addDialog.slice(start, addDialog.indexOf('\n</script>', start));
    const switchAt = body.indexOf("tasksStore.setFilter('downloading')");
    const catchAt = body.indexOf('} catch (e) {');
    expect(switchAt).toBeGreaterThan(-1);
    expect(catchAt).toBeGreaterThan(-1);
    // 切视图必须排在 catch 分支的 return 之后 —— 若被挪进失败分支会立刻变红
    expect(switchAt).toBeGreaterThan(body.indexOf('return;', catchAt));
    expect(body).toContain('ui.closeAddDialog()');
  });

  it('counts 与 visible 共用 isInProgress，不各自写一份状态枚举判断', () => {
    expect(store).toContain('export function isInProgress(status: TaskStatus): boolean');
    expect(store).toContain("if (state.filter === 'downloading')");
    expect(store).toContain('if (isInProgress(task.status)) downloading += 1');
    expect(store).toContain('list = list.filter((task) => isInProgress(task.status))');
  });
});
