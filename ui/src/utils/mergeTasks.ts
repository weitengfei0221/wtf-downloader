/**
 * 任务列表增量合并（纯函数，无 Vue 依赖）。
 *
 * 背景（2026-11 用户实测缺陷 3）：原 `fetch()` 是 `this.tasks = await listTasks(...)`
 * —— 每次刷新整表替换，所有 task 都是新对象，配合行入场动画就是用户看到的
 * "列表反复闪一下"。改为按 id 就地 `Object.assign` 后：
 * - 已存在的任务**保留对象引用**，`:key` 不变 → Vue 复用行组件与 DOM，不重建；
 * - 只有真正新增的 id 需要播入场动画（调用方用 `added` 判定）；
 * - 服务端已删除的 id 出现在 `removed`，供调用方清帧/清选择。
 */
export interface TaskMergeResult<T> {
  /** 合并后数组，顺序 = 服务端返回顺序；元素是**传入的那批对象引用** */
  tasks: T[];
  /** 本地原本没有、本次新增的 id */
  added: string[];
  /** 服务端已不存在（本地需移除）的 id */
  removed: string[];
  /** 本地已有、本次就地更新的 id（对象身份保留） */
  kept: string[];
}

export function mergeTasks<T extends { id: string }>(
  existing: readonly T[],
  incoming: readonly T[],
): TaskMergeResult<T> {
  const pool = new Map<string, T>();
  for (const task of existing) pool.set(task.id, task);

  const tasks: T[] = [];
  const added: string[] = [];
  const kept: string[] = [];

  for (const fresh of incoming) {
    const prev = pool.get(fresh.id);
    if (prev == null) {
      tasks.push(fresh);
      added.push(fresh.id);
      continue;
    }
    // 就地合并：保留 prev 的对象身份，落库字段以服务端为准
    Object.assign(prev, fresh);
    tasks.push(prev);
    kept.push(fresh.id);
    pool.delete(fresh.id); // 剩下的键 = 服务端已删除
  }

  return { tasks, added, removed: [...pool.keys()], kept };
}
