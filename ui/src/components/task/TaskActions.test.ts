import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 回归护栏（2026-10-25 实测缺陷）：TaskActions 曾把 emitAction 写成柯里化
 * `(type) => (e) => emit(...)`，而模板内联语句 `@click="emitAction('pause')"` 只是
 * 求值表达式，返回的函数从未被调用 → 行内 7 个操作按钮 emit 永不触发（右键菜单
 * 里能用，因为那条路径直接 `emit('action', ...)`）。本测试静态守住两点：
 * 1) 处理器不是柯里化（不返回函数）；2) 每个调用点都显式传入 $event。
 */
const source = readFileSync(fileURLToPath(new URL('./TaskActions.vue', import.meta.url)), 'utf8');

describe('TaskActions 事件处理器契约', () => {
  it('emitAction 直接 emit，不是返回函数的高阶形式', () => {
    expect(source).toMatch(/function emitAction\(type: string, event: MouseEvent\): void \{/);
    expect(source).toContain("emit('action', type, event)");
    // 柯里化残留：`function emitAction(...): (e: MouseEvent) => ...`
    expect(source).not.toMatch(/function emitAction\([\s\S]{0,80}?\)\s*:\s*\(/);
  });

  it('7 个按钮的调用点全部传入 $event', () => {
    const calls = [...source.matchAll(/emitAction\('([a-z-]+)'(, [^)]*)?\)/g)];
    expect(calls.map((m) => m[1])).toEqual([
      'pause',
      'resume',
      'retry',
      'open-file',
      'open-dir',
      'remove',
      'more',
    ]);
    expect(calls.every((m) => m[2] === ', $event')).toBe(true);
  });
});
