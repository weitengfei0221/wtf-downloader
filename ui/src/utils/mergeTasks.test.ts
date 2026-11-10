import { describe, expect, it } from 'vitest';
import { mergeTasks } from './mergeTasks';

interface Row {
  id: string;
  status: string;
  speedLimit: number | null;
}

const row = (id: string, status = 'pending', speedLimit: number | null = null): Row => ({
  id,
  status,
  speedLimit,
});

/**
 * 2026-11 用户实测缺陷 3（列表整表闪烁）的回归护栏：
 * 合并必须**保留已存在任务的对象身份**（Vue 靠 `:key` + 同一对象复用行组件），
 * 只把真正新增/删除的 id 交出去。三条断言分别对应"保留身份 / 新增 / 删除"。
 */
describe('mergeTasks 增量合并', () => {
  it('保留身份：已存在的任务就地更新字段，仍返回原对象引用', () => {
    const a = row('a', 'downloading');
    const b = row('b', 'paused');
    const existing = [a, b];

    const result = mergeTasks(existing, [row('a', 'completed'), row('b', 'paused', 2_000_000)]);

    expect(result.tasks).toHaveLength(2);
    // 对象身份保留（不是新对象）——行组件不会被重建
    expect(result.tasks[0]).toBe(a);
    expect(result.tasks[1]).toBe(b);
    // 字段以服务端为准就地写入
    expect(a.status).toBe('completed');
    expect(b.speedLimit).toBe(2_000_000);
    // 分类正确
    expect(result.kept).toEqual(['a', 'b']);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it('新增：本地没有的 id 走 added，原样引用服务端对象', () => {
    const a = row('a');
    const fresh = row('c');

    const result = mergeTasks([a], [row('a'), fresh]);

    expect(result.added).toEqual(['c']);
    expect(result.kept).toEqual(['a']);
    expect(result.removed).toEqual([]);
    expect(result.tasks[1]).toBe(fresh);
    expect(result.tasks[0]).toBe(a);
    // 顺序按服务端返回
    expect(result.tasks.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('删除：服务端已不存在的 id 进 removed，且不残留在结果数组', () => {
    const a = row('a');
    const b = row('b');

    const result = mergeTasks([a, b], [row('b')]);

    expect(result.removed).toEqual(['a']);
    expect(result.added).toEqual([]);
    expect(result.tasks.map((t) => t.id)).toEqual(['b']);
    expect(result.tasks[0]).toBe(b);
  });

  it('空态/全删：本地有数据而服务端返回空 → 全部 removed，不抛错', () => {
    const result = mergeTasks([row('a'), row('b')], []);

    expect(result.tasks).toEqual([]);
    expect(result.removed).toEqual(['a', 'b']);
    expect(result.kept).toEqual([]);
    expect(result.added).toEqual([]);
  });

  it('幂等：同一份服务端数据连续合并两次，第二次不再有新对象且无增删', () => {
    const a = row('a');
    const first = mergeTasks([a], [row('a', 'downloading')]);
    const second = mergeTasks(first.tasks, [row('a', 'downloading', 1_000_000)]);

    expect(second.tasks[0]).toBe(a);
    expect(second.added).toEqual([]);
    expect(second.removed).toEqual([]);
    expect(second.kept).toEqual(['a']);
  });
});
