import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 第十轮更新机制的静态接线护栏（DESIGN.md §2.4 / §4.4）：
 * node 环境无法挂载真实 WebView2 / GitHub Release，故把「启动延迟静默检查、
 * 自动检查不弹窗（只亮状态栏按钮）、确认前不下载、确认框版本跨度、文案与分层」
 * 落成源码断言；交互行为由 api/updater.test.ts + stores/updater.test.ts 的行为用例证明。
 */
const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/** 去掉注释再断言，避免说明文字被当成实现（含 Vue 模板的 HTML 注释） */
const code = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const app = read('../App.vue');
const appCode = code(app);
const settings = read('./SettingsView.vue');
const settingsCode = code(settings);
const locales = read('../locales/zh-CN.ts');
const api = read('../api/updater.ts');
const storeSource = read('../stores/updater.ts');
const row = read('../components/settings/UpdateSettingsRow.vue');
const dialogs = read('../components/UpdateDialogs.vue');

// 拼接出包名，避免本护栏文件自身含字面量被 architecture.guard.test.ts 的分层扫描判为违规
const PLUGIN_PKG = ['@tauri', 'apps/plugin-'].join('-');
const API_PKG = ['@tauri', 'apps/api/'].join('-');

describe('启动自动检查：延迟 3s、卸载清理、完全静默', () => {
  it('App.vue 挂载后延迟 3000ms 调 autoCheck，且 onBeforeUnmount 清 timer', () => {
    expect(appCode).toContain('AUTO_CHECK_DELAY_MS = 3000');
    expect(appCode).toContain('window.setTimeout(() => void updater.autoCheck(), AUTO_CHECK_DELAY_MS)');
    expect(appCode).toContain('window.clearTimeout(autoCheckTimer)');
    expect(appCode).toContain('void updater.loadVersion()');
  });

  it('App.vue 挂 UpdateDialogs，不把弹窗标记塞进已 299 行的 TaskListView.vue', () => {
    expect(app).toContain("import UpdateDialogs from '@/components/UpdateDialogs.vue'");
    expect(app).toContain('<UpdateDialogs />');
    expect(read('./TaskListView.vue')).not.toContain('updater');
  });

  it('auto 分支失败完全静默：store 里 auto 不推 toast、不 console', () => {
    const store = code(storeSource);
    expect(store).toContain("if (mode === 'manual') useToastStore().pushError('update.checkFailed', e)");
    expect(store).not.toContain('console.error');
    expect(store).toContain('this.lastCheckFailed = true');
  });
});

