/**
 * 文案资源（DESIGN.md §6 全量，真实场景文案，禁占位）。
 * Spec §3：MVP 仅简体中文，文案集中资源文件预留 i18n 接口——组件内禁写裸字符串。
 */

export const zhCN = {
  'common.cancel': '取消',
  'common.retry': '重试',
  'common.close': '关闭',
  'common.undo': '撤销',
  'common.viewAll': '查看全部',
  'common.speedPlaceholder': '输入 MB/s',

  'topbar.appName': 'wtf-downloader',
  'topbar.newTask': '新建任务',
  'topbar.newTaskTooltip': 'Ctrl+N',
  'topbar.searchPlaceholder': '搜索任务',
  'topbar.settings': '设置',
  'topbar.settingsTitle': '设置',
  'topbar.backToTasks': '返回任务列表',

  'filter.all': '全部',
  'filter.downloading': '下载中',
  'filter.completed': '已完成',
  'filter.failed': '失败',
  /** 独立筛选开关「仅看文件已丢失」（不并入四值状态筛选，DESIGN.md §2.10） */
  'filter.missing': '文件已丢失',
  'filter.missingAria': '仅显示关联文件已丢失的已完成任务',

  'statusbar.totalSpeed': '全部任务总速度（只读）',

  'status.pending': '等待中',
  'status.paused': '已暂停',
  'status.completed': '已完成',
  'status.failed': '已失败',
  'status.retrying': '重试中 {done}/{total}',

  'meta.queued': '排队中',
  'meta.remaining': '剩余 {eta}',
  'meta.segments': '{done}/{total} 分片完成',
  'meta.segmentsActive': '{active} 分片并行中',
  'meta.completedAt': '完成于 {time}',
  'meta.speedLimited': '（限 {limit}）',

  'empty.noTasksTitle': '还没有下载任务',
  'empty.noTasksSub': '复制链接后按 Ctrl+N，或点击右上角「新建任务」，粘贴即可开始',
  'empty.noResultsTitle': '没有{filter}的任务',
  'empty.noResultsSub': '切换到「全部」查看所有任务',
  'empty.missingTitle': '没有文件已丢失的任务',
  'empty.missingSub': '关联文件都在，切换到「全部」查看所有任务',

  /** 已完成任务文件丢失：瞬时呈现态（§2.10），不是任务状态 */
  'task.fileMissing': '文件已丢失',

  'error.loadFailed': '任务列表加载失败',

  'add.title': '新建下载任务',
  'add.urlLabel': '下载链接',
  'add.urlHelper': '支持 HTTP/HTTPS 直链，一行一个，可批量添加',
  'add.urlLineError': '第 {n} 行链接格式不正确，需以 http:// 或 https:// 开头',
  'add.clipPrefill': '已自动填入剪贴板链接',
  'add.probing': '正在解析文件信息…',
  'add.probeTimeout': '解析超时，请检查链接，或直接添加',
  'add.stillAdd': '仍然添加',
  'add.probeFailed': '解析失败：{reason}',
  'add.filenameLabel': '文件名',
  'add.filenameError': '文件名不能包含 \\ / : * ? " < > |',
  'add.acceptRanges': '支持分段加速',
  'add.noRanges': '服务器不支持分段加速，将单连接下载',
  'add.dirLabel': '保存到',
  'add.changeDir': '更改',
  'add.multiSummary': '将添加 {n} 个任务，均保存到 {dir}',
  'add.advanced': '高级选项',
  'add.segmentsLabel': '下载分片数',
  'add.segmentsHelper': '分片越多对服务器压力越大，16 通常已是最优',
  'add.parallelEstimate': '预计 {n} 个分片并行',
  'add.httpWarning': '该链接为未加密 HTTP 连接，下载内容将明文传输',
  'add.submit': '开始下载',
  'add.submitMulti': '添加 {n} 个任务',
  'add.addFailed': '添加失败：{reason}',
  'add.addedToast': '已添加 {n} 个任务',
  'add.discardMessage': '已填入的内容将丢失',
  'add.keepEditing': '继续编辑',
  'add.discard': '放弃',

  'remove.title': '删除任务',
  'remove.message': '「{filename}」将从列表中移除，未完成的下载进度会一并清除。',
  'remove.messageCompleted':
    '「{filename}」已下载完成。选择「删除任务和文件」会一并删除磁盘上的文件。',
  'remove.confirm': '删除',
  'remove.onlyTask': '仅删除任务',
  'remove.withFiles': '删除任务和文件',
  'remove.removedToast': '已移除「{filename}」',
  'remove.removedWithFileToast': '已移除「{filename}」及其文件',

  /** 迅雷式多选右键菜单（DESIGN.md §2.9）：不再有批量条 / 复选框 / 全选入口 */
  'bulk.menuAria': '批量任务操作',
  'bulk.selected': '已选 {n} 个任务',
  'bulk.pauseAll': '全部暂停',
  'bulk.resumeAll': '全部开始',
  'bulk.retryAll': '全部重试',
  'bulk.removeSelected': '删除选中任务…',
  'bulk.removeTitle': '批量删除任务',
  'bulk.removeMessage': '将删除选中的 {n} 个任务。',
  /** 含已完成任务：明确告知「仅删除任务」不动磁盘文件 */
  'bulk.removeMessageCompleted':
    '将删除选中的 {n} 个任务。选「删除任务和文件」才会删除已完成任务的文件。',
  'bulk.partialFailed': '{total} 项中有 {failed} 项未完成，请查看错误提示',

  'conflict.title': '资源已变化',
  'conflict.message': '资源已变化，是否重新完整下载？',
  'conflict.redownload': '重新下载',

  'more.openFile': '打开文件',
  'more.openDir': '打开目录',
  'more.taskLimit': '任务限速',
  'more.remove': '删除',
  'more.taskLimitTitle': '任务限速',
  'more.unlimited': '不限',
  'more.limitUnit': 'MB/s',
  'more.limitInvalid': '请输入大于 0 的数值',

  'settings.groupDownload': '下载',
  'settings.loadFailed': '设置加载失败',
  'settings.groupGeneral': '通用',
  'settings.downloadDir': '下载目录',
  'settings.changeDir': '更改下载目录',
  'settings.defaultSegments': '默认分片数',
  'settings.defaultSegmentsHelper': '新建任务的默认分片数',
  'settings.globalLimit': '全局限速',
  'settings.globalLimitHelper': '应用启动时应用的默认限速，0 或留空为不限',
  'settings.autostart': '开机自动启动',
  'settings.autostartHelper': '登录 Windows 后自动运行',
  'settings.closeToTray': '关闭窗口时最小化到托盘',
  'settings.closeToTrayHelper': '关闭后仍在后台下载，可从托盘图标重新打开',
  'settings.notify': '下载完成系统通知',
  'settings.notifyHelper': '每个任务完成时发送系统通知',
  'settings.themeNote': '外观跟随 Windows 系统设置（深色/浅色）',
  'settings.unit': 'MB/s',
  'settings.groupUpdate': '更新',

  /** 软件更新（DESIGN.md §4.4，第十轮）：启动自动检查 + 设置页手动检查 */
  'update.currentVersion': '当前版本 {version}',
  'update.versionUnknown': '版本未知',
  'update.check': '检查更新',
  'update.checkHint': '启动后自动检查，也可手动检查',
  'update.neverChecked': '尚未检查更新',
  'update.lastChecked': '上次检查 {time}',
  'update.lastCheckFailed': '上次检查失败（{time}）',
  'update.statusLine': '{version} · {status}',
  'update.confirmWithNotes': '{message} {notes}',
  'update.upToDate': '已是最新版本',
  'update.checkFailed': '检查更新失败：{reason}',
  'update.installFailed': '更新安装失败：{reason}',
  'update.availableTitle': '发现新版本 {version}',
  /** 下载前必须明示：Windows 安装阶段应用自动退出、完成后需手动重开（官方行为） */
  'update.confirmMessage': '发现新版本 {version}。安装更新时应用会自动退出，安装完成后请重新打开；进行中的下载任务会自动恢复。',
  'update.later': '稍后',
  'update.installNow': '立即更新',
  'update.installingTitle': '正在安装更新',
  'update.installing': '正在下载并安装更新，应用将在安装阶段自动退出',
  'update.installingFinished': '安装已开始，应用即将退出；完成后请重新打开',
  'update.progress': '已下载 {downloaded} / {total}',
  'update.progressUnknown': '已下载 {downloaded}',
  'update.releaseNotes': '更新说明：{body}',
  'aria.checkUpdate': '检查更新',

  'toast.saved': '设置已保存',
  'toast.saveFailed': '保存失败：{reason}',
  /** 透传键：用于**已自带完整文案**的错误（后端 AppError message，如 "文件不存在：D:/x.zip"）。
      由 stores/toast.ts `pushError` 自动选用，不叠加业务前缀（防「保存失败：任务不存在…」重复）。 */
  'toast.asIs': '{reason}',
  /** 仅用于**非 AppError**（无业务语义的裸原因：运行时错误 / IPC 原始串 / 命令未注册）时的前缀 */
  'toast.openFailed': '打开失败：{reason}',

  'notify.unknownFile': '未知文件',
  /** 系统 toast 的标题行只承担**事件语义**：应用名由 Windows 从 AUMID 的 DisplayName 渲染，
      再写一遍应用名会让气泡连着两行 "wtf-downloader"（2026-11 归属修复后的排版口径） */
  'notify.completedTitle': '下载完成',
  'notify.failedTitle': '下载失败',
  'notify.completedBody': '「{filename}」已下载完成',
  'notify.failedBody': '「{filename}」下载失败：{reason}',
  'notify.failedBodyNoReason': '「{filename}」下载失败',

  'aria.openFile': '打开文件',
  'aria.openDir': '打开目录',
  'aria.more': '更多',
  'aria.clearSearch': '清空搜索',
  'aria.changeDir': '更改下载目录',
  'aria.taskMenu': '任务菜单',
  'aria.pause': '暂停',
  'aria.resume': '恢复',
  'aria.retry': '重试',
  'aria.remove': '删除',
} as const;

export type MessageKey = keyof typeof zhCN;

/** 极简 t()：{param} 插值。后续接入完整 i18n 时仅需替换此实现。 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let text: string = zhCN[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}
