import { defineStore } from 'pinia';
import {
  listTasks,
  pauseTask,
  resumeTask,
  retryTask,
  removeTask,
  setTaskSpeedLimit,
} from '@/api/tasks';
import type {
  ProgressFrame,
  StateChangedPayload,
  TaskFilter,
  TaskRecord,
  TaskStatus,
} from '@/api/types';
import { mergeTasks } from '@/utils/mergeTasks';

/**
 * 文件丢失判据（**唯一实现**，DESIGN.md §2.10）：
 * ① id 命中后端 `check_files` 返回的缺失集合；② 该任务当前仍为 completed。
 * ② 是防御性收敛——本地状态可能已先于检测结果变化，不该给非完成行挂徽标。
 * 返回只读 Set，`visible` 的「仅看文件丢失」与 TaskRow 的 `fileMissing` 共用它，
 * 全项目不存在第二份"哪些任务算文件丢失"的判定。
 */
export function fileMissingIdsOf(
  tasks: TaskRecord[],
  missingFileIds: string[],
): ReadonlySet<string> {
  const completed = new Set(
    tasks.filter((task) => task.status === 'completed').map((task) => task.id),
  );
  return new Set(missingFileIds.filter((id) => completed.has(id)));
}

/**
 * 「下载中」视图的状态集合（**唯一实现**，2026-11 第七轮追加裁决）。
 *
 * 用户口径：「暂停的任务也属于下载中」。且后端 `add_task` 建任务时落
 * `TaskStatus::Pending`（`crates/downloader-engine/src/http/ops.rs`），新建后切到
 * 该视图必须能立刻看到刚添加的任务，故 pending / downloading / paused 都算
 * 「仍在进行中」；completed / failed 不算。
 *
 * `counts.downloading` 与 `visible` 都只调用本函数，禁止各自再写一份状态枚举判断
 * （两份判据必然随需求变更分叉）。`TaskFilter` 四值契约不变：这是纯前端呈现层的
 * 分组语义，不新增第五个值、不传给后端（`fetch` 恒取 `listTasks('all')` 后本地过滤）。
 */
export function isInProgress(status: TaskStatus): boolean {
  return status === 'pending' || status === 'downloading' || status === 'paused';
}

