import { getCurrentInstance, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import type { TaskRecord } from '@/api/types';

/**
 * 列表空白区框选（DESIGN.md §2.9，2026-11 第七轮用户实测）。
 *
 * 分两层，刻意在 node 环境（本仓库 vitest environment=node，无 jsdom）也能验证状态机：
 *  - `createMarqueeMachine` 是纯状态机：只吃普通数值事件对象与注入依赖，不碰 window / DOM；
 *  - `useMarqueeSelection` 是 Vue 包装层：负责读 DOM 行 rect、注册 window 生命周期监听，
 *    组件实例不存在时（纯逻辑单测）跳过注册，与 useTaskSelection 的 getCurrentInstance 惯例一致。
 *
 * 关键坑：mouseup 之后浏览器仍会派发一次 click，若不加拦截会命中 `<main @click.self>`
 * 把刚框好的选择立刻清空。这里用 suppressNextClick 标志位在 window 的 **capture 阶段**
 * 吞掉这一次 click（不移除既有 @click.self 清空语义）——阈值内的普通点击不受影响。
 */
export const MARQUEE_THRESHOLD = 4;

export interface Point {
  x: number;
  y: number;
}

/** 视口坐标矩形（与 getBoundingClientRect / clientX,clientY 同坐标系）。 */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface RowRect {
  id: string;
  rect: Rect;
}

export interface MarqueeMouseEvent extends Point {
  button: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export interface MarqueeClickEvent {
  stopPropagation(): void;
  preventDefault(): void;
}

/** 归一化任意方向的拖动为 left/top/right/bottom 递增矩形。 */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}

/** 阈值内（<= 4px）视为普通点击；超过才画框。 */
export function beyondThreshold(a: Point, b: Point, threshold = MARQUEE_THRESHOLD): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) > threshold;
}

/** 矩形相交判定：仅擦边（left===right 等）不算命中，避免贴边误选。 */
export function rectsIntersect(box: Rect, row: Rect): boolean {
  return (
    box.left < row.right &&
    box.right > row.left &&
    box.top < row.bottom &&
    box.bottom > row.top
  );
}

/** 命中判定：只接受当前 visible 内的 id，筛选隐藏的行永不参与（双保险，DOM 里本就没有隐藏行）。 */
export function idsInRect(rows: RowRect[], box: Rect, visibleIds: ReadonlySet<string>): string[] {
  return rows
    .filter((row) => visibleIds.has(row.id) && rectsIntersect(box, row.rect))
    .map((row) => row.id);
}

export interface MarqueeDeps {
  getRows: () => RowRect[];
  getVisibleIds: () => ReadonlySet<string>;
  commit: (ids: string[], additive: boolean) => void;
  threshold?: number;
}

export interface MarqueeMachine {
  box: Ref<Rect | null>;
  onMouseDown: (event: MarqueeMouseEvent) => void;
  onMouseMove: (point: Point) => void;
  onMouseUp: (point: Point) => void;
  onKeyDown: (event: { key: string }) => void;
  onWindowBlur: () => void;
  /** window capture 阶段调用；返回 true 表示这次 click 已被吞掉。 */
  onClickCapture: (event: MarqueeClickEvent) => boolean;
  /** 任意 mousedown 都复位抑制标志，防止上一次拖框残留吞掉窗口外释放后的正常点击。 */
  noteMouseDown: () => void;
  isDrawing: () => boolean;
  shouldSuppressClick: () => boolean;
}

