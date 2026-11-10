<script setup lang="ts">
const props = withDefaults(
  defineProps<{ modelValue: boolean; disabled?: boolean; label?: string }>(),
  { disabled: false, label: undefined },
);
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

function toggle(): void {
  emit('update:modelValue', !props.modelValue);
}
</script>

<template>
  <!-- 规格见 DESIGN.md §4.2 Toggle：track 36x20（hit 外扩 44x28）/ knob 16 / Space 切换 / role switch -->
  <button
    class="toggle"
    :class="{ on: modelValue }"
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    @click="toggle"
  />
</template>

<style scoped>
.toggle {
  position: relative;
  width: 44px;
  height: 28px;
  flex: none;
  border-radius: var(--radius-full);
  background: var(--surface-3);
  border: 1px solid var(--border);
  transition: background-color var(--motion-fast) var(--ease-standard);
  /* 内缩回 36x20 视觉 track */
  background-clip: padding-box;
}

.toggle::after {
  content: '';
  position: absolute;
  top: 5px;
  left: 5px;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border);
  transition:
    transform var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard);
}

.toggle.on {
  background: var(--primary-bg);
  border-color: var(--primary-bg);
}

.toggle.on::after {
  background: var(--primary-fg);
  box-shadow: none;
  transform: translateX(16px);
}

.toggle:disabled {
  opacity: 0.4;
}
</style>
