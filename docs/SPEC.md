# Spec - wtf-downloader v1.0

> 生成日期：2026-10-23
> 基于：PRD v1.0 + 技术选型与架构调研（含 §10 设计联动确认）+ UIUX 设计方向 v4（黑灰中性/PrimeVue 风品牌色）
> 状态：已确认（基于用户 2026-10-23 09:30 三文档确认 + 品牌色变更裁决自动生成）

---

## 1. 产品定义

- **一句话描述**：一款界面现代、轻量、无广告的跨平台 HTTP/HTTPS 直链多分片下载器：把"大文件下载"这件事做到快、稳、可恢复。
- **目标用户**：25-40 岁重度大文件下载用户（开发者/创作者/科研/学生，周均下载 1-50GB：GitHub Release、ISO、模型权重）为主；网络不稳定环境的普通用户为辅。
- **核心问题**：市场上"现代 UI"与"轻量"至今互斥——界面现代的都是 Electron（Motrix 125MB 内存），轻量的界面陈旧（NDM/aria2），IDM 付费且 Windows 独占，开源阵营欠维护（Motrix 停滞）或欠信任（FDM 恶意安装包事件）。

## 2. MVP 范围（锁定——不在此列表的功能一律不做）

对应 PRD F1-F10，验收标准摘要见第 9 节（完整 EARS 以 PRD §9 为准）；F11/F12 为本轮用户实测反馈补录的 P1 项：

| 优先级 | 功能 | 验收标准摘要 | RICE 评分 |
|--------|------|-------------|-----------|
| P0 | F1 HTTP/HTTPS 多分片下载引擎 | Range 探测→分片并行；不支持 Range 降级单连接；吞吐 ≥3 倍单连接（基准测试验证） | 6.0 |
| P0 | F2 任务列表与进度管理 | 实时状态/进度/速度/剩余时间；暂停/恢复/重试/删除 | 10.0 |
| P0 | F3 断点续传 | 分片级进度记录，续传不清零；ETag/Last-Modified 失效校验 | 10.0 |
| P0 | F4 任务持久化与重启恢复 | 崩溃/重启后 3 秒内恢复任务列表与进度（允许丢最近 1 个快照周期） | 8.0 |
| P0 | F5 系统托盘常驻 | 关窗驻留；托盘菜单暂停/恢复全部、退出；tooltip 1Hz 辅助显示 | 8.0 |
| P0 | F6 添加任务 | 2 秒内探测文件名/大小；可改目录与文件名；剪贴板预填 | 15.0 |
| P0 | F7 限速 | 全局+单任务；即时生效；收敛 ±10% | 8.0 |
| P0 | F8 删除任务与清理 | 可选连文件删；已完成任务只删记录；有确认提示 | 8.0 |
| P1 | F9 基础设置 | 下载目录/分片数/限速默认值/开机自启 | 3.2 |
| P1 | F10 失败自动重试 | 网络类错误退避重试（默认 3 次），超限转失败态 | 6.4 |
| P1 | F11 多选批量操作（**Ctrl 多选 + 右键菜单**） | 任务列表按住 Ctrl 多选、Ctrl+A 全选当前筛选结果、Shift 连选，右键按选中数量切换菜单：单选 = 单任务 4 项，多选 = 全部暂停/全部开始/全部重试/删除选中任务；**不做复选框、不做批量操作条**。理由：用户实测要求「和迅雷一样的逻辑」，按选择数量决定可执行操作；本轮只落契约与列表多选能力 | — |
| P1 | F12 已完成任务文件丢失提示 | 列表主动识别「已完成任务关联的正式文件已不在磁盘」并降权显示；理由：用户在应用外（资源管理器/清理软件）删除已下载文件后，应用内记录仍显示「已完成」，直到点「打开文件」才报「文件不存在」（`open.rs` 已有该检查）；要求不删任务、不改任务状态，仅做瞬时存在性检测 | — |

> F11/F12 为 2026-11-05 用户实测反馈补录的 P1 项，RICE 未重算（本轮不调整既有优先级排序），故评分列留 `—`。F12 的落地方式是新增 `check_files` 命令（见 §5.1）：一次批量返回正式文件已丢失的「已完成任务」id 列表，前端据此降权显示；检测为瞬时读操作，不新增业务状态。
>
> **默认视图口径（2026-11-06 第七轮裁决）**：任务列表打开即进入「下载中」筛选视图（`stores/tasks.ts` 的 `filter: 'downloading'`），筛选 Tab 顺序为 `下载中 / 全部 / 已完成 / 失败`（仅把 downloading 提到第一位，其余相对顺序不变）。`TaskFilter` 四值类型 `'all' | 'downloading' | 'completed' | 'failed'` 及 `list_tasks` 的 `{ filter? }` **契约一个字段都不改**，改的只是前端默认值与展示顺序。F11 的选择能力本轮补入「空白区拖框多选」（§2.9.1）：从列表空白区按住左键画框，覆盖到的当前可见行被选中，普通＝替换 / Ctrl·Shift＝追加，与 Ctrl 多选、Shift 连选、Ctrl+A、右键菜单共用同一选择集合。**零后端 / IPC 改动。**
>
> **追加裁决（同日）**：「下载中」是**分组视图**，覆盖 `pending / downloading / paused`（用户「暂停的任务也属于下载中」；后端 `add_task` 初始态为 `TaskStatus::Pending`，必须含 pending 否则新建后看不到刚加的任务）。判据单点落在 `stores/tasks.ts` 的 `isInProgress(status)`、由 `counts` 与 `visible` 共用；`AddTaskDialog.submit()` 成功分支调 `setFilter('downloading')`，无论之前停在哪个视图都不停留（失败分支不切）。**四值契约与 `list_tasks { filter? }` 仍一字不改，零后端改动。**

## 3. 明确不做（Out-of-Scope — 锁定）

完整 10 条（O1-O10）以 PRD §8 为准，摘要：

| 不做的功能 | 原因 | 何时考虑 |
|------------|------|----------|
| BT/磁力/ed2k | 用户明确划 V2；P2P 引擎复杂度拖垮 MVP | V2（引擎 trait 已预留） |
| 视频站点解析 | 解析规则维护成本极高 | V2 |
| FTP/SFTP | 技术栈差异大、目标用户低频 | V2 评估 |
| 浏览器扩展接管 | 涉及商店审核与兼容维护，要做就做好 | V2（Backlog 首位） |
| 订阅/付费/账号 | 开源免费是核心差异化 | 不做 |
| 远程管理/Web UI | 单机桌面工具定位 | V2（引擎 crate 复用方向） |
| Linux/移动端 | 无需求输入 | 不承诺 |
| 下载队列/计划任务/分类 | 非 MVP 核心，防蔓延 | Backlog |
| 多语言 i18n | MVP 仅简体中文（文案集中资源文件预留接口） | V2 |
| macOS | 引擎天然跨平台，宣传口径 MVP 只承诺 Windows | V1.1/V2 |

