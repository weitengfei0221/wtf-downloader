import type { UnlistenFn } from '@tauri-apps/api/event';

/**
 * 主题装配（深色优先、跟随系统）：
 * - 后端未就绪/纯浏览器环境：watchSystemTheme 用 prefers-color-scheme 写 data-theme；
 * - Tauri 就绪后：watchTauriTheme 用 window.theme() + onThemeChanged 接管（DESIGN.md §9.1），
 *   接管成功后应停用系统监听。
 * design-tokens.css 已内建 :root[data-theme] 显式标记与媒体查询兜底双通道。
 */

export type ThemeName = 'light' | 'dark';

function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
}

/** 监听系统 prefers-color-scheme，写 <html data-theme>；返回停止函数 */
export function watchSystemTheme(): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  applyTheme(mq.matches ? 'dark' : 'light');
  const onChange = (e: MediaQueryListEvent): void => {
    applyTheme(e.matches ? 'dark' : 'light');
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/**
 * 预留接口：接入 Tauri 主题事件源。成功返回 unlisten（并已应用当前主题），
 * 失败（后端未就绪/非 Tauri 环境）返回 null，调用方继续用系统监听。
 */
export async function watchTauriTheme(): Promise<UnlistenFn | null> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    const initial = await win.theme();
    if (initial === 'light' || initial === 'dark') applyTheme(initial);
    return await win.onThemeChanged(({ payload }) => {
      if (payload === 'light' || payload === 'dark') applyTheme(payload);
    });
  } catch {
    return null;
  }
}
