/**
 * 弹窗通用行为：焦点困环 + Esc 关闭（DESIGN.md §1.7 / §3.1）。
 * 用法：容器根节点绑定 @keydown="onDialogKeydown($event, requestClose)"。
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab 在弹窗内循环（焦点困环） */
export function trapTabKey(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
  if (focusables.length === 0) return;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  const active = document.activeElement;
  if (!event.shiftKey && (active === last || active === container)) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
  } else if (active !== null && !container.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * 弹窗容器键盘处理：Tab 困环；Esc → requestClose（由调用方决定是直接关还是弹放弃确认）。
 * keydown 事件需来自容器内部（弹窗内元素）。
 */
export function onDialogKeydown(container: HTMLElement, event: KeyboardEvent, requestClose: () => void): void {
  if (event.key === 'Tab') {
    trapTabKey(container, event);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    requestClose();
  }
}

/** 打开弹窗后聚焦首个指定元素 */
export function focusFirst(container: HTMLElement, selector?: string): void {
  const target = selector
    ? (container.querySelector<HTMLElement>(selector) ?? container)
    : container;
  target.focus();
}

/**
 * 锚定式浮层定位：基于触发元素 rect 计算 fixed 坐标（Teleport 到 body 用）。
 * align 'end' = 浮层右缘对齐锚点右缘；默认向下展开，视口不足时向上翻转。
 */
export function anchoredStyle(
  anchor: HTMLElement,
  options: { width?: number; estimatedHeight?: number; margin?: number } = {},
): { left: string; top: string; width?: string; minWidth?: string } {
  const margin = options.margin ?? 4;
  const rect = anchor.getBoundingClientRect();
  const width = options.width;
  const left = width != null ? Math.max(8, rect.right - width) : rect.left;
  const estimatedHeight = options.estimatedHeight ?? 160;
  const viewportH = window.innerHeight;
  const openDown = rect.bottom + estimatedHeight + margin <= viewportH;
  const top = openDown ? rect.bottom + margin : Math.max(8, rect.top - estimatedHeight - margin);
  const style: { left: string; top: string; width?: string; minWidth?: string } = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
  };
  if (width != null) {
    style.width = `${width}px`;
  }
  return style;
}

/** 视口坐标点（鼠标 clientX/clientY 或按钮 rect 右下角） */
export interface AnchorPoint {
  x: number;
  y: number;
}

/**
 * ConfirmDialog 的按钮项（**唯一定义**）。`safe` 标记 Enter 触发项，即"最安全项"
 * （取消 / 仅删除任务这类不破坏数据的动作）。
 */
export interface ConfirmAction {
  key: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  safe?: boolean;
}

/** 浮层定位可注入视口尺寸（便于单测；缺省读 window） */
interface PointOptions {
  width?: number;
  estimatedHeight?: number;
  margin?: number;
  viewport?: { width: number; height: number };
}

const EDGE = 8;

/**
 * 坐标点锚定浮层定位（右键菜单 / 「更多」按钮用）：以坐标点为基准向右下展开，
 * 右/下越界时翻转到左侧/上方，四周保留 8px 边距（DESIGN.md §1.4）。
 * 与 anchoredStyle 的区别：输入是坐标点而非元素 rect——右键菜单必须落在鼠标位置，
 * 用整行元素 rect 会固定偏到行右下角（2026-10-25 实测修复）。
 */
export function anchoredStyleAt(
  point: AnchorPoint,
  options: PointOptions = {},
): { left: string; top: string; width?: string; minWidth?: string } {
  const margin = options.margin ?? 4;
  const width = options.width;
  const height = options.estimatedHeight ?? 160;
  const viewportW = options.viewport?.width ?? window.innerWidth;
  const viewportH = options.viewport?.height ?? window.innerHeight;

  // 水平：默认与点左对齐；右侧放不下则翻转到点的左侧
  let left = point.x;
  if (width != null) {
    if (point.x + width + margin > viewportW) left = point.x - width - margin;
    left = Math.min(Math.max(EDGE, left), Math.max(EDGE, viewportW - width - EDGE));
  } else {
    left = Math.min(Math.max(EDGE, left), Math.max(EDGE, viewportW - EDGE));
  }

  // 垂直：默认向下展开；下方放不下则翻转到上方
  let top = point.y + margin;
  if (top + height + EDGE > viewportH) top = point.y - height - margin;
  top = Math.min(Math.max(EDGE, top), Math.max(EDGE, viewportH - height - EDGE));

  const style: { left: string; top: string; width?: string; minWidth?: string } = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
  };
  if (width != null) {
    style.width = `${width}px`;
  }
  return style;
}
