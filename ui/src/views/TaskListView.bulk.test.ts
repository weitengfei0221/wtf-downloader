import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 静态护栏（DESIGN.md §2.9，2026-11 用户裁决「迅雷式多选」）：主视图把点击选择、
 * 右键菜单切换、删除语义、文件丢失呈现态接到正确位置。node 环境无法挂载 .vue，
 * 故沿用项目既有源码断言惯例（§9.1）：断言是「同一份语义只有一个实现 / 两套选中
 * 互不覆盖 / 旧复选框范式不得回潮」的结构保证，不是功能验收（GUI 点击另验）。
 */
const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/** 去掉注释再断言：源码里的「为什么不用」说明文字必须保留，不该被当成实现 */
const code = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const view = read('./TaskListView.vue');
const viewCode = code(view);
/** 删除流程已整段抽到 composable（2026-11-13 技术债清理），语义断言改盯这里 */
const removeFlow = read('../composables/useRemoveFlow.ts');
const removeFlowCode = code(removeFlow);
const row = read('../components/task/TaskRow.vue');
const rowCode = code(row);
const selection = read('../composables/useTaskSelection.ts');
const selectionCode = code(selection);
const singleMenu = read('../components/task/TaskMoreMenu.vue');
const contextMenu = read('../components/task/TaskContextMenu.vue');
const contextCode = code(contextMenu);
const bulk = read('../utils/bulk.ts');
const locales = read('../locales/zh-CN.ts');
const topbar = read('../components/AppTopbar.vue');
const confirmDialog = read('../components/ConfirmDialog.vue');
const barPath = fileURLToPath(new URL('../components/task/BulkActionBar.vue', import.meta.url));

describe('P0：批量条 / 复选框范式已整体移除（迅雷式多选）', () => {
  it('BulkActionBar.vue 整文件删除，视图不再引入或渲染它', () => {
    expect(existsSync(barPath)).toBe(false);
    expect(view).not.toContain('BulkActionBar');
    expect(viewCode).not.toMatch(/toggleAll|allVisibleSelected/);
  });

  it('TaskRow 无复选框 input / .row-check / checked prop / check emit', () => {
    expect(row).not.toContain('type="checkbox"');
    expect(row).not.toContain('row-check');
    expect(rowCode).not.toMatch(/checked\??:/);
    expect(rowCode).not.toContain("emit('check'");
    expect(rowCode).not.toMatch(/onCheck|selectAria/);
  });

  it('locales 不再保留批量条 / 复选框相关键', () => {
    expect(locales).not.toContain("'task.selectAria'");
    expect(locales).not.toContain("'bulk.barAria'");
    expect(locales).not.toContain("'bulk.selectAll'");
    expect(locales).not.toContain("'bulk.pause':");
    expect(locales).not.toContain("'bulk.clear':");
  });

  it('新多选菜单文案全部进 locales（组件禁裸字符串）', () => {
    for (const key of [
      'bulk.menuAria',
      'bulk.selected',
      'bulk.pauseAll',
      'bulk.resumeAll',
      'bulk.retryAll',
      'bulk.removeSelected',
      'bulk.removeTitle',
      'bulk.removeMessage',
      'bulk.removeMessageCompleted',
      'bulk.partialFailed',
    ]) {
      expect(locales).toContain(`'${key}'`);
    }
  });
});

