<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { X } from '@lucide/vue';
import { t } from '@/locales/zh-CN';
import { focusFirst, onDialogKeydown } from '@/utils/dialog';
import IconButton from '@/components/IconButton.vue';

/**
 * 弹窗容器（DESIGN.md §1.7 / §3.1）：遮罩 --overlay、bg --surface、--radius-lg、
 * --elev-raised、进入 200ms fade + scale 0.98→1；焦点困环 + Esc → request-close；
 * 点击遮罩 = request-close（由调用方决定是否弹"放弃"确认）。z-index 1200。
 *
 * 三段式布局（2026-11 用户实测：滚动条贯穿整个弹窗，标题/底部按钮跟着滚）：
 * .head 固定、.body 是**唯一滚动容器**、可选 #footer 插槽固定底部。
 * 滚动条垂直范围只从标题栏下沿到底部操作区上沿，头尾不受内容与滚动影响。
 */
const props = withDefaults(
  defineProps<{ width?: number; closeable?: boolean }>(),
  { width: 480, closeable: true },
);
const emit = defineEmits<{ 'request-close': [] }>();

const panel = ref<HTMLElement | null>(null);

function requestClose(): void {
  if (props.closeable) emit('request-close');
}

function onKeydown(e: KeyboardEvent): void {
  if (panel.value) onDialogKeydown(panel.value, e, requestClose);
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown, true);
  await nextTick();
  if (panel.value) focusFirst(panel.value, 'textarea, input');
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true);
});
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @mousedown.self="requestClose">
      <div
        ref="panel"
        class="panel"
        :style="{ width: `${width}px` }"
        role="dialog"
        aria-modal="true"
      >
        <header class="head">
          <h2 class="title"><slot name="title" /></h2>
          <IconButton v-if="closeable" :label="t('common.close')" @click="requestClose">
            <X class="icon-16" />
          </IconButton>
        </header>
        <div class="body"><slot /></div>
        <footer v-if="$slots.footer" class="foot"><slot name="footer" /></footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 1200; /* Token zIndex.modal */
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  animation: overlay-in var(--motion-base) var(--ease-standard);
}

.panel {
  display: flex;
  flex-direction: column;
  max-width: calc(100vw - 32px); /* 窗口 < 520px 时弹窗宽 = 窗口宽 - 32px */
  max-height: 80vh;
  overflow: hidden; /* 头尾固定：滚动只发生在 .body，绝不贯穿整个弹窗 */
  padding: var(--space-6);
  background: var(--surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--elev-raised);
  animation: panel-in var(--motion-base) var(--ease-standard);
}

.head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-4);
}

.body {
  flex: 1;
  min-height: 0; /* 允许在 max-height 触顶时收缩，否则 overflow 不生效 */
  overflow-y: auto; /* 唯一滚动容器 */
  /* 焦点环是 3px **外环**（--focus-ring）。滚动容器水平方向零余量时，这个外环
     以及输入框自身的 1px 边框会一起被裁掉，只剩上下两段（2026-11 用户实测：
     「获得焦点时左右边框没有」）。这里留一圈画环余量，再用等量负 margin 抵消，
     内容位置与宽高完全不变，只为让外环有地方画。 */
  padding: var(--space-1);
  margin: calc(var(--space-1) * -1);
}

.foot {
  flex: none;
}

.title {
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--fg);
}

@keyframes overlay-in {
  from {
    opacity: 0;
  }
}

@keyframes panel-in {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
}
</style>
