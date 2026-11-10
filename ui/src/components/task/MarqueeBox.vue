<script setup lang="ts">
import type { Rect } from '@/composables/useMarqueeSelection';

/**
 * 框选矩形（DESIGN.md §2.9）：纯展示，不承载任何交互。
 * 坐标是视口坐标（clientX/clientY 与 getBoundingClientRect 同系），故 position:fixed，
 * 天然抵消列表 scrollTop；pointer-events:none 保证不干扰 mouseup / click 命中判定。
 */
defineProps<{ box: Rect | null }>();
</script>

<template>
  <div
    v-if="box"
    class="marquee-box"
    aria-hidden="true"
    :style="{
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.right - box.left}px`,
      height: `${box.bottom - box.top}px`,
    }"
  />
</template>

<style scoped>
.marquee-box {
  position: fixed;
  /* 高于列表行、低于菜单(1000)/弹窗(1200)/Toast(1300)，沿用既有 z-index 层级。 */
  z-index: 900;
  box-sizing: border-box;
  border: 1px solid var(--primary-bg);
  background: var(--primary-soft);
  opacity: 0.6;
  pointer-events: none;
  user-select: none;
}
</style>
