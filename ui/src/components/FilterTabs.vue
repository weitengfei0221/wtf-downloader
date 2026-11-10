<script setup lang="ts">
import { computed } from 'vue';
import { FileWarning } from '@lucide/vue';
import { t } from '@/locales/zh-CN';
import type { TaskFilter } from '@/api/types';
import { useTasksStore } from '@/stores/tasks';

/**
 * 顶栏筛选分段控件（DESIGN.md §2.2）：容器 bg --surface-2 / --radius-md / padding 2px；
 * 激活项浅色 bg --surface、深色 bg --surface-3（+1px --border），计数 12px tabular-nums。
 */
const store = useTasksStore();

const tabs = computed(() => {
  const counts = store.counts;
  // 下载中置顶且为默认视图（2026-11 第七轮用户裁决）；其余保持原相对顺序。
  return [
    { key: 'downloading' as TaskFilter, label: t('filter.downloading'), count: counts.downloading },
    { key: 'all' as TaskFilter, label: t('filter.all'), count: counts.all },
    { key: 'completed' as TaskFilter, label: t('filter.completed'), count: counts.completed },
    { key: 'failed' as TaskFilter, label: t('filter.failed'), count: counts.failed },
  ];
});
</script>

<template>
  <div class="filter-group">
    <!-- 四值状态筛选：语义不变，切换时由 setFilter 退出独立的文件丢失筛选 -->
    <div class="seg" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="seg-item"
        :class="{ active: store.filter === tab.key && !store.missingOnly }"
        type="button"
        role="tab"
        :aria-selected="store.filter === tab.key && !store.missingOnly"
        @click="store.setFilter(tab.key)"
      >
        <span class="seg-label">{{ tab.label }}</span>
        <span class="seg-count mono" :class="{ 'seg-count-active': store.filter === tab.key && !store.missingOnly }">{{ tab.count }}</span>
      </button>
    </div>

    <!-- 独立开关（DESIGN.md §2.10）：只在确实存在文件丢失任务时出现，不计入 TaskFilter 四值 -->
    <button
      v-if="store.missingCount > 0"
      class="missing-filter"
      type="button"
      role="switch"
      :aria-checked="store.missingOnly"
      :aria-label="t('filter.missingAria')"
      @click="store.toggleMissingOnly()"
    >
      <FileWarning class="icon-16" aria-hidden="true" />
      <span>{{ t('filter.missing') }}</span>
      <span class="missing-count mono">{{ store.missingCount }}</span>
    </button>
  </div>
</template>

<style scoped>
.filter-group {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
}

.seg {
  display: inline-flex;
  /* 不参与顶栏收缩：分段控件的文字绝不能换行（窄窗时应由搜索框让位，见 AppTopbar） */
  flex: none;
  gap: 2px;
  padding: 2px;
  background: var(--surface-2);
  border-radius: var(--radius-md);
}

.seg-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--muted);
  border: 1px solid transparent;
  white-space: nowrap;
  transition:
    background-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    border-color var(--motion-fast) var(--ease-standard);
}

.seg-item:hover {
  color: var(--fg-2);
}

.seg-item.active {
  background: var(--surface);
  border-color: var(--border);
  color: var(--fg);
  font-weight: 500;
}

/* 深色主题激活项底色（DESIGN.md §2.2：深色 bg --surface-3） */
:global(html[data-theme='dark']) .seg-item.active {
  background: var(--surface-3);
}

.seg-count {
  font-size: var(--text-xs);
  color: var(--muted);
}

.seg-count-active {
  color: var(--fg-2);
}

/* 独立筛选开关：不复用 seg-item（它属于 tablist，role=tab 语义不能混） */
.missing-filter {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  flex: none;
  height: 28px;
  padding: 0 var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  color: var(--muted);
  white-space: nowrap;
  transition:
    background-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    border-color var(--motion-fast) var(--ease-standard);
}

.missing-filter:hover {
  color: var(--fg-2);
  border-color: var(--fg-2);
}

.missing-filter[aria-checked='true'] {
  background: var(--warn-soft);
  border-color: var(--warn);
  color: var(--warn);
}

.missing-filter:focus-visible {
  box-shadow: var(--focus-ring);
}

.missing-count {
  font-size: var(--text-xs);
  font-weight: 500;
}
</style>