describe('点击 / Ctrl / Shift / Ctrl+A 接线（选择集合始终从 visible 派生）', () => {
  it('选择集合来自 useTaskSelection(() => tasksStore.visible)', () => {
    expect(view).toContain('useTaskSelection(() => tasksStore.visible)');
    expect(view).toContain('selected: checkedTasks,');
  });

  it('高亮由 has(task.id) 驱动；焦点环仍由 selectedId / tabindex 驱动', () => {
    expect(view).toContain(':highlighted="has(task.id)"');
    expect(view).toContain('const selectedId = ref<string | null>(null)');
    expect(view).toContain('@selected="selectedId = task.id"');
    expect(view).toContain('rowTabIndex(task, index)');
    expect(row).toContain("'row-selected': highlighted");
    expect(row).toContain(':tabindex="tabindex ?? -1"');
  });

  it('左键清空只选该行并同步焦点行；Ctrl 切换；Shift 连选', () => {
    expect(view).toContain('@select="(e) => onRowSelect(task, e)"');
    expect(viewCode).toContain('if (e.ctrlKey || e.metaKey) toggleCheck(task.id, false)');
    expect(viewCode).toContain('else if (e.shiftKey) toggleCheck(task.id, true)');
    expect(viewCode).toContain('selectOnly(task.id); selectedId.value = task.id');
  });

  it('右键先按选择集合收敛；点击列表空白区清空选择', () => {
    expect(view).toContain('@context="prepareContext"');
    expect(selection).toContain('function prepareContext(id: string): void');
    expect(selection).toContain('if (!has(id)) selectOnly(id)');
    expect(view).toContain('@click.self="clearChecks"');
  });

  it('Ctrl+A 全选当前 visible，且文本输入控件内不拦截', () => {
    expect(selection).toContain('isA && (e.ctrlKey || e.metaKey)');
    expect(selection).toContain('isTextEntry(e.target)');
    expect(selection).toContain('hasOpenDialog()');
    expect(selection).toContain('e.preventDefault();');
    expect(selection).toContain('selectAll()');
    expect(selection).toContain("tag === 'INPUT'");
    expect(selection).toContain("tag === 'TEXTAREA'");
  });

  it('composable 不读写 selectedId / 入场动画；勾选不参与 :key 与 isNew', () => {
    expect(selectionCode).not.toContain('selectedId');
    expect(selectionCode).not.toContain('isNew');
    expect(selectionCode).not.toContain('enterIds');
    expect(selectionCode).not.toContain('row-enter');
    expect(view).toContain(':key="task.id"');
    expect(view).toContain(':is-new="enterIds.includes(task.id)"');
    expect(viewCode).not.toMatch(/:key="[^"]*(highlighted|fileMissing)/);
  });
});

describe('右键菜单：单选无「全部」，多选才有批量项', () => {
  it('单选 TaskMoreMenu 仍是 4 项，绝不出现任何「全部」/ bulk 键', () => {
    for (const item of ['more.openFile', 'more.openDir', 'more.taskLimit', 'more.remove']) {
      expect(singleMenu).toContain(`t('${item}')`);
    }
    expect(singleMenu).not.toContain('全部');
    expect(singleMenu).not.toContain("t('bulk.");
  });

  it('多选 TaskContextMenu 有只读提示 + 三个批量项 + 删除项', () => {
    expect(contextMenu).toContain("t('bulk.selected'");
    expect(contextMenu).toContain("'bulk.pauseAll'");
    expect(contextMenu).toContain("'bulk.resumeAll'");
    expect(contextMenu).toContain("'bulk.retryAll'");
    expect(contextMenu).toContain("t('bulk.removeSelected')");
    expect(contextMenu).toContain('role="menuitem"');
  });

  it('TaskRow 按 selectionCount 在两套菜单间切换，「更多」按钮保持单选', () => {
    expect(view).toContain(':selection-count="checkedTasks.length"');
    expect(view).toContain(':selected-tasks="checkedTasks"');
    expect(row).toContain('<TaskMoreMenu');
    expect(row).toContain('<TaskContextMenu');
    expect(row).toContain("menuTrigger.value === 'row' && (props.selectionCount ?? 0) > 1");
    expect(row).toContain("menuTrigger.value = 'more'");
  });

  it('右键锚点用鼠标 clientX/clientY（不改回 rect）；estimatedHeight 按项数动态算', () => {
    expect(row).toContain('menuPoint.value = { x: event.clientX, y: event.clientY }');
    expect(contextMenu).toContain('anchoredStyleAt(props.point');
    expect(contextMenu).toContain('estimatedHeight.value');
    expect(contextMenu).toContain('ACTIONS.length');
    expect(contextMenu).not.toContain('estimatedHeight: 148');
  });
});