## 4. 技术架构（锁定 — 含版本锚定）

> 全部版本号经架构师 2026-10-23 联网查证。脚手架落地时回填补丁号（见 6.3 待验证清单）。

| 层 | 技术 | 实际版本 | 锁定原因 |
|----|------|----------|----------|
| 桌面框架 | tauri | 2.12.x（≥2.12.2） | 含 macOS restart 与 Channel 堆积修复；MSRV 1.90 |
| 前端框架 | vue | 3.5.44 | 用户指定 Vue 3 + TS |
| 构建 | vite | 8.3.x（模板锁定） | create-tauri-app 官方模板 |
| 状态管理 | pinia | 4.1.0 | peer vue ^3.5.11 兼容 |
| 路由 | vue-router | 5.4.0 | createWebHashHistory（WebView 标准做法） |
| 图标库 | @lucide/vue | 1.x（Lucide v1.61.0 线） | ADR-005；**废弃包 lucide-vue-next 禁用** |
| HTTP 客户端 | reqwest | 0.13.5 | async + Range + rustls 默认；ADR-001 |
| 持久化 | rusqlite（bundled） | 0.40.2 | MSRV 1.88 无工具链冲突；ADR-002；**sqlx 禁用** |
| 限速 | governor | 0.10.4 | GCRA 无锁 + 热调速率；ADR-003 |
| 数据库 | SQLite（bundled 3.53.x，WAL 模式） | — | 单写者低频写场景 |
| 单实例 | tauri-plugin-single-instance | 2.x（补丁号待回填） | 二次启动聚焦已有窗口 |
| 自启动 | tauri-plugin-autostart | 2.x（补丁号待回填） | 设置页调用 |
| 部署 | NSIS 安装包（内置 WebView2 bootstrapper） | - | Windows 优先 |
| 认证 | 无（单机无账号） | - | - |

**Cargo workspace 结构（锁定，架构报告 §4）**：
```
wtf-downloader/
├── Cargo.toml                  # workspace 根（只做成员声明与共享 profile）
├── crates/
│   ├── downloader-engine/      # 纯 Rust 引擎（零 Tauri 依赖，可独立测试）
│   │   └── src/{lib, protocol/, http/{mod,segment,resume,writer}, throttle, store, task}.rs
│   └── app/                    # Tauri 桥接层（commands 薄层 + tray + 装配）
└── ui/                         # Vue 3 前端（api/ stores/ router/ views/ components/）
```

**分层硬约束**：engine 零 Tauri 依赖；commands 层不写业务逻辑；前端仅 `api/` 层允许 import `@tauri-apps/api`；单文件 ≤300 行；入口只装配。

## 5. API 端点清单（锁定——开发时以此为唯一依据）

> 桌面应用：API = Tauri invoke command（前端→Rust）+ 事件/Channel（Rust→前端）。契约以本表为准，前端据此生成 TS 类型。
>
> **命名口径（2026-11-05 补充，此前文档缺失导致"按表实现必失败"）**：本表所有参数名一律按 **Rust 侧 `snake_case`** 书写（即 `#[tauri::command]` 函数形参名）。**线上实际传输的一切键名一律 camelCase**，转换由 Tauri v2 的 `#[serde(rename_all = "camelCase")]` 与 IPC 参数映射自动完成：
> - **注意：命令名例外，必须保持 `snake_case` 且永不做转换**：线上调用是 `invoke('list_tasks')` / `invoke('set_task_speed_limit')` / `invoke('pause_all')`。**任何人不得把命令名"统一"成 camelCase**——那会让全部 IPC 立即失效，且前端测试 mock 的是 invoke 壳、后端测试不覆盖调用侧，两层测试都拦不住。本条为硬约束，清理/重构时以此为准。
> - **注意：`code` 的取值也是契约值，不得改风格**：如 `code: "resume_conflict"`（**不是** `resumeConflict`）。前端按字符串精确比较，改风格不会报错、只会让 AC-09「是否重新下载」弹窗**静默不出现**——比命令名更危险，因为连运行时错误都没有。
> - 标量参数：`task_id: String` ⇔ 前端 `invoke('pause_task', { taskId })`
> - 结构体参数：`patch: ConfigPatchArg` ⇔ 前端 `invoke('set_config', { patch })`，**结构体字段名 camelCase**（如 `defaultSegments`），外层参数名仍为 `patch`
> - 事件/Channel 载荷：Rust 结构体字段 snake_case ⇔ 线上 JSON camelCase（如 `task_id` ⇔ `taskId`）
> - **前端从不使用 snake_case**；后端从不接收 camelCase 形参名
>
> 实测样例（`cargo test -p app events::tests::failed_payload_wire_shape_is_pinned` 输出）：`{"code":"resume_conflict","error":"…","taskId":"t10"}`

### 5.1 Commands（前端 invoke）

| Command | 功能 | 参数 | 返回 |
|---------|------|------|------|
| `probe_url` | 探测直链元数据（添加弹窗用） | `{ url: string, headers?: Record<string,string> }` | `{ filename, total_size, accept_ranges, etag?, last_modified?, final_url }` |
| `add_task` | 创建任务并入队 | `{ url, filename?, dir?, headers?, segments?: number }` | `{ task_id }` |
| `list_tasks` | 查询任务列表 | `{ filter?: "all"\|"downloading"\|"completed"\|"failed" }` | `TaskRecord[]` |
| `check_files` | 批量瞬时检测已完成任务的正式文件是否已丢失，返回丢失 id 交前端降权显示；不改状态、不落库、不 emit 事件 | `{ task_ids: string[] }` | `Result<string[]>` |
| `pause_task` / `resume_task` / `retry_task` | 任务控制 | `{ task_id }` | `Result<TaskRecord>` |
| `remove_task` | 删除任务。`delete_files=false`（仅删除任务）：未完成任务的 `.part` 清除、已完成任务的文件保留；`delete_files=true`（删除任务和文件）：连磁盘文件一起删 | `{ task_id, delete_files: boolean }` | `Result<()>` |
| `pause_all` / `resume_all` | 批量控制（托盘同源） | — | `Result<()>` |
| `get_config` / `set_config` | 设置读写 | `set: Partial<Config>` | `Config` |
| `set_global_speed_limit` | 全局限速（即时生效） | `{ bytes_per_sec: number \| null }` | `Result<()>` |
| `set_task_speed_limit` | 单任务限速 | `{ task_id, bytes_per_sec: number \| null }` | `Result<()>` |
| `open_file_location` | 打开文件所在目录 | `{ task_id }` | `Result<()>` |
| `set_autostart` | 开机自启 | `{ enabled: boolean }` | `Result<()>` |
| `open_path` | 用系统默认程序打开文件/目录（Rust 侧 opener API，绕开 JS 端路径作用域限制） | `{ path: string }` | `Result<()>` |
| `notify_user` | 发送系统通知（Rust 侧自建 toast 并携带应用 AUMID；dev/portable 下避免归属为宿主进程） | `{ title: string, body: string }` | `Result<()>` |

