<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { Plus, Search, Settings, X } from '@lucide/vue';
import { t } from '@/locales/zh-CN';
import { useUiStore } from '@/stores/ui';
import { useTasksStore } from '@/stores/tasks';
import BaseButton from '@/components/BaseButton.vue';
import IconButton from '@/components/IconButton.vue';
import FilterTabs from '@/components/FilterTabs.vue';

/**
 * 主界面顶栏（DESIGN.md §2.2，52px）：App 名 + 筛选分段控件 + 搜索（Ctrl+F 聚焦，
 * Esc 清空失焦，有内容 X 清除）+ 新建主按钮（Primary，tooltip Ctrl+N）+ 设置入口
 * （Settings 20，aria-label）。顶栏不放总速度（2026-11 交互减法）：实时总速度是
 * 状态信息而非操作入口，移到状态栏只读展示；全局限速只在设置页设置。
 */
const emit = defineEmits<{ 'open-settings': [] }>();

const ui = useUiStore();
const tasksStore = useTasksStore();

const searchEl = ref<HTMLInputElement | null>(null);

/** Ctrl+F 聚焦搜索框（由父视图全局快捷键转发） */
async function focusSearch(): Promise<boolean> {
  if (searchEl.value == null) return false;
  await nextTick();
  searchEl.value.focus();
  return true;
}

function onSearchKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    // Esc 在搜索框内只负责清空并失焦，不要再冒泡到 window 触发「清空批量勾选」
    // （与 ConfirmDialog / TaskMoreMenu 同一套 Esc 归属纪律，DESIGN.md §2.9）
    e.stopPropagation();
    tasksStore.search = '';
    searchEl.value?.blur();
  }
}

defineExpose({ focusSearch });
</script>

<template>
  <header class="topbar">
    <span class="app-name">{{ t('topbar.appName') }}</span>
    <FilterTabs />
    <div class="right">
      <div class="search">
        <Search class="icon-16 search-icon" aria-hidden="true" />
        <input
          ref="searchEl"
          v-model="tasksStore.search"
          class="search-input"
          type="text"
          :placeholder="t('topbar.searchPlaceholder')"
          @keydown="onSearchKeydown"
        />
        <button
          v-if="tasksStore.search !== ''"
          class="search-clear"
          type="button"
          :aria-label="t('aria.clearSearch')"
          @click="tasksStore.search = ''"
        >
          <X class="icon-16" />
        </button>
      </div>
      <BaseButton
        variant="primary"
        :title="t('topbar.newTaskTooltip')"
        @click="ui.openAddDialog()"
      >
        <template #icon><Plus class="icon-16" /></template>
        {{ t('topbar.newTask') }}
      </BaseButton>
      <IconButton :label="t('topbar.settings')" size="md" @click="emit('open-settings')">
        <Settings class="icon-20" />
      </IconButton>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: 52px;
  flex: none;
  padding: 0 var(--space-4);
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}

.app-name {
  flex: none;
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--fg);
  white-space: nowrap;
}

.right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-left: auto;
  min-width: 0;
}

/* 顶栏收缩纪律（DESIGN.md §2.2 元素位置恒定）：除搜索框外一律不收缩，
   宽度不足时只由搜索框让位——按钮不换行、筛选 Tab 不折行。 */
.right > :deep(*) {
  flex: none;
}

.search {
  position: relative;
  display: flex;
  align-items: center;
  flex: 0 1 200px;
  min-width: 0;
  width: 200px;
  height: 32px;
  padding: 0 var(--space-2) 0 var(--space-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition:
    border-color var(--motion-fast) var(--ease-standard),
    box-shadow var(--motion-fast) var(--ease-standard);
}

/*
 * 单一焦点视觉（DESIGN.md §2.2 搜索焦点）：焦点环只画在容器上——
 * border-color 切 --primary-bg + 3px --primary-soft 柔和外环，圆角与容器一致。
 * 输入框自身必须关掉 base.css 的 input:focus-visible 环，否则容器边框 + 内层
 * 3px 环叠加成"双层粗框"（用户实测问题 1）。不使用裸 outline，避免与 hover 叠层。
 */
.search-input:focus-visible {
  box-shadow: none;
}

.search:focus-within {
  border-color: var(--primary-bg);
  box-shadow: 0 0 0 3px var(--primary-soft);
}

.search-icon {
  color: var(--muted);
  margin-right: var(--space-2);
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  font-size: var(--text-sm);
  color: var(--fg);
}

.search-input::placeholder {
  color: var(--meta);
}

.search-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm);
  color: var(--muted);
  transition: color var(--motion-fast) var(--ease-standard);
}

.search-clear:hover {
  color: var(--fg);
}
</style>
