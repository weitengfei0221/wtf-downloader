import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 静态护栏（2026-11 用户实测缺陷 2 / 3 的前端侧根因）：
 * - 缺陷 2：限速输入框用 `props.task.speedLimit` 初始化且解除后不更新 → 重开仍显示旧值。
 *   现在 openLimit 每次从 store 重新取，null 时显式置空；非法输入不再静默降级成"不限速"。
 * - 缺陷 3：入场动画写在 `.row` 上 → 每次刷新随行重渲染重放，整列表"闪一下"。
 *   现在动画挂 `.row-enter`，只由 `isNew`（首次出现的行）触发。
 */
const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const taskRow = read('./TaskRow.vue');
const taskList = read('../../views/TaskListView.vue');
const taskMenu = read('./TaskMoreMenu.vue');

describe('任务行入场动画只对新行播放（缺陷 3）', () => {
  it('`.row` 不再声明 animation，动画只挂在 `.row-enter` 上', () => {
    // 取 `.row {` 到下一个 `}` 的样式块
    const start = taskRow.indexOf('.row {');
    expect(start).toBeGreaterThan(-1);
    const block = taskRow.slice(start, taskRow.indexOf('}', start));
    expect(block).not.toContain('animation');

    const enterAt = taskRow.indexOf('.row-enter {');
    expect(enterAt).toBeGreaterThan(-1);
    expect(taskRow.slice(enterAt, taskRow.indexOf('}', enterAt))).toContain('animation: row-in');
  });

  it('模板把 `.row-enter` 绑定到 isNew', () => {
    expect(taskRow).toContain("'row-enter': isNew");
    expect(taskRow).toMatch(/isNew\?:\s*boolean/);
  });

  it('TaskListView 传 :is-new，且按"首次出现"判定（seenIds 跨筛选保留）', () => {
    expect(taskList).toContain(':is-new="enterIds.includes(task.id)"');
    // seenIds 必须声明在组件作用域（不能被 watch 内的局部变量顶替，否则每次刷新都算新行）
    expect(taskList).toContain('const seenIds = new Set<string>()');
    expect(taskList).toContain('!seenIds.has(task.id)');
    expect(taskList).toContain('seenIds.add(task.id)');
  });
});

describe('限速面板取当前值 + 非法输入不降级（缺陷 1 / 2）', () => {
  it('openLimit 从 store 重新取值，不限速时显式置空（不残留上次 MB 数）', () => {
    const start = taskMenu.indexOf('async function openLimit');
    expect(start).toBeGreaterThan(-1);
    const body = taskMenu.slice(start, taskMenu.indexOf('async function applyLimit'));

    expect(body).toContain('currentLimitMb()');
    // 每次打开都重新计算（currentLimitMb 内部读 store.byId，见下一用例）
    expect(body).not.toContain('props.task.speedLimit');
    // 三元另一侧是空串（null → 输入框空）
    expect(body).toMatch(/:\s*'';/);
  });

  it('currentLimitMb 读 store 的 speedLimit（不是缓存 props 上次的值）', () => {
    const start = taskMenu.indexOf('function currentLimitMb');
    expect(start).toBeGreaterThan(-1);
    const body = taskMenu.slice(start, taskMenu.indexOf('const limitInvalid'));
    expect(body).toContain("tasksStore.byId(props.task.id)?.speedLimit");
  });

  it('applyLimit 对非法输入中止并给内联提示（不静默变成"不限速"）', () => {
    const start = taskMenu.indexOf('async function applyLimit');
    const body = taskMenu.slice(start, taskMenu.indexOf('<template>'));

    // 非法 → 设提示并 return，发生在换算 bps 之前
    const guardAt = body.indexOf('limitInvalid.value');
    const bpsAt = body.indexOf('const bps =');
    expect(guardAt).toBeGreaterThan(-1);
    expect(bpsAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(bpsAt);
    expect(body).toMatch(/limitError\.value = t\('more\.limitInvalid'\);\s*\n\s*return;/);
  });

  it('不限速写入 null（不是 0 / undefined），且落库走 store 动作', () => {
    expect(taskMenu).toContain('unlimited ? null : Math.round');
    expect(taskMenu).toContain('tasksStore.setTaskLimit(props.task.id, bps)');
    // 组件层禁直连 api（限速也要经 store 回写本地）
    expect(taskMenu).not.toContain('setTaskSpeedLimit');
  });
});