export function createMarqueeMachine(deps: MarqueeDeps): MarqueeMachine {
  const box = ref<Rect | null>(null);
  const threshold = deps.threshold ?? MARQUEE_THRESHOLD;
  let origin: Point | null = null;
  let pending = false;
  let drawing = false;
  let additive = false;
  let suppressNextClick = false;

  function clearState(): void {
    origin = null;
    pending = false;
    drawing = false;
    box.value = null;
  }

  function cancel(): void {
    clearState();
    suppressNextClick = false;
  }

  return {
    box,
    onMouseDown(event) {
      // 每次新按下一律复位，防止上一次拖框残留的标志吞掉后续正常 click。
      suppressNextClick = false;
      if (event.button !== 0) return; // 只响应左键
      origin = { x: event.x, y: event.y };
      pending = true;
      drawing = false;
      additive = event.ctrlKey || event.shiftKey || event.metaKey;
      box.value = null;
    },
    onMouseMove(point) {
      if (!pending || origin == null) return;
      if (!drawing) {
        if (!beyondThreshold(origin, point, threshold)) return;
        drawing = true;
      }
      box.value = rectFromPoints(origin, point);
    },
    onMouseUp(point) {
      if (!pending || origin == null) return;
      if (drawing) {
        const finalBox = rectFromPoints(origin, point);
        deps.commit(idsInRect(deps.getRows(), finalBox, deps.getVisibleIds()), additive);
        suppressNextClick = true; // 吞掉紧随 mouseup 的 click，保护选择集合
      }
      clearState(); // 矩形消失，选择集合保留
    },
    onKeyDown(event) {
      // 中途 Esc 只取消画框；Esc 清空选择沿用 useTaskSelection 自己的 window 监听（不 stopPropagation）。
      if (event.key === 'Escape' && pending) cancel();
    },
    onWindowBlur() {
      if (pending) cancel();
    },
    onClickCapture(event) {
      if (!suppressNextClick) return false;
      suppressNextClick = false;
      event.stopPropagation();
      event.preventDefault();
      return true;
    },
    noteMouseDown() {
      suppressNextClick = false;
    },
    isDrawing: () => drawing,
    shouldSuppressClick: () => suppressNextClick,
  };
}

export interface MarqueeOptions {
  /** 取列表容器 DOM；用 getter 而非 Ref，composable 不依赖组件上下文，node 单测可直接注入。 */
  getListEl: () => HTMLElement | null;
  visible: () => TaskRecord[];
  commit: (ids: string[], additive: boolean) => void;
}

/** 从当前渲染出的行读 rect：v-for 只渲染 visible，天然不含筛选隐藏行。 */
function readRowRects(el: HTMLElement | null): RowRect[] {
  if (el == null) return [];
  const rows: RowRect[] = [];
  el.querySelectorAll<HTMLElement>('[data-task-id]').forEach((node) => {
    const id = node.dataset.taskId;
    if (id == null) return;
    const r = node.getBoundingClientRect();
    rows.push({ id, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
  });
  return rows;
}

export function useMarqueeSelection(options: MarqueeOptions): MarqueeMachine {
  const machine = createMarqueeMachine({
    getRows: () => readRowRects(options.getListEl()),
    getVisibleIds: () => new Set(options.visible().map((task) => task.id)),
    commit: options.commit,
  });

  if (getCurrentInstance() != null) {
    /*
     * 全部监听挂在 window：子组件 onMounted 早于父组件模板 ref 赋值，若把 mousedown
     * 直接绑到列表 DOM 会在首次挂载时拿到 null。改为事件发生时再取 DOM 判 target，
     * 等价于 Vue 的 .self 修饰符，且不受挂载时序影响。
     */
    const onAnyDown = (event: MouseEvent): void => {
      machine.noteMouseDown();
      const el = options.getListEl();
      // 仅列表容器本身（空白）启动；任务行上按下走既有左键 / Ctrl / Shift 分流，绝不劫持。
      if (el == null || event.target !== el || event.button !== 0) return;
      machine.onMouseDown({
        x: event.clientX,
        y: event.clientY,
        button: event.button,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
      });
    };
    const onMove = (event: MouseEvent): void =>
      machine.onMouseMove({ x: event.clientX, y: event.clientY });
    const onUp = (event: MouseEvent): void =>
      machine.onMouseUp({ x: event.clientX, y: event.clientY });
    const onKey = (event: KeyboardEvent): void => machine.onKeyDown({ key: event.key });
    const onBlur = (): void => machine.onWindowBlur();
    const onClick = (event: MouseEvent): void => {
      machine.onClickCapture(event);
    };

    onMounted(() => {
      window.addEventListener('mousedown', onAnyDown, true); // capture：先复位标志再判空白
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('keydown', onKey);
      window.addEventListener('blur', onBlur);
      window.addEventListener('click', onClick, true); // capture 阶段吞这次 click
    });
    onBeforeUnmount(() => {
      window.removeEventListener('mousedown', onAnyDown, true);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('click', onClick, true);
    });
  }

  return machine;
}
