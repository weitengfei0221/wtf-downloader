<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { FolderOpen, RotateCw, Trash2 } from '@lucide/vue';
import { t } from '@/locales/zh-CN';
import { pickDirectory } from '@/api/config';
import { MB } from '@/utils/units';
import { useConfigStore } from '@/stores/config';
import StatusBar from '@/components/StatusBar.vue';
import SettingsTopbar from '@/components/settings/SettingsTopbar.vue';
import SettingsRow from '@/components/settings/SettingsRow.vue';
import UpdateSettingsRow from '@/components/settings/UpdateSettingsRow.vue';
import ToggleSwitch from '@/components/ToggleSwitch.vue';
import BaseInput from '@/components/BaseInput.vue';
import BaseButton from '@/components/BaseButton.vue';
import IconButton from '@/components/IconButton.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';

/**
 * 设置页（DESIGN.md §4）：三分组 7 设置项，即时保存。
 * 内容列 max-width 720px + margin-inline auto 居中（左右对称留白，问题 4a）。
 * 顶栏右上角此时是「返回任务列表」（ArrowLeft 20），不再是齿轮（问题 4b）。
 *
 * 2026-11 交互减法：下载目录行去掉「打开」按钮 —— opener 受 ACL 路径作用域限制
 * 无法授权，点击必然 `Not allowed to open path`。目录行只保留 FolderOpen 图标
 * （pickDirectory 系统选择器，正常工作）+ 路径展示。
 */
const router = useRouter();
const configStore = useConfigStore();

const segmentsText = ref('');
const limitText = ref('');
const clearConfirm = ref(false);

const config = computed(() => configStore.config);

onMounted(async () => {
  if (configStore.config == null) await configStore.load();
  syncInputs();
});

function syncInputs(): void {
  segmentsText.value = String(config.value?.defaultSegments ?? 16);
  const bps = config.value?.globalSpeedLimitBps;
  limitText.value = bps != null ? String(Math.round(bps / MB)) : '';
}

function backToTasks(): void {
  void router.push('/');
}

/** 配置读取失败态的重试（文案不再复用"任务列表加载失败"，那是主界面语汇） */
async function reload(): Promise<void> {
  await configStore.load();
  syncInputs();
}

async function changeDir(): Promise<void> {
  const picked = await pickDirectory(config.value?.downloadDir);
  if (picked) await configStore.patch({ downloadDir: picked });
}

async function commitSegments(): Promise<void> {
  // 空值/非法输入必须回退到当前值，不能被 Number('') = 0 夹成 1 悄悄存下去
  if (segmentsText.value.trim() === '' || !Number.isFinite(Number(segmentsText.value))) {
    syncInputs();
    return;
  }
  const n = Math.min(16, Math.max(1, Math.round(Number(segmentsText.value))));
  segmentsText.value = String(n);
  if (n !== config.value?.defaultSegments) await configStore.patch({ defaultSegments: n });
}

/**
 * 全局限速统一走 set_global_speed_limit（configStore.applyGlobalLimit）：
 * set_config 的 ConfigPatchArg.globalSpeedLimitBps 是 Option<Option<u64>>，
 * 而 serde 把 JSON null 解成**外层 None**（= "本字段不改"），因此
 * `patch({ globalSpeedLimitBps: null })` 无法解除限速——会静默保留旧值。
 * set_global_speed_limit 的 Option<u64> 语义明确（null = 解除），且同样落库持久化。
 */
async function commitLimit(): Promise<void> {
  const mb = Number(limitText.value);
  const bps =
    limitText.value.trim() === '' || !Number.isFinite(mb) || mb <= 0 ? null : Math.round(mb * MB);
  await configStore.applyGlobalLimit(bps, true);
  // 归一化回显：0/空 → 不限（空串），小数取整，失败时也回到真实值
  syncInputs();
}
</script>

