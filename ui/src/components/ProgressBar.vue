<script setup lang="ts">
import { computed } from 'vue';
import type { TaskStatus } from '@/api/types';

const props = defineProps<{
  status: TaskStatus;
  /** 0-100；null = 无总大小（下载中 → indeterminate 往复） */
  percent: number | null;
  label: string;
}>();

const width = computed(() => {
  switch (props.status) {
    case 'pending':
      return '100%'; // 条纹整轨覆盖
    case 'completed':
      return '100%';
    default:
      return props.percent == null ? (props.status === 'downloading' ? '30%' : '0%') : `${props.percent}%`;
  }
});

/** 无 Content-Length 的下载中任务：30% 宽左右往复（周期 1.2s linear，DESIGN.md §1.2 补充规则） */
const indeterminate = computed(() => props.status === 'downloading' && props.percent == null);
</script>

<template>
  <div
    class="bar"
    :class="{ 'bar-paused': status === 'paused' }"
    role="progressbar"
    :aria-label="label"
    :aria-valuemin="0"
    :aria-valuemax="100"
    :aria-valuenow="percent == null ? undefined : Math.round(percent)"
  >
    <div
      class="fill"
      :class="[`fill-${status}`, { 'fill-indeterminate': indeterminate }]"
      :style="{ width }"
    />
  </div>
</template>

<style scoped>
.bar {
  position: relative;
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--progress-track);
  overflow: hidden;
  flex: 1;
}

/* 已暂停：整条 opacity 0.6（DESIGN.md §1.2） */
.bar-paused {
  opacity: 0.6;
}

.fill {
  height: 100%;
  border-radius: var(--radius-full);
  /* 进度 width 过渡：250ms linear 匹配 4Hz 帧间隔平滑插值（禁 ease——4Hz 下会抖） */
  transition: width var(--motion-progress);
}

.fill-downloading {
  background: var(--primary-bg);
}

.fill-paused {
  background: var(--muted);
}

.fill-completed {
  background: var(--success);
}

.fill-failed {
  background: var(--danger);
}

/* 等待中：--meta 45° 条纹整轨覆盖、opacity 0.5（DESIGN.md §2.3） */
.fill-pending {
  background: repeating-linear-gradient(45deg, var(--meta) 0 4px, transparent 4px 8px);
  opacity: 0.5;
}

/* indeterminate 往复：translateX 动画（只动 transform），reduced-motion 全局规则会静止它 */
.fill-indeterminate {
  animation: indeterminate-sweep 1.2s linear infinite alternate;
}

@keyframes indeterminate-sweep {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(233%);
  }
}
</style>
