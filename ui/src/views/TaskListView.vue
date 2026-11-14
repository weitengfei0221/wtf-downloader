<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { CircleAlert, RotateCw } from '@lucide/vue';
import { t } from '@/locales/zh-CN';
import { openFileLocation } from '@/api/tasks';
import { openFile } from '@/api/config';
import { isResumeConflict } from '@/api/invoke';
import { joinPath } from '@/utils/path';
import type { TaskRecord } from '@/api/types';
import { useTasksStore } from '@/stores/tasks';
import { useConfigStore } from '@/stores/config';
import { useUiStore } from '@/stores/ui';
import { useToastStore } from '@/stores/toast';
import { useTaskSelection } from '@/composables/useTaskSelection';
import { useMissingFileCheck } from '@/composables/useMissingFileCheck';
import { useRemoveFlow } from '@/composables/useRemoveFlow';
import AppTopbar from '@/components/AppTopbar.vue';
import StatusBar from '@/components/StatusBar.vue';
import EmptyState from '@/components/EmptyState.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import BaseButton from '@/components/BaseButton.vue';
import TaskRow from '@/components/task/TaskRow.vue';
import MarqueeLayer from '@/components/task/MarqueeLayer.vue';

/** 任务列表主界面（DESIGN.md §2）：顶栏 + 滚动列表（五态）+ 状态栏 + 键盘路径。 */
const router = useRouter();
const tasksStore = useTasksStore();
const configStore = useConfigStore();
const uiStore = useUiStore();
const toast = useToastStore();

const topbarEl = ref<InstanceType<typeof AppTopbar> | null>(null);
const listEl = ref<HTMLElement | null>(null);
/** roving tabindex 键盘焦点行（↑↓/Space/Delete/Enter 落点），与选择集合互不覆盖 */
const selectedId = ref<string | null>(null);

const {
  selected: checkedTasks,
  has,
  toggle: toggleCheck,
  selectOnly,
  prepareContext,
  clear: clearChecks,
  removeIds,
  selectIds,
} = useTaskSelection(() => tasksStore.visible);
useMissingFileCheck();

/** 行左键：普通点击 = 清空原选择只选该行并同步焦点行；Ctrl 切换；Shift 连选 */
function onRowSelect(task: TaskRecord, e: MouseEvent): void {
  if (e.ctrlKey || e.metaKey) toggleCheck(task.id, false);
  else if (e.shiftKey) toggleCheck(task.id, true);
  else { selectOnly(task.id); selectedId.value = task.id; }
}

const visible = computed(() => tasksStore.visible);
const showError = computed(() => tasksStore.loadError !== '' && tasksStore.tasks.length === 0);
const showNoResults = computed(
  () => !tasksStore.loading && tasksStore.tasks.length > 0 && visible.value.length === 0,
);
const showNoTasks = computed(
  () => !tasksStore.loading && tasksStore.loadError === '' && tasksStore.tasks.length === 0,
);

/**
 * 入场动画只给"首次出现"的行（2026-11 实测缺陷 3：动画跟着每次刷新重放 → 列表闪烁）。
 * seenIds 跨筛选保留，所以切换筛选/搜索不会重放；只有真正新增的 id 进 enterIds。
 */
const seenIds = new Set<string>();
const enterIds = ref<string[]>([]);

watch(visible, (list) => {
  const fresh = list.filter((task) => !seenIds.has(task.id));
  for (const task of fresh) seenIds.add(task.id);
  enterIds.value = fresh.map((task) => task.id);
  if (selectedId.value != null && !list.some((task) => task.id === selectedId.value)) {
    selectedId.value = null;
  }
});

function rowTabIndex(task: TaskRecord, index: number): number {
  if (selectedId.value == null) return index === 0 ? 0 : -1;
  return task.id === selectedId.value ? 0 : -1;
}

function focusRow(id: string): void {
  listEl.value?.querySelector<HTMLElement>(`[data-task-id="${id}"]`)?.focus();
}

function moveSelection(delta: number): void {
  const list = visible.value;
  if (list.length === 0) return;
  const index = list.findIndex((task) => task.id === selectedId.value);
  const next = index === -1 ? 0 : Math.min(list.length - 1, Math.max(0, index + delta));
  selectedId.value = list[next]?.id ?? null;
  if (selectedId.value) focusRow(selectedId.value);
}

function onRowKey(task: TaskRecord, e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveSelection(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveSelection(-1);
  } else if (e.key === ' ') {
    e.preventDefault();
    void togglePauseResume(task);
  } else if (e.key === 'Delete') {
    e.preventDefault();
    requestRemove(task);
  } else if (e.key === 'Enter') {
    if (task.status === 'completed') {
      e.preventDefault();
      // 键盘路径复用行内动作分发（onAction → case 'open-dir'），与鼠标点击共用
      // 同一条 try/catch + toast.pushError 出口——不在这里再写一份 catch，
      // 否则两条路径必然分叉（2026-11 实测：鼠标路径修了、键盘路径漏了）。
      void onAction(task, 'open-dir');
    }
  }
}

function onCtrlF(e: KeyboardEvent): void {
  if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    void topbarEl.value?.focusSearch();
  }
}

async function togglePauseResume(task: TaskRecord): Promise<void> {
  if (task.status === 'downloading') await runTaskById(task.id, () => tasksStore.pause(task.id));
  else if (task.status === 'paused') await runTaskById(task.id, () => tasksStore.resume(task.id));
}

