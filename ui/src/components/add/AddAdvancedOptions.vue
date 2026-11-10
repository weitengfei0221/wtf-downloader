<script setup lang="ts">
import { ChevronDown } from '@lucide/vue';
import { t } from '@/locales/zh-CN';

/**
 * 添加弹窗阶段 3：高级选项折叠区（DESIGN.md §3.2）——默认收起；
 * ChevronDown 展开 180°（150ms）；分片数数值输入（32px/88px/mono/min1/max16/step1）
 * + 滑块（track 4px / thumb 16px / 键盘 ←→）。
 */
const props = defineProps<{ modelValue: number; open: boolean }>();

const emit = defineEmits<{
  'update:modelValue': [value: number];
  'update:open': [value: boolean];
}>();

function clamp(n: number): number {
  return Math.min(16, Math.max(1, Math.round(n)));
}

function onNumber(e: Event): void {
  const raw = Number((e.target as HTMLInputElement).value);
  if (Number.isFinite(raw)) emit('update:modelValue', clamp(raw));
}

function onRange(e: Event): void {
  emit('update:modelValue', clamp(Number((e.target as HTMLInputElement).value)));
}

void props;
</script>

<template>
  <div class="advanced">
    <button
      class="adv-head"
      type="button"
      :aria-expanded="open"
      @click="emit('update:open', !open)"
    >
      <ChevronDown class="icon-16 chevron" :class="{ 'chevron-open': open }" />
      <span>{{ t('add.advanced') }}</span>
    </button>

    <div v-if="open" class="adv-body">
      <div class="field">
        <label class="label">{{ t('add.segmentsLabel') }}</label>
        <div class="segments">
          <input
            class="seg-input mono"
            type="number"
            min="1"
            max="16"
            step="1"
            :value="modelValue"
            @input="onNumber"
          />
          <input
            class="seg-slider"
            type="range"
            min="1"
            max="16"
            step="1"
            :value="modelValue"
            :aria-label="t('add.segmentsLabel')"
            @input="onRange"
          />
        </div>
      </div>
      <p class="helper">{{ t('add.segmentsHelper') }}</p>
    </div>
  </div>
</template>

<style scoped>
.advanced {
  margin-top: var(--space-4);
}

.adv-head {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--fg-2);
  transition: color var(--motion-fast) var(--ease-standard);
}

.adv-head:hover {
  color: var(--fg);
}

.chevron {
  transition: transform var(--motion-fast) var(--ease-standard);
}

.chevron-open {
  transform: rotate(180deg);
}

.adv-body {
  margin-top: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  animation: adv-in var(--motion-base) var(--ease-standard);
}

@keyframes adv-in {
  from {
    opacity: 0;
  }
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--fg-2);
}

.segments {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.seg-input {
  width: 88px;
  height: 32px;
  padding: 0 var(--space-2);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--fg);
}

.seg-slider {
  width: 140px;
  height: 16px;
  appearance: none;
  background: transparent;
}

.seg-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--progress-track);
}

.seg-slider::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -6px;
  border-radius: var(--radius-full);
  background: var(--primary-bg);
}

.helper {
  font-size: var(--text-xs);
  color: var(--muted);
}
</style>
