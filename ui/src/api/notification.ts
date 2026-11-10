import { invoke } from './invoke';
import { t } from '@/locales/zh-CN';

// 分层硬约束：仅本层可 import '@tauri-apps/api'（同 invoke 封装，组件层经由此处调用）。
//
// 系统通知一律经 Rust 命令 `notify_user` 发送，**JS 侧不做任何权限判断**。
// 两个理由（2026-11 实测，缺陷 4 / docs/SPEC.md §13）：
// 1) toast 归属身份修不了在进程侧：通知插件 2.7.0 只在 exe 不在 target/{debug,release}
//    时给 notify-rust 设 app_id，缺值时 notify-rust 回退到宿主 shell 的硬编码身份常量，
//    tauri-winrt-notification 再用 `CreateToastNotifierWithId` 把它随 toast 提交——所以
//    必须由发 toast 的一方（Rust 侧 `notify::prepare()` 注册的每用户级 AUMID）显式携带，
//    JS 只负责调命令。
// 2) 原先的 `isPermissionGranted()` / `requestPermission()` 门卫在 Windows 上没有对应的
//    运行时权限概念（MVP 为 Windows-only，Spec §10），一旦它返回 false 或抛异常，
//    通知会被**静默吞掉**——功能没坏却被一层守卫挡死，与 P1-001 属同一类失败，故删除。
//
// 注意：必须是**替换**而非叠加。插件的 `sendNotification` 与命令 `notify_user` 同时存在
// 会一个事件弹两条通知（一条正确归属、一条 "Windows PowerShell"）。

async function notify(title: string, body: string): Promise<void> {
  try {
    // 契约（SPEC §5.1 / §13）：命令名 notify_user，参数是两个平铺标量 title / body。
    // 后端会 trim → 空则 invalid_argument；超长按字符边界截断（title 128 / body 512），
    // 发送失败返回 notification_failed。三者都在这里静默处理（通知是辅助通道）。
    await invoke<void>('notify_user', { title, body });
  } catch (e) {
    // 不外抛、不弹 toast（绝不打扰下载主流程），只留一条 warn 供排查：
    // 命令未注册 / AUMID 缺失 / 参数被拒这类问题在 dev 下只有这里能看见。
    console.warn('[notification] notify_user failed:', e);
  }
}

/**
 * 任务完成通知（PRD F9 / DESIGN.md §5）。
 * 标题只承担**事件语义**（"下载完成"）：气泡顶部的应用名行由 Windows 从 AUMID 的
 * DisplayName 渲染（后端注册为 wtf-downloader），这里再写一遍应用名会连着两行重复。
 * 是否发送由 App.vue 按 config.notifyOnComplete 开关控制。
 */
export async function sendTaskCompletedNotification(filename: string): Promise<void> {
  await notify(t('notify.completedTitle'), t('notify.completedBody', { filename }));
}

/**
 * 任务失败通知（PRD F9：失败必须通知，不受 notifyOnComplete 开关控制）。
 * 标题同上只承担事件语义；正文含文件名与错误摘要，错误缺失时退化为无摘要文案。
 */
export async function sendTaskFailedNotification(filename: string, error?: string): Promise<void> {
  const body =
    error && error !== ''
      ? t('notify.failedBody', { filename, reason: error })
      : t('notify.failedBodyNoReason', { filename });
  await notify(t('notify.failedTitle'), body);
}
