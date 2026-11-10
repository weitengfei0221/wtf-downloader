<script setup lang="ts">
import type { TaskRecord } from '@/api/types';
import TaskActions from '@/components/task/TaskActions.vue';

/**
 * 任务行第一层（DESIGN.md §2.3）：文件名 14px/500 --fg，单行截断，
 * title 显示全名 + 完整路径；右侧 hover 操作组。
 */
defineProps<{ task: TaskRecord; fileMissing?: boolean }>();
const emit = defineEmits<{ action: [type: string, event: MouseEvent] }>();
</script>

<template>
  <div class="row-header">
    <span class="filename" :title="`${task.filename}\n${task.dir}`">{{ task.filename }}</span>
    <TaskActions :task="task" :file-missing="fileMissing" @action="(type, event) => emit('action', type, event)" />
  </div>
</template>

<style scoped>
.row-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  height: 20px;
}

.filename {
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--fg);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  min-width: 0;
}
</style>