### 5.2 事件（Rust emit → 前端 listen，低频）

| 事件 | 载荷 | 触发时机 |
|------|------|----------|
| `task:state-changed` | `{ task_id, from, to, error? }` | 状态机任何跳变 |
| `task:created` / `task:removed` | `{ task_id }` | 任务增删 |
| `task:completed` | `{ task_id }` | 完成终态（完成通知用） |
| `task:failed` | `{ task_id, error, code? }` | 失败终态（失败通知 / AC-09 用）。`code` 为机器可读失败标识（与 `AppError.code` 同词表，如 `resume_conflict`）；**判定必须用 `code`，不得检索 `error` 文本**——`error` 是用户可见中文文案，随时可能改写。引擎无码时该字段**整键缺省**（不发空串） |

### 5.3 进度流（tauri::ipc::Channel，**4Hz Rust 生产端节流，硬约束**）

```jsonc
// 每 250ms 一帧；Channel::send 返回 Err = 前端句柄释放，视为取消推送信号（下载不中断）
{ "task_id": "...", "downloaded_bytes": 0, "total_bytes": 0, "speed_bps": 0, "eta_secs": null,
  "segments": [{ "index": 0, "downloaded": 0, "total": 0 }] }
```

## 6. 数据库表清单（锁定，SQLite WAL）

| 表 | 核心字段 | 索引 | 说明 |
|----|----------|------|------|
| `tasks` | id(TEXT PK, uuid)、url、final_url、filename、dir、total_bytes、status(TEXT 枚举: pending/downloading/paused/failed/completed)、etag、last_modified、content_type、speed_limit、error、retry_count、created_at、updated_at | idx(status), idx(updated_at) | 任务主表 |
| `segments` | task_id、seg_index、start_byte、end_byte、downloaded_bytes；PK(task_id, seg_index) | — | 分片进度；分片完成即更新（低频写） |
| `config` | key(TEXT PK)、value(TEXT JSON) | — | 设置键值（目录/分片数/限速默认值/通知开关） |

**持久化策略**：进度快照周期 1-3 秒（架构师在引擎实现时定夺，写入引擎常量）；分片完成事件即时写；WAL 模式；启动时校验 .part 文件实际存在与大小再入队。

**任务状态机（锁定）**：`pending →(start) downloading ⇄(pause/resume) paused；downloading →(error 可重试) retry 退避→downloading；退避耗尽→failed →(retry 手动) pending；downloading →(complete) completed；任意态 →(remove) removed`。不可重试错误（404/403）直达 failed。**重启恢复：DB 中所有非终态任务统一回 pending 由调度器重新拉起。**

## 7. 页面清单（锁定）

| 页面 | 路由（hash） | 核心组件 | 对应 API | 设计要点 |
|------|------|----------|----------|----------|
| 任务列表（主界面） | `/` | 顶栏（筛选分段控件/搜索/新建按钮/总速度 chip）+ 任务行（文件名/hover 操作组/进度条/元数据行）+ 状态栏 | list_tasks + Channel 进度流 + task 事件 | 打开即列表无仪表盘；五态覆盖（Empty/Loading/Error/Populated/Edge）；等宽数字 tabular-nums |
| 添加任务弹窗 | —（主界面模态） | URL 输入（粘贴即校验/批量预留）+ 解析后文件名/目录 + 高级选项折叠 | probe_url + add_task | 渐进披露；480px 宽；Enter 提交 |
| 设置 | `/settings` | 下载目录/默认分片数/全局限速默认值/开机自启/完成通知/清除本地统计 | get/set_config + set_autostart | 最小设置集，渐进披露 |
| 托盘菜单 | —（OS 原生） | 显示主窗口/暂停全部/恢复全部/全局限速子菜单/退出 | pause_all/resume_all/set_global_speed_limit + tray 事件 | tooltip 1Hz 仅活动任务时更新 |

快捷键：Ctrl+N 新建任务、Ctrl+F 搜索（Raycast 交互方向，MVP 最小实现）。

## 8. 设计 Token（锁定，v4 黑灰中性/PrimeVue 风）

> 设计师须同步产出 `ui/src/styles/design-tokens.json` + `design-tokens.css`（前端 import 引用，禁止硬编码色值——唯一例外 #fff/#000 不适用本表已全覆盖）。

| Token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| --bg | #F7F8FA | #0B0D10 | 窗口背景 |
| --surface | #FFFFFF | #111419 | 列表行/卡片/输入框底 |
| --surface-2 | #EEF0F4 | #191D23 | hover 行/次级面板 |
| --surface-3 | #E7E9EE | #21252C | 按下态/菜单底/badge 中性底 |
| --fg | #16181D | #EDF0F4 | 主文本 |
| --fg-2 | #3D434D | #B9C0CC | 次级文本（大小/路径/速度） |
| --muted | #666E7A | #8B93A1 | 副文本/暂停进度条 |
| --meta | #9AA2AE | #5F6774 | 三级元数据/等待轨道 |
| --border | #E4E7EC | #22262E | hairline 边框 |
| --border-soft | #EEF0F4 | rgba(255,255,255,0.06) | 行内分隔线 |
| --primary-bg | #111417 | #F5F6F8 | 主按钮/激活态/下载中进度条/图标选中圆角块 |
| --primary-fg | #FFFFFF | #0B0D10 | primary 填充上的文字与图标 |
| --primary-hover | #33373D | #E2E5EA | primary 悬停 |
| --primary-active | #0B0D0E | #FFFFFF | primary 按下 |
| --primary-soft | #E9EBEF | rgba(237,240,244,0.10) | 选中行背景 |
| --success / --success-soft | #059669 / #D1FAE5 | #34D399 / rgba(52,211,153,0.12) | 完成徽章 |
| --warn / --warn-soft | #D97706 / #FEF3C7 | #FBBF24 / rgba(251,191,36,0.12) | 限速/重试徽章 |
| --danger / --danger-soft | #DC2626 / #FEE2E2 | #F87171 / rgba(248,113,113,0.12) | 失败/删除 |
| --progress-track | #E4E7EC | #1D2128 | 进度条轨道 |
| --focus-ring | 0 0 0 3px rgba(17,20,23,0.35) | 0 0 0 3px rgba(245,246,248,0.40) | 键盘焦点环 |
| --elev-raised | 0 4px 16px rgba(22,24,29,0.10) | 0 8px 32px rgba(0,0,0,0.45) | 弹窗/下拉投影 |
| --chart-1/2/3 | rgba(22,24,29, .90/.55/.30) | rgba(237,240,244, .90/.55/.30) | 数据可视化灰阶阶梯（MVP 不实现、仅锁定命名） |

