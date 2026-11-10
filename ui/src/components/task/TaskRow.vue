<script setup lang="ts">
import { computed, ref } from 'vue';
import { Check, FileWarning } from '@lucide/vue';
import { t } from '@/locales/zh-CN';
import type { ProgressFrame, TaskRecord } from '@/api/types';
import type { AnchorPoint } from '@/utils/dialog';
import TaskRowHeader from '@/components/task/TaskRowHeader.vue';
import TaskRowProgress from '@/components/task/TaskRowProgress.vue';
import TaskRowMeta from '@/components/task/TaskRowMeta.vue';
import TaskMoreMenu from '@/components/task/TaskMoreMenu.vue';
import TaskContextMenu from '@/components/task/TaskContextMenu.vue';

/**
 * 任务行（DESIGN.md §2.3 / §2.9）：圆角条块 --radius-md、min-height 80px、行内 padding
 * 12px 16px；三层结构；hover bg --surface-2（150ms）；选中高亮 --primary-soft；
 * 进入动画 fade + slide 8px（200ms，仅首次出现的行）；roving tabindex 由 tabindex 驱动。
 *
 * 两套「选中」互不覆盖：`highlighted` = has(task.id)（选择集合，驱动 .row-selected
 * 高亮）；`tabindex`/selectedId 是键盘焦点行（驱动 :focus-visible 焦点环）。
 * 迅雷式多选：左键 / Ctrl / Shift 由列表状态机分流；右键按选择数量切换单选/多选菜单。
 * `fileMissing` 是瞬时呈现态（§2.10）：整行降权 + 徽标 + 禁用「打开文件」，状态不动。
 */
const props = defineProps<{
  task: TaskRecord;
  frame?: ProgressFrame;
  /** roving tabindex（由列表视图按 selectedId 计算） */
  tabindex?: number;
  /** 该任务是本次刷新新增的（只有新增行播入场动画） */
  isNew?: boolean;
  /** 是否在选择集合中：驱动 .row-selected（--primary-soft） */
  highlighted?: boolean;
  /** 当前选择集合数量：右键菜单按它切换单选 / 多选 */
  selectionCount?: number;
  /** 当前选择集合（从 visible 派生）：多选菜单的动作目标 */
  selectedTasks?: TaskRecord[];
  /** 关联正式文件已不存在：瞬时呈现态，不改 TaskRecord / 不改 TaskStatus */
  fileMissing?: boolean;
}>();

const emit = defineEmits<{
  action: [type: string];
  key: [event: KeyboardEvent];
  selected: [];
  /** 行左键点击：由列表状态机按 Ctrl / Shift / 普通点击分流 */
  select: [event: MouseEvent];
  /** 右键：列表视图先按选择集合收敛（行不在集合内 → 只选该行） */
  context: [id: string];
  /** 多选菜单删除成功后清理选择集合 */
  removed: [ids: string[]];
}>();

/** 菜单锚点：坐标点（非元素 rect），右键 = 鼠标 clientX/clientY，按钮 = 按钮右下角 */
const menuPoint = ref<AnchorPoint | null>(null);
const menuOpen = ref(false);
const menuTrigger = ref<'row' | 'more'>('row');

/** 右键按选择数量切换；「更多」按钮始终是该行自己的单选菜单（4 项不变） */
const menuIsMulti = computed(
  () => menuTrigger.value === 'row' && (props.selectionCount ?? 0) > 1,
);

/** 按钮「更多」：以按钮右下角为锚点（x 回收 4px 使菜单贴住按钮右侧） */
function pointFromButton(event: MouseEvent): AnchorPoint {
  const el = event.currentTarget as HTMLElement | null;
  if (el == null) return { x: event.clientX, y: event.clientY };
  const rect = el.getBoundingClientRect();
  return { x: rect.right - 4, y: rect.bottom + 4 };
}

/** 行内操作组：`more` 在本组件内拦截并自行开菜单（父级 switch 无需处理） */
function onAction(type: string, event: MouseEvent): void {
  if (type === 'more') {
    menuTrigger.value = 'more';
    menuPoint.value = pointFromButton(event);
    menuOpen.value = true;
    return;
  }
  emit('action', type);
}

/** 右键：菜单落在鼠标位置（整行 rect 会固定偏到行右下角，2026-10-25 实测修复） */
function onContextMenu(event: MouseEvent): void {
  emit('context', props.task.id);
  menuTrigger.value = 'row';
  menuPoint.value = { x: event.clientX, y: event.clientY };
  menuOpen.value = true;
}

function onMoreAction(type: 'open-file' | 'open-dir' | 'remove'): void {
  menuOpen.value = false;
  emit('action', type);
}

function closeMenu(): void {
  menuOpen.value = false;
}

function onRemoved(ids: string[]): void {
  menuOpen.value = false;
  emit('removed', ids);
}

function onRowClick(event: MouseEvent): void {
  emit('select', event);
}
</script>

