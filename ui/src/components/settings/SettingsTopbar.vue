<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue';
import { t } from '@/locales/zh-CN';
import IconButton from '@/components/IconButton.vue';

/**
 * 设置页顶栏（DESIGN.md §4.1）：App 名 · 设置 + 右上角「返回任务列表」。
 * 图标随路由切换语义——设置页里它不是设置入口（齿轮），而是返回（ArrowLeft 20）；
 * aria-label 与 title 同文案，键盘可达（IconButton 为原生 button，focus-visible 环）。
 */
defineEmits<{ back: [] }>();
</script>

<template>
  <header class="topbar">
    <span class="app-name">{{ t('topbar.appName') }}</span>
    <span class="sep" aria-hidden="true">·</span>
    <span class="page-title">{{ t('topbar.settingsTitle') }}</span>
    <IconButton
      class="back-btn"
      :label="t('topbar.backToTasks')"
      :title="t('topbar.backToTasks')"
      size="md"
      @click="$emit('back')"
    >
      <ArrowLeft class="icon-20" />
    </IconButton>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 52px;
  flex: none;
  padding: 0 var(--space-4);
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}

.app-name {
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--fg);
}

.sep {
  color: var(--meta);
}

.page-title {
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--fg);
}

/* 返回按钮：ghost 规格（hover --surface-3），推到最右 */
.back-btn {
  margin-left: auto;
}
</style>