- **字体**：Inter + Noto Sans SC + JetBrains Mono（速度/大小/时间用 mono + tabular-nums）；字重仅 400/500 两级；woff2 子集内嵌（字重维度 5 文件、总体积 ≤3MB、unicode-range 子集化、保留系统回退栈）
- **图标库**：@lucide/vue（唯一，禁 lucide-vue-next 及任何第二套）；尺寸 16/20/24px、24px/2px 描边基准
- **主题**：深色优先、跟随系统 prefers-color-scheme；Mica 不启用（原生标题栏，--bg-translucent 预留）
- **对标**：Motrix（品类）+ Linear（工艺纪律）+ PrimeVue（黑白灰中性视觉）
- **primary 纪律**：每屏实心 ≤2 处；语义色仅小面积徽章；对比度已验算全部 ≥4.5:1（浅 17.4:1 / 深 18.0:1）
- **数字单位**：十进制 MB/s、GB（对齐 Windows/macOS 系统惯例，项目总监 2026-10-23 裁决）

## 9. 验收标准（锁定——QA 测试时以此为唯一依据）

完整 EARS 以 PRD §9 七组为准（添加任务/分片下载/断点续传/暂停恢复/重启恢复/限速/删除任务），关键条目编号承接：

| 编号 | 功能 | EARS 格式验收标准 | 优先级 |
|------|------|-------------------|--------|
| AC-01 | 添加任务 | When 用户粘贴合法 HTTP/HTTPS 直链并确认，系统必须在 2 秒内完成文件名与大小探测并创建"等待下载"任务 | P0 |
| AC-02 | 添加任务 | If URL 非法，系统必须拒绝创建并给出明确错误原因，不产生半成品记录 | P0 |
| AC-03 | 分片下载 | When 服务器支持 Range，系统必须按配置分片数并行下载，各分片写对应偏移 | P0 |
| AC-04 | 分片降级 | When 服务器不支持 Range，系统必须降级单连接并如实展示"服务器不支持分段加速" | P0 |
| AC-05 | 进度推送 | While 任务下载中，系统必须以 ≥2 次/秒频率推送字节数/总字节/速度/剩余时间（实现取 4Hz） | P0 |
| AC-06 | 分片重试 | When 分片可重试错误（超时/5xx/连接重置），系统必须自动重试该分片（默认 3 次指数退避）且不影响其余分片 | P0 |
| AC-07 | 完整性 | When 全部完成，目标文件大小必须与 Content-Length 一致，偏差置失败 | P0 |
| AC-08 | 断点续传 | When 已暂停任务恢复且服务器支持 Range，系统必须从各分片已完成字节继续，进度不清零 | P0 |
| AC-09 | 续传校验 | If 续传时 Content-Length/ETag 与持久化记录不一致，系统必须终止并询问是否重下，不得静默拼坏数据 | P0 |
| AC-10 | 暂停 | When 用户暂停下载中任务，系统必须在 1 秒内停全部分片连接并持久化进度 | P0 |
| AC-11 | 重启恢复 | When 应用再次启动，系统必须在 3 秒内加载全部任务记录，未完成任务进度完整 | P0 |
| AC-12 | 限速 | When 全局限速 X 且当前超速，系统必须在 2 秒内收敛到 X ±10% | P0 |
| AC-13 | 删除 | When 删除任务，系统必须移除记录；**未完成**任务的 `.part` 一律清除（与是否勾选删文件无关）；**已完成**任务的文件仅在"删除任务和文件"时删除，选"仅删除任务"时保留 | P0 |
| AC-14 | 引擎独立 | downloader-engine crate 必须零 Tauri 依赖，`cargo test` 独立运行通过 | P0 |
| AC-15 | 性能 | 分片吞吐 ≥3 倍单连接；常驻内存 <80MB；3 任务 <150MB；冷启动 <2s | P0/P1 |
| AC-16 | 单实例 | When 二次启动应用，必须仅聚焦已有窗口不出现新实例 | P1 |

## 10. 边界与约束

- Windows 10 21H2 / Win11（WebView2，安装包内置 bootstrapper 处理缺失）；Win7 不支持；macOS 后续
- 硬约束（架构报告 §6.1 全文有效）：Rust 工具链 ≥1.90；sqlx 禁用；rusqlite 必须 spawn_blocking 隔离；SQLite WAL；4Hz 节流必须在 Rust 生产端（Channel 无界队列，禁前端节流兜底）；engine 零 Tauri 依赖；图标库唯一 @lucide/vue；禁 emoji 图标/紫粉渐变/占位文案
- 重定向：自动跟随上限 10 跳，分片请求以最终 URL 为准
- 0 字节文件直接完成；无 Content-Length 降级单连接流式（只显示已下载字节不显示百分比）；文件 < 分片数×最小分片尺寸时自动减少分片数
- 本地匿名统计（PRD §12）：仅本地、可清除，封装 `track_event` 统一接口
- 安全：HTTPS 优先（HTTP 按用户确认降级）；不执行下载内容；不上传任何数据

## 11. 内嵌已知坑（从项目记忆拉取）

> 项目首次立项，`.workbuddy/memory/pitfalls.jsonl` 暂无历史坑。以下为架构师调研阶段查证的预置坑（视同已验证）：

| 坑 | 技术栈指纹 | 根因 | 修法 |
|----|------------|------|------|
| sqlx 与 Tauri 工具链冲突 | sqlx 0.9 / tauri 2.12 | sqlx MSRV 1.94 > tauri MSRV 1.90 | 已选 rusqlite；sqlx 列为禁用依赖 |
| rusqlite 阻塞 tokio runtime | rusqlite + tauri async command | 同步 API 在 async 上下文直接持锁查询 | 一律 spawn_blocking 隔离 |
| Channel 无界队列内存积压 | tauri ipc Channel | 无内建节流/背压，前端节流时 Rust 侧积压 | 生产端 250ms coalesce + 定时发送 |
| lucide-vue-next 废弃告警 | @lucide/vue | 2026-03 官方废弃旧包名 | 只装 @lucide/vue |
| Windows 托盘 set_title 角标不可用 | tauri tray-icon | set_title 仅 macOS；Linux 无 tooltip | Windows 用 tooltip 1Hz，菜单项文本兜底 |

