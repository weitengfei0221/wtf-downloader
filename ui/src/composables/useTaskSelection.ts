import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref } from 'vue';
import type { TaskRecord } from '@/api/types';

/**
 * 迅雷式多选状态机（DESIGN.md §2.9）：左键单选 / Ctrl 切换 / Shift 连选 / Ctrl+A
 * 全选当前 visible / Esc 清空 / 点空白清空。无复选框、无批量条。
 *
 * **与 `selectedId` 严格分离**：`TaskListView.selectedId` 是 roving tabindex 的
 * 键盘焦点行（单行、决定 ↑↓ 与 Space/Delete 落在谁身上，驱动 focus 环）；这里的
 * `checkedIds` 是选择集合（多行、决定右键菜单是单选还是多选、动作作用于谁）。
 * 两者不互相赋值、不互相覆盖：composable 内不出现 selectedId / 入场动画。
 *
 * `selected` 始终从当前 `visible` 派生 → 动作**永不作用于被筛选隐藏的行**。
 * 集合本身可保留隐藏 id（筛选切回自然恢复），但它不参与任何隐藏行的动作。
 */
export function useTaskSelection(visible: () => TaskRecord[]) {
  /** 选择集合（与焦点行无关，可含当前筛选之外的 id） */
  const checkedIds = ref<ReadonlySet<string>>(new Set<string>());
  /** Shift 连选锚点：上一次点击的行 id */
  let anchorId: string | null = null;

  const visibleIds = computed(() => visible().map((task) => task.id));

  /** 只对当前可见的选择生效：菜单项数量、按钮可用性、动作目标全部取它 */
  const selected = computed(() => visible().filter((task) => checkedIds.value.has(task.id)));
  const count = computed(() => selected.value.length);
  const allVisibleSelected = computed(
    () => visibleIds.value.length > 0 && visibleIds.value.every((id) => checkedIds.value.has(id)),
  );

  function has(id: string): boolean {
    return checkedIds.value.has(id);
  }

  function commit(next: Set<string>): void {
    checkedIds.value = next;
  }

  /** 左键单选：清空原选择、只选中该行，同时把它设为 Shift 锚点 */
  function selectOnly(id: string): void {
    commit(new Set([id]));
    anchorId = id;
  }

  /** 右键准备：行不在集合中 → 收敛为单选；已在集合中 → 保持多选（数量由视图取） */
  function prepareContext(id: string): void {
    if (!has(id)) selectOnly(id);
  }

  /** Ctrl+点击＝切换成员资格；Shift+点击＝按 visible 顺序连选（沿用原 shift 分支） */
  function toggle(id: string, shiftKey = false): void {
    const order = visibleIds.value;
    const from = anchorId == null ? -1 : order.indexOf(anchorId);
    const to = order.indexOf(id);
    const next = new Set(checkedIds.value);
    if (shiftKey && from !== -1 && to !== -1) {
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      for (let i = lo; i <= hi; i += 1) {
        const at = order[i];
        if (at != null) next.add(at);
      }
    } else if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    commit(next);
    anchorId = id;
  }

  /** Ctrl+A 全选只作用于当前筛选结果（visible），不是 store.tasks 全集 */
  function selectAll(): void {
    const next = new Set(checkedIds.value);
    for (const id of visibleIds.value) next.add(id);
    commit(next);
  }

  /**
   * 框选批量提交（DESIGN.md §2.9）：
   * - additive（Ctrl / Shift 框选）＝在既有集合上追加；否则＝替换（先清空再选）。
   * - ids 一律再过一遍 visible 白名单：筛选隐藏的行永不参与（调用方已按 DOM 行命中，
   *   这里兜底防误传隐藏 id），集合仍只从 visible 派生。
   * - 框选没有单击锚点，复位 Shift 连选锚点；之后首次 Shift 点击退化为普通切换。
   */
  function selectIds(ids: string[], additive: boolean): void {
    const allowed = new Set(visibleIds.value);
    const next = additive ? new Set(checkedIds.value) : new Set<string>();
    for (const id of ids) {
      if (allowed.has(id)) next.add(id);
    }
    commit(next);
    anchorId = null;
  }

  /** 历史全选切换 API（已无常驻 UI 入口，保留给回归用例验证筛选派生） */
  function toggleAll(): void {
    if (allVisibleSelected.value) {
      const next = new Set(checkedIds.value);
      for (const id of visibleIds.value) next.delete(id);
      commit(next);
    } else {
      selectAll();
    }
    anchorId = null;
  }

  /** Esc / 点击列表空白区 */
  function clear(): void {
    checkedIds.value = new Set<string>();
    anchorId = null;
  }

  /** 删除成功后清掉已删 id（无论先前是否在当前筛选内） */
  function removeIds(ids: string[]): void {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    const next = new Set([...checkedIds.value].filter((id) => !gone.has(id)));
    checkedIds.value = next;
    if (anchorId != null && gone.has(anchorId)) anchorId = null;
  }

  /** 文本输入控件内不抢 Ctrl+A：让浏览器全选文本（搜索框 / 限速输入 / 弹窗输入框） */
  function isTextEntry(target: EventTarget | null): boolean {
    if (target == null) return false;
    const el = target as { tagName?: string; isContentEditable?: boolean };
    const tag = el.tagName ?? '';
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
  }

  /** 有模态弹窗打开时不抢 Ctrl+A（弹窗内按钮聚焦时不该改背后的选择集合） */
  function hasOpenDialog(): boolean {
    return typeof document !== 'undefined' && document.querySelector('[role="dialog"]') != null;
  }

  // Esc 清空选择。ConfirmDialog 在 window capture 阶段 stopPropagation，
  // 故「Esc 关弹窗」不会连带清空；两个右键菜单的文档级 Esc 同样先消费事件。
  // 返回给测试直接调用：脱离组件实例时（纯逻辑单测）不注册全局监听。
  function onWindowKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && checkedIds.value.size > 0) {
      clear();
      return;
    }
    const isA = e.key === 'a' || e.key === 'A';
    if (isA && (e.ctrlKey || e.metaKey) && !isTextEntry(e.target) && !hasOpenDialog()) {
      e.preventDefault();
      selectAll();
    }
  }
  if (getCurrentInstance() != null) {
    onMounted(() => window.addEventListener('keydown', onWindowKeydown));
    onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown));
  }

  return {
    checkedIds,
    selected,
    count,
    allVisibleSelected,
    has,
    selectOnly,
    prepareContext,
    toggle,
    selectAll,
    selectIds,
    toggleAll,
    clear,
    removeIds,
    onWindowKeydown,
  };
}