describe('确认框点明版本跨度，退出提示下沉到进度框', () => {
  it('确认框正文含 {from} / {to}，说明从哪个版本升到哪个版本', () => {
    expect(locales).toContain("'update.confirmMessage': '当前版本 {from}，新版本 {to}；是否立即更新？'");
    expect(dialogs).toContain(
      "t('update.confirmMessage', { from: fromVersion, to: updater.available.version })",
    );
    expect(dialogs).toContain("t('update.availableTitle', { version: updater.available.version })");
    // 当前版本取不到时降级为「版本未知」，不显示空串
    expect(dialogs).toContain("t('update.versionUnknown')");
    expect(locales).not.toContain('更新将重启应用');
  });

  it('不再把更新说明与后果堆进确认框（releaseNotes / confirmWithNotes 已删）', () => {
    expect(locales).not.toContain('update.releaseNotes');
    expect(locales).not.toContain('update.confirmWithNotes');
    expect(dialogs).not.toContain('info.body');
  });

  it('「应用会退出」只在进度框里说，用户按下更新之后才需要知道', () => {
    expect(locales).toContain("'update.installing': '正在下载并安装更新，应用将在安装阶段自动退出'");
    expect(locales).toContain(
      "'update.installingFinished': '安装已开始，应用即将退出；完成后请重新打开'",
    );
  });

  it('确认框两按钮：稍后（safe，最安全默认项）/ 立即更新', () => {
    expect(dialogs).toContain("{ key: 'later', label: t('update.later'), variant: 'ghost', safe: true }");
    expect(dialogs).toContain("{ key: 'install', label: t('update.installNow'), variant: 'primary' }");
    expect(dialogs).toContain('ConfirmDialog');
  });

  it('auto 分支不得打开弹窗：openConfirm 是唯一入口，checkUpdate 体内无 confirmOpen = true', () => {
    const store = code(storeSource);
    const checkBody = store.slice(
      store.indexOf('async checkUpdate('),
      store.indexOf('async closeConfirm('),
    );
    expect(checkBody).not.toContain('this.confirmOpen = true');
    // 手动分支才直接弹（用户主动点了按钮）
    expect(checkBody).toContain("if (mode === 'manual') this.openConfirm();");
    // openConfirm 是唯一写 confirmOpen = true 的实现
    const openBody = store.slice(store.indexOf('openConfirm()'), store.indexOf('async checkUpdate('));
    expect(openBody).toContain('this.confirmOpen = true');
    expect(store.match(/this\.confirmOpen = true/g)).toHaveLength(1);
  });

  it('「稍后」不销毁 pending：closeConfirm 只关弹窗，状态栏按钮可再次点开安装', () => {
    const store = code(storeSource);
    const closeBody = store.slice(store.indexOf('closeConfirm()'), store.indexOf('async confirmInstall('));
    expect(closeBody).toContain('this.confirmOpen = false');
    // 不得在这里清 available 或释放 handle（否则再点开时 confirmInstall 直接 return）
    expect(closeBody).not.toContain('this.available = null');
    expect(closeBody).not.toContain('discardPendingUpdate');
  });

  it('确认前不下载：checkUpdate 不调用 installUpdate，只有 confirmInstall 调', () => {
    const store = code(storeSource);
    const checkBody = store.slice(store.indexOf('async checkUpdate('), store.indexOf('closeConfirm(): void'));
    expect(checkBody).not.toContain('installUpdate');
    const installBody = store.slice(store.indexOf('async confirmInstall('));
    expect(installBody).toContain('await installUpdate(');
    expect(installBody).toContain('hasPendingUpdate()');
  });

  it('安装中展示进度且不可误关；安装阶段自动退出、不调用任何重启 API', () => {
    expect(dialogs).toContain(':closeable="false"');
    expect(dialogs).toContain('<ProgressBar');
    expect(dialogs).toContain("t('update.installingFinished')");
    const store = code(storeSource);
    expect(store).not.toContain('relaunch');
    expect(locales).toContain("'update.installingFinished'");
    // 安装成功后 installing 保持 true（失败分支才复位），由 stores/updater.test.ts 行为用例证明
    expect(store).toContain('await installUpdate(');
  });
});