## 12. 端到端验证步骤

```bash
# 1. 构建与自检
cargo test -p downloader-engine        # 断言：引擎测试全绿（零 Tauri 依赖证明）
npm --prefix ui run build              # 断言：vue-tsc 类型检查 + 构建通过

# 2. 启动
cargo tauri dev                        # 等待主窗口出现

# 3. 核心成功流
#    UI: Ctrl+N 粘贴一个支持 Range 的公网大文件直链 → 确认
#    断言：任务进入下载中，进度条 4Hz 刷新，速度/剩余时间展示（十进制 MB/s）
#    中途暂停 → 断点保持；恢复 → 从断点继续（日志验证 Range 起点非 0）
#    下载完成 → 文件大小 == 服务器 Content-Length，状态"已完成"

# 4. 断电恢复流
#    下载中任务管理器强杀进程 → 重新启动应用
#    断言：3 秒内任务恢复且进度完整（允许丢最近 1 个快照周期）

# 5. 关键错误流
#    UI: 添加 404 链接 → 断言：探活失败即拒绝创建（任务不入库），弹窗内联报错含 HTTP 状态码，弹窗不关（AC-02）
#    UI: 链接探活通过、下载过程中返回 404/403 → 断言：任务直达 failed（状态机 §6 口径，不进重试循环）
#    UI: 添加非法 URL → 断言：拒绝创建并提示原因

# 6. 限速流
#    设置全局限速 1MB/s → 2 任务并行下载
#    断言：合计速率 2 秒内收敛至 1MB/s ±10%

# 7. 托盘与单实例
#    关闭主窗口 → 断言：应用驻留托盘，下载不中断
#    再次双击启动 → 断言：仅聚焦已有窗口
```

## 13. 变更记录

