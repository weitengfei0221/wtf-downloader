<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { ExternalLink, FolderOpen, Gauge, Trash2 } from '@lucide/vue';
import { t } from '@/locales/zh-CN';
import type { TaskRecord } from '@/api/types';
import type { AnchorPoint } from '@/utils/dialog';
import { anchoredStyleAt } from '@/utils/dialog';
import { useToastStore } from '@/stores/toast';
import { useTasksStore } from '@/stores/tasks';
import { MB } from '@/utils/units';

/**
 * 任务行「更多」菜单（DESIGN.md §2.3）：打开文件 / 打开目录 / 任务限速（内联
 * popover：mono 输入 MB/s + 不限开关，Enter 生效）/ 删除（--danger 文字）。
 * z-index 1000；菜单项高 32px；点击外部 / Esc / 滚动 / 窗口 resize 关闭。
 * 定位按坐标点（鼠标或按钮右下角）展开，越界翻转（2026-10-25 实测修复）。
 */
const props = defineProps<{ task: TaskRecord; point: AnchorPoint; fileMissing?: boolean }>();
const emit = defineEmits<{
  close: [];
  action: [type: 'open-file' | 'open-dir' | 'remove'];
}>();

const MENU_WIDTH = 200;
const MENU_HEIGHT = 148;

const toast = useToastStore();
const tasksStore = useTasksStore();
const menu = ref<HTMLElement | null>(null);
const limitOpen = ref(false);
const limitInput = ref<string>('');
const limitError = ref<string>('');
const limitInputEl = ref<HTMLInputElement | null>(null);

const style = computed(() =>
  anchoredStyleAt(props.point, { width: MENU_WIDTH, estimatedHeight: MENU_HEIGHT }),
);

/** 当前生效的限速（MB 取整）；null = 不限速 */
function currentLimitMb(): number | null {
  const limit = tasksStore.byId(props.task.id)?.speedLimit ?? null;
  return limit != null ? Math.round(limit / MB) : null;
}

/** 输入是否非法（空 / 非数字 / ≤0）：非法时不允许"应用"静默降级成不限速 */
const limitInvalid = computed(() => {
  const raw = limitInput.value.trim();
  const mb = Number(raw);
  return raw === '' || !Number.isFinite(mb) || mb <= 0;
});

function onDocClick(e: MouseEvent): void {
  if (menu.value && !menu.value.contains(e.target as Node)) emit('close');
}

function onDocKeydown(e: KeyboardEvent): void {
  // Esc 只关菜单，不要再冒泡到 window 触发「清空批量勾选」
  if (e.key === 'Escape') {
    e.stopPropagation();
    emit('close');
  }
}

/** 浮层是 fixed 坐标定位：页面/容器滚动或窗口尺寸变化后锚点失效，直接关闭 */
function onViewportChange(e: Event): void {
  if (menu.value && e.target instanceof Node && menu.value.contains(e.target)) return;
  emit('close');
}

onMounted(async () => {
  document.addEventListener('mousedown', onDocClick);
  document.addEventListener('keydown', onDocKeydown);
  // capture 阶段捕获任意滚动容器（列表滚动不冒泡到 document）
  document.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('resize', onViewportChange);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick);
  document.removeEventListener('keydown', onDocKeydown);
  document.removeEventListener('scroll', onViewportChange, true);
  window.removeEventListener('resize', onViewportChange);
});

/**
 * 打开限速面板。**每次都从 store 重新取值**（2026-11 实测缺陷 2：解除限速后重开
 * 输入框仍显示上次的 MB 数）；不限速时显式置空，不留残留数字。
 */
async function openLimit(): Promise<void> {
  const mb = currentLimitMb();
  limitInput.value = mb != null ? String(mb) : '';
  limitError.value = '';
  limitOpen.value = true;
  await nextTick();
  limitInputEl.value?.focus();
}

/**
 * 应用限速。unlimited = true 走「不限」（清 null），否则按输入框的 MB 值换算。
 * 非法输入不静默降级为不限速（原文案 `Number('') → 0 → null` 会悄悄解除限速），
 * 改为内联提示并中止；成功由 store 本地 patch，行内「限 X MB/s」即时出现。
 */
async function applyLimit(unlimited: boolean): Promise<void> {
  if (!unlimited && limitInvalid.value) {
    limitError.value = t('more.limitInvalid');
    return;
  }
  const bps = unlimited ? null : Math.round(Number(limitInput.value) * MB);
  try {
    await tasksStore.setTaskLimit(props.task.id, bps);
  } catch (e) {
    toast.pushError('toast.saveFailed', e);
  }
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div ref="menu" class="menu" :style="style" role="menu" @click.stop>
      <template v-if="!limitOpen">
        <!-- 文件已丢失：禁用「打开文件」，保留「打开目录」 -->
        <button class="menu-item" type="button" role="menuitem" :disabled="fileMissing" @click="emit('action', 'open-file')">
          <ExternalLink class="icon-16" />
          {{ t('more.openFile') }}
        </button>
        <button class="menu-item" type="button" role="menuitem" @click="emit('action', 'open-dir')">
          <FolderOpen class="icon-16" />
          {{ t('more.openDir') }}
        </button>
        <button class="menu-item" type="button" role="menuitem" @click="openLimit">
          <Gauge class="icon-16" />
          {{ t('more.taskLimit') }}
        </button>
        <div class="menu-sep" />
        <button class="menu-item menu-danger" type="button" role="menuitem" @click="emit('action', 'remove')">
          <Trash2 class="icon-16" />
          {{ t('more.remove') }}
        </button>
      </template>

      <div v-else class="limit-pop">
        <p class="limit-title">{{ t('more.taskLimitTitle') }}</p>
        <div class="limit-row">
          <input
            ref="limitInputEl"
            v-model="limitInput"
            class="limit-input mono"
            :class="{ 'limit-input-invalid': limitError !== '' }"
            type="number"
            min="1"
            :aria-invalid="limitError !== ''"
            :placeholder="t('common.speedPlaceholder')"
            @input="limitError = ''"
            @keydown.enter.prevent="applyLimit(false)"
          />
          <span class="limit-unit">{{ t('more.limitUnit') }}</span>
        </div>
        <p v-if="limitError" class="limit-err" role="alert">{{ limitError }}</p>
        <button class="limit-unlimited" type="button" @click="applyLimit(true)">
          {{ t('more.unlimited') }}
        </button>
      </div>
    </div>
  </Teleport>
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

.menu-danger {
  color: var(--danger);
}

.menu-danger:hover {
  color: var(--danger);
}

.menu-sep {
  height: 1px;
  margin: var(--space-1) 0;
  background: var(--border-soft);
}

.limit-pop {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
}

.limit-title {
  font-size: var(--text-xs);
  color: var(--muted);
}

.limit-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.limit-input {
  width: 88px;
  height: 32px;
  padding: 0 var(--space-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--fg);
}

.limit-unit {
  font-size: var(--text-xs);
  color: var(--muted);
}

/* 非法输入内联提示（12px --danger）：不静默降级成"不限速" */
.limit-input-invalid {
  border-color: var(--danger);
}

.limit-err {
  font-size: var(--text-xs);
  color: var(--danger);
  line-height: 1.4;
}

.limit-unlimited {
  align-self: flex-start;
  font-size: var(--text-sm);
  color: var(--fg-2);
  transition: color var(--motion-fast) var(--ease-standard);
}

.limit-unlimited:hover {
  color: var(--fg);
}
</style>
