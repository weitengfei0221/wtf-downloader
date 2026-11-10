<script setup lang="ts">
import { FolderOpen } from '@lucide/vue';
import { t } from '@/locales/zh-CN';

/**
 * 添加弹窗「保存目录」行（DESIGN.md §3.2 阶段 2）：32px 行容器（bg --surface-2）、
 * FolderOpen 16 --muted + mono 路径省略号 + 右侧「更改」Ghost 按钮。
 */
defineProps<{ dir: string }>();
const emit = defineEmits<{ change: [] }>();
</script>

<template>
  <div class="field-block">
    <label class="label">{{ t('add.dirLabel') }}</label>
    <div class="dir-row">
      <FolderOpen class="icon-16 dir-icon" aria-hidden="true" />
      <span class="dir-path mono" :title="dir">{{ dir }}</span>
      <button class="change" type="button" @click="emit('change')">
        {{ t('add.changeDir') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.field-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--fg-2);
}

.dir-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 32px;
  padding: 0 var(--space-3);
  background: var(--surface-2);
  border-radius: var(--radius-md);
}

.dir-icon {
  color: var(--muted);
}

.dir-path {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--fg-2);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.change {
  flex: none;
  font-size: var(--text-sm);
  color: var(--fg-2);
  transition: color var(--motion-fast) var(--ease-standard);
}

.change:hover {
  color: var(--fg);
}
</style>
