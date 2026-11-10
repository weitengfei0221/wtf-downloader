<script setup lang="ts">
import { computed } from 'vue';
import type { ProgressFrame, TaskRecord } from '@/api/types';
import { formatPercent } from '@/utils/format';
import ProgressBar from '@/components/ProgressBar.vue';

const props = defineProps<{ task: TaskRecord; frame?: ProgressFrame }>();

const percent = computed(() => {
  const total = props.frame?.totalBytes ?? props.task.totalBytes;
  if (total == null) return null;
  const done = props.frame?.downloadedBytes ?? props.task.downloadedBytes;
  return (done / total) * 100;
});

/** 百分比：无总大小 "--"；完成 "100%"（DESIGN.md §2.3） */
const percentText = computed(() => {
  const total = props.frame?.totalBytes ?? props.task.totalBytes;
  const done = props.frame?.downloadedBytes ?? props.task.downloadedBytes;
  if (props.task.status === 'completed') return '100%';
  return formatPercent(done, total);
});
</script>

<template>
  <!-- 第二层：4px 进度条 + 右端百分比，gap 8px，行高 16px 垂直居中 -->
  <div class="progress-line">
    <ProgressBar :status="task.status" :percent="percent" :label="task.filename" />
    <span class="percent mono">{{ percentText }}</span>
  </div>
</template>

<style scoped>
.progress-line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 16px;
}

.percent {
  font-size: var(--text-xs);
  color: var(--fg-2);
  min-width: 44px;
  text-align: right;
  flex: none;
}
</style>
