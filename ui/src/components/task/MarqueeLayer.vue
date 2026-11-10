<script setup lang="ts">
import type { TaskRecord } from '@/api/types';
import { useMarqueeSelection } from '@/composables/useMarqueeSelection';
import MarqueeBox from '@/components/task/MarqueeBox.vue';

/**
 * 框选容器（DESIGN.md §2.9）：把「纯状态机 composable」与「纯渲染组件」接起来。
 * 单独成件是为了不让 TaskListView.vue（基线 296 非空行）触碰 300 行硬门禁。
 * 选择集合的唯一出口仍由父视图的 useTaskSelection.selectIds 提供（commit 事件）。
 */
const props = defineProps<{
  listEl: HTMLElement | null;
  visible: TaskRecord[];
}>();

const emit = defineEmits<{ commit: [ids: string[], additive: boolean] }>();

const { box } = useMarqueeSelection({
  getListEl: () => props.listEl,
  visible: () => props.visible,
  commit: (ids, additive) => emit('commit', ids, additive),
});
</script>

<template>
  <MarqueeBox :box="box" />
</template>
