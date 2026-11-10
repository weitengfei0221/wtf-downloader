import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 静态护栏（DESIGN.md §3.1，2026-11 用户实测）：弹窗头尾固定，滚动条只属于中间
 * 内容区。node 环境无法挂载 .vue，故按项目惯例（§9.1）断言结构，不是视觉验收。
 */
const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const shell = read('./ModalShell.vue');
const addDialog = read('./AddTaskDialog.vue');
const addCss = read('./add-task-dialog.css');
const confirm = read('./ConfirmDialog.vue');
const button = read('./BaseButton.vue');
const dirRow = read('./add/AddDirRow.vue');
const advanced = read('./add/AddAdvancedOptions.vue');

const blockOf = (source: string, selector: string): string => {
  const start = source.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('}', start));
};

describe('ModalShell：三段式 flex，唯一滚动容器是 .body', () => {
  it('.panel 是 flex 列、overflow:hidden、max-height 80vh', () => {
    const panel = blockOf(shell, '.panel');
    expect(panel).toContain('display: flex');
    expect(panel).toContain('flex-direction: column');
    expect(panel).toContain('max-height: 80vh');
    expect(panel).toContain('overflow: hidden');
    expect(panel).not.toContain('overflow-y: auto');
  });

  it('.head 固定顶部（flex:none）', () => {
    expect(blockOf(shell, '.head')).toContain('flex: none');
  });

  it('.body 是唯一 overflow-y:auto 容器，且 flex:1 + min-height:0', () => {
    const body = blockOf(shell, '.body');
    expect(body).toContain('flex: 1');
    expect(body).toContain('min-height: 0');
    expect(body).toContain('overflow-y: auto');
    expect(shell.match(/overflow-y:\s*auto/g)).toHaveLength(1);
  });

  it('可选具名 footer 插槽固定底部，且只在有内容时渲染', () => {
    expect(blockOf(shell, '.foot')).toContain('flex: none');
    expect(shell).toContain('v-if="$slots.footer" class="foot"');
    expect(shell).toContain('<slot name="footer" />');
    expect(shell).toContain('<div class="body"><slot /></div>');
  });

  it('焦点困环 / Esc / 遮罩点击 / 进入动画 / z-index 一律不变', () => {
    expect(shell).toContain('onDialogKeydown(panel.value, e, requestClose)');
    expect(shell).toContain("focusFirst(panel.value, 'textarea, input')");
    expect(shell).toContain('@mousedown.self="requestClose"');
    expect(shell).toContain('animation: panel-in var(--motion-base) var(--ease-standard)');
    expect(shell).toContain('z-index: 1200');
  });
});

describe('AddTaskDialog：footer 移到插槽，提交按钮跨插槽关联 form', () => {
  it('form 有 id，且只有一份 submit 实现（Enter 与点击共用 @submit.prevent）', () => {
    expect(addDialog).toContain('id="add-task-form" class="form" @submit.prevent="submit"');
    expect(addDialog.match(/async function submit\(/g)).toHaveLength(1);
    // 「仍然添加」是唯一的直接调用点，且与 form submit 共用同一个函数（不是第二份实现）
    expect(addDialog.match(/@click="submit"/g)).toHaveLength(1);
  });

  it('提交按钮 type=submit 且 form=add-task-form（跨插槽提交）', () => {
    expect(addDialog).toContain('type="submit"');
    expect(addDialog).toContain('form="add-task-form"');
    expect(addDialog).toContain('<template #footer>');
    expect(addDialog.indexOf('</form>')).toBeLessThan(addDialog.indexOf('<template #footer>'));
  });

  it('footer 不再在 form 内；BaseButton 把 form 显式绑定到根 button', () => {
    const formBody = addDialog.slice(
      addDialog.indexOf('<form id="add-task-form"'),
      addDialog.indexOf('</form>'),
    );
    expect(formBody).not.toContain('class="footer"');
    expect(button).toContain(':form="form"');
    expect(button).toContain('form?: string');
    // 模板里没有顶层注释节点（否则编译成 Fragment 根，透传属性会被静默吞掉）
    const templateBlock = button.slice(button.indexOf('<template>'), button.indexOf('</template>'));
    expect(templateBlock).not.toContain('<!--');
    expect(templateBlock).toContain('<button');
  });

  it('移到插槽后间距不丢：分隔线 / padding-top / 补偿后的 margin-top', () => {
    const footer = blockOf(addCss, '.footer');
    expect(footer).toContain('border-top: 1px solid var(--border-soft)');
    expect(footer).toContain('padding-top: var(--space-4)');
    expect(footer).toContain('margin-top: var(--space-6)');
  });
});

describe('info-row / AddDirRow 不被遮挡、不被裁半行（2026-11 截图补充自检）', () => {
  it('.info-row 与「保存到」之间靠 form gap 分隔，无绝对定位 / 负 margin 重叠', () => {
    const form = blockOf(addCss, '.form');
    const info = blockOf(addCss, '.info-row');
    expect(form).toContain('display: flex');
    expect(form).toContain('flex-direction: column');
    expect(form).toContain('gap: var(--space-4)');
    expect(info).toContain('display: flex');
    // 弹窗样式链里不允许 absolute/fixed + 负 margin（会把「保存到」压到 info-row 上）
    for (const source of [addCss, dirRow]) {
      expect(source).not.toMatch(/position:\s*(absolute|fixed)/);
      expect(source).not.toMatch(/margin[a-z-]*:\s*-/);
    }
  });

  it('已知例外只有 range 滑块 thumb 的 -6px（在表单控件内部，不影响行间布局）', () => {
    const neg = [...advanced.matchAll(/margin[a-z-]*:\s*-\d+px/g)];
    expect(neg).toHaveLength(1);
    expect(advanced.indexOf('::-webkit-slider-thumb')).toBeLessThan(advanced.indexOf('margin-top: -6px'));
    expect(advanced).not.toMatch(/position:\s*(absolute|fixed)/);
  });

  it('头/尾固定且不与滚动区重叠：.head/.foot flex:none，.body 是唯一滚动容器', () => {
    expect(blockOf(shell, '.head')).toContain('flex: none');
    expect(blockOf(shell, '.foot')).toContain('flex: none');
    expect(blockOf(shell, '.body')).toContain('overflow-y: auto');
    expect(blockOf(shell, '.panel')).toContain('overflow: hidden');
    expect(shell.match(/overflow-y:\s*auto/g)).toHaveLength(1);
  });
});

describe('ConfirmDialog：同步移到 footer 插槽，短内容不出现滚动条', () => {
  it('footer 在 #footer 插槽内，message 仍在默认插槽', () => {
    expect(confirm).toContain('<template #footer>');
    expect(confirm.indexOf('<p class="message">')).toBeLessThan(confirm.indexOf('<template #footer>'));
    expect(confirm.indexOf('<footer class="footer">')).toBeGreaterThan(confirm.indexOf('<template #footer>'));
  });

  it('正文与按钮区间距保持（message margin-bottom 24px）', () => {
    expect(confirm).toContain('margin-bottom: var(--space-6)');
  });
});
