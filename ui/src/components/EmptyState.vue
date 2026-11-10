<script setup lang="ts">
import { Download } from '@lucide/vue';
import { computed } from 'vue';
import { t } from '@/locales/zh-CN';
import type { TaskFilter } from '@/api/types';
import BaseButton from '@/components/BaseButton.vue';
import { Plus } from '@lucide/vue';

/**
 * 空状态（DESIGN.md §2.6）：
 * - no-tasks：Download 24 --meta + 主/副文案 + Primary CTA「新建任务」（Plus 16）
 * - no-results：文案「没有{筛选名}的任务」+ Ghost「查看全部」
 * 空态文案永远给出下一步动作。
 */
const props = defineProps<{
  variant: 'no-tasks' | 'no-results';
  filter?: TaskFilter;
  missingOnly?: boolean;
}>();

const emit = defineEmits<{ 'new-task': []; 'view-all': [] }>();

const filterName = computed(() => {
  switch (props.filter) {
    case 'downloading':
      return t('filter.downloading');
    case 'completed':
      return t('filter.completed');
    case 'failed':
      return t('filter.failed');
    default:
      return t('filter.all');
  }
});

const title = computed(() => {
  if (props.variant === 'no-tasks') return t('empty.noTasksTitle');
  if (props.missingOnly) return t('empty.missingTitle');
  return t('empty.noResultsTitle', { filter: filterName.value });
});

const subtitle = computed(() => {
  if (props.variant === 'no-tasks') return t('empty.noTasksSub');
  if (props.missingOnly) return t('empty.missingSub');
  return t('empty.noResultsSub');
});
</script>

<template>
  <div class="empty">
    <Download class="icon-24 empty-icon" aria-hidden="true" />
    <p class="empty-title">{{ title }}</p>
    <p class="empty-sub">{{ subtitle }}</p>
    <BaseButton v-if="variant === 'no-tasks'" variant="primary" @click="emit('new-task')">
      <template #icon><Plus class="icon-16" /></template>
      {{ t('topbar.newTask') }}
    </BaseButton>
    <BaseButton v-else variant="ghost" @click="emit('view-all')">
      {{ t('common.viewAll') }}
    </BaseButton>
  </div>
</template>

<style scoped>
.empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  text-align: center;
}

.empty-icon {
  color: var(--meta);
  margin-bottom: var(--space-4);
}

.empty-title {
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--fg-2);
}

.empty-sub {
  font-size: var(--text-sm);
  color: var(--muted);
  max-width: 40ch;
  line-height: 1.5;
}
</style>
