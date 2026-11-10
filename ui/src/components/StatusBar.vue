<script setup lang="ts">
import { computed } from 'vue';
import { ArrowDown, FolderOpen } from '@lucide/vue';
import { t } from '@/locales/zh-CN';
import { useTasksStore } from '@/stores/tasks';
import { useConfigStore } from '@/stores/config';
import { formatSpeed } from '@/utils/format';

/**
 * 状态栏（DESIGN.md §2.4，32px）：三段网格 —— 左 = 任务计数摘要（数字 mono
 * tabular-nums）· 中 = 全部任务总实时速度（只读）· 右 = 默认下载目录（纯展示）。
 *
 * 2026-11 交互减法：
 * - 总速度从顶栏 chip 下移至此：速度是状态信息，不是操作入口。纯文本、无 hover
 *   背景、`cursor: default`、不可点击；速度为 0（无下载中任务）时整段隐藏，
 *   避免长期常驻 "0 B/s" 噪音。全局限速只在设置页设置。
 * - 下载目录同理纯展示：FolderOpen 仅作图标语义（aria-hidden），无 click/
 *   hover/title。opener 受 ACL 路径作用域限制无法授权，可点的按钮必然失败，
 *   故直接不给伪交互暗示。
 */
const tasksStore = useTasksStore();
const configStore = useConfigStore();

const counts = computed(() => tasksStore.counts);
const dir = computed(() => configStore.config?.downloadDir ?? '');
const totalSpeed = computed(() => tasksStore.totalSpeedBps);
const speedText = computed(() => formatSpeed(totalSpeed.value));
</script>

<template>
  <footer class="statusbar">
    <p class="summary">
      共 <span class="num mono">{{ counts.all }}</span> 个任务 ·
      <span class="num mono">{{ counts.downloading }}</span> 个下载中 ·
      <span class="num mono">{{ counts.failed }}</span> 个失败
    </p>

    <div
      v-if="totalSpeed > 0"
      class="speed"
      role="group"
      :aria-label="t('statusbar.totalSpeed')"
    >
      <ArrowDown class="icon-16 speed-icon" aria-hidden="true" />
      <span class="speed-value mono">{{ speedText }}</span>
    </div>

    <div v-if="dir !== ''" class="dir-group">
      <FolderOpen class="icon-16 dir-icon" aria-hidden="true" />
      <span class="dir mono">{{ dir }}</span>
    </div>
  </footer>
</template>

<style scoped>
/* 三段网格：1fr auto 1fr —— 中间总速度真正居中，左右各自靠边（不互相挤压） */
.statusbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-3);
  height: 32px;
  flex: none;
  padding: 0 var(--space-4);
  background: var(--bg);
  border-top: 1px solid var(--border);
  font-size: var(--text-xs);
}

.summary {
  grid-column: 1;
  min-width: 0;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 数字 mono tabular-nums --fg-2（DESIGN.md §2.4） */
.num {
  color: var(--fg-2);
}

/* 总速度：只读状态信息（默认光标、无 hover 反馈、不可点击） */
.speed {
  grid-column: 2;
  justify-self: center;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--fg-2);
  cursor: default;
  white-space: nowrap;
}

.speed-icon {
  color: var(--muted);
}

/* 目录行：展示信息，非控件（默认光标、无 hover 反馈） */
/* 显式钉在第 3 列：总速度隐藏时（v-if / 窄窗）不会被自动排到中列 */
.dir-group {
  grid-column: 3;
  justify-self: end;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  color: var(--meta);
  cursor: default;
}

.dir {
  min-width: 0;
  max-width: 40ch;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: default;
}

/* 窄窗让位（DESIGN.md §8）：窗口最小 720px 时优先保证计数与目录可见 */
@media (max-width: 860px) {
  .speed {
    display: none;
  }
}
</style>
