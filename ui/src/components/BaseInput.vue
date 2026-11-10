<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue?: string;
    placeholder?: string;
    mono?: boolean;
    invalid?: boolean;
    disabled?: boolean;
    type?: string;
    min?: number;
    max?: number;
    step?: number;
  }>(),
  {
    modelValue: '',
    placeholder: '',
    mono: false,
    invalid: false,
    disabled: false,
    type: 'text',
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
  enter: [];
  blur: [];
}>();

function onInput(e: Event): void {
  emit('update:modelValue', (e.target as HTMLInputElement).value);
}
function onEnter(e: KeyboardEvent): void {
  if (e.key === 'Enter') emit('enter');
}
function onBlur(): void {
  emit('blur');
}
void props;
</script>

<template>
  <!-- 规格见 DESIGN.md §1.7 输入框：高 32px / bg --surface / 1px --border / error 边框 --danger -->
  <input
    class="input"
    :class="{ 'input-mono': mono, 'input-invalid': invalid }"
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :min="min"
    :max="max"
    :step="step"
    @input="onInput"
    @keydown="onEnter"
    @blur="onBlur"
  />
</template>

<style scoped>
.input {
  width: 100%;
  height: 32px;
  padding: 0 var(--space-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--fg);
  transition:
    border-color var(--motion-fast) var(--ease-standard),
    background-color var(--motion-fast) var(--ease-standard);
}

.input::placeholder {
  color: var(--meta);
}

.input-mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.input:disabled {
  background: var(--surface-2);
  color: var(--meta);
}

.input-invalid {
  border-color: var(--danger);
}

/* 数字输入去掉原生 spinner（mono 数值输入统一观感） */
.input[type='number']::-webkit-outer-spin-button,
.input[type='number']::-webkit-inner-spin-button {
  appearance: none;
  margin: 0;
}
</style>
