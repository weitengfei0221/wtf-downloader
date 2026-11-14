<script setup lang="ts">
import { computed } from 'vue';
import { ArrowDown } from '@lucide/vue';
import { t } from '@/locales/zh-CN';
import { useTasksStore } from '@/stores/tasks';
import { useUpdaterStore } from '@/stores/updater';
import { formatSpeed } from '@/utils/format';

/**
 * 状态栏（DESIGN.md §2.4，32px）：三段网格 —— 左 = 任务计数摘要（数字 mono
 * tabular-nums）· 中 = 全部任务总实时速度（只读）· 右 = 更新状态（两态）。
 *
 * 2026-11 交互减法：
 * - 总速度从顶栏 chip 下移至此：速度是状态信息，不是操作入口。纯文本、无 hover
 *   背景、`cursor: default`、不可点击；速度为 0（无下载中任务）时整段隐藏，
 *   避免长期常驻 "0 B/s" 噪音。全局限速只在设置页设置。
 * - 右侧原「默认下载目录」label 已移除（用户裁决 2026-11-13）：目录是设置项，不必
 *   常驻状态栏。改为更新状态两态——有可用更新时是**「小圆点 + 文字」**（常态透明无底、
 *   hover 才铺 `--surface-2`、方形无圆角、可点；自动检查到后在这里提示，不弹窗打扰）；
 *   无更新时是纯展示的当前版本 label（span，无 hover、不可点击）。
 */
const tasksStore = useTasksStore();
const updater = useUpdaterStore();

const counts = computed(() => tasksStore.counts);
const totalSpeed = computed(() => tasksStore.totalSpeedBps);
const speedText = computed(() => formatSpeed(totalSpeed.value));
const hasUpdate = computed(() => updater.available != null);
const versionText = computed(() =>
  updater.currentVersion !== ''
    ? t('statusbar.version', { version: updater.currentVersion })
    : t('update.versionUnknown'),
);
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

    <!-- 第 3 列两态：有更新 = 可点圆点+文字；无更新 = 只读版本 label（不是 button，避免伪交互） -->
    <button
      v-if="hasUpdate"
      class="update-cta"
      type="button"
      @click="updater.openConfirm()"
    >
      <span class="cta-dot" aria-hidden="true" />
      {{ t('statusbar.updateAvailable') }}
    </button>
    <span v-else class="version mono">{{ versionText }}</span>
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

/*
 * 发现新版本：**形态是状态标签、不是按钮**（2026-11-13 用户裁决「不要用按钮，按钮感觉
 * 太重了，就是一个方形不带圆角的 label 块，配色也不要按钮主色，太突兀了」）。
 * 视觉：方形无圆角、中性 --surface-3 底 + --fg 字、高度贴齐 12px 文字行（20px）。
 * 元素仍是 <button>：它必须可点、可 Tab 聚焦、可 Enter/Space 触发，只是不长得像按钮。
 * 禁用 --primary-* 与 --radius-*（护栏 `views/Updater.guard.test.ts` 会扫本规则体）。
 */
.update-cta {
  grid-column: 3;
  justify-self: end;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  height: 20px;
  padding: 0 var(--space-2);
  border: none;
  border-radius: 0;
  /* 常态透明：只有圆点 + 文字，不铺底色（2026-11-13 用户裁决「正常显示时没有背景」） */
  background: transparent;
  color: var(--fg);
  font-size: var(--text-xs);
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--motion-fast) var(--ease-standard);
}

.update-cta:hover {
  background: var(--surface-2);
}

/* 小圆点：只表示「有新版本可用」。
   用 --success 而非 --danger：本应用里红色是失败语义（左侧「X 个失败」），
   红点会被读成「出错」而不是「有新东西」。 */
.cta-dot {
  width: 6px;
  height: 6px;
  flex: none; /* 不被文字挤压成椭圆 */
  border-radius: 50%;
  background: var(--success);
}

.update-cta:focus-visible {
  box-shadow: var(--focus-ring);
}

/* 当前版本：只读 label（span，无 hover、不可点击） */
.version {
  grid-column: 3;
  justify-self: end;
  color: var(--meta);
  white-space: nowrap;
  cursor: default;
}

/* 窄窗让位（DESIGN.md §8）：窗口最小 720px 时优先保证计数与更新状态可见 */
@media (max-width: 860px) {
  .speed {
    display: none;
  }
}
</style>