| 日期 | 变更内容 | 原因 | 影响范围 |
|------|----------|------|----------|
| 2026-10-23 | Spec v1.0 初版（三文档确认 + 品牌色 Cyan→黑灰中性裁决合入） | 用户确认 Phase 1 文档并指定 PrimeVue 风品牌色 | 全局 |
| 2026-10-23 | §4 插件族补录：tauri-plugin-opener（服务 open_file_location）、tauri-plugin-notification（完成通知） | Phase 2 架构设计确认（ARCHITECTURE.md §6.2）；属官方 desktop 插件族新增，不新增 API 端点，补丁号 S0 回填 | app crate 装配 |
| 2026-10-23 | Phase 3 三项补录：① tauri-plugin-dialog 2.8.3（前端目录选择依赖）；② list_tasks 的 progress Channel 由可选改必传（tauri 2.12 Channel 不实现 Deserialize，Option 无法作 CommandArg；前端恒传，契约不变）；③ clear_stats 语义裁决：MVP 仅清除运行态统计（GlobalStats），持久化统计（PRD §12 track_event 体系）降级至 V1.1 | 后端开发实证 + 项目总监裁决 | app crate / §5.1 / 设置页 |
| 2026-11-05 | 小改：① 新增 `open_path` 命令（第 17 条）——JS 侧 `openPath` 的路径作用域为精确路径匹配、无法为任意下载目录授权，改走 Rust 侧 opener API；② 顶栏移除速度 chip，总实时速度下移至状态栏并改为只读展示；③ 状态栏目录改为纯展示、设置页下载目录行移除重复「打开」按钮；④ Toast 统一改为顶部居中向下弹出 | 用户实测反馈（opener 作用域限制经 crate 源码核实） | crates/app 命令层 / §5.1 / 顶栏 / 状态栏 / 设置页 / Toast |
| 2026-11-05 | 小改：系统通知归属修复。① 新增 `notify_user` 命令（参数 `title`/`body`，纳入 §5.1 契约），系统通知改由 Rust 侧发送；② 启动 setup 首步注册每用户级 AUMID `HKCU\Software\Classes\AppUserModelId\com.wtfdownloader.app`（`DisplayName`=`wtf-downloader`，`IconUri`=当前 exe）并设置进程级 AUMID；③ 前端 `ui/src/api/notification.ts` 的 `sendNotification` 改调 `invoke('notify_user', { title, body })`（权限门卫保留） | 用户实测：下载完成通知显示为 "Windows PowerShell" 而非本应用。溯源（crate 源码 + 实测）：tauri-plugin-notification 2.7.0 仅在 exe 不在 target/{debug,release} 时设 app_id；notify-rust 4.18.2 在该值缺失时回退到宿主 shell 身份；tauri-winrt-notification 0.8.1 用 `CreateToastNotifierWithId` 显式携带该 id。实测结论：单独设置进程 AUMID 无效（toast 仍落入 shell 身份桶），必须由 App 层自建 toast 并携带本应用 AUMID | crates/app 新增 notify 模块 / 命令层 / ui/src/api/notification.ts |
| 2026-11-05 | 契约补齐：`task:failed` 载荷新增 `code?: string`（机器可读失败标识，与 `AppError.code` 同词表）；引擎 `EngineEvent::StateChanged` 增 `code` 字段，码字面量单点定义 `protocol::CODE_RESUME_CONFLICT = "resume_conflict"`，四处续传冲突失败点引用该常量（`prepare.rs` 三处 + `worker.rs` Range 被忽略一处）；本轮**不改任何 `error` 文案**（文本清理进独立专项） | AC-09 弹窗此前靠 `p.error.includes('resume_conflict')` 嗅文本，而错误文本已进入"会被中文化/改写"的通道；API reject 路径判 `code`、事件路径嗅文本，同一语义两种判据。仅在前端或 app 层解析消息前缀属于"把脆弱点挪位置"，故改为引擎侧结构化携带 | §5.2 / crates/downloader-engine（protocol·task·http 若干）/ crates/app events.rs |
| 2026-11-05 | §12 端到端第 5 步口径澄清：**添加时探活失败 → 拒绝创建、弹窗内联报错（AC-02）**；**下载过程中 404/403 → 任务直达 failed（状态机 §6）**。原措辞"添加 404 → 任务置失败"与实现（探活拒绝创建）冲突，按阶段拆分 | 后端 Phase 4 实测发现：404 直链调 add_task 直接 reject、任务不入库 | §12 第 5 步；不影响实现 |
| 2026-11-05 | §2 F9 补充：toast payload 结构定稿为 `ToastGeneric` + 2 个 text（title=事件语义、body=具体信息），应用名行由系统按 AUMID DisplayName 渲染；新增 `notify_user` 命令（第 18 条） | 通知归属修复后实测 dump 到 XML 原文（app 桶 1 / shell 桶 0） | §5.1 / §7 / ui/src/api/notification.ts |
| 2026-11-06 | **F11 交互范式纠正**：复选框 + 40px 批量操作条整批移除，改为「Ctrl 多选 / Ctrl+A 全选 visible / Shift 连选 / 右键按选中数量切换单选·多选菜单」（迅雷式）；新增 `TaskContextMenu.vue`，`TaskRow.vue` 去掉复选框。同期弹窗容器改为三段式：`.head` 与可选 `#footer` 固定、仅 `.body` 滚动，`AddTaskDialog` / `ConfirmDialog` 的 footer 移入插槽，提交按钮用 `form` 属性跨插槽关联。**零后端改动** | 用户原话「不是加复选框和批量操作栏……和迅雷一样的逻辑」；另一实测「标题栏和底部操作按钮区域不应该被内容和滚动条影响位置」。属前端交互与布局纠正，不触碰 IPC 命令名 / `code` 值 / AC-13 / 文件丢失检测契约 | ui/src/components（ModalShell / AddTaskDialog / ConfirmDialog / BaseButton / task/*）、ui/src/composables/useTaskSelection.ts、ui/src/views/TaskListView.vue、ui/src/locales/zh-CN.ts、静态护栏与 docs/phase2/DESIGN.md §2.1/§2.3/§2.5/§2.9/§3.1/§6/§10 |
| 2026-11-05 | 新增 `check_files` 命令（第 19 条）：批量瞬时检测已完成任务的正式文件 `dir.join(filename)` 是否存在，一次 `list(All)` 读完成全批次，返回正式文件已丢失的「已完成任务」id 列表交前端降权显示。仅 `ErrorKind::NotFound` 计入丢失；其它 IO 错误（权限/占用等）按「存在」处理不误报；未知 id、空数组、非完成态一律跳过。§2 补录 F11 多选批量操作、F12 已完成任务文件丢失提示两条 P1 功能 | 用户实测：在应用外（资源管理器/清理软件）删除已下载文件后，任务记录仍在且显示「已完成」，点「打开文件」才报「文件不存在」（`open.rs` 已有该检查）；诉求是不删任务、不改状态，只让列表主动识别并降权显示 | 设计决定：**这是瞬时存在性检测，不是新的业务状态**——不改状态机、不改 `TaskRecord` / `Downloader` 契约、不落库、不 emit 事件、不动 `remove` / AC-13（`http/ops.rs:194` 的 `delete_files && status != Completed` 保持原样）；命令名保持 snake_case 不做 camelCase 转换，`code: "resume_conflict"` 契约值不变。影响范围：crates/app 命令层新增 `check_files` 模块（纯函数 + 16 条护栏用例）/ §5.1 / §2 / §13 |
| 2026-11-06 | **第七轮实测反馈 7 项（纯前端）**：① 新建下载任务弹窗 footer 改单行三元素（并发提示最左 / 取消 / 开始下载靠右）；② 选中态加 `--primary-bg` inset 主色竖条 + 16px `Check` 对号（固定前导槽不跳字），三态压过 hover；③ 右键菜单「任务限速」去省略号；④ 任务行 / 列表禁文本选择（`user-select:none` + input 兜底）；⑤ 「下载中」置顶且成为默认任务列表视图；⑥ 空白区拖框多选（新 `useMarqueeSelection.ts` 状态机 + `MarqueeBox.vue` 渲染 + `MarqueeLayer.vue` 容器）；⑦ 相关护栏用例与文档同步。**零后端 / Rust / IPC 命令名 / `code` 值 / AC-13 / `check_files` 契约改动** | 用户实测：弹窗底部两行且取消被裁切；「按住 ctrl 选的时候最后一次点击选中的状态貌似被覆盖了……第三个任务其实被选中了，但是颜色看不出来」（右键菜单显示「已选 3 个任务」已证明集合是 3 条）；「选中的时候是不是可以给任务上加个对号」；「任务限速四个字后面的省略号去掉」；「shift 选中时有些文字被选中了，是没有设置 user-select」；「把下载中视图调整为第一位，并且是默认任务列表视图」；「鼠标从任务列表空白位置开始按住左键可以画框，框覆盖的任务都被选中，就和选文件或文件夹一样」 | ② 先用行为单测证伪「选择集合被逻辑覆盖」（Ctrl 连点 3 行含最后一行 `has()` 全 true、commit 同步、selected 派生正确），再改视觉，禁止只改样式掩盖逻辑问题；不改 design token 全局定义，颜色一律 `var(--token)`。⑤ `TaskFilter` 四值与 `list_tasks { filter? }` 契约不动，只改前端默认值与 Tab 顺序，`viewAll()` 仍回 `all`。⑥ 拖框后浏览器补发的 click 用 capture 阶段标志位吞掉，既有 `@click.self` 清空语义保留；命中限当前 `visible`。影响范围：`ui/src/components`（AddTaskDialog / add-task-dialog.css / FilterTabs / task/TaskRow / task/TaskMoreMenu / task/MarqueeBox / task/MarqueeLayer）、`ui/src/composables`（useTaskSelection / useMarqueeSelection）、`ui/src/views`（TaskListView / task-list-view.css）、`ui/src/stores/tasks.ts`、`ui/src/locales/zh-CN.ts`、`ui/src/styles/base.css`、测试护栏、`docs/phase2/DESIGN.md` §2.2/§2.3/§2.5/§2.6/§2.9/§2.9.1/§3.2/§6/§9/§10、§2/§13 |
| 2026-11-06 | **第七轮追加裁决（纯前端）**：①「下载中」由「status 相等」改为分组视图，含 `pending / downloading / paused`，判据单点 `isInProgress(status)` 由 `counts.downloading` 与 `visible` 共用；② 新建任务成功后立即 `setFilter('downloading')`，不停留在原视图 | 用户原话「暂停的任务也属于下载中」「新建任务后要立即切换到下载中视图，而不是当前停留的是全部，就停留在全部」。必须含 pending 的依据：后端 `add_task` 落 `TaskStatus::Pending`（`crates/downloader-engine/src/http/ops.rs`）；`TaskFilter` 四值与 `list_tasks { filter? }` 契约一字未改，`fetch` 恒取全量后本地过滤。**零后端 / Rust / IPC 改动** | `ui/src/stores/tasks.ts`、`ui/src/components/AddTaskDialog.vue`、`ui/src/stores/tasks.defaultView.test.ts`（+6 用例）、`docs/phase2/DESIGN.md` §2.2/§2.4/§9 第 16 条、§2/§13 |
| 2026-11-06 | **第九轮实测修正 2 项（纯前端）**：① 选中行去掉左侧 `inset` 主色竖条 / 描边框（`.row.row-selected` 三态只留 `--primary-soft` 整行底色；`:focus-visible` 只留 `--focus-ring`；`.select-mark` 保持纯 16px `Check` 对号、规则体内禁任何形成「框」的声明）；② 已暂停改警告色（`StatusBadge.badge-paused` → `--warn` / `--warn-soft` / 500；`TaskRowMeta` 新增 `.meta-paused` 只染「已暂停」文字，sizeText 不染；pending / completed / failed 三态不动）。「状态指示只允许语义图标本身，禁止装饰性边框 / 描边胶囊 / 左侧竖条 / 发光底 / 渐变底」写进 DESIGN.md §0 P0-5 全案硬规则，并落成 `architecture.guard.test.ts` 的 `P0-3` / `P0-4` 规则体切片护栏。**零后端 / Rust / IPC 命令名 / `code` 值 / AC-13 / `check_files` 契约改动，design token 全局定义零改动** | 用户「选中时只显示对号，不要这个左边的框框，这个就是 ai 味道，写进约束，坚决不要」+「已暂停给一个颜色醒目一些，比如警告色」。竖条沿行圆角渲染成描边小框，属 AI 模板味装饰；已暂停原 `--muted` + `--surface-3` 与 pending 几乎同色不醒目 | 影响范围：`ui/src/components/task/TaskRow.vue`、`ui/src/components/StatusBadge.vue`、`ui/src/components/task/TaskRowMeta.vue`、`ui/src/architecture.guard.test.ts`、`ui/src/components/task/FileMissing.guard.test.ts`、`ui/src/views/Marquee.guard.test.ts`、`docs/phase2/DESIGN.md` §0/§1.2/§1.5/§1.7/§2.3/§9/§9.1/§10、§13 |
| 2026-11-07 | **上线前置：软件更新机制（Rust / 配置 / 发布侧）**：① `crates/app/Cargo.toml` 新增 `tauri-plugin-updater`，`lib.rs` Builder 链注册该插件（single-instance 仍居首、`notify::prepare()` 仍为 setup 首行）；② `capabilities/default.json` 加 `updater:default`；③ `tauri.conf.json` 加 `bundle.createUpdaterArtifacts: true`、`plugins.updater.{pubkey,endpoints}`，端点为占位地址（仅 tauri.conf.json 一处），待用户提供仓库后一行替换；④ 生成 minisign 密钥对，公钥内容入配置、私钥留在本机 `~/.tauri/` 不入库；⑤ 新增 `docs/UPDATES.md` 发布手册。**零 IPC 命令变化**：19 个命令名 / `code` 契约值 / AC-13 / `check_files` 契约 / `crates/downloader-engine` 均未改动；updater 走插件自带命令，不进 `generate_handler!`，故 §5.1 表不改 | 用户拍板：GitHub Releases 静态 `latest.json` 更新源、启动自动检查 + 设置页手动检查、首版不做代码签名但 updater 签名不可禁用。项目总监裁决**只保留用户已授权的 `tauri-plugin-updater` 一个 Rust 依赖**：Tauri v2 官方说明 Windows 上执行安装步骤时应用会自动退出、且安装后立即重启并非必需，故 `relaunch()` 在本产品不可达，不引入任何重启类插件及其权限；安装阶段自动退出后由用户重新打开应用 | `crates/app`（Cargo.toml / lib.rs / tauri.conf.json / capabilities/default.json）、`Cargo.lock`、`docs/UPDATES.md`、`README.md`、§13 |
| 2026-11-09 | **品牌图标与安装程序中文化（配置层）**：① `bundle.icon` 改引用 `crates/app/icons/wtf-downloader-32/128/256.png` 与 `wtf-downloader.ico`；② 用 1024 母版 `wtf-downloader.png` 经 `tauri icon` 重新生成六层 ICO（16/24/32/48/64/256），替换原单层 256 ICO；③ 新增 `bundle.windows.nsis`：`languages: ["SimpChinese"]`、`installerIcon` 指向品牌 ICO、`installMode: currentUser`；④ 新建根 `.gitignore` 排除 target / node_modules / `*.key` / `*.sig` / `.env`；⑤ README「打包」补私钥环境变量、`--no-install` 与 `.sig` 用途，`docs/UPDATES.md` 补 §8.1 图标口径与 §9 建仓/发布/测更新全流程 | 用户实测：安装向导为英文 NSIS 界面、exe 与标题栏仍是 Tauri 默认图标；提供 `wtf-downloader-*` 品牌图标集后按实际文件名改配置。**零 IPC / 后端 / 前端代码改动，未打包**（由用户自行打包）；欢迎页侧栏大图需 164×314 BMP，未提供故未配置 | `crates/app/tauri.conf.json`、`crates/app/icons/wtf-downloader.ico`、`.gitignore`、`README.md`、`docs/UPDATES.md` |
| 2026-11-10 | **图标重做 + 主程序改名 + 通知栏 logo + 删除无效统计（契约 19 → 18 条）**：① 图标改用 `crates/app/icons/lgoo.svg`（1024 矢量、满铺圆角卡片）经 `tauri icon` 重新渲染，产出 `wtf-downloader.ico`（六层 16/24/32/48/64/256 全部满铺）+ `-32/-128/-256.png` + `notify.png`（96px 通知 logo），删除带 18% 透明留白的旧 `wtf-downloader.png`；② NSIS 补 `uninstallerIcon`，卸载程序不再是 NSIS 默认图标；③ `crates/app/Cargo.toml` 新增 `[[bin]] name = "wtf-downloader"`，安装后主程序不再是 `app.exe`（NSIS 模板按注册表 `MainBinaryName` 自动删除旧名的 exe）；④ 通知图标落地：`bundle.resources` 携带 `icons/notify.png`，`notify::prepare(app)` 的 `IconUri` 由指向 exe 改为指向该 PNG，出栈 toast 增加 `appLogoOverride`，路径含 XML 元字符时降级为无图标而非静默失败；⑤ **删除 `clear_stats` 命令**与设置页整组「数据/清除统计数据」：该命令只把 `GlobalStats` 两个原子值置零，4Hz 聚合器下一帧即写回，用户点完无任何变化；同步删除 `GlobalStats::clear()`（无调用方）、`api/config.ts`/`stores/config.ts` 的 `clearStats`、6 条 i18n 文案；⑥ 修正误导文案：原文案称统计「用于改进产品」，但本项目没有任何上传/遥测代码 | 用户实测：桌面图标比其他 app 小一圈、标题栏图标看不清（根因是母版 18% 透明留白，且旧 ICO 各层占比 65%~100% 不一致）；安装后主程序叫 `app.exe` 与产品名不符；卸载程序图标未品牌化；用户明确「不做回传数据，做最纯粹的工具，清除统计数据那里不要，直接删掉」 | 分层不动：`TaskRecord` / `Downloader` 契约、`remove` 的 AC-13（已完成任务永不删文件）、`GlobalStats` 字段与托盘 tooltip 均保持原样；契约门禁 18/18/18、前端 348 用例、`cargo test --workspace` 140 通过 | `crates/app/icons/*`、`crates/app/Cargo.toml`、`crates/app/tauri.conf.json`、`crates/app/src/{lib.rs,notify/*}`、`crates/app/src/commands/config.rs`、`crates/downloader-engine/src/protocol/mod.rs`、`ui/src/{views/SettingsView.vue,api/config.ts,stores/config.ts,locales/zh-CN.ts}`、§5.1 |
| 2026-11-11 | **删除语义定稿：两条路径各自成立，`delete_files` 恢复为真开关**（契约仍 18 条）。① 引擎 `http/ops.rs` 的 `remove` 分成两个独立规则——未完成任务的 `.part` **一律**清除（与 `delete_files` 无关，记录都没了不可能再续传，留着只是垃圾）；已完成任务的成品文件**只在 `delete_files=true` 时**用 `remove_owned_file` 删除，`NotFound` 视为成功、其余 IO 错误向上抛（文件被占用时不能假装删掉了）；② 确认框按状态派生：已完成任务给三按钮（取消 / 仅删除任务 / 删除任务和文件），未完成任务只给「取消 / 删除」——未完成任务磁盘上只剩 `.part`（反正一律清），多一个"是否删文件"就是假选项；③ 已完成任务不再"直接移除"，改为先确认再删——此前它连弹窗都没有，等于**永远没有入口删除成品文件**；④ 选「仅删除任务」仍给 5s 撤销；选「删除任务和文件」不给撤销（文件已删，撤销无从恢复），改推 `remove.removedWithFileToast`；⑤ `ConfirmAction` 类型上移到 `utils/dialog.ts` 单点定义，`TaskListView` 派生 actions 不再复制一份接口 | 用户裁决原话「已完成任务的文件永不删除是什么意思，勾选了同时删除文件当然也要删除文件啊」。旧实现里 `with-files` 被 AC-13 的 `status != Completed` 挡住，成品文件在任何路径下都删不掉，按钮名与行为不符；已完成任务更是没有删除文件的入口 | 分层不动：`TaskRecord` 契约、状态机、`check_files` 均未改；集成用例覆盖四象限：`remove_task_deletes_part_file`（未完成 + false 仍清 `.part`）、`remove_completed_task_keeps_finished_file`（已完成 + false 保留）、`remove_completed_task_with_files_deletes_finished_file`（已完成 + true 真删）、`remove_completed_task_with_files_tolerates_missing_file`（文件已被外部删除时不报错） | `crates/downloader-engine/src/{protocol/mod.rs,http/ops.rs}`、`crates/downloader-engine/tests/integration_lifecycle.rs`、`crates/app/src/commands/{tasks.rs,check_files.rs,check_files/tests_spy.rs}`、`ui/src/{App.vue,api/tasks.ts,stores/tasks.ts,composables/useBulkActions.ts,utils/bulk.ts,utils/dialog.ts,components/ConfirmDialog.vue,components/task/TaskContextMenu.vue,views/TaskListView.vue,locales/zh-CN.ts}`、§5.1、§4 AC-13 |
| 2026-11-11 | **弹窗输入框焦点环左右被裁（纯前端 1 行 CSS）**：`ModalShell.vue` 的 `.body` 加 `padding: var(--space-1)` + 等量负 `margin: calc(var(--space-1) * -1)`。`--focus-ring` 是 3px **外环**，而 `.body` 原本水平内边距为 0、宽度正好等于输入框，`overflow-y:auto` 把外环左右两段（视觉上连同输入框 1px 边框）裁掉，只剩上下两段。内容盒几何完全不变，只是给外环腾出 4px | 用户实测截图：添加任务弹窗的链接输入框获得焦点后「左右边框没有」。全仓三个滚动容器里只有 `.body` 是零内边距（`.list` 16px、设置页 `.content` 24px），所以只有弹窗内出现 | 零后端 / 零 IPC / 零 token 改动；`ModalLayout.guard.test.ts` 增 1 条断言（`.body` 的 padding 与负 margin 必须等量成对），15 用例全绿 | `ui/src/components/ModalShell.vue`、`ui/src/components/ModalLayout.guard.test.ts`、`docs/phase2/DESIGN.md` §3.1 |
| 2026-11-11 | **剪贴板改走 Tauri 插件（消除 WebView2 权限弹窗）**：新增 `tauri-plugin-clipboard-manager` 2.5.0（Rust）与 `@tauri-apps/plugin-clipboard-manager`（npm）；`lib.rs` 注册插件、`capabilities/default.json` 加 `clipboard-manager:allow-read-text`；新建 `ui/src/api/clipboard.ts` 作为唯一可直连该插件的一层，`AddTaskDialog.vue` 的剪贴板预填由 `navigator.clipboard.readText()` 改为 `readClipboardText()`；`architecture.guard.test.ts` 的 `PLUGIN_NEEDLES` 与判别力断言同步纳入 clipboard 插件 | 用户实测：每次打开「新建任务」弹窗都弹「localhost:5173 想要查看复制到剪贴板的文本和图像」的阻止/允许框。根因是 `AddTaskDialog.reset()` 每次打开都调 `navigator.clipboard.readText()`，而 WebView2 把剪贴板读取归为敏感权限、每次询问且不提供「记住选择」 | 命令契约不变（仍 18 条）：剪贴板走插件自带命令，不进 `generate_handler!`；F6 预填行为不变（仅当剪贴板为单个 http(s) 链接时填充），读取失败仍静默跳过 | `crates/app/{Cargo.toml,src/lib.rs,capabilities/default.json}`、`ui/package.json`、`ui/src/api/clipboard.ts`、`ui/src/components/AddTaskDialog.vue`、`ui/src/architecture.guard.test.ts`、`Cargo.lock`、`ui/package-lock.json` |
