<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ListChecks, Pause, Play, RotateCw, Trash2 } from '@lucide/vue';
import { t } from '@/locales/zh-CN';
import type { TaskRecord } from '@/api/types';
import type { AnchorPoint } from '@/utils/dialog';
import { anchoredStyleAt } from '@/utils/dialog';
import { bulkTargetIds, deleteFilesFromKey, type BulkActionKey } from '@/utils/bulk';
import { useBulkActions } from '@/composables/useBulkActions';
import { useToastStore } from '@/stores/toast';
import ConfirmDialog from '@/components/ConfirmDialog.vue';

/**
 * 多选右键菜单（DESIGN.md §2.9）：选中 >1 条时替代 TaskMoreMenu。
 * 顶部只读提示「已选 {n} 个任务」→ 全部暂停 / 全部开始 / 全部重试 → 分隔线 →
 * 删除选中任务…（三按钮确认：取消 / 仅删除任务 / 删除任务和文件）。
 * 三项可用性统一取 bulkTargetIds(kind, selected)，无可操作对象时 disabled 而非隐藏
 * （菜单项数恒定，estimatedHeight 才不会算错）。
 * 删除语义单点在后端（AC-13）：`.part` 一律清；成品文件只随 `with-files` 删。
 * z-index 1000；点外部 / Esc / 滚动 / resize 关闭；Esc 先消费，不连带清空选择。
 */
const props = defineProps<{ tasks: TaskRecord[]; point: AnchorPoint }>();
const emit = defineEmits<{ close: []; removed: [ids: string[]] }>();

const MENU_WIDTH = 200;
const ITEM_H = 32;
const HINT_H = 24;
const SEP_H = 9; // 1px 分隔线 + 上下各 --space-1
const PAD_V = 4; // 上下各 --space-1

/** 批量动作项：菜单项数从这里派生，estimatedHeight 随实际项数变化（非写死 148） */
const ACTIONS = [
  { kind: 'pause', labelKey: 'bulk.pauseAll', icon: Pause },
  { kind: 'resume', labelKey: 'bulk.resumeAll', icon: Play },
  { kind: 'retry', labelKey: 'bulk.retryAll', icon: RotateCw },
] as const;

const toast = useToastStore();
const bulk = useBulkActions();
const menu = ref<HTMLElement | null>(null);
const busy = ref(false);
const confirmOpen = ref(false);

/** 贴近屏幕底部时按真实高度翻转；项数变了高度自动跟着变 */
const estimatedHeight = computed(
  () => PAD_V * 2 + HINT_H + ACTIONS.length * ITEM_H + SEP_H + ITEM_H,
);
const style = computed(() =>
  anchoredStyleAt(props.point, { width: MENU_WIDTH, estimatedHeight: estimatedHeight.value }),
);

/** 判据只有一处：按钮可用性与 useBulkActions.run 的目标集合共用 bulkTargetIds */
const can = computed(() => ({
  pause: bulkTargetIds('pause', props.tasks).length > 0,
  resume: bulkTargetIds('resume', props.tasks).length > 0,
  retry: bulkTargetIds('retry', props.tasks).length > 0,
}));

const hasCompleted = computed(() => props.tasks.some((task) => task.status === 'completed'));
const removeMessage = computed(() =>
  hasCompleted.value
    ? t('bulk.removeMessageCompleted', { n: props.tasks.length })
    : t('bulk.removeMessage', { n: props.tasks.length }),
);

function onDocClick(e: MouseEvent): void {
  // 确认弹窗期间不能因外部点击卸载菜单，否则会连带销毁弹窗本身
  if (confirmOpen.value) return;
  if (menu.value && !menu.value.contains(e.target as Node)) emit('close');
}

function onDocKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (confirmOpen.value) return; // Esc 交给 ConfirmDialog 的 capture 监听消费
    e.stopPropagation();
    emit('close');
  }
}

function onViewportChange(e: Event): void {
  if (confirmOpen.value) return;
  if (menu.value && e.target instanceof Node && menu.value.contains(e.target)) return;
  emit('close');
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick);
  document.addEventListener('keydown', onDocKeydown);
  document.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('resize', onViewportChange);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick);
  document.removeEventListener('keydown', onDocKeydown);
  document.removeEventListener('scroll', onViewportChange, true);
  window.removeEventListener('resize', onViewportChange);
});

async function run(kind: BulkActionKey): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await bulk.run(kind, props.tasks);
  } finally {
    busy.value = false;
    emit('close');
  }
}

async function confirmRemove(key: string): Promise<void> {
  confirmOpen.value = false;
  if (key === 'cancel' || busy.value) return;
  busy.value = true;
  try {
    const result = await bulk.remove(props.tasks, deleteFilesFromKey(key));
    if (result.succeeded.length > 0) emit('removed', result.succeeded);
  } catch (e) {
    toast.pushError('toast.saveFailed', e);
  } finally {
    busy.value = false;
    emit('close');
  }
}
</script>

<template>
  <Teleport to="body">
    <div ref="menu" class="menu" :style="style" role="menu" :aria-label="t('bulk.menuAria')" @click.stop>
      <p class="hint">
        <ListChecks class="icon-16" aria-hidden="true" />
        {{ t('bulk.selected', { n: tasks.length }) }}
      </p>
      <button
        v-for="action in ACTIONS"
        :key="action.kind"
        class="menu-item"
        type="button"
        role="menuitem"
        :disabled="busy || !can[action.kind]"
        @click="run(action.kind)"
      >
        <component :is="action.icon" class="icon-16" />
        {{ t(action.labelKey) }}
      </button>
      <div class="menu-sep" />
      <button
        class="menu-item menu-danger"
        type="button"
        role="menuitem"
        :disabled="busy"
        @click="confirmOpen = true"
      >
        <Trash2 class="icon-16" />
        {{ t('bulk.removeSelected') }}
      </button>
    </div>
  </Teleport>

  <ConfirmDialog
    v-if="confirmOpen"
    :title="t('bulk.removeTitle')"
    :message="removeMessage"
    :actions="[
      { key: 'cancel', label: t('common.cancel'), variant: 'ghost', safe: true },
      { key: 'task-only', label: t('remove.onlyTask'), variant: 'secondary', safe: true },
      { key: 'with-files', label: t('remove.withFiles'), variant: 'destructive' },
    ]"
    @select="confirmRemove"
  />
</template>

<style scoped>
.menu {
  position: fixed;
  z-index: 1000; /* Token zIndex.dropdown */
  min-width: 160px;
  padding: var(--space-1);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--elev-raised);
  animation: menu-in var(--motion-fast) var(--ease-standard);
}

@keyframes menu-in {
  from {
    opacity: 0;
  }
}

.hint {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 24px;
  padding: 0 var(--space-2);
  font-size: var(--text-xs);
  color: var(--muted);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: 32px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--fg-2);
  transition: background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}

.menu-item:hover {
  background: var(--surface-2);
  color: var(--fg);
}

.menu-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.menu-item:disabled:hover {
  background: none;
  color: var(--fg-2);
}

.menu-sep {
  height: 1px;
  margin: var(--space-1) 0;
  background: var(--border-soft);
}

.menu-danger {
  color: var(--danger);
}

.menu-danger:hover {
  color: var(--danger);
}
</style>