describe('可用性判据与删除语义：唯一实现，不在组件里重写一遍', () => {
  it('三项可用性统一用 bulkTargetIds(kind, selected).length > 0，无可操作对象时 disabled', () => {
    for (const kind of ['pause', 'resume', 'retry']) {
      expect(contextMenu).toContain(`bulkTargetIds('${kind}', props.tasks).length > 0`);
    }
    expect(contextMenu).toContain(':disabled="busy || !can[action.kind]"');
    expect(contextCode).not.toMatch(/status === '(paused|downloading|failed)'/);
  });

  it('删除用 deleteFilesFromKey 单点映射，组件里不自写 with-files 判断', () => {
    expect(contextMenu).toContain('deleteFilesFromKey(key)');
    expect(contextCode).not.toContain("key === 'with-files'");
    expect(removeFlow).toContain('deleteFilesFromKey(key)');
    expect(removeFlowCode).not.toContain("key === 'with-files'");
    expect(bulk).toContain('export function deleteFilesFromKey(key: string): boolean');
  });

  it('确认框按状态派生：已完成三按钮（含「删除任务和文件」），未完成只有「删除」', () => {
    for (const key of ['cancel', 'task-only', 'with-files']) {
      expect(contextMenu).toContain(`key: '${key}'`);
    }
    // 未完成任务删完记录就没了，磁盘上只剩 .part（后端一律清），没有可选的文件
    expect(removeFlow).toContain("confirmTask.value?.status !== 'completed'");
    expect(removeFlow).toContain("{ key: 'remove', label: t('remove.confirm')");
    expect(removeFlow).toContain("{ key: 'with-files', label: t('remove.withFiles')");
    expect(removeFlow).toContain('remove.messageCompleted');
  });

  it('批量删除文案告知「只有选删除任务和文件才删文件」+ 删除成功后清理选择', () => {
    expect(contextMenu).toContain('hasCompleted.value');
    expect(contextMenu).toContain("t('bulk.removeMessageCompleted'");
    expect(locales).toContain('选「删除任务和文件」才会删除已完成任务的文件');
    expect(contextMenu).toContain("emit('removed', result.succeeded)");
    expect(view).toContain('@removed="removeIds"');
    expect(selection).toContain('function removeIds(ids: string[]): void');
  });

  /**
   * 2026-11-13 技术债护栏：删除流程曾被整段写回 view，把 TaskListView.vue 从 299 行
   * 顶到 337 行（超出 300 行门禁）。这里直接断言「视图不得再出现任何删除实现」，
   * 比只查「有没有第二个 ref」更硬——后者挡不住 `await tasksStore.remove(...)` 这种
   * 不带 ref 的内联重写，而内联重写正是本次把行数顶爆的那一类。
   */
  it('删除实现只存在于 useRemoveFlow：view 内零 tasksStore.remove / deleteFilesFromKey', () => {
    expect(removeFlowCode).toContain('await tasksStore.remove(');
    expect(removeFlowCode).toContain('deleteFilesFromKey(key)');
    expect(viewCode).not.toContain('tasksStore.remove(');
    expect(viewCode).not.toContain('deleteFilesFromKey');
    // 视图只做接线（拿到 requestRemove / confirmRemove 传给行与确认框）
    expect(viewCode).toContain('useRemoveFlow()');
    expect(viewCode).toContain(':actions="removeActions"');
    expect(viewCode).toContain('@select="confirmRemove"');
  });
});

describe('Esc 归属纪律：搜索框 / 弹窗 / 菜单先消费，不连带清空选择', () => {
  it('搜索框 Esc 先 stopPropagation 再清空并失焦', () => {
    const start = topbar.indexOf('function onSearchKeydown');
    const body = topbar.slice(start, topbar.indexOf('defineExpose(', start));
    expect(body).toContain('e.stopPropagation()');
    expect(body).toContain('tasksStore.search = ');
  });

  it('ConfirmDialog 与两个菜单的 Esc 各先 stopPropagation', () => {
    expect(confirmDialog).toContain('e.stopPropagation()');
    expect(singleMenu).toContain('e.stopPropagation();');
    expect(contextMenu).toContain('e.stopPropagation();');
  });

  it('useTaskSelection 的 Esc 只在 window 冒泡阶段清空（消费方先拦截）', () => {
    expect(selection).toContain("window.addEventListener('keydown', onWindowKeydown)");
    expect(selection).toContain("if (e.key === 'Escape' && checkedIds.value.size > 0) {");
  });
});

describe('文件丢失呈现态接线未丢（§2.10）', () => {
  it('视图仍传 missingIdSet 判据与独立筛选，空态退出走 setFilter 单点', () => {
    expect(view).toContain(':file-missing="tasksStore.missingIdSet.has(task.id)"');
    expect(view).toContain(':missing-only="tasksStore.missingOnly"');
    expect(view).toContain("tasksStore.setFilter('all')");
    expect(view).toContain('useMissingFileCheck()');
    expect(viewCode).not.toContain('missingFileIds');
  });

  it('TaskRow 徽标 + 整行降权 + fileMissing 透传行头与单选菜单', () => {
    expect(row).toContain("'row-file-missing': fileMissing");
    expect(row).toContain("t('task.fileMissing')");
    expect(row).toContain("import { Check, FileWarning } from '@lucide/vue'");
    expect(row).toContain(':file-missing="fileMissing" @action="onAction"');
    expect(row.match(/:file-missing="fileMissing"/g)).toHaveLength(2);
    expect(row).toMatch(/\.row-file-missing\s*\{[^}]*opacity:\s*0\.6/s);
    expect(singleMenu).toContain(':disabled="fileMissing"');
    expect(locales).toContain("'task.fileMissing': '文件已丢失'");
  });
});
