import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 静态护栏（DESIGN.md §2.10）：已完成任务文件丢失是「瞬时呈现态」——
 * 行内徽标 + 整行降权 + 禁用「打开文件」+ 保留「打开目录」+ 可单独筛选。
 * node 环境无法挂载 .vue，故按项目惯例对模板/样式做结构断言（§9.1）。
 */
const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const row = read('./TaskRow.vue');
const actions = read('./TaskActions.vue');
const menu = read('./TaskMoreMenu.vue');
const tabs = read('../../components/FilterTabs.vue');
const contextMenu = read('./TaskContextMenu.vue');
const locales = read('../../locales/zh-CN.ts');
const store = read('../../stores/tasks.ts');

/** 找包含某标记的唯一一行（模板里按钮各占一行，便于断言该行自身的属性） */
function lineWith(source: string, marker: string): string {
  const hit = source.split('\n').find((line) => line.includes(marker));
  if (hit == null) throw new Error(`未找到标记：${marker}`);
  return hit;
}

describe('TaskRow：徽标 + 整行降权 + 选择高亮', () => {
  it('row 同时绑定选择高亮与 fileMissing（两套状态互不覆盖）', () => {
    expect(row).toContain("'row-selected': highlighted");
    expect(row).toContain("'row-file-missing': fileMissing");
    expect(row).toContain("'row-enter': isNew");
  });

  it('无复选框：选择由行点击 / Ctrl / Shift 接线产生', () => {
    expect(row).not.toContain('type="checkbox"');
    expect(row).not.toContain('row-check');
    expect(row).toContain('@click="onRowClick"');
    expect(row).toContain("emit('select', event)");
    expect(row).toContain('@contextmenu.prevent="onContextMenu($event)"');
    expect(row).toContain("emit('context', props.task.id)");
  });

  it('整行降权只用统一 opacity，不写死色值', () => {
    expect(row).toMatch(/\.row-file-missing\s*\{[^}]*opacity:\s*0\.6/s);
    expect(row).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(row).not.toMatch(/rgba?\(/);
  });

  it('行内徽标文案取自 locales，图标是 @lucide/vue 的 FileWarning', () => {
    expect(row).toContain('v-if="fileMissing" class="missing-badge"');
    expect(row).toContain("t('task.fileMissing')");
    expect(row).toContain("import { Check, FileWarning } from '@lucide/vue'");
    expect(row).toContain('<FileWarning class="icon-16" aria-hidden="true" />');
  });

  it('选中对号：仅 highlighted 时渲染 16px Check，固定槽常驻、非复选框', () => {
    expect(row).toContain('<span class="select-mark" aria-hidden="true">');
    expect(row).toContain('<Check v-if="highlighted" class="icon-16" />');
    // 固定前导槽：未选中时同样占位 → 文件名不跳；pointer-events:none → 不可交互、不是 checkbox
    expect(row).toMatch(/\.select-mark\s*\{[^}]*width:\s*16px/s);
    expect(row).toMatch(/\.select-mark\s*\{[^}]*pointer-events:\s*none/s);
    expect(row).not.toContain('type="checkbox"');
  });

  it('选中态：只保留 --primary-soft 底，无 inset 竖条 / 描边框，三态压过 hover，焦点环不丢', () => {
    expect(row).toContain('.row.row-selected,');
    expect(row).toContain('.row.row-selected:hover,');
    expect(row).toContain('.row.row-selected:focus-within {');
    expect(row).toMatch(/\.row\.row-selected:hover,\s*\n\.row\.row-selected:focus-within\s*\{[^}]*background:\s*var\(--primary-soft\)/s);
    // 第九轮用户裁决：状态指示只显示对号，左边的框框（inset 竖条）坚决不要
    expect(row).not.toContain('inset 3px 0 0 var(--primary-bg)');
    expect(row).toContain('.row.row-selected:focus-visible');
    expect(row).toContain('box-shadow: var(--focus-ring)');
    // 颜色只用 token：无硬编码 hex / RGB 函数
    expect(row).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(row).not.toMatch(/rgba?\(/);
  });

  it('徽标配色只用 token（--warn / --warn-soft / --radius-full）', () => {
    expect(row).toContain('color: var(--warn)');
    expect(row).toContain('background: var(--warn-soft)');
    expect(row).toContain('border-radius: var(--radius-full)');
  });

  it('行键盘事件交由列表分发，Esc 不在行内被吞（window 级监听清空选择）', () => {
    expect(row).toContain('@keydown="emit(\'key\', $event)"');
    expect(row).not.toContain('onCheckKeydown');
    expect(row).not.toContain('stopPropagation');
  });

  it('fileMissing 透传到行头与更多菜单（禁用「打开文件」的两条入口）', () => {
    expect(row.match(/:file-missing="fileMissing"/g)).toHaveLength(2);
    expect(row).toContain(':file-missing="fileMissing" @action="onAction"');
  });
});

describe('TaskActions / TaskMoreMenu：禁用打开文件、保留打开目录', () => {
  it('行内操作组的 open-file 按钮 disabled=fileMissing', () => {
    expect(lineWith(actions, "emitAction('open-file'")).toContain(':disabled="fileMissing"');
  });

  it('行内操作组的 open-dir 按钮不带 disabled（用户仍可去看目录）', () => {
    expect(lineWith(actions, "emitAction('open-dir'")).not.toContain(':disabled');
  });

  it('更多菜单的 open-file 项 disabled=fileMissing', () => {
    expect(lineWith(menu, "emit('action', 'open-file')")).toContain(':disabled="fileMissing"');
  });

  it('更多菜单的 open-dir 项不带 disabled', () => {
    expect(lineWith(menu, "emit('action', 'open-dir')")).not.toContain(':disabled');
  });

  it('菜单 Esc 先 stopPropagation 再关闭，不连带清空批量勾选', () => {
    expect(menu).toContain('e.stopPropagation();');
    expect(menu).toContain("emit('close')");
  });
});

describe('FilterTabs：独立筛选开关，不破坏四值 TaskFilter', () => {
  it('role=switch 的独立开关只在有缺失时出现', () => {
    expect(tabs).toContain('role="switch"');
    expect(tabs).toContain('v-if="store.missingCount > 0"');
    expect(tabs).toContain('@click="store.toggleMissingOnly()"');
    expect(tabs).toContain(':aria-checked="store.missingOnly"');
  });

  it('不引入第五个 TaskFilter 值，四个状态 Tab 原样保留', () => {
    for (const name of ['all', 'downloading', 'completed', 'failed']) {
      expect(tabs).toContain(`key: '${name}' as TaskFilter`);
    }
    expect(tabs).not.toContain("'missing' as TaskFilter");
  });

  it('切状态 Tab 走 setFilter 单点（顺带退出独立筛选）', () => {
    expect(tabs).toContain('@click="store.setFilter(tab.key)"');
  });
});

describe('文案与批量删除 AC-13', () => {
  it('新增文案键全部进 locales（组件禁裸字符串）', () => {
    for (const key of [
      'filter.missing',
      'filter.missingAria',
      'empty.missingTitle',
      'empty.missingSub',
      'task.fileMissing',
      'bulk.menuAria',
      'bulk.selected',
      'bulk.pauseAll',
      'bulk.resumeAll',
      'bulk.retryAll',
      'bulk.removeSelected',
      'bulk.partialFailed',
      'bulk.removeMessage',
      'bulk.removeMessageCompleted',
    ]) {
      expect(locales).toContain(`'${key}'`);
    }
  });

  it('「文件已丢失」徽标文案明确，且呈现态入口绝不删任务/改状态/自动清理记录', () => {
    expect(locales).toContain("'task.fileMissing': '文件已丢失'");
    const start = store.indexOf('    setMissingFileIds(');
    const body = store.slice(start, store.indexOf('    setFilter(', start));
    expect(body).not.toContain('removeTask');
    expect(body).not.toContain('this.remove(');
    expect(body).not.toContain('this.tasks =');
    expect(body).not.toContain('status =');
  });

  it('含已完成任务的批量删除文案说明「只有选删除任务和文件才删文件」', () => {
    expect(locales).toContain('选「删除任务和文件」才会删除已完成任务的文件');
    expect(contextMenu).toContain('hasCompleted.value');
    expect(contextMenu).toContain("t('bulk.removeMessageCompleted'");
  });

  it('多选菜单删除是三按钮 ConfirmDialog（取消 / 仅删除任务 / 删除任务和文件）', () => {
    expect(contextMenu).toContain("key: 'cancel'");
    expect(contextMenu).toContain("key: 'task-only'");
    expect(contextMenu).toContain("key: 'with-files'");
    expect(contextMenu).toContain('deleteFilesFromKey(key)');
  });
});
