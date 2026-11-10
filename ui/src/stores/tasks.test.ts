import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 静态护栏（2026-11 用户实测三条缺陷的 store 侧根因）：
 * 1) 限速变更后只调命令、不回写本地 → 用户要等下一次列表刷新才看到「限 X MB/s」；
 * 2) 解除限速后 `speedLimit` 不更新 → 重开输入框残留上次的 MB 数；
 * 3) `fetch()` 整体替换数组 + `onStateChanged` 先 patch 再 refresh → 整列表闪烁。
 * 这三条都不是类型系统能拦住的（返回类型都对，只是"少写了一次回写"），
 * 因此按现有 TaskListView.test.ts / TaskActions.test.ts 的惯例做源码断言。
 */
const source = readFileSync(fileURLToPath(new URL('./tasks.ts', import.meta.url)), 'utf8');

/** 取某个 action 的函数体（到下一个 4 空格缩进的顶层符号为止，含注释块边界） */
function actionBody(name: string): string {
  const start = source.indexOf(`    async ${name}(`);
  if (start === -1) throw new Error(`action not found: ${name}`);
  const rest = source.slice(start + 1);
  const end = rest.search(/\n    \S/);
  return end === -1 ? rest : rest.slice(0, end);
}

describe('tasks store：限速本地回写（缺陷 1 / 2）', () => {
  it('setTaskLimit 成功后把 speedLimit 就地 patch 到任务上', () => {
    const body = actionBody('setTaskLimit');
    expect(body).toContain('await setTaskSpeedLimit(');
    // 回写：不限速必须写 null（下游用 != null 判定），不是 0/undefined
    expect(body).toContain('task.speedLimit = bytesPerSec');
  });

  it('setTaskLimit 不触发全量 refresh（刷新不解决问题，只是掩盖"没回写"）', () => {
    expect(actionBody('setTaskLimit')).not.toContain('refresh(');
  });
});

describe('tasks store：刷新不整表替换（缺陷 3）', () => {
  it('fetch 用 mergeTasks 增量合并，不再 `this.tasks = await listTasks(...)`', () => {
    const body = actionBody('fetch');
    expect(body).toContain('mergeTasks(this.tasks, incoming)');
    expect(body).not.toMatch(/this\.tasks = await listTasks/);
  });

  it('onStateChanged 只在本地缺记录时兜底 refresh，patch 之后不再 refresh', () => {
    const body = actionBody('onStateChanged');
    const refreshAt = body.indexOf('this.refresh()');
    const patchAt = body.indexOf('task.status = payload.to');
    expect(patchAt).toBeGreaterThan(-1);
    // refresh 只能出现在状态 patch 之前（`if (task == null)` 兜底分支），
    // 且全函数至多一处——patch 之后再拉一次就是"闪一下"的来源
    expect(refreshAt).toBeGreaterThan(-1);
    expect(refreshAt).toBeLessThan(patchAt);
    expect(body.match(/this\.refresh\(\)/g)).toHaveLength(1);
  });

  it('pruneFrames 仍在 fetch 内（合并不能把 4Hz 帧清掉）', () => {
    expect(actionBody('fetch')).toContain('this.pruneFrames()');
  });
});
