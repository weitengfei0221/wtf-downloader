<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { AlertCircle, Check, LoaderCircle, Plus, TriangleAlert } from '@lucide/vue';
import { t } from '@/locales/zh-CN';
import { addTask, probeUrl } from '@/api/tasks';
import { pickDirectory } from '@/api/config';
import { readClipboardText } from '@/api/clipboard';
import { errMessage, isComposedError } from '@/api/invoke';
import type { ProbeResult } from '@/api/types';
import { isHttpUrl, formatBytes } from '@/utils/format';
import { useUiStore } from '@/stores/ui';
import { useConfigStore } from '@/stores/config';
import { useToastStore } from '@/stores/toast';
import { useTasksStore } from '@/stores/tasks';
import ModalShell from '@/components/ModalShell.vue';
import BaseButton from '@/components/BaseButton.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import AddAdvancedOptions from '@/components/add/AddAdvancedOptions.vue';
import AddDirRow from '@/components/add/AddDirRow.vue';

/**
 * 添加任务弹窗（DESIGN.md §3）：480px 渐进披露三阶段——URL 输入（粘贴即校验 +
 * 500ms 防抖解析 + 剪贴板预填）→ 解析成功展开文件名/目录 → 高级折叠。
 * Enter 提交；失败内联错误条且弹窗不关（AC-02）。
 */
const PROBE_TIMEOUT_MS = 2000;
const PROBE_DEBOUNCE_MS = 500;
const ILLEGAL_FILENAME = /[\\/:*?"<>|]/;
const TIMEOUT = Symbol('probe-timeout');

const ui = useUiStore();
const configStore = useConfigStore();
const toast = useToastStore();
const tasksStore = useTasksStore();

const urlText = ref('');
const filename = ref('');
const dir = ref('');
const segments = ref(16);
const advancedOpen = ref(false);
const clipPrefill = ref(false);
const submitting = ref(false);
const addError = ref('');
const discardConfirm = ref(false);

type ProbeState = 'idle' | 'probing' | 'done' | 'timeout' | 'failed';
const probeState = ref<ProbeState>('idle');
const probeResult = ref<ProbeResult | null>(null);

let probeTimer: number | undefined;
let lastProbedUrl = '';

const urls = computed(() => {
  const lines = urlText.value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return [...new Set(lines)];
});

const invalidLineNo = computed(() => {
  const lines = urlText.value.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? '';
    if (line !== '' && !isHttpUrl(line)) return i + 1;
  }
  return null;
});

const singleUrl = computed(() => (urls.value.length === 1 ? urls.value[0] ?? null : null));
const filenameInvalid = computed(
  () => filename.value !== '' && ILLEGAL_FILENAME.test(filename.value),
);
const isPlainHttp = computed(() => urls.value.some((u) => u.toLowerCase().startsWith('http://')));
const probed = computed(() => probeState.value === 'done' && probeResult.value != null);
const submitLabel = computed(() =>
  urls.value.length > 1 ? t('add.submitMulti', { n: urls.value.length }) : t('add.submit'),
);
const canSubmit = computed(
  () =>
    urls.value.length > 0 && invalidLineNo.value == null && !filenameInvalid.value && !submitting.value,
);
const parallelHint = computed(() =>
  probed.value && singleUrl.value != null ? t('add.parallelEstimate', { n: segments.value }) : '',
);

watch(
  () => ui.addDialogOpen,
  (open) => {
    if (open) void reset();
  },
);

watch(singleUrl, (url) => {
  window.clearTimeout(probeTimer);
  if (url == null || invalidLineNo.value != null) {
    probeState.value = 'idle';
    probeResult.value = null;
    return;
  }
  if (url === lastProbedUrl && (probeState.value === 'done' || probeState.value === 'probing')) return;
  probeTimer = window.setTimeout(() => void probe(url), PROBE_DEBOUNCE_MS);
});

async function reset(): Promise<void> {
  urlText.value = '';
  filename.value = '';
  advancedOpen.value = false;
  clipPrefill.value = false;
  probeState.value = 'idle';
  probeResult.value = null;
  addError.value = '';
  discardConfirm.value = false;
  submitting.value = false;
  lastProbedUrl = '';
  dir.value = configStore.config?.downloadDir ?? '';
  segments.value = configStore.config?.defaultSegments ?? 16;
  try {
    // Via the clipboard plugin, not `navigator.clipboard`: the Web API makes
    // WebView2 show a permission prompt on every single read.
    const text = (await readClipboardText()).trim();
    if (text !== '' && !text.includes('\n') && isHttpUrl(text)) {
      urlText.value = text;
      clipPrefill.value = true;
    }
  } catch {
    // 剪贴板不可读（空剪贴板 / 非文本内容 / 插件不可用）：静默跳过预填（F6 尽力而为）
  }
}

async function probe(url: string): Promise<void> {
  probeState.value = 'probing';
  lastProbedUrl = url;
  try {
    const timeoutP = new Promise<typeof TIMEOUT>((resolve) => {
      window.setTimeout(() => resolve(TIMEOUT), PROBE_TIMEOUT_MS);
    });
    const result = await Promise.race([probeUrl(url), timeoutP]);
    if (result === TIMEOUT) {
      probeState.value = 'timeout';
      return;
    }
    probeResult.value = result;
    probeState.value = 'done';
    if (filename.value === '') filename.value = result.filename;
  } catch {
    probeResult.value = null;
    probeState.value = 'failed';
  }
}

async function changeDir(): Promise<void> {
  const picked = await pickDirectory(dir.value);
  if (picked) dir.value = picked;
}

