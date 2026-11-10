<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    /** aria-label（无可见文字的图标按钮必需） */
    label: string;
    danger?: boolean;
    /** sm = 28px hit / 16px 图标（行内）；md = 32px hit / 20px 图标（独立入口） */
    size?: 'sm' | 'md';
    disabled?: boolean;
  }>(),
  { danger: false, size: 'sm', disabled: false },
);

const sizeClass = computed(() => (props.size === 'md' ? 'icon-btn-md' : 'icon-btn-sm'));
</script>

<template>
  <button
    class="icon-btn"
    :class="[sizeClass, { 'icon-btn-danger': danger }]"
    type="button"
    :aria-label="label"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<style scoped>
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  color: var(--fg-2);
  border-radius: var(--radius-md);
  transition:
    background-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard);
}

.icon-btn:not(:disabled):hover {
  background: var(--surface-3);
  color: var(--fg);
}

.icon-btn-sm {
  width: 28px;
  height: 28px;
}

.icon-btn-md {
  width: 32px;
  height: 32px;
}

.icon-btn-danger:not(:disabled):hover {
  background: var(--danger-soft);
  color: var(--danger);
}
</style>
