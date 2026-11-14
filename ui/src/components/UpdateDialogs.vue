<script setup lang="ts">
import { computed } from 'vue';
import { t } from '@/locales/zh-CN';
import { formatBytes } from '@/utils/format';
import { useUpdaterStore } from '@/stores/updater';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import ModalShell from '@/components/ModalShell.vue';
import ProgressBar from '@/components/ProgressBar.vue';

/**
 * 更新相关的两个全局模态（DESIGN.md §4.4）：发现新版本确认框 + 下载安装进度框。
 * 独立于 App.vue 成件，避免把弹窗标记塞进应用外壳。
 *
 * 文案分工：
 *   - 确认框（用户 2026-11-13 裁决）：正文点明**从哪个版本升到哪个版本**，
 *     「当前版本 {from}，新版本 {to}；是否立即更新？」——版本跨度是用户决策的关键信息；
 *   - 进度框：这里才是「应用会自动退出、完成后请重新打开」该出现的地方——用户按了
 *     立即更新之后才需要知道这件事，放在入口只是噪音。
 *
 * 弹窗由谁打开（同日裁决）：自动检查只写 available、**不弹窗**（状态栏按钮提示）；
 * 手动检查与状态栏按钮都经 openConfirm() 进来。
 */
const updater = useUpdaterStore();

/** 当前版本取不到时用降级文案，绝不显示空串或硬编码版本号 */
const fromVersion = computed(() =>
  updater.currentVersion !== '' ? updater.currentVersion : t('update.versionUnknown'),
);

const percent = computed(() => {
  const p = updater.progress;
  if (p == null || p.total == null || p.total <= 0) return null;
  return Math.min(100, Math.round((p.downloaded / p.total) * 100));
});

const progressText = computed(() => {
  // 下载完成后进入安装阶段，应用随即自动退出：明确告知用户需手动重新打开
  if (percent.value === 100) return t('update.installingFinished');
  const p = updater.progress;
  if (p == null) return t('update.installing');
  const done = formatBytes(p.downloaded);
  return p.total == null
    ? t('update.progressUnknown', { downloaded: done })
    : t('update.progress', { downloaded: done, total: formatBytes(p.total) });
});
</script>

<template>
  <ConfirmDialog
    v-if="updater.confirmOpen && updater.available"
    :title="t('update.availableTitle', { version: updater.available.version })"
    :message="
      t('update.confirmMessage', { from: fromVersion, to: updater.available.version })
    "
    :actions="[
      { key: 'later', label: t('update.later'), variant: 'ghost', safe: true },
      { key: 'install', label: t('update.installNow'), variant: 'primary' },
    ]"
    @select="(key) => (key === 'install' ? void updater.confirmInstall() : updater.closeConfirm())"
  />

  <ModalShell v-if="updater.installing" :width="400" :closeable="false">
    <template #title>{{ t('update.installingTitle') }}</template>
    <div class="install">
      <p class="hint">{{ progressText }}</p>
      <ProgressBar status="downloading" :percent="percent" :label="t('update.installingTitle')" />
    </div>
  </ModalShell>
</template>

<style scoped>
.install {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-top: var(--space-1);
}

.hint {
  font-size: var(--text-sm);
  color: var(--muted);
}
</style>
