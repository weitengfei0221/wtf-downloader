import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { TaskRecord, TaskStatus } from '@/api/types';
import { useTaskSelection } from './useTaskSelection';
import {
  MARQUEE_THRESHOLD,
  beyondThreshold,
  createMarqueeMachine,
  idsInRect,
  rectFromPoints,
  rectsIntersect,
  type MarqueeDeps,
  type MarqueeMouseEvent,
  type RowRect,
} from './useMarqueeSelection';

/**
 * 框选状态机行为验证（DESIGN.md §2.9）。vitest environment=node，无 jsdom，
 * 故 createMarqueeMachine 刻意设计成只吃普通数值事件对象 + 注入依赖的纯状态机，
 * 真实 DOM 监听由 useMarqueeSelection 包装层负责（另见 Marquee.guard.test.ts 静态护栏）。
 */
const task = (id: string, status: TaskStatus = 'downloading'): TaskRecord => ({
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

const rect = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});

/** 三行，各高 20，纵向排布在 y=0..60；x=0..100 */
const rows: RowRect[] = [
  { id: 'a', rect: rect(0, 0, 100, 20) },
  { id: 'b', rect: rect(0, 20, 100, 40) },
  { id: 'c', rect: rect(0, 40, 100, 60) },
];

const down = (over: Partial<MarqueeMouseEvent> = {}): MarqueeMouseEvent => ({
  x: 0,
  y: 0,
  button: 0,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
  ...over,
});

function clickEvent() {
  return { stopPropagation: vi.fn<() => void>(), preventDefault: vi.fn<() => void>() };
}

function setup(over: Partial<MarqueeDeps> = {}) {
  const commit = vi.fn();
  const deps: MarqueeDeps = {
    getRows: () => rows,
    getVisibleIds: () => new Set(['a', 'b', 'c']),
    commit,
    ...over,
  };
  return { machine: createMarqueeMachine(deps), commit };
}

/** 一次完整拖框：从 (x1,y1) 拖到 (x2,y2) */
function drag(
  machine: ReturnType<typeof createMarqueeMachine>,
  x2: number,
  y2: number,
  start = down(),
): void {
  machine.onMouseDown(start);
  machine.onMouseMove({ x: x2, y: y2 });
  machine.onMouseUp({ x: x2, y: y2 });
}

describe('纯几何：矩形归一化 / 阈值 / 相交命中', () => {
  it('rectFromPoints 归一化任意方向（反向拖也得到递增矩形）', () => {
    expect(rectFromPoints({ x: 100, y: 80 }, { x: 20, y: 10 })).toEqual(rect(20, 10, 100, 80));
    expect(rectFromPoints({ x: 20, y: 10 }, { x: 100, y: 80 })).toEqual(rect(20, 10, 100, 80));
  });

  it('阈值 4px：欧氏距离以内视为普通点击，超过才画框', () => {
    expect(MARQUEE_THRESHOLD).toBe(4);
    const a = { x: 0, y: 0 };
    expect(beyondThreshold(a, { x: 4, y: 0 })).toBe(false); // 恰好 4px 不画框
    expect(beyondThreshold(a, { x: 2, y: 2 })).toBe(false); // 斜向 2.83px
    expect(beyondThreshold(a, { x: 3, y: 3 })).toBe(true); // 斜向 4.24px 已超阈值
    expect(beyondThreshold(a, { x: 5, y: 0 })).toBe(true);
  });

  it('rectsIntersect：相交命中，仅擦边 / 完全分离都不算', () => {
    expect(rectsIntersect(rect(10, 5, 50, 15), rows[0]!.rect)).toBe(true);
    expect(rectsIntersect(rect(0, 20, 100, 20), rows[0]!.rect)).toBe(false); // 零高度贴边
    expect(rectsIntersect(rect(100, 0, 200, 20), rows[0]!.rect)).toBe(false); // 仅擦右边界
    expect(rectsIntersect(rect(200, 200, 300, 300), rows[0]!.rect)).toBe(false);
  });

  it('idsInRect 只返回相交且属于 visible 的行，隐藏行永不参与', () => {
    const withHidden: RowRect[] = [...rows, { id: 'hidden', rect: rect(0, 0, 100, 60) }];
    expect(idsInRect(withHidden, rect(0, 10, 50, 50), new Set(['a', 'b', 'c']))).toEqual(['a', 'b', 'c']);
    expect(idsInRect(withHidden, rect(0, 0, 10, 5), new Set(['a', 'b', 'c']))).toEqual(['a']);
    expect(idsInRect(withHidden, rect(0, 0, 100, 60), new Set(['a']))).toEqual(['a']);
    expect(idsInRect(withHidden, rect(500, 500, 600, 600), new Set(['a', 'b', 'c']))).toEqual([]);
  });
});

