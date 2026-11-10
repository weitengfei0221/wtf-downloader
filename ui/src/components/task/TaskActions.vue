<script setup lang="ts">
import {
  Ellipsis,
  ExternalLink,
  FolderOpen,
  Pause,
  Play,
  RotateCw,
  Trash2,
} from '@lucide/vue';
import { t } from '@/locales/zh-CN';
import type { TaskRecord } from '@/api/types';
import IconButton from '@/components/IconButton.vue';

defineProps<{ task: TaskRecord; fileMissing?: boolean }>();
const emit = defineEmits<{ action: [type: string, event: MouseEvent] }>();

/**
 * 事件处理器（非柯里化）：模板内联语句是「求值表达式」，柯里化返回值不会被调用，
 * emit 将永不触发（2026-10-25 实测修复）。故一律写成 emitAction(type, $event)。
 */
function emitAction(type: string, event: MouseEvent): void {
  emit('action', type, event);
}
</script>

<template>
  <!-- 行内 hover 操作组（DESIGN.md §1.2 状态映射）：
       pending 仅 Trash2；downloading Pause/FolderOpen/Trash2；paused Play/FolderOpen/Trash2；
       completed ExternalLink/FolderOpen/Trash2；failed RotateCw/FolderOpen/Trash2；
       末位 Ellipsis 更多菜单。图标按钮 28px hit、间 4px。 -->
  <div class="actions" @click.stop>
    <IconButton v-if="task.status === 'downloading'" :label="t('aria.pause')" @click="emitAction('pause', $event)">
      <Pause class="icon-16" />
    </IconButton>
    <IconButton v-if="task.status === 'paused'" :label="t('aria.resume')" @click="emitAction('resume', $event)">
      <Play class="icon-16" />
    </IconButton>
    <IconButton v-if="task.status === 'failed'" :label="t('aria.retry')" @click="emitAction('retry', $event)">
      <RotateCw class="icon-16" />
    </IconButton>
    <!-- 文件已丢失：ExternalLink「打开文件」禁用；FolderOpen「打开目录」始终可用（用户可能想去看目录） -->
    <IconButton v-if="task.status === 'completed'" :label="t('aria.openFile')" :disabled="fileMissing" @click="emitAction('open-file', $event)">
      <ExternalLink class="icon-16" />
    </IconButton>
    <IconButton v-if="task.status !== 'pending'" :label="t('aria.openDir')" @click="emitAction('open-dir', $event)">
      <FolderOpen class="icon-16" />
    </IconButton>
    <IconButton :label="t('aria.remove')" danger @click="emitAction('remove', $event)">
      <Trash2 class="icon-16" />
    </IconButton>
    <IconButton :label="t('aria.more')" @click="emitAction('more', $event)">
      <Ellipsis class="icon-16" />
    </IconButton>
  </div>
</template>

<style scoped>
.actions {
  display: inline-flex;
  gap: var(--space-1);
  flex: none;
}
</style>
