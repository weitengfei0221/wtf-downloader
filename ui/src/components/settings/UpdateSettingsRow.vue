<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { RefreshCw } from '@lucide/vue';
import { t } from '@/locales/zh-CN';
import { formatCompletedAt } from '@/utils/format';
import { useUpdaterStore } from '@/stores/updater';
import SettingsRow from '@/components/settings/SettingsRow.vue';
import BaseButton from '@/components/BaseButton.vue';

/**
 * 设置页「检查更新」行（DESIGN.md §4.4，第十轮）：
 * 显示当前版本（Tauri getVersion，不硬编码）+ 上次检查时间 / 失败态 + 手动检查按钮。
 * 手动检查的失败 toast 在 stores/updater.ts 里推，与启动自动检查的静默策略区分。
 */
const updater = useUpdaterStore();

onMounted(() => void updater.loadVersion());

const versionText = computed(() =>
  updater.currentVersion !== ''
    ? t('update.currentVersion', { version: updater.currentVersion })
    : t('update.versionUnknown'),
);

const statusText = computed(() => {
  const at = updater.lastCheckedAt;
  if (at == null) return t('update.neverChecked');
  const time = formatCompletedAt(at);
  return updater.lastCheckFailed
    ? t('update.lastCheckFailed', { time })
    : t('update.lastChecked', { time });
});

const helper = computed(() =>
  t('update.statusLine', { version: versionText.value, status: statusText.value }),
);
</script>

<template>
  <SettingsRow :label="t('update.check')" :helper="helper">
    <BaseButton
      variant="secondary"
      :loading="updater.checking"
      :disabled="updater.installing"
      :title="t('aria.checkUpdate')"
      @click="updater.manualCheck()"
    >
      <template #icon><RefreshCw class="icon-16" /></template>
      {{ t('update.check') }}
    </BaseButton>
  </SettingsRow>
</template>
