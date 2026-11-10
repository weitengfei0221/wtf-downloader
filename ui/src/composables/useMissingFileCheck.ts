import { onBeforeUnmount, onMounted, watch } from 'vue';
import { checkFiles } from '@/api/tasks';
import { useTasksStore } from '@/stores/tasks';

/**
 * 文件丢失检测的执行器（DESIGN.md §2.10）。抽成纯工厂便于在 node 环境做行为单测，
 * 组件里的 `useMissingFileCheck()` 只负责接线（fetch 成功 / window focus）。
 *
 * 两条硬约束：
 * - **失败只留一条 warn、不污染呈现态**：`check` reject 时 `console.warn` 一次
 *   （与 `api/notification.ts` 同款，仅 dev 排查用），随后直接返回——绝不写
 *   `missingFileIds`、不清空上次结果、不改任务状态、不落库、不弹 toast。
 *   `check_files` 是需求 2 的唯一数据源，命令名写错/后端没注册/参数形状不对时
 *   「功能做了但永远不生效且零报错」正是要消灭的静默失效家族（DESIGN.md §2.10）。
 * - **只认最后一次结果**：并发的 focus / fetch 重查以序号收敛，旧结果不得覆盖新结果。
 */
export interface MissingFileCheckerDeps {
  taskIds(): string[];
  check(ids: string[]): Promise<unknown>;
  apply(ids: unknown): void;
}

export function createMissingFileChecker(deps: MissingFileCheckerDeps) {
  let seq = 0;
  let disposed = false;

  async function check(): Promise<void> {
    const mine = ++seq;
    let result: unknown;
    try {
      result = await deps.check(deps.taskIds());
    } catch (e) {
      // 唯一数据源失败必须留痕，否则「功能做了但永远不生效」无任何报错。
      // 不弹 toast 打扰用户；不清空已有结果（保留上一次呈现态比清零更稳）。
      console.warn('[check_files] check failed:', e);
      return;
    }
    if (disposed || mine !== seq) return;
    deps.apply(result);
  }

  return {
    check,
    dispose(): void {
      disposed = true;
    },
  };
}

/**
 * 检测接线：**只在 fetch() 成功后（fetchRevision 递增）与 window focus 时查**。
 * 不做轮询、不挂 4Hz 进度帧（`applyFrame` 不改 fetchRevision）。
 * `focus` 覆盖最典型路径：切到资源管理器删掉文件再切回应用。
 */
export function useMissingFileCheck(): void {
  const tasksStore = useTasksStore();
  const checker = createMissingFileChecker({
    taskIds: () => tasksStore.tasks.map((task) => task.id),
    check: checkFiles,
    apply: (ids) => tasksStore.setMissingFileIds(ids),
  });

  // fetch 成功分支才递增此计数：加载失败不拿陈旧 id 探测
  watch(() => tasksStore.fetchRevision, () => {
    void checker.check();
  });

  function onFocus(): void {
    void checker.check();
  }
  onMounted(() => window.addEventListener('focus', onFocus));
  onBeforeUnmount(() => {
    checker.dispose();
    window.removeEventListener('focus', onFocus);
  });
}