describe('状态机：阈值 / 画框 / mouseup 后矩形消失', () => {
  it('阈值内移动 = 普通点击：不画框、不提交、不吞 click（@click.self 仍可清空）', () => {
    const { machine, commit } = setup();
    machine.onMouseDown(down());
    machine.onMouseMove({ x: 3, y: 0 });
    expect(machine.box.value).toBeNull();
    expect(machine.isDrawing()).toBe(false);
    machine.onMouseUp({ x: 3, y: 0 });
    expect(commit).not.toHaveBeenCalled();
    expect(machine.shouldSuppressClick()).toBe(false);
    expect(machine.onClickCapture(clickEvent())).toBe(false);
  });

  it('超过阈值才画框；mouseup 后 box 置空但提交已发生', () => {
    const { machine, commit } = setup();
    machine.onMouseDown(down());
    machine.onMouseMove({ x: 50, y: 30 });
    expect(machine.box.value).toEqual(rect(0, 0, 50, 30));
    expect(machine.isDrawing()).toBe(true);
    machine.onMouseUp({ x: 50, y: 30 });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(machine.box.value).toBeNull();
    expect(machine.isDrawing()).toBe(false);
  });

  it('反向拖（右下 → 左上）命中判定同样正确', () => {
    const { machine, commit } = setup();
    machine.onMouseDown(down({ x: 90, y: 55 }));
    machine.onMouseMove({ x: 10, y: 5 });
    machine.onMouseUp({ x: 10, y: 5 });
    expect(commit).toHaveBeenCalledWith(['a', 'b', 'c'], false);
  });

  it('非左键（右键 / 中键）不启动框选', () => {
    const { machine, commit } = setup();
    drag(machine, 50, 30, down({ button: 2 }));
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('状态机：替换 / 追加（Ctrl / Shift / Meta）', () => {
  it('普通框选 = 替换（additive=false）', () => {
    const { machine, commit } = setup();
    drag(machine, 50, 30);
    expect(commit).toHaveBeenCalledWith(['a', 'b'], false);
  });

  for (const key of ['ctrlKey', 'shiftKey', 'metaKey'] as const) {
    it(`${key} + 框选 = 追加（additive=true）`, () => {
      const { machine, commit } = setup();
      drag(machine, 50, 30, down({ [key]: true }));
      expect(commit).toHaveBeenCalledWith(['a', 'b'], true);
    });
  }

  it('接真实 useTaskSelection：替换清空旧选择、追加保留旧选择', () => {
    const visible = ref([task('x'), task('a'), task('b'), task('c')]);
    const sel = useTaskSelection(() => visible.value);
    sel.selectOnly('x');
    const commit = (ids: string[], additive: boolean) => sel.selectIds(ids, additive);

    const replaceMachine = createMarqueeMachine({
      getRows: () => rows,
      getVisibleIds: () => new Set(visible.value.map((t) => t.id)),
      commit,
    });
    drag(replaceMachine, 50, 10);
    expect([...sel.checkedIds.value].sort()).toEqual(['a']); // x 被替换掉

    const addMachine = createMarqueeMachine({
      getRows: () => rows,
      getVisibleIds: () => new Set(visible.value.map((t) => t.id)),
      commit,
    });
    drag(addMachine, 50, 30, down({ ctrlKey: true }));
    expect([...sel.checkedIds.value].sort()).toEqual(['a', 'b']); // 追加（x 已被替换）
  });
});

describe('状态机：后续 click 不清空框选结果（用户实测关键坑）', () => {
  it('拖框后 window capture 吞掉紧随的 click，选择集合保留', () => {
    const visible = ref([task('a'), task('b'), task('c')]);
    const sel = useTaskSelection(() => visible.value);
    const machine = createMarqueeMachine({
      getRows: () => rows,
      getVisibleIds: () => new Set(visible.value.map((t) => t.id)),
      commit: (ids, additive) => sel.selectIds(ids, additive),
    });
    drag(machine, 50, 30);
    expect(sel.count.value).toBe(2);

    // 模拟浏览器在 mouseup 后派发的 click：只有未被 capture 吞掉时才轮到 @click.self 清空。
    const e = clickEvent();
    const swallowed = machine.onClickCapture(e);
    expect(swallowed).toBe(true);
    expect(e.stopPropagation).toHaveBeenCalledOnce();
    expect(e.preventDefault).toHaveBeenCalledOnce();
    if (!swallowed) sel.clear();
    expect(sel.count.value).toBe(2); // 未被清空
  });

  it('抑制标志只生效一次；下一次正常点击不被误吞（blank click 仍能清空）', () => {
    const { machine } = setup();
    drag(machine, 50, 30);
    expect(machine.onClickCapture(clickEvent())).toBe(true);
    expect(machine.onClickCapture(clickEvent())).toBe(false);

    // 新一次 mousedown 复位标志：阈值内普通点击不吞，@click.self 正常清空
    machine.onMouseDown(down());
    machine.onMouseMove({ x: 2, y: 0 });
    machine.onMouseUp({ x: 2, y: 0 });
    expect(machine.onClickCapture(clickEvent())).toBe(false);
  });

  it('拖框后在窗口外释放：下一次任意 mousedown 复位标志，不会吞掉无关点击', () => {
    const { machine } = setup();
    drag(machine, 50, 30);
    expect(machine.shouldSuppressClick()).toBe(true);
    machine.noteMouseDown(); // 模拟窗口内另一次 mousedown（capture 阶段）
    expect(machine.shouldSuppressClick()).toBe(false);
    expect(machine.onClickCapture(clickEvent())).toBe(false);
  });
});

describe('状态机：Esc / 窗口失焦取消画框', () => {
  it('中途 Esc 取消画框：矩形消失、后续 mouseup 不提交', () => {
    const { machine, commit } = setup();
    machine.onMouseDown(down());
    machine.onMouseMove({ x: 50, y: 30 });
    expect(machine.box.value).not.toBeNull();
    machine.onKeyDown({ key: 'Escape' });
    expect(machine.box.value).toBeNull();
    expect(machine.isDrawing()).toBe(false);
    machine.onMouseUp({ x: 50, y: 30 });
    expect(commit).not.toHaveBeenCalled();
    expect(machine.shouldSuppressClick()).toBe(false);
  });

  it('窗口失焦取消画框：矩形消失、后续 mouseup 不提交', () => {
    const { machine, commit } = setup();
    machine.onMouseDown(down());
    machine.onMouseMove({ x: 50, y: 30 });
    machine.onWindowBlur();
    expect(machine.box.value).toBeNull();
    machine.onMouseUp({ x: 50, y: 30 });
    expect(commit).not.toHaveBeenCalled();
  });

  it('非 Esc 键不打断正在进行的画框', () => {
    const { machine, commit } = setup();
    machine.onMouseDown(down());
    machine.onMouseMove({ x: 50, y: 30 });
    machine.onKeyDown({ key: 'a' });
    expect(machine.isDrawing()).toBe(true);
    machine.onMouseUp({ x: 50, y: 30 });
    expect(commit).toHaveBeenCalledOnce();
  });

  it('未按下时 Esc / blur 是空操作（不误清已有选择）', () => {
    const { machine } = setup();
    expect(() => {
      machine.onKeyDown({ key: 'Escape' });
      machine.onWindowBlur();
    }).not.toThrow();
    expect(machine.shouldSuppressClick()).toBe(false);
  });
});