<template>
  <div class="view">
    <SettingsTopbar @back="backToTasks" />

    <main class="content">
      <div class="content-inner">
        <p v-if="config == null" class="load-note">
          {{ t('settings.loadFailed') }}
          <BaseButton variant="secondary" class="load-retry" @click="reload">
            <template #icon><RotateCw class="icon-16" /></template>
            {{ t('common.retry') }}
          </BaseButton>
        </p>
        <template v-else>
          <section class="group">
            <h3 class="group-title">{{ t('settings.groupDownload') }}</h3>
            <div class="group-box">
              <SettingsRow :label="t('settings.downloadDir')">
                <span class="dir mono" :title="config.downloadDir">{{ config.downloadDir }}</span>
                <IconButton :label="t('aria.changeDir')" @click="changeDir">
                  <FolderOpen class="icon-16" />
                </IconButton>
              </SettingsRow>
              <SettingsRow
                :label="t('settings.defaultSegments')"
                :helper="t('settings.defaultSegmentsHelper')"
              >
                <BaseInput
                  v-model="segmentsText"
                  mono
                  type="number"
                  :min="1"
                  :max="16"
                  class="w-88"
                  @enter="commitSegments"
                  @blur="commitSegments"
                />
              </SettingsRow>
              <SettingsRow :label="t('settings.globalLimit')" :helper="t('settings.globalLimitHelper')">
                <BaseInput
                  v-model="limitText"
                  mono
                  type="number"
                  :min="0"
                  class="w-88"
                  :placeholder="t('common.speedPlaceholder')"
                  @enter="commitLimit"
                  @blur="commitLimit"
                />
                <span class="unit">{{ t('settings.unit') }}</span>
              </SettingsRow>
            </div>
          </section>

          <section class="group">
            <h3 class="group-title">{{ t('settings.groupGeneral') }}</h3>
            <div class="group-box">
              <SettingsRow :label="t('settings.autostart')" :helper="t('settings.autostartHelper')">
                <ToggleSwitch
                  :model-value="config.autostartEnabled"
                  :label="t('settings.autostart')"
                  @update:model-value="configStore.setAutostart"
                />
              </SettingsRow>
              <SettingsRow :label="t('settings.closeToTray')" :helper="t('settings.closeToTrayHelper')">
                <ToggleSwitch
                  :model-value="config.minimizeToTray"
                  :label="t('settings.closeToTray')"
                  @update:model-value="(v) => configStore.patch({ minimizeToTray: v })"
                />
              </SettingsRow>
              <SettingsRow :label="t('settings.notify')" :helper="t('settings.notifyHelper')">
                <ToggleSwitch
                  :model-value="config.notifyOnComplete"
                  :label="t('settings.notify')"
                  @update:model-value="(v) => configStore.patch({ notifyOnComplete: v })"
                />
              </SettingsRow>
            </div>
          </section>

          <section class="group">
            <h3 class="group-title">{{ t('settings.groupData') }}</h3>
            <div class="group-box">
              <SettingsRow :label="t('settings.statsDesc')">
                <BaseButton variant="destructive" @click="clearConfirm = true">
                  <template #icon><Trash2 class="icon-16" /></template>
                  {{ t('settings.clearStats') }}
                </BaseButton>
              </SettingsRow>
            </div>
          </section>

          <section class="group">
            <h3 class="group-title">{{ t('settings.groupUpdate') }}</h3>
            <div class="group-box">
              <UpdateSettingsRow />
            </div>
          </section>

          <p class="theme-note">{{ t('settings.themeNote') }}</p>
        </template>
      </div>
    </main>

    <StatusBar />

    <ConfirmDialog
      v-if="clearConfirm"
      :title="t('settings.clearStatsTitle')"
      :message="t('settings.clearStatsMessage')"
      :actions="[
        { key: 'cancel', label: t('common.cancel'), variant: 'ghost', safe: true },
        { key: 'clear', label: t('settings.clear'), variant: 'destructive' },
      ]"
      @select="
        (key) => {
          clearConfirm = false;
          if (key === 'clear') void configStore.clearStats();
        }
      "
    />
  </div>
</template>

<style scoped>
.view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* 滚动容器保持满宽（滚动条贴窗口右缘），内容列在内层居中（问题 4a） */
.content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-6) var(--space-6) var(--space-8);
}

.content-inner {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  width: 100%;
  max-width: 720px;
  margin-inline: auto;
}

.load-note {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-sm);
  color: var(--muted);
}

.load-retry {
  flex: none;
}

.group-title {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--fg-2);
  margin-bottom: var(--space-3);
}

.group-box {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.dir {
  font-size: var(--text-xs);
  color: var(--muted);
  /* 「打开」按钮移除后右缘只剩图标按钮，路径可用宽度增加（24ch → 32ch） */
  max-width: 32ch;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.w-88 {
  width: 88px;
}

.unit {
  font-size: var(--text-xs);
  color: var(--muted);
}

.theme-note {
  font-size: var(--text-xs);
  color: var(--meta);
}
</style>