describe('设置页检查更新行 + 版本号来源 + 文案集中', () => {
  it('SettingsView 新增「更新」分组并挂 UpdateSettingsRow', () => {
    expect(settingsCode).toContain("import UpdateSettingsRow from '@/components/settings/UpdateSettingsRow.vue'");
    expect(settingsCode).toContain("<h3 class=\"group-title\">{{ t('settings.groupUpdate') }}</h3>");
    expect(settingsCode).toContain('<UpdateSettingsRow />');
  });

  it('版本来自 Tauri getVersion()，不在组件里硬编码版本号', () => {
    expect(api).toContain(`import { getVersion } from '${API_PKG}app'`);
    expect(row).not.toMatch(/currentVersion:\s*['"]\d/);
    expect(row).toContain("t('update.versionUnknown')");
  });

  it('「更新」分组排在「下载」分组之前（用户裁决：更新放最前面）', () => {
    const updateAt = settingsCode.indexOf("t('settings.groupUpdate')");
    const downloadAt = settingsCode.indexOf("t('settings.groupDownload')");
    expect(updateAt).toBeGreaterThan(-1);
    expect(downloadAt).toBeGreaterThan(-1);
    expect(updateAt).toBeLessThan(downloadAt);
  });

  it('全部文案键存在，组件内无裸中文字符串', () => {
    for (const key of [
      'update.currentVersion',
      'update.check',
      'update.neverChecked',
      'update.lastChecked',
      'update.lastCheckFailed',
      'update.upToDate',
      'update.checkFailed',
      'update.installFailed',
      'update.availableTitle',
      'update.confirmMessage',
      'update.later',
      'update.installNow',
      'update.installingTitle',
      'update.progress',
      'update.progressUnknown',
    ]) {
      expect(locales, `缺少文案键 ${key}`).toContain(`'${key}'`);
    }
    // 中文只应出现在 locales（注释里的说明文字已剥离，不算裸文案）
    for (const source of [row, dialogs, app, settings]) {
      expect(code(source)).not.toMatch(/[\u4e00-\u9fa5]{4,}/);
    }
  });
});

describe('分层与契约：插件只在 api/、不新增 IPC 命令', () => {
  it('api/updater.ts 不经 invoke.ts、不新增自定义命令名', () => {
    expect(api).not.toContain("./invoke");
    expect(api).not.toMatch(/invoke\(['"]/);
    expect(api).toContain(`from '${PLUGIN_PKG}updater'`);
    // 项目总监裁决：不引入重启类插件，api 层**代码**也不得出现 relaunch（注释说明不算实现）
    expect(api).not.toContain(`${PLUGIN_PKG}process`);
    expect(code(api)).not.toContain('relaunch');
  });

  it('组件 / store / view 层零插件直连', () => {
    for (const source of [row, dialogs, app, settings, storeSource]) {
      expect(source).not.toContain(PLUGIN_PKG);
      expect(source).not.toContain(API_PKG);
    }
  });

  it('颜色只用 token，且无 emoji / 紫粉渐变', () => {
    for (const source of [row, dialogs]) {
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source).not.toMatch(/rgba?\(/);
      expect(source).not.toMatch(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u);
    }
  });
});

describe('主题三态选择（2026-11-13 用户裁决「主题三个选项」）', () => {
  const theme = read('../api/theme.ts');
  const themeCode = code(theme);
  const configStore = read('../stores/config.ts');
  const mainTs = read('../main.ts');

  it('设置页有三个选项，文案键齐全，themeNote 已删除', () => {
    for (const key of ['settings.theme', 'settings.themeSystem', 'settings.themeLight', 'settings.themeDark']) {
      expect(locales, `缺少文案键 ${key}`).toContain(`'${key}'`);
    }
    expect(locales).not.toContain('settings.themeNote');
    expect(settings).not.toContain('theme-note');
    expect(settings).not.toContain('settings.themeNote');
    // 三个选项的值与配置契约一致
    for (const v of ['system', 'light', 'dark']) {
      expect(settings).toContain(`value: '${v}' as const`);
    }
    // 键盘可达 + 读屏语义：button + aria-pressed
    expect(settings).toContain(':aria-pressed="config.theme === opt.value"');
    expect(settings).toContain('@click="configStore.patch({ theme: opt.value })"');
  });

  it('分段控件形态复用 .seg/.seg-item（不新造组件、方角紧凑）', () => {
    expect(settings).toContain('class="seg"');
    expect(settings).toContain('class="seg-item"');
    expect(settings).not.toContain('ToggleSwitch v-if');
  });

  it('theme.ts 只提供三态 API，且不保留会写 data-theme 的未接线函数', () => {
    expect(themeCode).toContain('export type ThemePreference');
    expect(themeCode).toContain('export function resolveTheme');
    expect(themeCode).toContain('export function applyThemePreference');
    // 绝对偏好不订阅系统事件：这是「固定浅色被系统深色冲掉」的根治点
    expect(themeCode).toContain("if (pref !== 'system') return () => undefined;");
    // 零调用死代码已删（2026-11-13）：这两个会无条件写 data-theme，留着就是回接线的入口
    expect(themeCode).not.toContain('watchSystemTheme');
    expect(themeCode).not.toContain('watchTauriTheme');
    // 全模块只有一处写 data-theme（applyTheme 内部）
    expect((themeCode.match(/dataset\.theme = /g) ?? []).length).toBe(1);
  });

  it('main.ts 先按 localStorage 镜像上色（防开机闪浅色），且不得回接系统/Tauri 主题源', () => {
    expect(mainTs).toContain('activateTheme(readThemePreference())');
    expect(mainTs).not.toContain('watchSystemTheme()');
    expect(mainTs).not.toContain('watchTauriTheme()');
  });

  it('config store 在 load / patch 后重应用主题并写镜像', () => {
    const store = code(configStore);
    expect(store).toContain('activateTheme(this.config.theme)');
    expect(store).toContain('writeThemePreference(this.config.theme)');
    // load 与 patch 两条路径都要有
    const loadBody = store.slice(store.indexOf('async load('), store.indexOf('async patch('));
    expect(loadBody).toContain('activateTheme(');
    const patchBody = store.slice(store.indexOf('async patch('));
    expect(patchBody).toContain('activateTheme(');
    expect(patchBody).toContain('writeThemePreference(');
  });

  it('偏好切换只留一条监听：activateTheme 先停旧的（模块级单例收口）', () => {
    expect(themeCode).toContain('activeStop?.()');
    expect(themeCode).toContain('export function activateTheme');
    expect(themeCode).toContain('export function stopActiveTheme');
    // 不允许调用方自己持有 stop 再忘记释放：只有一处写 data-theme 的入口
    const applyCount = (themeCode.match(/dataset\.theme = /g) ?? []).length;
    expect(applyCount).toBe(1);
  });
});
