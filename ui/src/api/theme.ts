/**
 * 主题装配（DESIGN.md §4.2 / §9.1）。
 *
 * 三态偏好（2026-11-13 用户裁决「主题三个选项：跟随系统 / 浅色 / 深色」）：
 * `ThemePreference` 是**用户偏好**，`ThemeName` 是**实际生效主题**，
 * `resolveTheme(pref, systemDark)` 负责把前者解析成后者，
 * `applyThemePreference(pref)` 负责写 DOM 并在需要时订阅系统变化，
 * `activateTheme(pref)` 是唯一出口（内部先停旧监听再装新的）。
 *
 * **为什么没有 Tauri 主题 API 路径**（勿以为是漏接线又加回来）：`system` 模式统一走
 * `prefers-color-scheme`。WebView2 的系统深浅色与 Windows 应用主题同源（同一系统设置），
 * 再挂一条 `window.theme()` / `onThemeChanged` 只会多出一条会**无条件写 `data-theme`**
 * 的通路——任何人重新接上它就会绕过用户偏好，把固定浅色的用户被系统深色事件冲回去，
 * 正是本次专门防住的失败模式。故原 `watchSystemTheme` / `watchTauriTheme` 两个零调用
 * 导出已删除（先例：`GlobalStats::clear()` 同因零调用方被删）。
 *
 * design-tokens.css 已内建 `:root[data-theme="dark"]` 显式块 + 媒体查询兜底双通道，
 * 所以本文件只写 `data-theme`，**CSS 一行都不用改**。
 */

/** 实际生效的主题（写到 <html data-theme> 上的值） */
export type ThemeName = 'light' | 'dark';

/** 用户偏好（配置字段 `theme`，Rust 侧以 "system"/"light"/"dark" 小写序列化） */
export type ThemePreference = 'system' | 'light' | 'dark';

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
}

/**
 * 偏好 + 系统当前是否深色 → 实际主题（纯函数，无副作用）。
 * `light` / `dark` 是**绝对**偏好，直接返回，无视系统值——这是三态语义的核心：
 * 用户选了浅色，系统切到深色也不该跟着变。
 */
export function resolveTheme(pref: ThemePreference, systemDark: boolean): ThemeName {
  if (pref === 'light') return 'light';
  if (pref === 'dark') return 'dark';
  return systemDark ? 'dark' : 'light';
}

/** 系统当前是否深色（无 matchMedia 的环境按浅色处理，避免 SSR/测试环境抛错） */
function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

/**
 * 按偏好应用主题；返回停止函数。
 *
 * **只有 `system` 才订阅** `prefers-color-scheme`：`light`/`dark` 是绝对偏好，
 * 订阅了反而会被系统事件覆盖（这就是「固定深色用户被系统切浅色冲掉」的失败模式）。
 * 调用方切换偏好时**必须先调用上一次返回的停止函数**，否则旧监听残留——
 * 会让已固定为浅色的用户被系统深色事件重新刷成深色。本函数不持有模块级状态，
 * 就是为了让"谁申请谁释放"的责任落在调用方（stores/config.ts 与 main.ts）。
 *
 * @param pref 用户偏好；system 时跟随系统
 * @param systemDark 可注入的系统深色值（测试用）；缺省读 matchMedia
 */
export function applyThemePreference(
  pref: ThemePreference,
  systemDark: boolean = systemPrefersDark(),
): () => void {
  applyTheme(resolveTheme(pref, systemDark));
  // 绝对偏好：不订阅系统事件（订阅会破坏"用户明确指定"的语义）
  if (pref !== 'system') return () => undefined;

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const mq = window.matchMedia(SYSTEM_DARK_QUERY);
  const onChange = (e: MediaQueryListEvent): void => {
    applyTheme(resolveTheme('system', e.matches));
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/** localStorage 镜像键：config 未取回前先用它同步上色，避免固定深色用户开机闪浅色 */
export const THEME_STORAGE_KEY = 'wtf.theme';

/** 读镜像偏好；缺失/非法一律回落 'system'（防手改 localStorage 把主题搞坏） */
export function readThemePreference(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // 隐私模式 / 存储禁用：按默认处理
  }
  return 'system';
}

/** 写镜像偏好（仅供 config 生效值同步，失败静默——镜像只是优化，不是事实源） */
export function writeThemePreference(pref: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // 存储不可用：不影响本次会话的主题应用
  }
}

/**
 * 当前生效的停止函数（模块级单例）。
 *
 * 这是"偏好切换时旧监听必须停掉"的**唯一收口**：`activateTheme` 先停旧的再装新的，
 * 调用方（main.ts / stores/config.ts）不可能忘记释放，也不可能装出两条监听。
 * 若把 holder 放在调用方，两处各自持有一份就必然出现"只停了自己那条"的残留监听。
 */
let activeStop: (() => void) | null = null;

/**
 * 切换并应用主题偏好（幂等，可反复调用）：先停上一条系统监听，再按新偏好应用。
 * @param pref 用户偏好
 * @param systemDark 可注入的系统深色值（测试用）
 */
export function activateTheme(
  pref: ThemePreference,
  systemDark: boolean = systemPrefersDark(),
): void {
  activeStop?.();
  activeStop = applyThemePreference(pref, systemDark);
}

/** 停止当前系统监听（组件卸载 / 测试清理用） */
export function stopActiveTheme(): void {
  activeStop?.();
  activeStop = null;
}
