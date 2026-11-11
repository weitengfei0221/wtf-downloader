import { readText } from '@tauri-apps/plugin-clipboard-manager';

/**
 * 剪贴板读取（**唯一**可直连 clipboard 插件的一层）。
 *
 * 为什么不用内置的 `navigator.clipboard.readText()`：WebView2 把剪贴板读取归为
 * 敏感权限，**每次**调用都会弹「<origin> 想要查看复制到剪贴板的文本和图像」的
 * 阻止/允许确认框，而 Chromium 不提供「记住这次选择」——用户每开一次新建任务
 * 弹窗就得点一次「允许」。走插件的 IPC 通道不经过 WebView 的权限层，这个框不
 * 会出现。
 *
 * 分层铁律：组件 / store / view 只 import 本文件的函数，绝不直接 import 插件包
 * （architecture.guard.test.ts 的 P0 分层护栏会扫）。
 */

/** 读取剪贴板纯文本；剪贴板为空或不是文本时返回空串（由调用方判断用途） */
export async function readClipboardText(): Promise<string> {
  return readText();
}
