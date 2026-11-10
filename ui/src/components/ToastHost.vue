<script setup lang="ts">
import { watch } from 'vue';
import { Check, CircleAlert } from '@lucide/vue';
import { useToastStore, type ToastItem } from '@/stores/toast';

/**
 * Toast 宿主（DESIGN.md §1.7）：**顶部水平居中**，距窗口顶 56px（原生标题栏 32px
 * + 安全间距，不压系统窗口按钮）；bg --surface + 1px --border + --radius-md +
 * --elev-raised；成功 Check（--success）/ 错误 AlertCircle（--danger）+ 文字 13px
 * --fg；可选操作链接；进入 200ms 向下滑出（translateY(-8px) → 0）；到时自动消失
 * （默认 4s，可指定），hover 暂停；多条按数组顺序向下依次排列（先到在上，
 * 新条追加在下方，位置稳定不跳动）；z-index 1300；aria-live 播报。
 */
const store = useToastStore();

const timers = new Map<number, number>();

watch(
  () => store.items.map((item) => item.id),
  (ids, oldIds) => {
    for (const id of ids) {
      if (!oldIds.includes(id) && !timers.has(id)) {
        const item = store.items.find((i) => i.id === id);
        if (item) arm(item);
      }
    }
    for (const id of oldIds) {
      if (!ids.includes(id)) clear(id);
    }
  },
);

function arm(item: ToastItem): void {
  clear(item.id);
  const timer = window.setTimeout(() => {
    timers.delete(item.id);
    store.dismiss(item.id);
  }, item.durationMs ?? 4000);
  timers.set(item.id, timer);
}

function clear(id: number): void {
  const timer = timers.get(id);
  if (timer != null) {
    window.clearTimeout(timer);
    timers.delete(id);
  }
}

/** hover 暂停计时（重进时重新满额计时，4s 量级下体验无差） */
function pause(item: ToastItem): void {
  clear(item.id);
}

function resume(item: ToastItem): void {
  arm(item);
}

function runAction(item: ToastItem): void {
  item.action?.();
  store.dismiss(item.id);
}
</script>

<template>
  <Teleport to="body">
    <div class="toasts" aria-live="polite">
      <div
        v-for="item in store.items"
        :key="item.id"
        class="toast"
        role="status"
        @mouseenter="pause(item)"
        @mouseleave="resume(item)"
      >
        <Check v-if="item.kind === 'success'" class="icon-16 icon-success" />
        <CircleAlert v-else-if="item.kind === 'error'" class="icon-16 icon-error" />
        <span class="toast-text">{{ item.message }}</span>
        <button v-if="item.actionLabel" class="toast-action" type="button" @click="runAction(item)">
          {{ item.actionLabel }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.toasts {
  position: fixed;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1300; /* Token zIndex.toast */
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  /* 定宽（而非 max-width）：绝对定位 + left:50% 时 shrink-to-fit 的可算宽度只有
     容器的一半，会得出不可预期的窄条；显式宽度让 440px 上限在小窗口也确定 */
  width: min(440px, calc(100vw - 32px));
  /* 停在窗口顶部：容器不吃指针事件，避免遮挡顶栏搜索/按钮（条目自身恢复可交互） */
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 100%;
  padding: var(--space-3) var(--space-4);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--elev-raised);
  pointer-events: auto;
  animation: toast-in var(--motion-base) var(--ease-standard);
}

.toast-text {
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--fg);
  /* 长文案在 max-width 内换行，不撑破容器（原 nowrap 会让 440px 上限失效） */
  overflow-wrap: anywhere;
}

.icon-success {
  color: var(--success);
}

.icon-error {
  color: var(--danger);
}

.toast-action {
  flex: none;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--fg-2);
  transition: color var(--motion-fast) var(--ease-standard);
}

.toast-action:hover {
  color: var(--fg);
}

/* 顶部居中 → 向下滑出（禁弹跳缓动；reduced-motion 由 design-tokens 全局规则瞬切） */
@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
}
</style>
