import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 第十轮更新机制的静态接线护栏（DESIGN.md §4.4）：
 * node 环境无法挂载真实 WebView2 / GitHub Release，故把「启动延迟静默检查、
 * 下载前重启提示、确认前不下载、文案与分层」落成源码断言；
 * 交互行为由 api/updater.test.ts + stores/updater.test.ts 的行为用例证明。
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

describe('下载前确认与退出提示（Windows 安装会自动退出，硬要求）', () => {
  it('确认框文案在下载前明示「安装时自动退出、完成后请重新打开」', () => {
    expect(locales).toContain(
      "'update.confirmMessage': '发现新版本 {version}。安装更新时应用会自动退出，安装完成后请重新打开；进行中的下载任务会自动恢复。'",
    );
    expect(locales).not.toContain('更新将重启应用');
    expect(dialogs).toContain("t('update.confirmMessage', { version: info.version })");
  });

  it('确认框两按钮：稍后（safe，最安全默认项）/ 立即更新', () => {
    expect(dialogs).toContain("{ key: 'later', label: t('update.later'), variant: 'ghost', safe: true }");
    expect(dialogs).toContain("{ key: 'install', label: t('update.installNow'), variant: 'primary' }");
    expect(dialogs).toContain('ConfirmDialog');
  });

  it('确认前不下载：checkUpdate 不调用 installUpdate，只有 confirmInstall 调', () => {
    const store = code(storeSource);
    const checkBody = store.slice(store.indexOf('async checkUpdate('), store.indexOf('async dismissConfirm('));
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
