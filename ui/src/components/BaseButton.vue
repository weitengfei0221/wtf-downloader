<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue';

/**
 * 规格见 DESIGN.md §1.7 按钮：高 32px / padding 0 12px / 13px 500 / 图标 16px + 4px 间距。
 * `form` 显式成 prop 并绑定到根 <button>：AddTaskDialog 的提交按钮位于 #footer 插槽、
 * 在 <form> 之外，必须靠 HTML form 属性跨插槽关联才能提交（Enter 与点击两条路径共用）。
 * 原来模板首节点是注释 → 编译成 Fragment 根，Vue 自动属性透传会静默丢弃 form/title，
 * 故注释移到 script、且 form 显式绑定，双保险。
 */
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
    loading?: boolean;
    disabled?: boolean;
    type?: 'button' | 'submit';
    /** 关联的表单 id（按钮在 form 之外时用） */
    form?: string;
  }>(),
  { variant: 'secondary', loading: false, disabled: false, type: 'button' },
);
</script>

<template>
  <button
    class="btn"
    :class="`btn-${variant}`"
    :type="type"
    :form="form"
    :disabled="disabled || loading"
  >
    <LoaderCircle v-if="loading" class="icon-16 icon-spin" />
    <slot v-else name="icon" />
    <span v-if="$slots.default" class="btn-label"><slot /></span>
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 32px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 500;
  transition:
    background-color var(--motion-fast) var(--ease-standard),
    border-color var(--motion-fast) var(--ease-standard),
    color var(--motion-fast) var(--ease-standard),
    opacity var(--motion-fast) var(--ease-standard);
}

.btn:disabled {
  opacity: 0.4;
}

.btn-label {
  white-space: nowrap;
}

/* Primary：全屏唯一常驻 primary 按钮（新建任务/开始下载） */
.btn-primary {
  background: var(--primary-bg);
  color: var(--primary-fg);
}
.btn-primary:hover:not(:disabled) {
  background: var(--primary-hover);
}
.btn-primary:active:not(:disabled) {
  background: var(--primary-active);
}

.btn-secondary {
  border: 1px solid var(--border);
  color: var(--fg-2);
}
.btn-secondary:hover:not(:disabled) {
  border-color: var(--fg-2);
  color: var(--fg);
}
.btn-secondary:active:not(:disabled) {
  background: var(--surface-3);
}

.btn-ghost {
  color: var(--fg-2);
}
.btn-ghost:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--fg);
}
.btn-ghost:active:not(:disabled) {
  background: var(--surface-3);
}

.btn-destructive {
  background: var(--danger-soft);
  border: 1px solid var(--border);
  color: var(--danger);
}
.btn-destructive:hover:not(:disabled) {
  background: var(--surface-3);
  color: var(--danger);
}
.btn-destructive:active:not(:disabled) {
  background: var(--surface-3);
}
</style>
