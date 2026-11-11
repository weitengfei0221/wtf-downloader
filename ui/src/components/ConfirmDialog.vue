<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import ModalShell from '@/components/ModalShell.vue';
import BaseButton from '@/components/BaseButton.vue';
import type { ConfirmAction } from '@/utils/dialog';

/**
 * 通用确认弹窗（DESIGN.md §1.7）：宽 400px；Esc = 取消，Enter = 最安全项
 * （safe = true 的按钮）；焦点困环由 ModalShell 提供。
 * 按钮项类型定义在 `utils/dialog.ts`，调用方派生 actions 时不复制一份。
 */

const props = defineProps<{
  title: string;
  message: string;
  actions: ConfirmAction[];
}>();

const emit = defineEmits<{ select: [key: string] }>();

const cancelKey = computed(() => {
  const cancel = props.actions.find(
    (a) => a.safe && (a.variant === 'ghost' || a.variant === 'secondary'),
  );
  return cancel?.key;
});

const safeKey = computed(
  () => (props.actions.find((a) => a.safe) ?? props.actions[0])?.key ?? '',
);

function select(key: string): void {
  emit('select', key);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    select(safeKey.value);
  } else if (e.key === 'Escape' && cancelKey.value) {
    e.preventDefault();
    e.stopPropagation();
    select(cancelKey.value);
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown, true));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true));
</script>

<template>
  <ModalShell :width="400" @request-close="cancelKey ? select(cancelKey) : undefined">
    <template #title>{{ title }}</template>
    <p class="message">{{ message }}</p>
    <template #footer>
      <footer class="footer">
        <BaseButton
          v-for="action in actions"
          :key="action.key"
          :variant="action.variant ?? 'secondary'"
          @click="select(action.key)"
        >
          {{ action.label }}
        </BaseButton>
      </footer>
    </template>
  </ModalShell>
</template>

<style scoped>
.message {
  font-size: var(--text-sm);
  color: var(--fg-2);
  line-height: 1.5;
  margin-bottom: var(--space-6);
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
