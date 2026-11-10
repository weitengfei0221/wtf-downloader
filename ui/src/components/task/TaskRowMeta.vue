<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/locales/zh-CN';
import type { ProgressFrame, TaskRecord } from '@/api/types';
import {
  formatBytes,
  formatCompletedAt,
  formatEta,
  formatLimit,
  formatSpeed,
} from '@/utils/format';
import { segmentsSummaryText } from '@/utils/segments';
import StatusBadge from '@/components/StatusBadge.vue';

/**
 * 任务行第三层元数据行（DESIGN.md §1.2 / §2.3）：12px，" · " 分隔，
 * 数字一律 mono tabular-nums；badge 悬浮右端（margin-left auto）。
 */
const props = defineProps<{ task: TaskRecord; frame?: ProgressFrame }>();

const downloaded = computed(() => props.frame?.downloadedBytes ?? props.task.downloadedBytes);
const total = computed(() => props.frame?.totalBytes ?? props.task.totalBytes);
const speedBps = computed(() => props.frame?.speedBps ?? 0);
const etaSecs = computed(() => props.frame?.etaSecs ?? null);

const sizeText = computed(() => {
  if (props.task.status === 'completed') return formatBytes(total.value);
  if (total.value == null) return formatBytes(downloaded.value);
  return `${formatBytes(downloaded.value)} / ${formatBytes(total.value)}`;
});

/** 分片进度摘要：完成/活跃双态，全部完成或单片流式时不展示（见 utils/segments.ts） */
const segmentsText = computed(() => segmentsSummaryText(props.frame?.segments, total.value));

const limitText = computed(() =>
  props.task.speedLimit != null ? t('meta.speedLimited', { limit: formatLimit(props.task.speedLimit) }) : '',
);
</script>

<template>
  <div class="meta">
    <template v-if="task.status === 'pending'">
      <span class="meta-muted">{{ t('meta.queued') }}</span>
      <span class="dot">·</span>
      <span class="meta-muted mono">{{ formatBytes(total) }}</span>
    </template>

    <template v-else-if="task.status === 'downloading'">
      <span class="meta-strong mono">{{ sizeText }}</span>
      <span class="dot">·</span>
      <span class="meta-strong mono" :class="{ 'meta-warn': task.speedLimit != null }">
        {{ formatSpeed(speedBps) }}{{ limitText }}
      </span>
      <template v-if="total != null">
        <span class="dot">·</span>
        <span class="meta-muted mono">{{ t('meta.remaining', { eta: formatEta(etaSecs) }) }}</span>
      </template>
      <template v-if="segmentsText">
        <span class="dot">·</span>
        <span class="meta-muted mono">{{ segmentsText }}</span>
      </template>
    </template>

    <template v-else-if="task.status === 'paused'">
      <span class="meta-paused">{{ t('status.paused') }}</span>
      <span class="dot">·</span>
      <span class="meta-strong mono">{{ sizeText }}</span>
    </template>

    <template v-else-if="task.status === 'completed'">
      <span class="meta-strong mono">{{ sizeText }}</span>
      <span class="dot">·</span>
      <span class="meta-muted">{{ t('meta.completedAt', { time: formatCompletedAt(task.updatedAt) }) }}</span>
    </template>

    <template v-else>
      <span class="meta-error" :title="task.error ?? ''">{{ task.error ?? '' }}</span>
      <span class="dot">·</span>
      <span class="meta-strong mono">{{ sizeText }}</span>
    </template>

    <StatusBadge :status="task.status" class="badge" />
  </div>
</template>

<style scoped>
.meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 16px;
  font-size: var(--text-xs);
  min-width: 0;
}

.dot {
  color: var(--meta);
  flex: none;
}

.meta-strong {
  color: var(--fg-2);
  white-space: nowrap;
}

.meta-muted {
  color: var(--muted);
  white-space: nowrap;
}

/* 单任务限速开启：速度文字 --warn（DESIGN.md §1.2 补充规则） */
.meta-warn {
  color: var(--warn);
}

/* 已暂停状态文字：警告色，与 StatusBadge.badge-paused 同口径（第九轮裁决）；只染状态词，sizeText 不染 */
.meta-paused {
  color: var(--warn);
}

/* 失败态：错误摘要 --danger 12px，超长截断 + title 全文 */
.meta-error {
  color: var(--danger);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  min-width: 0;
}

.badge {
  margin-left: auto;
}
</style>
