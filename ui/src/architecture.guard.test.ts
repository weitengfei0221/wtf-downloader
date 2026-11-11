import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 全仓 P0 护栏（DESIGN.md §0 / §9.1）：把「交付前扫描」固化成用例，
 * 免得每次靠人记得跑 grep。三条：零 emoji 图标、零硬编码颜色、
 * 仅 src/api/ 可直连 Tauri 的 IPC 包。
 */
const SRC = fileURLToPath(new URL('.', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (f: string): string => relative(SRC, f).replace(/\\/g, '/');
const sources = walk(SRC)
  .filter((f) => /\.(vue|ts|css|js|jsx)$/.test(f))
  .map((f) => ({ path: rel(f), text: readFileSync(f, 'utf8') }));

const EMOJI = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
// #fff / #000 是 P0 明确允许的例外；Token 源文件 design-tokens.css 是唯一色值源
const HEX = /#(?!fff\b|ffffff\b|000\b|000000\b)[0-9a-fA-F]{3,8}\b/i;
const RGB = /rgba?\(/;
// 拼出 IPC 包名，避免本护栏文件自身包含该字面量而被自己判为违规
const NEEDLE = ['@tauri', 'apps/api'].join('-');
// 第十轮：更新机制只引入 updater 一个插件包，同样只允许 api/ 层直接 import。
// 项目总监裁决：不引入任何重启类插件（Windows 安装阶段应用自动退出，relaunch 不可达）。
const PLUGIN_NEEDLES = [
  ['@tauri', 'apps/plugin-updater'].join('-'),
  ['@tauri', 'apps/plugin-dialog'].join('-'),
  ['@tauri', 'apps/plugin-clipboard-manager'].join('-'),
];

describe('扫描分母有效（非空集，防止空集假通过）', () => {
  it('确实扫到了源码文件', () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(sources.some((s) => s.path.endsWith('.vue'))).toBe(true);
    expect(sources.some((s) => s.path.endsWith('.ts'))).toBe(true);
  });
});

describe('P0-1：零 emoji 作功能图标', () => {
  it('所有 .vue/.ts/.css 文件都不含 emoji 码点', () => {
    const hits = sources.filter((s) => EMOJI.test(s.text)).map((s) => s.path);
    expect(hits).toEqual([]);
  });
});

describe('P0-2：零硬编码颜色（只用 token）', () => {
  it('除 design-tokens.css 外无 hex 字面量', () => {
    const hits = sources
      .filter((s) => s.path !== 'styles/design-tokens.css')
      .filter((s) => HEX.test(s.text))
      .map((s) => s.path);
    expect(hits).toEqual([]);
  });

  it('除 design-tokens.css 外无 RGB 函数字面量', () => {
    const hits = sources
      .filter((s) => s.path !== 'styles/design-tokens.css')
      .filter((s) => RGB.test(s.text))
      .map((s) => s.path);
    expect(hits).toEqual([]);
  });
});

describe('分层：仅 src/api/ 可直连 Tauri IPC 包', () => {
  it('组件 / store / composable / view 层零直连', () => {
    const hits = sources
      .filter((s) => !s.path.startsWith('api/'))
      .filter((s) => s.text.includes(NEEDLE))
      .map((s) => s.path);
    expect(hits).toEqual([]);
  });

  it('api/ 层确实存在直连（证明这条护栏有判别力，不是恒成立）', () => {
    expect(sources.some((s) => s.path.startsWith('api/') && s.text.includes(NEEDLE))).toBe(true);
  });

  it('Tauri 插件包（updater / dialog / clipboard）也只在 api/ 层直连', () => {
    const hits = sources
      .filter((s) => !s.path.startsWith('api/'))
      .filter((s) => PLUGIN_NEEDLES.some((needle) => s.text.includes(needle)))
      .map((s) => s.path);
    expect(hits).toEqual([]);
  });

  it('api/ 层确实直连了 updater / dialog / clipboard 插件（证明这条护栏有判别力）', () => {
    const apiText = sources
      .filter((s) => s.path.startsWith('api/'))
      .map((s) => s.text)
      .join('\n');
    expect(apiText).toContain(PLUGIN_NEEDLES[0]);
    expect(apiText).toContain(PLUGIN_NEEDLES[1]);
    expect(apiText).toContain(PLUGIN_NEEDLES[2]);
  });
});

/** 规则体切片：从 selector（含多选择器规则的起始标记）到其后第一个 `}`，避免整文件误伤。 */
function blockFrom(source: string, startMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('}', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

const sourceOf = (path: string): string => {
  const hit = sources.find((s) => s.path === path);
  expect(hit, `未扫到 ${path}`).toBeDefined();
  return hit!.text;
};

/*
 * 2026-11 第九轮用户裁决（写进 P0 约束，坚决不要）：
 * 「选中时只显示对号，不要这个左边的框框，这个就是 ai 味道」。
 * 状态指示只允许语义图标本身，禁止为选中 / 状态标记套任何装饰性边框、描边胶囊、
 * 左侧竖条、发光底、渐变底——这类装饰是 AI 模板味。以下断言按规则体切片守死，
 * 不用整文件 not.toContain（会误伤 badge / 输入框等合法的边框与底色）。
 */
describe('P0-3：状态指示不得套装饰性边框 / 竖条（第九轮裁决）', () => {
  const taskRow = sourceOf('components/task/TaskRow.vue');

  it('.row-selected 三态规则内不含 inset / 竖条 / box-shadow 描边，只留底色', () => {
    const selected = blockFrom(taskRow, '.row.row-selected,');
    expect(selected).toContain('background: var(--primary-soft)');
    expect(selected).not.toContain('inset');
    expect(selected).not.toContain('box-shadow');
    expect(selected).not.toContain('border-left');
  });

  it('选中行焦点态只保留 --focus-ring，不再叠加竖条', () => {
    const focus = blockFrom(taskRow, '.row.row-selected:focus-visible');
    expect(focus).toContain('box-shadow: var(--focus-ring)');
    expect(focus).not.toContain('inset');
  });

  it('.select-mark 规则体内不含任何会形成「框」的声明', () => {
    const mark = blockFrom(taskRow, '.select-mark {');
    for (const banned of [
      'border',
      'border-radius',
      'background',
      'box-shadow',
      'outline',
      'padding',
    ]) {
      expect(mark, `.select-mark 不应出现 ${banned}`).not.toContain(banned);
    }
    // 纯图标仍然完整：固定槽 + 不可交互
    expect(mark).toContain('width: 16px');
    expect(mark).toContain('pointer-events: none');
  });

  it('只显示对号：Check 的 v-if="highlighted" 渲染条件仍在（没被一并删掉）', () => {
    expect(taskRow).toContain('<Check v-if="highlighted" class="icon-16" />');
    expect(taskRow).toContain("import { Check, FileWarning } from '@lucide/vue'");
    expect(taskRow).not.toContain('type="checkbox"');
  });
});

describe('P0-4：已暂停用警告色（第九轮裁决，醒目化）', () => {
  const badge = sourceOf('components/StatusBadge.vue');
  const meta = sourceOf('components/task/TaskRowMeta.vue');

  it('.badge-paused 规则体用 --warn / --warn-soft / 500，不再用灰色', () => {
    const paused = blockFrom(badge, '.badge-paused {');
    expect(paused).toContain('color: var(--warn)');
    expect(paused).toContain('background: var(--warn-soft)');
    expect(paused).toContain('font-weight: 500');
    expect(paused).not.toContain('var(--muted)');
    expect(paused).not.toContain('var(--surface-3)');
  });

  it('pending / completed / failed 三态配色原样不动', () => {
    expect(blockFrom(badge, '.badge-pending {')).toContain('color: var(--meta)');
    expect(blockFrom(badge, '.badge-pending {')).toContain('background: var(--surface-3)');
    expect(blockFrom(badge, '.badge-completed {')).toContain('color: var(--success)');
    expect(blockFrom(badge, '.badge-failed {')).toContain('color: var(--danger)');
  });

  it('元数据行只把「已暂停」文字染警告色，sizeText 不染色', () => {
    expect(meta).toContain("<span class=\"meta-paused\">{{ t('status.paused') }}</span>");
    expect(blockFrom(meta, '.meta-paused {')).toContain('color: var(--warn)');
    expect(meta).toContain('<span class="meta-strong mono">{{ sizeText }}</span>');
  });
});
