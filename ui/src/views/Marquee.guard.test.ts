import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 第七轮实测反馈的静态护栏（DESIGN.md §9.1）：node 环境无法挂载 .vue / 真实拖框，
 * 结构与接线用源码断言守住；交互行为由 useMarqueeSelection.test.ts 的纯状态机用例证明。
 */
const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/** 去掉注释再断言：说明"为什么不用"的文字不该被当成实现 */
const code = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const view = read('./TaskListView.vue');
const viewCode = code(view);
const row = read('../components/task/TaskRow.vue');
const listCss = read('./task-list-view.css');
const baseCss = read('../styles/base.css');
const addDialog = read('../components/AddTaskDialog.vue');
const addCss = read('../components/add-task-dialog.css');
const marqueeBox = read('../components/task/MarqueeBox.vue');
const marqueeLayer = read('../components/task/MarqueeLayer.vue');
const machine = read('../composables/useMarqueeSelection.ts');
const machineCode = code(machine);
const locales = read('../locales/zh-CN.ts');
const filterTabs = read('../components/FilterTabs.vue');

/** 取某个 CSS 规则块（到第一个 } 为止） */
const blockOf = (source: string, selector: string): string => {
  const start = source.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('}', start));
};

describe('项 1：footer 单行三元素，form 跨插槽关联未断', () => {
  it('DOM 顺序 = parallel-hint → 取消 → 开始下载，三者是同一 footer 的直接兄弟', () => {
    const footerStart = addDialog.indexOf('<footer class="footer">');
    const footerEnd = addDialog.indexOf('</footer>', footerStart);
    const footer = addDialog.slice(footerStart, footerEnd);
    expect(footer).toContain('class="footer"');
    const hintAt = footer.indexOf('class="parallel-hint"');
    const cancelAt = footer.indexOf("t('common.cancel')");
    const submitAt = footer.indexOf('form="add-task-form"');
    expect(hintAt).toBeGreaterThan(-1);
    expect(hintAt).toBeLessThan(cancelAt);
    expect(cancelAt).toBeLessThan(submitAt);
    // 没有 .footer-right 包裹层（原来的两行 column 结构已彻底移除，不留死样式）
    expect(footer).not.toContain('footer-right');
  });

  it('CSS：footer 是单行 flex、align-items:center、justify-content:flex-end；hint 用 margin-right:auto 顶到最左', () => {
    const footer = blockOf(addCss, '.footer');
    expect(footer).toContain('display: flex');
    expect(footer).toContain('align-items: center');
    expect(footer).toContain('justify-content: flex-end');
    expect(footer).not.toContain('align-items: flex-end');
    expect(footer).not.toContain('justify-content: space-between');
    expect(blockOf(addCss, '.parallel-hint')).toContain('margin-right: auto');
    expect(addCss).not.toContain('.footer-right');
  });

  it('间距观感不变：border-top / padding-top / margin-top 三行原样保留', () => {
    const footer = blockOf(addCss, '.footer');
    expect(footer).toContain('border-top: 1px solid var(--border-soft)');
    expect(footer).toContain('padding-top: var(--space-4)');
    expect(footer).toContain('margin-top: var(--space-6)');
  });

  it('form id 与提交按钮跨插槽关联不变，全文件只有一份 submit 实现', () => {
    expect(addDialog).toContain('id="add-task-form" class="form" @submit.prevent="submit"');
    expect(addDialog).toContain('type="submit"');
    expect(addDialog).toContain('form="add-task-form"');
    expect(addDialog.match(/async function submit\(/g)).toHaveLength(1);
    expect(addDialog.match(/@click="submit"/g)).toHaveLength(1);
    expect(addDialog.indexOf('</form>')).toBeLessThan(addDialog.indexOf('<template #footer>'));
    // hint 不存在时（多 URL / 未探测）两按钮仍靠右：v-if 挂在 hint 上，footer 自身常驻
    expect(addDialog).toContain('<span v-if="parallelHint" class="parallel-hint">');
  });
});

describe('项 4：菜单文案「任务限速」去掉省略号', () => {
  it('locales 值就是「任务限速」，不含省略号；其它文案的省略号不受影响', () => {
    expect(locales).toContain("'more.taskLimit': '任务限速'");
    expect(locales).not.toContain("'more.taskLimit': '任务限速…'");
    expect(locales).toContain("'bulk.removeSelected': '删除选中任务…'");
  });
});

describe('项 5：禁文本选择（Shift 连选 / 拖框前置条件）', () => {
  it('.row 与 .list 都声明 user-select:none', () => {
    expect(blockOf(row, '.row')).toContain('user-select: none');
    expect(blockOf(listCss, '.list')).toContain('user-select: none');
  });

  it('input / textarea 用 user-select:text 兜底，不误伤限速输入与搜索框', () => {
    expect(baseCss).toMatch(/input,\s*\ntextarea\s*\{[^}]*user-select:\s*text/s);
  });
});

describe('项 6：下载中置顶且为默认视图', () => {
  it('FilterTabs 顺序 downloading → all → completed → failed', () => {
    const markers = ["key: 'downloading'", "key: 'all'", "key: 'completed'", "key: 'failed'"];
    const positions = markers.map((m) => filterTabs.indexOf(m));
    expect(positions.every((p) => p > -1)).toBe(true);
    expect(positions[0]).toBeLessThan(positions[1]!);
    expect(positions[1]).toBeLessThan(positions[2]!);
    expect(positions[2]).toBeLessThan(positions[3]!);
  });

  it('store 默认 filter 是 downloading；viewAll 仍回 all', () => {
    expect(read('../stores/tasks.ts')).toContain("filter: 'downloading' as TaskFilter");
    expect(view).toContain("tasksStore.setFilter('all')");
  });
});

describe('项 2+3：选中态可辨标识 + 对号', () => {
  it('对号只在 highlighted 时渲染，来自锁定的 @lucide/vue，固定槽常驻', () => {
    expect(row).toContain("import { Check, FileWarning } from '@lucide/vue'");
    expect(row).toContain('<Check v-if="highlighted" class="icon-16" />');
    expect(row).toContain('<span class="select-mark" aria-hidden="true">');
    expect(blockOf(row, '.select-mark')).toContain('width: 16px');
    expect(blockOf(row, '.select-mark')).toContain('pointer-events: none');
    // 不是复选框、不可交互
    expect(row).not.toContain('type="checkbox"');
    expect(row).not.toContain('row-check');
  });

  it('选中态只保留 --primary-soft 整行底色，无任何竖条 / 描边框（第九轮裁决）', () => {
    const selected = row.slice(row.indexOf('.row.row-selected,'), row.indexOf('.row:focus-visible'));
    expect(selected).toContain('background: var(--primary-soft)'); // 底色要留
    expect(selected).not.toContain('inset'); // 左侧竖条已整条删除
    expect(selected).not.toContain('box-shadow');
    expect(selected).not.toContain('border-left');
  });

  it('.row-selected / :hover / :focus-within 三态齐全且压过普通 hover，焦点环不丢', () => {
    expect(row).toContain('.row.row-selected,');
    expect(row).toContain('.row.row-selected:hover,');
    expect(row).toContain('.row.row-selected:focus-within {');
    expect(row.indexOf('.row:hover,')).toBeLessThan(row.indexOf('.row.row-selected,'));
    expect(row).toContain('.row.row-selected:focus-visible');
    expect(row).toContain('box-shadow: var(--focus-ring)');
    // 焦点态不再把竖条与焦点环叠在一起
    const focusRule = row.slice(row.indexOf('.row.row-selected:focus-visible'), row.indexOf('}', row.indexOf('.row.row-selected:focus-visible')));
    expect(focusRule).not.toContain('inset');
    expect(focusRule).toContain('box-shadow: var(--focus-ring)');
  });

  it('深浅两套主题都只用 token，无硬编码色值 / RGB 函数 / emoji', () => {
    for (const source of [row, marqueeBox, addCss, listCss]) {
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source).not.toMatch(/rgba?\(/);
      expect(source).not.toMatch(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u);
    }
  });
});

describe('项 7：框选 composable + 渲染组件接线', () => {
  it('TaskListView 只做接线（3 行），逻辑全在新文件', () => {
    expect(view).toContain("import MarqueeLayer from '@/components/task/MarqueeLayer.vue'");
    expect(view).toContain('<MarqueeLayer :list-el="listEl" :visible="visible" @commit="selectIds" />');
    expect(view).toContain('selectIds,');
    // 既有的空白点击清空语义保留（靠 capture 吞掉拖框后的 click，而不是删掉它）
    expect(view).toContain('@click.self="clearChecks"');
    // 接线之外没有把框选状态机塞进主视图（去注释后不该出现 mousedown 监听 / 阈值常量）
    expect(viewCode).not.toContain('mousedown');
    expect(viewCode).not.toContain('MARQUEE_THRESHOLD');
    expect(viewCode).not.toContain('getBoundingClientRect');
  });

  it('MarqueeLayer 把 composable 的 box 交给 MarqueeBox，commit 事件回传 selectIds', () => {
    expect(marqueeLayer).toContain('useMarqueeSelection(');
    expect(marqueeLayer).toContain('<MarqueeBox :box="box" />');
    expect(marqueeLayer).toContain("const emit = defineEmits<{ commit: [ids: string[], additive: boolean] }>()");
    expect(marqueeBox).toContain('defineProps<{ box: Rect | null }>()');
  });

  it('命中判定用 getBoundingClientRect + 视口坐标，目标限当前 visible', () => {
    expect(machineCode).toContain('getBoundingClientRect()');
    expect(machineCode).toContain("querySelectorAll<HTMLElement>('[data-task-id]')");
    expect(machineCode).toContain('new Set(options.visible().map((task) => task.id))');
    expect(machineCode).toContain('visibleIds.has(row.id)');
  });

  it('仅列表空白（target === 容器）启动，行上按下不劫持', () => {
    expect(machineCode).toContain('event.target !== el');
    expect(machineCode).toContain("event.button !== 0");
  });

  it('拖框后的 click 在 window capture 阶段被标志位吞掉', () => {
    expect(machineCode).toContain("window.addEventListener('click', onClick, true)");
    expect(machineCode).toContain('suppressNextClick = true');
    expect(machineCode).toContain('event.stopPropagation()');
  });

  it('阈值 / 追加 / 替换 / Esc / 失焦 / 生命周期注销都在状态机里', () => {
    expect(machineCode).toContain('MARQUEE_THRESHOLD = 4');
    expect(machineCode).toContain('Math.hypot');
    expect(machineCode).toContain('event.ctrlKey || event.shiftKey || event.metaKey');
    expect(machineCode).toContain("event.key === 'Escape'");
    expect(machineCode).toContain("window.addEventListener('blur', onBlur)");
    expect(machineCode).toContain('onBeforeUnmount(');
  });

  it('选区矩形只用 token：主色描边 + --primary-soft 底 + pointer-events:none', () => {
    expect(marqueeBox).toContain('border: 1px solid var(--primary-bg)');
    expect(marqueeBox).toContain('background: var(--primary-soft)');
    expect(marqueeBox).toContain('pointer-events: none');
    expect(marqueeBox).toContain('position: fixed');
  });
});