function requestClose(): void {
  if (urlText.value.trim() !== '' || filename.value.trim() !== '') discardConfirm.value = true;
  else ui.closeAddDialog();
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  submitting.value = true;
  addError.value = '';
  let added = 0;
  try {
    for (const url of urls.value) {
      await addTask({
        url,
        filename: urls.value.length === 1 ? filename.value.trim() || undefined : undefined,
        dir: dir.value || undefined,
        segments: segments.value,
      });
      added += 1;
    }
  } catch (e) {
    // AC-02：失败弹窗不关；已成功入队的任务保留（无半成品记录——失败行未创建任务）
    // 文案规则同 Toast（DESIGN.md §6.4）：后端 AppError 已是完整中文句 → 原样展示，
    // 不叠加「添加失败：」；只有非 AppError（裸原因）才补前缀。
    addError.value = isComposedError(e)
      ? errMessage(e)
      : t('add.addFailed', { reason: errMessage(e) });
    submitting.value = false;
    return;
  }
  submitting.value = false;
  ui.closeAddDialog();
  // 新建后立即落到「下载中」视图（2026-11 用户裁决）：无论之前停在全部/已完成/失败，
  // 都不留在原视图。setFilter 顺带退出「仅看文件已丢失」独立筛选（DESIGN.md §2.10）。
  // 该视图含 pending（后端 add_task 初始状态），刷新回来后新任务一定可见。
  tasksStore.setFilter('downloading');
  toast.push('success', 'add.addedToast', { params: { n: added } });
  void tasksStore.refresh();
}
</script>

<template>
  <ModalShell v-if="ui.addDialogOpen" :width="480" @request-close="requestClose">
    <template #title>{{ t('add.title') }}</template>
    <!-- 提交按钮在 #footer 插槽（form 之外）：靠 form 属性关联，Enter 与点击共用同一份 submit -->
    <form id="add-task-form" class="form" @submit.prevent="submit">
      <div class="field-block">
        <label class="label" for="add-url">{{ t('add.urlLabel') }}</label>
        <textarea
          id="add-url"
          v-model="urlText"
          class="url-input mono"
          :class="{ 'input-invalid': invalidLineNo != null }"
          rows="2"
          @input="clipPrefill = false"
        />
        <p v-if="invalidLineNo != null" class="error">{{ t('add.urlLineError', { n: invalidLineNo }) }}</p>
        <p v-if="clipPrefill" class="meta-note">{{ t('add.clipPrefill') }}</p>
        <p v-else-if="!invalidLineNo" class="helper">{{ t('add.urlHelper') }}</p>

        <p v-if="probeState === 'probing'" class="probe-note">
          <LoaderCircle class="icon-16 icon-spin" />
          {{ t('add.probing') }}
        </p>
        <template v-else-if="probeState === 'timeout'">
          <p class="probe-note">{{ t('add.probeTimeout') }}</p>
          <BaseButton variant="ghost" class="still-add" @click="submit">{{ t('add.stillAdd') }}</BaseButton>
        </template>
      </div>

      <!-- 阶段 2：单条解析成功 / 多条摘要 -->
      <template v-if="singleUrl != null && probed && probeResult">
        <div class="field-block">
          <label class="label" for="add-filename">{{ t('add.filenameLabel') }}</label>
          <input
            id="add-filename"
            v-model="filename"
            class="filename-input"
            :class="{ 'input-invalid': filenameInvalid }"
            type="text"
          />
          <p v-if="filenameInvalid" class="error">{{ t('add.filenameError') }}</p>
        </div>
        <div class="info-row">
          <span class="mono info-size">{{ formatBytes(probeResult.totalSize) }}</span>
          <span v-if="probeResult.acceptRanges" class="info-ok">
            <Check class="icon-16" />{{ t('add.acceptRanges') }}
          </span>
          <span v-else class="info-warn">
            <TriangleAlert class="icon-16" />{{ t('add.noRanges') }}
          </span>
        </div>
      </template>
      <p v-else-if="urls.length > 1" class="meta-note">{{ t('add.multiSummary', { n: urls.length, dir }) }}</p>

      <div class="field-block">
        <AddDirRow :dir="dir" @change="changeDir" />
      </div>

      <AddAdvancedOptions v-model="segments" v-model:open="advancedOpen" />

      <p v-if="isPlainHttp" class="http-warn">
        <TriangleAlert class="icon-16" />
        {{ t('add.httpWarning') }}
      </p>

      <p v-if="addError" class="add-error">
        <AlertCircle class="icon-16" />
        {{ addError }}
      </p>
    </form>
    <template #footer>
      <!-- 单行三元素：hint 靠左（margin-right:auto），取消 / 开始下载靠右；hint 不存在时两按钮仍靠右。
           提交按钮始终 type=submit form=add-task-form，与 form 跨插槽关联，全文件只有一份 submit。 -->
      <footer class="footer">
        <span v-if="parallelHint" class="parallel-hint">{{ parallelHint }}</span>
        <BaseButton variant="ghost" type="button" @click="requestClose">{{ t('common.cancel') }}</BaseButton>
        <BaseButton
          variant="primary"
          type="submit"
          form="add-task-form"
          :disabled="!canSubmit"
          :loading="submitting"
        >
          <template #icon><Plus class="icon-16" /></template>
          {{ submitLabel }}
        </BaseButton>
      </footer>
    </template>
  </ModalShell>

  <ConfirmDialog
    v-if="discardConfirm"
    :title="t('add.discard')"
    :message="t('add.discardMessage')"
    :actions="[
      { key: 'keep', label: t('add.keepEditing'), variant: 'ghost', safe: true },
      { key: 'discard', label: t('add.discard'), variant: 'secondary' },
    ]"
    @select="
      (key) => {
        if (key === 'discard') ui.closeAddDialog();
        discardConfirm = false;
      }
    "
  />
</template>

<style scoped src="./add-task-dialog.css"></style>