<template>
  <article
    class="row"
    :class="{ 'row-selected': highlighted, 'row-enter': isNew, 'row-file-missing': fileMissing }"
    :data-task-id="task.id"
    :tabindex="tabindex ?? -1"
    @click="onRowClick"
    @keydown="emit('key', $event)"
    @focusin="emit('selected')"
    @contextmenu.prevent="onContextMenu($event)"
  >
    <div class="row-line">
      <!-- 选中对号：固定 16px 前导槽常驻，未选中时同样占位 → 文件名永不左右跳。
           纯状态指示（aria-hidden + pointer-events:none），不是 checkbox、不可交互。 -->
      <span class="select-mark" aria-hidden="true">
        <Check v-if="highlighted" class="icon-16" />
      </span>
      <div class="row-body">
        <TaskRowHeader :task="task" :file-missing="fileMissing" @action="onAction" />
        <TaskRowProgress :task="task" :frame="frame" />
        <TaskRowMeta :task="task" :frame="frame" />
      </div>
      <span v-if="fileMissing" class="missing-badge">
        <FileWarning class="icon-16" aria-hidden="true" />
        {{ t('task.fileMissing') }}
      </span>
    </div>
  </article>
  <TaskMoreMenu
    v-if="menuOpen && menuPoint && !menuIsMulti"
    :task="task"
    :point="menuPoint"
    :file-missing="fileMissing"
    @close="closeMenu"
    @action="onMoreAction"
  />
  <TaskContextMenu
    v-else-if="menuOpen && menuPoint"
    :tasks="selectedTasks ?? []"
    :point="menuPoint"
    @close="closeMenu"
    @removed="onRemoved"
  />
</template>

<style scoped>
.row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 80px;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--surface);
  /* Shift 连选 / 拖框时禁浏览器蓝色文本高亮（输入框由 base.css 的 input/textarea 兜底） */
  user-select: none;
  transition:
    background-color var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard),
    opacity var(--motion-fast) var(--ease-standard);
}

.row-line {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  min-width: 0;
}

/* 选中对号的固定前导槽：常驻 16px，未选中时同样占位，文件名不左右跳。
   纯状态指示，非复选框、不可交互；颜色取 --primary-bg（浅色近黑 / 深色近白，双主题高对比）。
   用户裁决（2026-11 第九轮）：状态指示不得套装饰性边框 / 描边胶囊 / 左侧竖条 / 发光底 / 渐变底，
   这是 AI 模板味，坚决不要。本规则体内只允许下面这些纯排版属性，禁止任何会形成「框」的声明。 */
.select-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 16px;
  height: 20px;
  color: var(--primary-bg);
  pointer-events: none;
}

.row-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

/*
 * 入场动画挂在独立类上，只由 `isNew` 触发（2026-11 实测缺陷 3：动画写在 .row 上，
 * 列表刷新时随行重渲染反复重放 → 整列表"闪一下"）。刷新/切换筛选不再重放。
 */
.row-enter {
  animation: row-in var(--motion-base) var(--ease-standard);
}

.row:hover,
.row:focus-within {
  background: var(--surface-2);
}

/*
 * 选中集合高亮（2026-11 第九轮裁决）：只保留 --primary-soft 整行底色。
 * 用户原话「选中时只显示对号，不要这个左边的框框，这个就是 ai 味道，写进约束，坚决不要」——
 * 上一轮加的 inset 左侧竖条随 .row 的圆角渲染成一个描边小框，属装饰性边框，已整条删除。
 * 状态指示只允许语义图标本身（行首 16px Check），禁止任何边框 / 描边胶囊 / 左侧竖条 / 发光底 / 渐变底。
 * 用 .row.row-selected 提升特异性，让 default / hover / focus-within 三态都压过普通 hover。
 */
.row.row-selected,
.row.row-selected:hover,
.row.row-selected:focus-within {
  background: var(--primary-soft);
}

.row:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

/* 选中行同时是键盘焦点行：只保留焦点环，不再叠加任何装饰性竖条 */
.row.row-selected:focus-visible {
  box-shadow: var(--focus-ring);
}

/* 文件已丢失：整行统一降权（只用 opacity，不写死色值），徽标保持可辨 */
.row-file-missing {
  opacity: 0.6;
}

.missing-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  flex: none;
  height: 20px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--warn);
  background: var(--warn-soft);
  white-space: nowrap;
}

/* 行 hover 或 focus-within 唤出操作组由子组件 :deep 控制（150ms fade-in） */
.row :deep(.actions) {
  opacity: 0;
  visibility: hidden;
  transition:
    opacity var(--motion-fast) var(--ease-standard),
    visibility var(--motion-fast) var(--ease-standard);
}

.row:hover :deep(.actions),
.row:focus-within :deep(.actions) {
  opacity: 1;
  visibility: visible;
}

@keyframes row-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
</style>
