import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 状态栏右下角更新提示的静态护栏（DESIGN.md §2.4）。
 *
 * 2026-11-14 从 `views/Updater.guard.test.ts` 拆出：该文件混装了更新流程、设置页、
 * 分层与主题四类断言，加上状态栏这 5 条后达到 312 行、破了 300 行门禁。
 * 拆开的理由不是"塞不下"，而是**关注点不同**——这里守的是状态栏两态的视觉与可达性
 * （圆点 + 文字、常态无底、hover 才铺灰、无更新态是只读 span），
 * 与"更新怎么检查、怎么安装"无关。以后改状态栏不必再动更新链路的护栏文件。
 *
 * node 环境挂不了 WebView2，故按仓库惯例断言源码结构与 token 用法，不构成视觉验收。
 */
const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/** 去掉注释再断言，避免说明文字被当成实现 */
const code = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const statusBar = read('./StatusBar.vue');
const statusBarCode = code(statusBar);

describe('状态栏右下角：有更新=圆点+文字，无更新=只读版本 label（目录 label 已移除）', () => {
  it('不再显示全局下载目录：无 downloadDir / configStore / FolderOpen', () => {
    expect(statusBar).not.toContain('downloadDir');
    expect(statusBar).not.toContain('configStore');
    expect(statusBar).not.toContain('useConfigStore');
    expect(statusBar).not.toContain('FolderOpen');
    expect(statusBar).not.toContain('dir-group');
    expect(statusBarCode).not.toContain('const dir');
  });

  it('有更新 → 可点提示调 openConfirm；无更新 → span 版本 label（不是 button）', () => {
    expect(statusBar).toContain("t('statusbar.updateAvailable')");
    expect(statusBar).toContain('@click="updater.openConfirm()"');
    expect(statusBar).toContain("t('statusbar.version', { version: updater.currentVersion })");
    expect(statusBar).toContain("t('update.versionUnknown')");
    // 无更新态必须是 span（只读），不能是 button
    expect(statusBar).toMatch(/<span v-else class="version mono">/);
    expect(statusBarCode).toContain('hasUpdate');
  });

  it('CTA 是「圆点 + 文字」：常态透明无底、方形无圆角、hover 才铺灰底', () => {
    // 2026-11-13 用户裁决：「不要用按钮，按钮感觉太重了……配色也不要按钮主色」
    // 同日追加：「前面加个小红点还是小绿点……悬浮后再显示背景灰色，正常显示时没有背景」
    const cta = statusBar.slice(statusBar.indexOf('.update-cta {'));
    const body = cta.slice(0, cta.indexOf('}'));
    expect(body).toContain('background: transparent'); // 常态不铺底
    expect(body).toContain('color: var(--fg)');
    expect(body).toContain('border-radius: 0');
    expect(body).toContain('height: 20px');
    expect(body).not.toContain('--primary');
    expect(body).not.toContain('--radius');
    // hover 才出现灰底
    expect(statusBar).toContain('.update-cta:hover {\n  background: var(--surface-2);');
    // 圆点：6px 正圆、语义绿（红在本应用是失败语义，会被读成出错）
    expect(statusBar).toContain('<span class="cta-dot" aria-hidden="true" />');
    const dot = statusBar.slice(statusBar.indexOf('.cta-dot {'));
    const dotBody = dot.slice(0, dot.indexOf('}'));
    expect(dotBody).toContain('width: 6px');
    expect(dotBody).toContain('height: 6px');
    expect(dotBody).toContain('border-radius: 50%');
    expect(dotBody).toContain('background: var(--success)');
    expect(dotBody).toContain('flex: none'); // 不被文字压成椭圆
    // 仍是 button（可点、可 Tab 聚焦），只是不像按钮
    expect(statusBar).toMatch(/<button[\s\S]*?class="update-cta"/);
    expect(statusBar).toContain('type="button"');
    expect(statusBar).toContain('.update-cta:focus-visible');
    expect(statusBar).toContain('box-shadow: var(--focus-ring)');
  });

  it('两态都用 token，禁硬编码色值；三列网格结构不动', () => {
    expect(statusBar).toContain('background: transparent'); // 有更新：常态无底
    expect(statusBar).toContain('background: var(--success)'); // 圆点
    expect(statusBar).toContain('color: var(--fg)');
    expect(statusBar).toContain('background: var(--surface-2)'); // hover
    expect(statusBar).toContain('color: var(--meta)'); // 无更新：版本 label
    expect(statusBar).toContain('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)');
    expect(statusBar).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(statusBar).not.toMatch(/rgba?\(/);
    expect(statusBar).not.toMatch(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u);
  });

  it('窄窗断点只隐藏速度，保留更新状态', () => {
    const media = statusBar.slice(statusBar.indexOf('@media (max-width: 860px)'));
    expect(media).toContain('.speed');
    expect(media).not.toContain('.update-cta');
    expect(media).not.toContain('.version');
  });
});
