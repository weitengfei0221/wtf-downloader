<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/locales/zh-CN';
import type { TaskStatus } from '@/api/types';

const props = defineProps<{ status: TaskStatus }>();

// DESIGN.md §1.2：下载中无 badge（进度条 + 速度即状态）
const visible = computed(() => props.status !== 'downloading');

const text = computed(() => {
  switch (props.status) {
    case 'pending':
      return t('status.pending');
    case 'paused':
      return t('status.paused');
    case 'completed':
      return t('status.completed');
    case 'failed':
      return t('status.failed');
    default:
      return '';
  }
});
</script>

<template>
  <!-- DESIGN.md §1.7 badge：height 20 / padding 0 8 / 12px / --radius-full / tabular-nums -->
  <span v-if="visible" class="badge" :class="`badge-${status}`">{{ text }}</span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex: none;
}

/* 等待中：--meta 文字 + --surface-3 底（DESIGN.md §1.2） */
.badge-pending {
  color: var(--meta);
  background: var(--surface-3);
}

/* 已暂停：警告色，用户裁决醒目化（2026-11 第九轮）。原 --muted + --surface-3 与 pending 几乎同色 */
.badge-paused {
  color: var(--warn);
  background: var(--warn-soft);
  font-weight: 500;
}

/* 已完成：--success 文字 + --success-soft 底 */
.badge-completed {
  color: var(--success);
  background: var(--success-soft);
}

/* 已失败：--danger 文字 + --danger-soft 底 */
.badge-failed {
  color: var(--danger);
  background: var(--danger-soft);
}
</style>
