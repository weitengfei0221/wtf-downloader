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
 * Windows 上安装器执行时应用会自动退出，所以 ConfirmDialog 的文案必须在**下载前**
 * 明示「安装时应用自动退出、完成后请重新打开」，不做任何重启调用（relaunch 不可达）。
 */
const updater = useUpdaterStore();

const message = computed(() => {
  const info = updater.available;
  if (info == null) return '';
  const message = t('update.confirmMessage', { version: info.version });
  if (!info.body) return message;
  return t('update.confirmWithNotes', {
    message,
    notes: t('update.releaseNotes', { body: info.body }),
  });
});

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
    :message="message"
    :actions="[
      { key: 'later', label: t('update.later'), variant: 'ghost', safe: true },
      { key: 'install', label: t('update.installNow'), variant: 'primary' },
    ]"
    @select="(key) => (key === 'install' ? void updater.confirmInstall() : void updater.dismissConfirm())"
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