export const useTasksStore = defineStore('tasks', {
  state: () => ({
    tasks: [] as TaskRecord[],
    loading: true,
    loadError: '' as string,
    // 默认进入「下载中」视图（2026-11 第七轮用户裁决）；TaskFilter 四值契约不变。
    filter: 'downloading' as TaskFilter,
    search: '',
    /** 最新进度帧（按 taskId；仅 downloading 任务有帧，非下载态帧被清除防陈旧速度） */
    frames: {} as Record<string, ProgressFrame>,
    /**
     * 纯呈现态：`check_files` 返回的、关联正式文件已不存在的已完成任务 id。
     * 瞬时派生，绝不写进 TaskRecord / 不落库 / 不改 TaskStatus 五态枚举。
     * 文件放回后下一次检测自然清空；检测失败时**不写入**，保留上一次结果。
     */
    missingFileIds: [] as string[],
    /** 独立筛选开关「仅看文件已丢失」，不并入 TaskFilter 四值语义（§2.10） */
    missingOnly: false,
    /** fetch 成功次数：驱动文件检测重查（事件驱动，非轮询、不挂 4Hz 进度帧） */
    fetchRevision: 0,
  }),

  getters: {
    byId(state): (id: string) => TaskRecord | undefined {
      return (id) => state.tasks.find((task) => task.id === id);
    },
    /** 文件丢失判据的唯一对外出口（组件读它，不得自行 filter） */
    missingIdSet(state): ReadonlySet<string> {
      return fileMissingIdsOf(state.tasks, state.missingFileIds);
    },
    missingCount(state): number {
      // 与 visible / TaskRow 共用唯一判据：非完成态的陈旧 id 不该让开关亮起却筛出空列表
      return fileMissingIdsOf(state.tasks, state.missingFileIds).size;
    },
    counts(state): { all: number; downloading: number; completed: number; failed: number } {
      let downloading = 0;
      let completed = 0;
      let failed = 0;
      for (const task of state.tasks) {
        // 与 visible 共用「下载中」分组判据：暂停 / 等待中也计入，不能只数 downloading
        if (isInProgress(task.status)) downloading += 1;
        else if (task.status === 'completed') completed += 1;
        else if (task.status === 'failed') failed += 1;
      }
      return { all: state.tasks.length, downloading, completed, failed };
    },
    visible(state): TaskRecord[] {
      let list = state.tasks;
      if (state.filter === 'downloading') {
        // 「下载中」是一个分组视图（pending/downloading/paused），不是 status 相等比较
        list = list.filter((task) => isInProgress(task.status));
      } else if (state.filter !== 'all') {
        list = list.filter((task) => task.status === state.filter);
      }
      const query = state.search.trim().toLowerCase();
      if (query !== '') {
        list = list.filter((task) => task.filename.toLowerCase().includes(query));
      }
      // 「仅看文件已丢失」是独立于四值状态筛选的一层（AND），共用唯一判据
      if (state.missingOnly) {
        const missing = fileMissingIdsOf(state.tasks, state.missingFileIds);
        list = list.filter((task) => missing.has(task.id));
      }
      return list;
    },
    totalSpeedBps(state): number {
      let sum = 0;
      for (const task of state.tasks) {
        if (task.status === 'downloading') {
          sum += state.frames[task.id]?.speedBps ?? 0;
        }
      }
      return sum;
    },
  },

  actions: {
    /**
     * 写入文件丢失呈现态的**唯一入口**（`useMissingFileCheck` 调用）。
     * - 校验返回形状：只收字符串数组，其余一律忽略（后端未注册/返回异常不污染 UI）；
     * - 去重；空数组 = 文件都回来了 → 顺手关掉「仅看文件已丢失」，避免留一个空筛选；
     * - 检测失败时调用方根本不调用本方法，故上一次结果原样保留（不落库、不改 TaskRecord）。
     */
    setMissingFileIds(ids: unknown): void {
      if (!Array.isArray(ids)) return;
      const safe = ids.filter((id): id is string => typeof id === 'string');
      this.missingFileIds = [...new Set(safe)];
      if (this.missingIdSet.size === 0) this.missingOnly = false;
    },

    /** 状态筛选四值语义不变；切到任一状态 Tab 时退出独立的文件丢失筛选 */
    setFilter(filter: TaskFilter): void {
      this.filter = filter;
      this.missingOnly = false;
    },

    /** 独立开关「仅看文件已丢失」：与状态筛选互斥（开启时复位为 all） */
    toggleMissingOnly(): void {
      if (this.missingIdSet.size === 0) {
        this.missingOnly = false;
        return;
      }
      this.missingOnly = !this.missingOnly;
      if (this.missingOnly) this.filter = 'all';
    },

    /** Channel 4Hz 帧直写 store（节流在生产端，前端不做二次节流） */
    applyFrame(frame: ProgressFrame): void {
      this.frames[frame.taskId] = frame;
    },

    /** 清掉非下载态任务的陈旧帧（状态事件/刷新后调用） */
    pruneFrames(): void {
      for (const id of Object.keys(this.frames)) {
        const task = this.tasks.find((item) => item.id === id);
        if (!task || task.status !== 'downloading') delete this.frames[id];
      }
    },

    /**
     * 拉取列表。initial = 首屏（骨架屏 → 数据/错误）。
     * 每次调用都以新 Channel 注册进度订阅（ARCHITECTURE.md §3.3 替换式注册）。
     *
     * **增量合并，不整体替换**（2026-11 实测缺陷 3）：原实现 `this.tasks = await
     * listTasks(...)` 让每条任务都变成新对象，行组件被整体重建，用户看到列表反复
     * "闪一下"。现在按 id 就地 `Object.assign`，已存在的任务保留对象身份 → 行不重建，
     * 只有真正新增的 id 才需要播入场动画（由 TaskListView 的 seenIds 差集判定）。
     */
    async fetch(initial = false): Promise<void> {
      if (initial) this.loading = true;
      try {
        const incoming = await listTasks('all', (frame) => this.applyFrame(frame));
        this.tasks = mergeTasks(this.tasks, incoming).tasks;
        this.loadError = '';
        this.pruneFrames();
        // 只在成功分支递增：失败不触发检测（避免用陈旧 id 覆盖呈现态）
        this.fetchRevision += 1;
      } catch (e) {
        // 首屏失败 → 错误态；已有数据时静默保旧列表（下次事件/操作会重试）
        this.loadError = e instanceof Error ? e.message : String(e);
      }
      if (initial) this.loading = false;
    },

    async refresh(): Promise<void> {
      await this.fetch(false);
    },

    /**
     * task:state-changed 事件：本地即时置状态（不等拉取，UI 反馈无延迟）。
     *
     * **不再 refresh()**（2026-11 实测缺陷 3）：状态已本地 patch，再拉一次全量只会
     * 制造无意义的对象/数组替换。仅当本地没有这条记录（漏了 task:created 事件）时
     * 才兜底拉取一次。
     *
     * 既然不 refresh，原本由那次拉取顺带补上的字段必须在这里补齐（否则是静默缺失）：
     * - 离开下载态时把**最后一帧**的 downloadedBytes/totalBytes 回写到记录（帧随后被删）；
     * - 完成态用本地 now 落 updatedAt，否则行内「完成于」会停在上一次刷新的时间。
     */
    async onStateChanged(payload: StateChangedPayload): Promise<void> {
      const task = this.byId(payload.taskId);
      if (task == null) {
        await this.refresh();
        return;
      }
      const lastFrame = this.frames[payload.taskId];
      task.status = payload.to;
      // 不 refresh 就必须在这里同步错误字段：否则失败行会一直显示上一次的原因
      if (payload.to === 'failed') {
        if (payload.error != null) task.error = payload.error;
      } else {
        task.error = null;
      }
      if (payload.to !== 'downloading') {
        if (lastFrame != null) {
          task.downloadedBytes = lastFrame.downloadedBytes;
          if (lastFrame.totalBytes != null) task.totalBytes = lastFrame.totalBytes;
        }
        delete this.frames[payload.taskId];
      }
      if (payload.to === 'completed') task.updatedAt = Date.now();
    },

    /**
     * 单任务限速（bytesPerSec = null 表示不限速）。
     *
     * 成功后**立即本地 patch**，不做全量 refresh（2026-11 实测缺陷 1/2）：限速变更
     * 不触发任何 task:* 事件，原实现只 `await set_task_speed_limit` 就关菜单，用户
     * 得等下一次列表刷新才看到「限 X MB/s」，看起来像没生效；同时 `speedLimit`
     * 不更新会让再次打开输入框时残留上一次的 MB 数（实际已解除限速）。
     *
     * 语义硬约束：不限速写 `null`（不是 0 / undefined），下游 `!= null` 判定才正确。
     */
    async setTaskLimit(id: string, bytesPerSec: number | null): Promise<void> {
      await setTaskSpeedLimit(id, bytesPerSec);
      const task = this.byId(id);
      // 行由本列表渲染而来，正常情况下必然命中；未命中即无 UI 可更新，无需兜底刷新
      if (task != null) task.speedLimit = bytesPerSec;
    },

    async pause(id: string): Promise<void> {
      await pauseTask(id);
      await this.refresh();
    },

    async resume(id: string): Promise<void> {
      await resumeTask(id);
      await this.refresh();
    },

    async retry(id: string): Promise<void> {
      await retryTask(id);
      await this.refresh();
    },

    async remove(id: string, deleteFiles: boolean): Promise<void> {
      await removeTask(id, deleteFiles);
      delete this.frames[id];
      await this.refresh();
    },
  },
});