/**
 * 行内操作分发。`more` 不在此列：TaskRow 内拦截并自行开「更多」菜单
 * （菜单需要按钮坐标锚点，归 TaskRow 单一所有；此处加 case 属不可达死代码）。
 *
 * **不变量：本函数必须永不 reject。** 三条入口（行内按钮 / 更多菜单 / 键盘 Enter）
 * 都以 `void onAction(...)` 形式 fire-and-forget，没有调用方 catch —— 一旦 reject
 * 就是三处同时"点了没反应"且无人察觉。因此外层兜底 try/catch 是**结构保证**，
 * 不是装饰：新增分支即便漏写自身 catch，也会落到这里给出可见反馈。
 */
async function onAction(task: TaskRecord, type: string): Promise<void> {
  try {
    switch (type) {
      case 'pause':
        await runTaskById(task.id, () => tasksStore.pause(task.id));
        break;
      case 'resume':
        await runTaskById(task.id, () => tasksStore.resume(task.id));
        break;
      case 'retry':
        await runTaskById(task.id, () => tasksStore.retry(task.id));
        break;
      case 'open-file':
        // 打开失败必须可见（命令未注册/文件被移走都会 reject，静默 = "点了没反应"）。
        // 文案由 toast.pushError 决策：后端 AppError 原样展示（"文件不存在：…"），
        // 只有非 AppError 时才补「打开失败：」前缀（DESIGN.md §6.4 契约）。
        try {
          await openFile(joinPath(task.dir, task.filename));
        } catch (e) {
          toast.pushError('toast.openFailed', e);
        }
        break;
      case 'open-dir':
        // 原先无 catch：open_file_location 失败会变成未处理 Promise（点了没反应）
        try {
          await openFileLocation(task.id);
        } catch (e) {
          toast.pushError('toast.openFailed', e);
        }
        break;
      case 'remove':
        requestRemove(task);
        break;
      default:
        break;
    }
  } catch (e) {
    // 兜底：仅在"某个分支漏写自身 catch"时触发（现有分支都已各自处理，行为不变）
    toast.pushError('toast.saveFailed', e);
  }
}

async function runTaskById(id: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (isResumeConflict(e)) uiStore.openResumeConflict(id);
    else toast.pushError('toast.saveFailed', e);
  }
}

/**
 * 删除流程整段归 `composables/useRemoveFlow.ts`（唯一实现，含确认框按状态派生、
 * 撤销 toast、`.part` 清理语义）；本视图只做接线：行内「删除」/ Delete 键调
 * requestRemove，确认框 @select 调 confirmRemove。
 */
const { confirmTask, removeActions, removeMessage, requestRemove, confirmRemove } =
  useRemoveFlow();

/** 空态「查看全部」：复用 setFilter 单点（顺带退出独立的文件丢失筛选） */
function viewAll(): void {
  tasksStore.setFilter('all');
}

onMounted(() => {
  void tasksStore.fetch(true);
  if (configStore.config == null) void configStore.load();
  window.addEventListener('keydown', onCtrlF);
});

onBeforeUnmount(() => window.removeEventListener('keydown', onCtrlF));
</script>

<template>
  <div class="view">
    <AppTopbar ref="topbarEl" @open-settings="router.push('/settings')" />

    <main ref="listEl" class="list" @click.self="clearChecks">
      <!-- Loading：3 条骨架行（shimmer 1.2s） -->
      <div v-if="tasksStore.loading" class="skeletons" aria-hidden="true">
        <div v-for="n in 3" :key="n" class="skeleton">
          <div class="sk-line sk-title" />
          <div class="sk-line sk-bar" />
          <div class="sk-line sk-meta" />
        </div>
      </div>

      <!-- Error：列表加载失败 -->
      <div v-else-if="showError" class="center">
        <CircleAlert class="icon-24 center-icon" aria-hidden="true" />
        <p class="center-title">{{ t('error.loadFailed') }}</p>
        <p class="center-sub">{{ tasksStore.loadError }}</p>
        <BaseButton variant="secondary" @click="tasksStore.fetch(true)">
          <template #icon><RotateCw class="icon-16" /></template>
          {{ t('common.retry') }}
        </BaseButton>
      </div>

      <EmptyState
        v-else-if="showNoTasks"
        variant="no-tasks"
        @new-task="uiStore.openAddDialog()"
      />
      <EmptyState
        v-else-if="showNoResults"
        variant="no-results"
        :filter="tasksStore.filter"
        :missing-only="tasksStore.missingOnly"
        @view-all="viewAll"
      />

      <!-- Populated / Edge：行间 8px，超长文件名省略 + title（行内处理） -->
      <template v-else>
        <TaskRow
          v-for="(task, index) in visible"
          :key="task.id"
          :task="task"
          :frame="tasksStore.frames[task.id]"
          :is-new="enterIds.includes(task.id)"
          :tab-index="rowTabIndex(task, index)"
          :highlighted="has(task.id)"
          :selection-count="checkedTasks.length"
          :selected-tasks="checkedTasks"
          :file-missing="tasksStore.missingIdSet.has(task.id)"
          @action="(type) => onAction(task, type)"
          @key="(e) => onRowKey(task, e)"
          @selected="selectedId = task.id"
          @select="(e) => onRowSelect(task, e)"
          @context="prepareContext"
          @removed="removeIds"
        />
      </template>
    </main>

    <MarqueeLayer :list-el="listEl" :visible="visible" @commit="selectIds" />
    <StatusBar />

    <ConfirmDialog
      v-if="confirmTask"
      :title="t('remove.title')"
      :message="removeMessage"
      :actions="removeActions"
      @select="confirmRemove"
    />
  </div>
</template>

<style scoped src="./task-list-view.css"></style>
