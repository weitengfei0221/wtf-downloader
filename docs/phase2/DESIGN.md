# wtf-downloader DESIGN.md — Phase 2 页面级设计规格

> 生成日期：2026-10-23 | 设计师：颜好看 | 基于：Spec v1.0（§7 页面清单 / §8 Token）+ UIUX 设计方向 v4 终稿
> 产品寄存器：**Product（产品型）**——设计服务产品，标杆是"赢得熟悉感"（Motrix 品类对标 / Linear 工艺纪律 / PrimeVue 黑灰中性视觉）
> 三轴刻度：DESIGN_VARIANCE **3**（工具类，可预测对称）/ MOTION_INTENSITY **3**（功能性动效，150ms 收敛）/ VISUAL_DENSITY **6**（任务列表为数据密集区）

## 0. 文档用途与消费方式

本文档是 Phase 3 前端实现的设计契约。**唯一颜色/字体/间距/圆角/动效源头是 `ui/src/styles/design-tokens.json`（CSS 版 `design-tokens.css` 由其生成）**，本文所有规格均以 Token 名引用，前端组件样式禁止出现硬编码色值（rgb/hex 字面量一律不允许）。

P0 规则复述（违反 = 退回）：
1. 全部图标来自 `@lucide/vue`，尺寸仅 16 / 20 / 24px 三档，描边 2px，**零 emoji**；
2. 无紫色→粉色渐变（全案无彩色品牌色，v4 黑灰中性）；
3. 无空洞占位文案（空态/错误文案全部指向真实动作，见 §6 文案清单）；
4. 无硬编码颜色（全部引用 design-tokens.css 变量）；
5. **状态指示只允许语义图标本身**（2026-11 第九轮用户裁决「坚决不要」，机器护栏见 `architecture.guard.test.ts` 的 `P0-3` describe）：禁止为选中 / 状态标记套任何**装饰性边框、描边胶囊、左侧竖条、发光底、渐变底**——此类装饰是 AI 模板味，坚决不要。允许保留的只有：语义图标（如选中行 16px `Check` 对号）、整行语义底色（`.row-selected` → `--primary-soft`）、状态徽章自身的语义配色、键盘焦点环 `--focus-ring`（功能性可访问性，非装饰）。任何「给状态加个框」的写法一律退回。

---

## 1. 设计系统总纲

### 1.1 视觉主题关键词

克制、精准、轻量、黑白反差、数据密集。深色为默认展示主题（挂机场景），深浅双主题跟随系统；层级靠亮度递进而非阴影（`--bg → --surface → --surface-2 → --surface-3`）；hairline 边框；唯一的"强调"是最高对比度中性色 primary（浅色近黑 / 深色近白），每屏实心 ≤2 处。

### 1.2 状态 → 样式映射（任务状态机 → 视觉，核心表）

| 任务状态 | 状态徽章 | 进度条填充 | 元数据行 | 行内直接操作（hover 组） |
|---|---|---|---|---|
| **等待中** pending | badge：`--meta` 文字 + `--surface-3` 底 | 轨道 `--progress-track` + `--meta` 45° 条纹填充（宽 100%，见 §2.3 条纹规格） | "排队中" `--muted` + 预计大小 | Pause（移到队尾不适用，MVP 不做）、Trash2 |
| **下载中** downloading | 无 badge（进度条 + 速度即状态） | `--primary-bg` 实心，width 过渡 `--motion-progress`（250ms linear 平滑插值） | 已下载/总大小 · 速度（mono `--fg-2`）· 剩余时间 · 分片 `2/8 分片完成` 或 `8 分片并行中`（`--muted`，详见下方补充规则） | Pause、FolderOpen、Trash2 |
| **已暂停** paused | badge：**`--warn` 文字 + `--warn-soft` 底 + 500 字重**（2026-11 第九轮裁决：原 `--muted`/`--surface-3` 与 pending 几乎同色、不醒目） | `--muted`，整条 opacity 0.6 | "已暂停" **`--warn`**（`.meta-paused`，与徽标同口径；sizeText 保持 `--fg-2` 不染色）+ 已下载/总大小 · 剩余时间列隐藏 | Play、FolderOpen、Trash2 |
| **重试中** retry 退避 | badge：`--warn` 文字 + `--warn-soft` 底，文案"重试中 2/3" | 同暂停态（`--muted` 0.6），保持已有比例 | "5 秒后自动重试 · 2/3 次" `--warn` 12px | Play（立即重试）、FolderOpen、Trash2 |
| **已完成** completed | badge：`--success` 文字 + `--success-soft` 底，文案"已完成" | `--success` 满格 100% | 总大小（mono）· 完成时刻（"今天 14:32" `--muted`） | ExternalLink（打开文件）、FolderOpen、Trash2 |
| **已失败** failed | badge：`--danger` 文字 + `--danger-soft` 底，文案"已失败" | `--danger`，停在失败时比例 | 错误摘要一行（`--danger` 12px，如"服务器返回 404，文件不存在"）+ 已下载/总大小 | RotateCw（重试）、FolderOpen、Trash2 |

补充规则：
- 无 Content-Length（流式下载）：百分比显示 `--`，进度条为 `--primary-bg` 30% 宽度左右往复动画（周期 1.2s，linear，reduced-motion 时静止），元数据只显示已下载字节与速度（Spec §10）。
- 0 字节文件：直接置 completed，元数据显示"0 B · 已完成"。
- 单任务限速开启时：速度值后追加速率上限标识，速度文字用 `--warn`（如 `1.0 MB/s（限 1.0 MB/s）`）。
- **分片进度语义（2026-10-25 实测修复：并行分片语义改为 活跃/完成 双态）**：8/16 片并行时各片接近同时完成，若只显示"已完成/总数"，中途恒为 `0/8`、全部完成时又直接隐藏，用户得不到任何有效信息。现分三态——① 已完成 > 0 且未全部完成 → `{done}/{total} 分片完成`；② 已完成 = 0 且存在已写入字节的分片 → `{active} 分片并行中`（active = 未完成但 `downloaded > 0` 的分片数）；③ 全部完成 / 尚未写入 / 单片流式（无 Content-Length）→ 不展示。数据源仍为 `ProgressFrame.segments`，不改 IPC 契约。

### 1.3 排版规则

- 字体栈：`--font-display` / `--font-body`（Inter + Noto Sans SC + Microsoft YaHei UI 回退）/ `--font-mono`（JetBrains Mono）。
- 字重仅 400 / 500 两级；层级靠字号表达，**禁用 600 及以上**。
- 字号 7 级：12（元数据/badge/helper）/ 13（输入框、按钮、次级正文）/ 14（文件名）/ 16（窗口/弹窗标题）/ 18/20/24（预留，MVP 仅空状态用 24px 图标位）。
- **所有实时刷新数字（速度/大小/百分比/剩余时间/分片数/计数）一律 `--font-mono` + `font-variant-numeric: tabular-nums`**，防 4Hz 刷新跳动。
- 字距：正文 0；中文标签不强制大写（无 ALL CAPS 场景，若未来出现英文 CAPS 标签须 `letter-spacing: 0.06em`）。
- 行高：元数据行 1.5；标题 1.3。

### 1.4 间距 / 圆角 / 阴影 / z-index

- 间距 4px 网格：`--space-1`(4) / `--space-2`(8) / `--space-3`(12) / `--space-4`(16) / `--space-6`(24) / `--space-8`(32)。
- 圆角：badge `--radius-sm`(6)；按钮/输入框/任务行/菜单 `--radius-md`(8)；卡片/弹窗 `--radius-lg`(12)；进度条/圆形按钮 `--radius-full`。禁 ≥24px。
- 阴影：深色主题不用投影表达层级（亮度递进）；仅弹窗/下拉用 `--elev-raised` 一级投影；浅色主题列表卡片不加投影。禁"1px 边框 + ≥16px 模糊"幽灵卡片。
- z-index：dropdown 1000 / modal 1200 / toast 1300（Token json `zIndex` 节点）。

### 1.5 动效

| 场景 | 时长/缓动 | 说明 |
|---|---|---|
| hover / active / 状态切换 / 操作反馈 | `--motion-fast` 150ms `--ease-standard` | 全局收敛值 |
| 弹窗进入 | `--motion-base` 200ms | fade + scale 0.98→1 |
| 任务行进入 | `--motion-base` 200ms | fade + 向上 slide 8px。**只对"首次出现"的行播一次**（`.row-enter` + `isNew`），刷新/增量合并/切换筛选不重放（见 §2.8） |
| 选择高亮切换 | `--motion-fast` 150ms `--ease-standard` | 高亮态**只改 `background-color`**（`.row-selected` → `--primary-soft`）+ 行首 16px `Check` 对号；**无任何竖条 / 描边框**（第九轮裁决，见 §0 P0-5），**不触发 `.row-enter`**：选择集合不参与 `:key`（恒为 `task.id`）与 `isNew`（见 §2.9）；无复选框、无批量条 |
| 文件已丢失整行降权 | `--motion-fast` 150ms `--ease-standard` | 整行 `opacity: 1 → 0.6` 过渡（只用 opacity，不写死色值）；徽标无独立入场动画（见 §2.10） |
| 完成瞬间 | `--motion-base` 200ms | 进度条满格 + Check 图标 scale-in 一次（不循环） |
| 进度条 width | `--motion-progress` 250ms linear | 匹配 4Hz 帧间隔平滑插值 |
| 骨架屏 shimmer | 周期 1.2s linear infinite | 加载持续态（非过渡），reduced-motion 时静止 |

`prefers-reduced-motion: reduce` 时全部退化瞬切（design-tokens.css 已含全局规则）。禁弹跳缓动、禁 >300ms 过渡、禁装饰性循环动画（shimmer/Loader2 旋转/indeterminate 进度条三个"状态指示器"除外）。

### 1.6 图标规范与全局映射表

`@lucide/vue` 唯一图标库（禁 lucide-vue-next）；统一 2px 描边、`currentColor` 继承文字色。装饰图标 `aria-hidden="true"`，无文字的图标按钮必须有 `aria-label`。

| 功能位 | 图标组件（@lucide/vue） | 尺寸 | 出现位置 |
|---|---|---|---|
| 新建任务 | `Plus` | 16 | 顶栏主按钮、空状态 CTA |
| 搜索 | `Search` | 16 | 搜索框前缀 |
| 总速度 | `ArrowDown` | 16 | 状态栏总速度前缀（只读） |
| 限速（菜单） | `Gauge` | 16 | 任务「更多」菜单的「任务限速」标题 |
| 设置入口 | `Settings` | 20 | 顶栏右侧图标按钮 |
| 空状态主视觉 | `Download` | 24 | 任务列表空态 |
| 暂停 | `Pause` | 16 | 任务行操作组、确认菜单 |
| 恢复 | `Play` | 16 | 任务行操作组 |
| 重试 | `RotateCw` | 16 | 失败行操作组、错误重试按钮 |
| 删除 | `Trash2` | 16 | 任务行操作组、清除统计 |
| 打开目录 | `FolderOpen` | 16 | 任务行操作组（可点）、状态栏（纯展示，`aria-hidden`）、设置页（`pickDirectory` 选择目录） |
| 打开文件 | `ExternalLink` | 16 | 已完成行操作组 |
| 更多菜单 | `Ellipsis`（如包内无此名则用别名 `MoreHorizontal`） | 16 | 任务行操作组末位 |
| 弹窗关闭 | `X` | 16 | 弹窗右上角（同一图标组件，非第二套库） |
| 折叠展开 | `ChevronDown` | 16 | 高级选项折叠头（展开时旋转 180°，150ms） |
| 已选计数提示 | `ListChecks` | 16 | 多选右键菜单顶部「已选 {n} 个任务」只读提示（不再是批量条全选复选框） |
| 文件已丢失 | `FileWarning` | 16 | 行内「文件已丢失」徽标、顶栏独立筛选开关 |
| 解析中 | `Loader2`（别名 `LoaderCircle`） | 16 | 添加弹窗解析指示，旋转 1s linear infinite |
| 成功/支持分段 | `Check` | 16 | 解析成功标识、成功 toast |
| 错误 | `AlertCircle`（别名 `CircleAlert`） | 16 | 错误行、错误 toast、加载失败态 |
| 警示 | `TriangleAlert`（别名 `AlertTriangle`） | 16 | HTTP 未加密提示、不支持分段提示 |

> 兼容说明：@lucide/vue 1.x 存在新旧双名图标（Ellipsis↔MoreHorizontal、AlertCircle↔CircleAlert、Loader2↔LoaderCircle、TriangleAlert↔AlertTriangle），首选表中主名，构建报错则换括号内别名，**两套名不可混用于同一功能位**。

### 1.7 通用组件规格

**按钮**（高度 32px，padding 0 12px，`--radius-md`，字号 13px/500，图标 16px + 4px 间距）：

| 变体 | Default | Hover（150ms） | Active | Focus-visible | Disabled |
|---|---|---|---|---|---|
| Primary | bg `--primary-bg` / 字 `--primary-fg` | bg `--primary-hover` | bg `--primary-active` | `--focus-ring` 外环 | opacity 0.4 + cursor not-allowed |
| Secondary | 透明底 + 1px `--border` / 字 `--fg-2` | 边框 `--fg-2`、字 `--fg` | bg `--surface-3` | `--focus-ring` | 同上 |
| Ghost | 透明 / 字 `--fg-2` | bg `--surface-2`、字 `--fg` | bg `--surface-3` | `--focus-ring` | 同上 |
| Destructive-soft | bg `--danger-soft` + 1px `--border` / 字 `--danger` | 字 `--danger` 加深（opacity .85 底加深用 `--danger-soft` 叠加自身，实现可用 filter: brightness(0.97)） | bg `--surface-3` | `--focus-ring` | 同上 |

**图标按钮**：24×24px 图标区内 16px 图标；独立图标按钮（如设置入口）32×32px 内 20px 图标；颜色 `--fg-2`，hover bg `--surface-3` + 字 `--fg`（150ms），危险图标（Trash2）hover 字 `--danger`；focus-visible `--focus-ring`。

**输入框**：高度 32px，bg `--surface`，1px `--border`，`--radius-md`，字 13px `--fg`，placeholder `--meta`；focus：border 不变色 + `--focus-ring` 环；error：border `--danger` + 环 `--focus-ring`（错误环即焦点环，避免双环）+ 下方 12px `--danger` 错误文字；disabled：bg `--surface-2` 字 `--meta`。mono 输入（URL/路径）用 `--font-mono` 13px。

**组合输入（容器边框 + 内部 input）焦点纪律**（2026-11 用户实测问题 1）：当输入框由「带 1px 边框的容器 + 内部裸 `<input>`」组成（如顶栏搜索框）时，焦点环**只画在容器上**——`:focus-within` 时容器 border-color → `--primary-bg` + `box-shadow: 0 0 0 3px var(--primary-soft)`；内部 `<input>` 必须 `:focus-visible { box-shadow: none }` 并禁用 outline。否则容器边框 + 内部 3px 环会叠加成"双层粗框"。深浅色两个主题都只用 Token，不写死 rgba。

**状态徽章 badge**：height 20px，padding 0 8px，`--radius-full`，字 12px/400 tabular-nums；配色见 §1.2 表（语义色 soft 底 + 语义色文字；中性 = `--surface-3` 底 + `--muted`/`--meta` 文字）。**已暂停例外（2026-11 第九轮裁决）**：`.badge-paused` 用 `--warn` 文字 + `--warn-soft` 底 + `font-weight: 500`，与 pending 的中性灰拉开差距；仅此一态改，pending / completed / failed 三态配色原样不动。

**Toast（2026-11 调整为顶部居中）**：**顶部水平居中**，距窗口顶 56px（原生标题栏 32px + 安全间距，避免压住窗口控制按钮与顶栏搜索）；bg `--surface`，1px `--border`，`--radius-md`，`--elev-raised`，padding 12px 16px；堆叠容器定宽 `min(440px, 100vw − 32px)`（单条宽度随文案收缩、上限同值；长文案在容器内换行，不铺满整行）；图标 16px（成功 Check `--success` / 错误 AlertCircle `--danger` / 信息无图标）+ 文字 13px `--fg`；可选右侧操作链接（13px/500 `--fg-2`，hover `--fg`）；**进入 200ms 向下滑出**（`translateY(-8px) → 0` + opacity，`--motion-base` + `--ease-standard`，禁弹跳缓动），4s 自动消失，hover 暂停计时；**多条按到达顺序向下依次堆叠**（先到在上、新条追加在下，位置稳定不跳位）；容器不吃指针事件（`pointer-events: none`，条目自身恢复），避免遮挡顶栏操作；z-index 1300。

**确认弹窗**：宽 400px，结构同 §3 添加弹窗容器（遮罩 `--overlay`、bg `--surface`、`--radius-lg`、`--elev-raised`、padding 24px）；标题 16px/500 `--fg`，正文 13px `--fg-2` 行高 1.5，底部按钮区右对齐、按钮间 8px；Esc = 取消，Enter = 最安全项（取消/仅删除任务），焦点初始困在弹窗内。

---

## 2. 页面一：任务列表主界面（路由 `/`）

### 2.1 布局结构

```
┌──────────────────────────────────────────────┐
│ 原生系统标题栏（OS 提供，不自绘）              │ 32px（OS）
├──────────────────────────────────────────────┤
│ 顶栏                                          │ 52px，bg --bg，底边 1px --border
├──────────────────────────────────────────────┤
│ 任务列表主体（滚动区）                        │ flex-1，bg --bg
├──────────────────────────────────────────────┤
│ 状态栏                                        │ 32px，bg --bg，顶边 1px --border
└──────────────────────────────────────────────┘
```

- 纵向 flex 布局，主体 `overflow-y: auto`；窗口最小尺寸 720×480，默认 960×640，无侧边栏（单一列表，不为导航而导航）。
- 无仪表盘：打开即任务列表（Spec §7）。
- **无常驻批量操作条、无复选框**（2026-11 用户裁决「迅雷式多选」）：顶栏与列表之间不再插入 40px 条。多选走 Ctrl / Shift / Ctrl+A + 右键菜单（§2.9），避免主视图触及单文件 300 非空行门禁（§9 第 8 条）。

### 2.2 顶栏（52px，水平 padding 16px，元素间 12px）

从左到右：

1. **App 名**："wtf-downloader" 16px/500 `--fg`，固定不滚动。
2. **筛选分段控件**（居左紧随 App 名）：**`下载中 / 全部 / 已完成 / 失败`**（2026-11 第七轮裁决：下载中置顶，仅把它提到第一位，其余保持原相对顺序）。容器 bg `--surface-2`、`--radius-md`、padding 2px；子项 padding 4px 12px、13px/400 `--muted`、`--radius-sm`；**激活项**：浅色 bg `--surface` + 1px `--border`（深色 bg `--surface-3` + 1px `--border`），字 13px/500 `--fg`；计数不加底色，直接随文案显示 12px tabular-nums（如"下载中 3"），非激活 `--muted`、激活 `--fg-2`。切换 150ms，焦点环可达。
   - **默认视图 = 下载中**（`stores/tasks.ts` 的 `filter: 'downloading' as TaskFilter`）。`TaskFilter` 仍是 `all / downloading / completed / failed` 四值契约，一个字段都不改；只是默认值与分段控件的展示顺序变了。默认 downloading 时筛选无结果空态显示"没有下载中的任务 / 切换到「全部」查看所有任务"，`viewAll()` 仍走 `setFilter('all')` 单点（§2.6 / §2.9），文案通顺。
   - **「下载中」是分组视图，不是 `status === 'downloading'`**（2026-11 第七轮追加裁决，用户原话「暂停的任务也属于下载中」）：`pending / downloading / paused` 三者都算进行中，`completed / failed` 不算。判据单点落地为 `stores/tasks.ts` 的 `isInProgress(status)`，`counts.downloading` 与 `visible` 都只调它，禁止各写一份状态枚举。必须含 `pending` 的理由：后端 `add_task` 建任务时落 `TaskStatus::Pending`（`crates/downloader-engine/src/http/ops.rs`），否则新建后切到该视图会看不到刚添加的任务。**四值契约不变**：这是纯前端呈现层分组，`fetch` 恒取 `listTasks('all')` 后本地过滤，不新增第五个 `TaskFilter` 值、不传给后端。状态栏「N 个下载中」与分段控件计数同源采用该口径。
   - **新建任务后立即切到「下载中」视图**（用户原话「新建任务后要立即切换到下载中视图，而不是当前停留的是全部，就停留在全部」）：`AddTaskDialog.submit()` 成功分支在 `ui.closeAddDialog()` 之后调 `tasksStore.setFilter('downloading')`，无论之前停在全部 / 已完成 / 失败都不留在原视图；`setFilter` 顺带退出「仅看文件已丢失」独立筛选（§2.10）。失败分支直接 return、不切视图。
3. **搜索框**（flex 布局中 margin-left auto 推到右侧组）：宽 200px、高 32px，Search 16px `--muted` 前缀（左 8px），placeholder "搜索任务"，输入即按文件名子串过滤（不分大小写）。Ctrl+F 聚焦；聚焦时 Esc 清空并失焦；有内容时右侧出现 X 16px 清除按钮。**搜索焦点：单层 ring，不叠加 outline**——`:focus-within` 时容器 border-color → `--primary-bg` + 3px `--primary-soft` 外环（圆角随容器 `--radius-md`），内部 `<input>` 关闭自身 `:focus-visible` 环，禁止与 hover 阴影/边框叠成两层（见 §1.7 组合输入焦点纪律）。
4. **新建任务按钮**（Primary，全屏唯一常驻 primary 按钮）：Plus 16 + "新建任务" 13px/500。hover 显示 tooltip "Ctrl+N"。
5. **设置入口**：Settings 20 图标按钮（32×32px hit 区，ghost 规格见 §1.7），aria-label "设置"，点击路由 `/settings`。**在同一位置的路由态切换**：进入设置页后该按钮换成"返回"语义——图标改 ArrowLeft 20、aria-label 与 title 均为 "返回任务列表"、点击回 `/`（见 §4.1），不得保留齿轮（齿轮在设置页会让"点击返回"与图标语义冲突，2026-11 用户实测问题 4b）。

> **「文件已丢失」独立筛选开关（§2.10）**：与四值分段控件并列、但在其**外部**（`.filter-group` 包住 `.seg` + 独立开关），`role="switch"` + `aria-checked`，仅在 `missingCount > 0` 时出现；命中态 bg `--warn-soft` / 字 `--warn` / 边框 `--warn`，图标 `FileWarning` 16。它**不占用 tablist 语义、不新增第五个 `TaskFilter` 值**：`TaskFilter` 仍是 `all / downloading / completed / failed` 四值，开关是与状态筛选 AND 的一层独立呈现态筛选。

> **总速度已移出顶栏（2026-11 交互减法）**：原总速度 chip（含点击弹限速下拉）整体移除——实时速度是**状态信息**而非操作入口，展示位改到状态栏（只读，见 §2.4）。顶栏因此只剩「App 名 / 筛选 / 搜索 / 新建任务 / 设置」五项，元素间自然间距 12px，不再有定宽占位。**顶栏不再有全局限速入口**：全局限速只在设置页设置（§4.2 第 3 项），单任务限速仍在行「更多」菜单。

### 2.3 任务行（三层信息结构）

列表滚动区 padding：上 8px、左右 16px；任务行为圆角条块（`--radius-md`），行间以 8px 间距分隔（不用分隔线；行本身即视觉单元）。行内 padding 12px 16px，**min-height 80px**（三层统一，含等待/完成态——保持列表节奏一致）。行结构自上而下：

**第一层（20px 高）：文件名 + 操作组**
- 文件名：14px/500 `--fg`，`text-overflow: ellipsis` 单行截断，hover 显示原生 tooltip 全名 + 完整路径。等宽场景（如 `.tar.gz`）仍用正文字体（文件名非实时数字，不用 mono）。
- 右侧 hover 操作组（详见下）：默认 `opacity: 0; visibility: hidden`，行 hover 或行内 focus-within 时 150ms fade-in；组内图标按钮 28×28px hit 区、图标 16px（规格 §1.7），按钮间 4px。按状态显示（见 §1.2 操作列）+ 末位 Ellipsis"更多"菜单（bg `--surface`、1px `--border`、`--radius-md`、`--elev-raised`，菜单项高 32px、13px、图标 16px）：`打开文件`（ExternalLink）/ `打开目录`（FolderOpen）/ `任务限速`（Gauge，弹 160px 内联 popover：mono 输入 MB/s + "不限"开关，Enter 生效）/ `删除`（Trash2，`--danger` 文字）。
- 限速 popover 行为（2026-11 实测修复，详见 §2.8）：**应用后即时生效**——`set_task_speed_limit` 成功后由 store 就地回写 `speedLimit`，行内「（限 X MB/s）」立刻出现，不等任何列表刷新；每次打开面板都从 store 重读当前值（不限速 → 输入框为空，不残留上次的 MB 数）；输入为空/≤0/非数字时 Enter 不生效，给 12px `--danger` 内联提示"请输入大于 0 的数值"且 1px 边框转 `--danger`，**不静默降级为"不限速"**。
- 菜单定位（2026-10-25 实测修复：原实现按整行元素 rect 锚定，右键菜单被固定在行右下角）：一律以**坐标点**锚定——行右键取 `clientX/clientY`，Ellipsis 按钮取按钮 rect 右下角（`x = right - 4, y = bottom + 4`）；向右下展开，右侧/下方放不下时翻转到左/上，四周保留 8px 视口边距（菜单 200×148）。点外部 / Esc / 任意容器滚动 / 窗口 resize 均关闭。
- 第一层左侧保留 12px 宽度的状态位给 badge 吗？——不。badge 放第三层末尾（见下），第一层保持纯净。

**第二层（4px 高进度条 + 百分比）：进度行**
- 布局：进度条 flex-1 + 右端百分比，水平 gap 8px，行高 16px 垂直居中。
- 进度条：高 **4px**、`--radius-full`；轨道 `--progress-track`；填充色按 §1.2 状态映射；width 过渡 `--motion-progress`（250ms linear）。等待态条纹填充：`repeating-linear-gradient(45deg, var(--meta) 0 4px, transparent 4px 8px)` 整轨覆盖、opacity 0.5。
- 百分比：mono 12px `--fg-2` tabular-nums（"63.4%"）；无总大小显示 `--`；完成态 "100%"。

**第三层（16px 高）：元数据行**
- 12px，元素间 " · "（U+00B7）分隔；数字部分一律 mono tabular-nums。
- 通用顺序：`已下载 / 总大小`（mono `--fg-2`，如 "1.4 GB / 2.4 GB"）→ 速度（仅下载中，mono `--fg-2`）→ 剩余时间（mono `--muted`，格式见 §6.5）→ 分片 `2/8 分片完成` / `8 分片并行中`（mono `--muted`，仅下载中，双态规则见 §1.2 补充规则）。
- 状态 badge 悬浮于第三层右端（与百分比列对齐区域下方不冲突——直接放元数据行最右侧，margin-left auto）。
- 失败态：第三层最左侧为错误摘要（`--danger` 12px，超长截断 + tooltip 全文）。
- 完成态：`总大小 · 完成于 今天 14:32`（时间 `--muted`）。

**行状态样式**（2026-11 第七轮：选中态可辨性修复；第九轮：去掉装饰性竖条）：
- hover：bg `--surface-2`（150ms）。
- **选择集合高亮**：`has(task.id)` 为真的行 bg `--primary-soft`（`.row-selected`）——**整行底色保留**（用户第九轮只要求去掉「左边的框框」，未要求去掉底色）。第七轮曾叠加 `box-shadow: inset 3px 0 0 var(--primary-bg)` 左侧竖条，但该竖条沿 `.row` 的 `border-radius` 渲染成一个描边小框，用户原话「选中时只显示对号，不要这个左边的框框，这个就是 ai 味道，写进约束，坚决不要」，**第九轮整条删除**（§0 P0-5 硬规则）。
  - `.row.row-selected` 提升特异性，`.row.row-selected:hover` / `.row.row-selected:focus-within` 三态都压过普通 `.row:hover` / `.row:focus-within`；`.row.row-selected:focus-visible` **只保留** `box-shadow: var(--focus-ring)`，不再把竖条与焦点环叠在一起。**不改 design token 全局定义**，颜色一律 `var(--token)`。
- **选中对号（唯一行内标识）**：仅 `highlighted` 为真时在行首渲染 16px `Check`（`@lucide/vue`，纯状态指示、`aria-hidden` + `pointer-events:none`，**不是复选框、不可交互**）。外层 `.select-mark` 是常驻 16px 固定前导槽，未选中时同样占位 → 文件名不左右跳；位置在行首文件名之前，不与「文件已丢失」徽标、hover 操作组、进度百分比重叠。`.select-mark` 规则体**只允许** `display/align/justify/flex/width/height/color/pointer-events`，禁止 `border` / `border-radius` / `background` / `box-shadow` / `outline` / `padding` 等任何会形成「框」的声明（§0 P0-5 + `architecture.guard.test.ts` 的 `P0-3` 规则体切片护栏）。
- **焦点环**：roving tabindex 由 `selectedId` 决定哪一行可聚焦，实际 `:focus-visible` 时叠加 `--focus-ring`；高亮不依赖焦点行。
- 失败行可选弱强调：无整行染色（克制），仅 badge + 错误文字表达。
- `.row` / `.list` 均声明 `user-select: none`（Shift 连选 / 拖框时不出现浏览器蓝色文本高亮）；`base.css` 的 `input, textarea { user-select: text }` 兜底，不误伤限速输入、搜索框与弹窗输入框。
- 行首仍**没有复选框**（§2.9）：16px 前导槽只承载只读对号，不占可交互状态位。

### 2.4 状态栏（32px，水平 padding 16px，12px 文字）

**三段网格**（`grid-template-columns: minmax(0,1fr) auto minmax(0,1fr)`，gap 12px）：左 = 计数 · 中 = 总速度 · 右 = 默认目录。

- 左：`共 12 个任务 · 3 个下载中 · 1 个失败`（`--muted`，数字 mono tabular-nums `--fg-2`，超长省略）。「N 个下载中」按 §2.2 的 `isInProgress` 分组口径计数（含 pending / paused），与分段控件 tab 计数同源，不是 `status === 'downloading'` 的条数。
- 中：**全部任务总实时速度（只读）**——ArrowDown 16（`--muted`，`aria-hidden`）+ 数值（mono 12px `--fg-2` tabular-nums，十进制格式见 §6.5），如 "12.4 MB/s"。**纯文本状态信息**：不可点击、无 hover 背景、无 title 提示、`cursor: default`；容器 `role="group"` + `aria-label="全部任务总速度（只读）"`。**速度为 0（无下载中任务）时整段隐藏**，避免长期常驻 "0 B/s" 噪音。窄窗（`≤860px`）同样整段隐藏，优先保证计数与目录可见（见 §8）。
- 右：默认下载目录路径（mono 12px `--meta`，超长省略号，`cursor: default`）+ FolderOpen 16 图标（`--meta`，`aria-hidden="true"`）。**目录为纯展示**：无 click、无 hover 反馈、无 title/aria-label 按钮语义；空路径时整组不渲染。
- **指针语义（2026-11 用户实测问题 3 + 交互减法）**：状态栏内**没有任何可控件**——计数、总速度、目录三者都是展示信息，一律默认光标。原「FolderOpen 打开下载目录」按钮已移除：opener 受 ACL 路径作用域限制无法授权，点击必然失败（`Not allowed to open path ...`），能点的按钮失败比不可点的图标更误导。打开目录的能力保留在任务行操作组（后端 `open_file_location` 命令）。

### 2.5 交互与键盘路径

| 输入 | 行为 |
|---|---|
| Ctrl+N（全局，含设置页） | 打开添加任务弹窗 |
| Ctrl+F（主界面） | 聚焦搜索框 |
| Tab / Shift+Tab | 自然顺序（顶栏 → 列表行；状态栏全部为只读文本，无可聚焦控件，Tab 直接跳过），全部 focus-visible 环 |
| ↑ / ↓ | 列表行间移动焦点（roving tabindex，焦点行 `:focus-visible` 出 `--focus-ring`；高亮由选择集合决定，不跟随焦点） |
| Space（行焦点） | 暂停/恢复该任务（pending/completed/failed 态无操作） |
| Del（行焦点） | 触发删除流程（见 §2.6 删除确认） |
| Enter（行焦点） | 已完成 = 打开目录，**复用行内动作分发 `onAction(task, 'open-dir')`**（与点击共用同一条 try/catch + `pushError` 出口，禁止键盘路径另写一份调用——两份实现必然分叉）；下载中/暂停 = 无操作（防误触） |
| 左键点击任务行 | 清空原选择、只选中该行，并把 `selectedId` 设为该行；行内操作按钮已有 `@click.stop`，不触发选择（见 §2.9） |
| Ctrl + 点击 | 切换该行在选择集合中的成员资格（不清空其它行），并更新 Shift 锚点 |
| Shift + 点击 | 以上一次点击为锚点，按**当前 `visible` 顺序**连选（沿用 `useTaskSelection.toggle` 的 shift 分支） |
| Ctrl + A | 全选当前筛选结果（`tasksStore.visible`），**不是** `store.tasks` 全集；焦点在 `input` / `textarea` / `select` / `contentEditable` 内时不拦截，让浏览器全选文本；有模态弹窗打开时同样不拦截 |
| 点击列表空白区 | **阈值内（<=4px）**：清空选择集合（`<main>` 的 `@click.self`，行内点击不清空） |
| 空白区按住左键拖框 | **框选 marquee**（§2.9）：画选区矩形，覆盖到的当前 `visible` 行被选中；普通＝替换，Ctrl / Shift / Meta＝追加。从任务行上按下仍走单选 / Ctrl / Shift，不被劫持 |
| 行右键 | 以鼠标 `clientX/clientY` 为锚点打开上下文菜单：行不在集合内 → 先清空并只选该行 → **单选菜单**；已在集合内且选中 >1 → **多选菜单**（见 §2.9） |
| 菜单键 / 行内「更多」按钮 | 打开该行的**单选**「更多」菜单（4 项不变；按钮锚点用按钮 rect 右下角，与右键的坐标锚点不同） |
| Esc | 关闭菜单/弹窗；搜索框聚焦时清空并失焦；**无菜单/弹窗/搜索焦点时清空选择集合**。弹窗（`ConfirmDialog` window capture）、两个右键菜单（document 级）、搜索框（input 级）的 Esc 各自先 `stopPropagation()`，因此"关弹窗/关菜单/清空搜索"不会连带清空选择（见 §2.9） |

所有 hover/active 反馈 150ms（§1.5）；操作按钮点击后立即反馈（暂停图标切换无延迟，进度数据以 4Hz 事件为准但 UI 不等数据）。

**两套「选中」语义（最容易写错的点）**：`TaskListView.selectedId: ref<string \| null>` 是 **roving tabindex 键盘焦点行**（单行，决定 ↑↓ / Space / Delete / Enter 落在谁身上，驱动 `rowTabIndex` / `moveSelection` / `focusRow` 与 `:focus-visible` 焦点环）；`useTaskSelection()` 的 `checkedIds: Set<string>` 是**选择集合**（多行，驱动 `.row-selected` 高亮、右键菜单单选/多选切换、批量动作作用于谁）。两者不互相赋值、不互相覆盖；composable 内不出现 `selectedId`，主视图不自行维护第二份选择集合。

**删除流程（F8）**：两条路径语义不同，确认框按任务状态派生按钮。
- 删除**未完成**任务（pending/downloading/paused/failed）：标题"删除任务"，正文"「{文件名}」将从列表中移除，未完成的下载进度会一并清除。"，按钮：Ghost"取消" / Destructive-soft"删除"。未完成任务磁盘上只剩 `.part`，后端无论按哪个键都会清掉，因此**不给"是否删文件"的选择**（给了就是假选项）。
- 删除**已完成**任务：标题"删除任务"，正文"「{文件名}」已下载完成。选择「删除任务和文件」会一并删除磁盘上的文件。"，按钮：Ghost"取消" / Secondary"仅删除任务" / Destructive-soft"删除任务和文件"（`remove_task` 的 `delete_files` 为 true）。选"仅删除任务"给 Toast + 5s"撤销"；选"删除任务和文件"**不给撤销**（文件已删，撤销无从恢复），Toast 文案用 `remove.removedWithFileToast`。
- 已完成任务也必须先确认再删：磁盘上有成品文件，"是否连文件一起删"只有用户能回答。

### 2.6 列表五态

| 态 | 视觉与文案 |
|---|---|
| **Empty**（无任务） | 列表区垂直居中：Download 24px `--meta`（下方 16px 间距）→ 主文案"还没有下载任务"（16px/500 `--fg-2`）→ 副文案"复制链接后按 Ctrl+N，或点击右上角「新建任务」，粘贴即可开始"（13px `--muted`）→ 16px 间距 → Primary 按钮"新建任务"（Plus 16，空态无进度条，不违反 primary ≤2 纪律） |
| **Empty**（筛选无结果） | 同上结构但文案："没有{筛选名}的任务"（默认视图下如"没有下载中的任务"；另有"没有失败的任务"）+ 副文案"切换到「全部」查看所有任务"；无 CTA 按钮，提供 Ghost 按钮"查看全部"（走 `setFilter('all')` 单点） |
| **Loading**（首屏） | 3 条骨架行（高 80px、`--radius-md`、bg `--surface-2`，内部两条灰色块模拟三层），shimmer 扫光周期 1.2s；数据到达即替换（无出场动画叠加） |
| **Error**（列表加载失败） | 居中：AlertCircle 24 `--meta` + "任务列表加载失败"（16px/500 `--fg-2`）+ 错误详情 13px `--muted` + Secondary 按钮"重试"（RotateCw 16，重新调 `list_tasks`） |
| **Populated** | §2.3 正常渲染 |
| **Edge** | 超长文件名省略 + tooltip；未知大小 `--`；0 字节直接完成态；速度 0 显示 "0 B/s"；剩余时间不可得显示 `--`；任务数 >200 时启用虚拟滚动（MVP 预留注释位，首版直接渲染） |

### 2.7 主界面图标映射汇总

Plus 16（新建）· Search 16（搜索）· X 16（清空搜索）· ArrowDown 16（状态栏总速度）· Gauge 16（任务限速菜单）· Settings 20（设置入口）· Check 16（成功 toast / **选中行对号**）· Pause 16 · Play 16 · RotateCw 16 · Trash2 16 · FolderOpen 16 · ExternalLink 16 · Ellipsis 16（更多）· Download 24（空态）· AlertCircle 16/24（错误态）· ListChecks 16（多选菜单「已选 {n} 个任务」只读提示）· FileWarning 16（文件已丢失徽标 / 独立筛选开关）。

### 2.8 列表渲染稳定性与限速即时反馈（2026-11 用户实测修复）

三条实测缺陷的根因都指向同一个设计盲区：**"数据变了"与"UI 该变了"之间缺少显式的回写/合并契约**。以下三条成为实现不变量，改动时不得回退。

| # | 现象 | 根因 | 不变量（实现点） |
|---|---|---|---|
| 1 | 单任务设限速后不立刻显示，要等列表刷新 | `applyLimit()` 只 `await set_task_speed_limit` 就关菜单，**没有回写本地 store**；限速变更不触发任何 `task:*` 事件，列表只在事件/操作时刷新 | 限速走 store 动作 `setTaskLimit(id, bps)`：成功后**就地 patch `task.speedLimit`**，不做全量 refresh（`stores/tasks.ts`） |
| 2 | 设 2MB → 设不限速 → 重开面板输入框仍显示 2 | 同 1 的根因（`speedLimit` 从未被更新），面板又用 `props.task.speedLimit` 初始化 | 不限速一律写 **`null`**（不是 `0`/`undefined`）；每次 `openLimit()` 都从 store 重读，`null` 时显式置空；非法输入内联提示而非降级（`TaskMoreMenu.vue`） |
| 3 | 定时/事件刷新导致整列表闪烁 | `fetch()` 是 `this.tasks = await listTasks(...)` 整体替换 → 每条任务都是新对象、行组件被重建；`.row` 上挂着 `animation: row-in`，配合 `onStateChanged` 的"先 patch 再 refresh"双重更新反复重放 | a) `fetch()` 按 id **增量合并**（`utils/mergeTasks.ts`，已存在任务 `Object.assign` 保留对象身份）；b) `onStateChanged` **不再 refresh**（仅本地缺记录时兜底一次）；c) 入场动画只挂 `.row-enter`，由 `isNew`＝"首次出现的 id"决定，`seenIds` 跨筛选保留 ⇒ 刷新/切筛选不重放 |

附带约束：
- `Frame` 4Hz 直写仍只经 `applyFrame` 改 frame 对象；合并后 `pruneFrames()` 保留原语义（非下载态任务清帧），**不得因合并逻辑把帧清空**。
- **不 refresh 的代价必须显式补齐**（否则是静默缺失）：`onStateChanged` 离开下载态时把**最后一帧**的 `downloadedBytes`/`totalBytes` 回写到记录（帧随后被删），完成态用本地 `now` 落 `updatedAt`——否则完成行的「已下载 / 总大小」与「完成于」会停在上一次刷新的值。
- 合并后数组顺序以服务端返回为准，元素是同一批对象引用（可用 `splice` 或新数组 + 原引用），`:key` 仍为 `task.id`。
- 三条路径的回归护栏：`utils/mergeTasks.test.ts`（保身份/新增/删除/幂等）、`stores/tasks.test.ts`（限速回写、fetch 合并、stateChanged 不 refresh）、`stores/tasks.behavior.test.ts`（mock IPC 跑真实 store：限速即时可见 / 不限速为 null / 对象身份保留 / 事件不多发拉取 / 完成态字段补齐）、`components/task/TaskRowEnter.test.ts`（动画只挂新行、面板取 store 值、非法输入不降级）。

### 2.9 迅雷式多选 + 右键菜单（Ctrl 多选 / Ctrl+A / Shift 连选 / 按数量切换菜单）

用户口径（2026-11 裁决，推翻上一版）：**「不是加复选框和批量操作栏，而是按住 ctrl 可以多选，ctrl + a 可以全选，然后右键操作，可以执行的操作按照选择的任务数量来决定，选择了多个就可以全部暂停、全部开始，单个任务的话就没有全部 xxx 的功能，也就是和迅雷一样的逻辑」**。

因此**删除** `BulkActionBar.vue`（整文件）、`TaskRow` 的复选框 / `.row-check` / `checked` prop / `check` emit、`TaskListView` 的批量条接线与 `toggleAll`/`master`、以及 `bulk.barAria` / `bulk.selectAll*` / `task.selectAria` 等文案键。顶栏与列表之间不再有 40px 常驻条。

**组件拆分（硬约束：`TaskListView.vue` 基线 296 非空行，第七轮接线后 299 行，禁止继续堆；菜单归 `TaskRow.vue`，框选归新文件）**：

| 单元 | 单一职责 |
|---|---|
| `composables/useTaskSelection.ts` | 选择状态机：`checkedIds: Set<string>`、`selected`（从 visible 派生）、`count`、`selectOnly/prepareContext/toggle/selectAll/selectIds/clear/removeIds/onWindowKeydown`（`selectIds` 为框选批量提交） |
| `components/task/TaskRow.vue` | 行点击分流（emit `select` / `context`）、按 `selectionCount` 在两套菜单间切换、`.row-selected` 高亮 + 16px 选中对号 |
| `components/task/TaskMoreMenu.vue` | **单选**菜单：保持原 4 项（打开文件 / 打开目录 / 任务限速 / 删除），**不得出现任何「全部 xxx」项** |
| `components/task/TaskContextMenu.vue` | **多选**菜单：只读提示 + 三个批量项 + 删除项 + 三按钮删除确认（独立组件，避免撑爆 TaskMoreMenu 的 300 行门禁） |
| `composables/useBulkActions.ts` | 批量动作编排：循环复用现有命令、单条失败不中断、部分失败汇总、一次 `refresh()` |
| `utils/bulk.ts` | **两份语义的唯一实现**：`bulkTargetIds(kind, tasks)`（动作→状态判据）、`deleteFilesFromKey(key)`（三按钮 key → `deleteFiles`） |
| `composables/useMarqueeSelection.ts` | **框选状态机**（§2.9 末）：纯几何 / 阈值 / 追加替换 / click 抑制 + Vue 生命周期包装 |
| `components/task/MarqueeBox.vue` | 框选矩形纯渲染（token 配色、`pointer-events:none`） |
| `components/task/MarqueeLayer.vue` | 框选容器：把 composable 的 `box` 交给 `MarqueeBox`，`commit` 事件回传 `selectIds`；单独成件以免撑爆 `TaskListView.vue` |

**交互契约（逐条对齐用户原话）**：

- **左键点击任务行**（不含行内操作按钮区，按钮已有 `@click.stop`）＝清空原选择、只选中该行（`selectOnly`），同时把 `selectedId` 设为该行；`Shift` 锚点一并更新。
- **Ctrl + 点击**＝切换该行在集合中的成员资格（不清空其它行），更新 Shift 锚点。
- **Shift + 点击**＝以上一次点击为锚点按当前 `visible` 顺序连选（沿用 `toggle(id, true)` 的 shift 分支，不清空已有选择）。反向连选同理；`clear()` 重置锚点，之后首次 Shift 退化为普通切换。
- **Ctrl + A**＝全选当前 `visible`（**不是** `store.tasks` 全集）。焦点在 `input` / `textarea` / `select` / `contentEditable`（搜索框、限速输入、弹窗输入框）内**不拦截**，让浏览器全选文本；有 `role="dialog"` 模态打开时也不拦截，避免背后选择集合被悄悄改写。
- **Esc**＝清空选择；沿用现有 Esc 归属纪律：搜索框（input 级）、`ConfirmDialog`（window capture）、两个右键菜单（document 级）先 `stopPropagation()`，故「清空搜索 / 关弹窗 / 关菜单」不会连带清空选择。
- **点击列表空白区**＝清空选择（`<main>` 的 `@click.self`；行内点击不清空）。
- **选中行高亮**用 `.row-selected`（`--primary-soft`），由 `has(task.id)` 驱动；**焦点环**仍由 `selectedId` / roving tabindex → `:focus-visible` 驱动。两者互不覆盖，composable 内不出现 `selectedId`。
- **选择集合始终从 `visible` 派生**：筛选隐藏的行永不参与动作；集合本身可保留隐藏 id，筛选切回自然恢复。选择变化不参与 `:key`（恒为 `task.id`）与 `isNew`，不会重放 `.row-enter`（§2.8 不变量不变）。
- **右键**：若右键的行**不在**选择集合中 → 先清空并只选中该行（`prepareContext`）→ **单选菜单**；若**已在**集合中且集合 >1 → 保持多选 → **多选菜单**。菜单锚点用鼠标 `clientX/clientY`（`onContextMenu` 现有实现，不得改回整行 rect）；行内「更多」按钮仍以按钮 rect 右下角为锚点且始终打开单选菜单。

**右键菜单规格（按选中数量切换，动作项数决定菜单）**：

- **单选（选中 1 条）**：`TaskMoreMenu.vue` 的 4 项原样不变（打开文件 / 打开目录 / 任务限速 / 删除），**零「全部 xxx」项**；文件已丢失时「打开文件」禁用、「打开目录」保留（§2.10）。
- **多选（选中 >1 条）**：顶部只读提示「已选 {n} 个任务」（`bulk.selected` + `ListChecks` 16）→「全部暂停」（`bulk.pauseAll`）/「全部开始」（`bulk.resumeAll`）/「全部重试」（`bulk.retryAll`）/ 分隔线 /「删除选中任务…」（`bulk.removeSelected`）。
  - 三项可用性统一用 `bulkTargetIds(kind, selected).length > 0` 判定；无可操作对象时 **disabled 而非隐藏**，保持菜单项数稳定。
  - 菜单高度 `estimatedHeight` 由 `ACTIONS.length` 动态算出后传给 `anchoredStyleAt`，贴近屏幕底部时翻转判断才不会错（写死 148 会在菜单项变化时误判）。
  - 删除点开三按钮 `ConfirmDialog`（取消 / `remove.onlyTask` / `remove.withFiles`），`deleteFilesFromKey(key)` 单点映射；含已完成任务时用 `bulk.removeMessageCompleted` 说明"只有选删除任务和文件才删文件"。删除成功后 `emit('removed', result.succeeded)` → `removeIds()` 清理选择。
  - 确认弹窗打开期间菜单不能因外部点击 / Esc 被卸载（否则会连带销毁弹窗），用 `confirmOpen` 守卫；Esc 交给弹窗的 capture 监听消费。

**按钮可用性与执行目标同源**：`can.pause/resume/retry` 与 `useBulkActions.run()` 都取 `bulkTargetIds`——暂停只对 `downloading`、开始只对 `paused`、重试只对 `failed`。禁止在组件里再写一份 `status === 'paused'` 判据（两份判据必然随需求变更分叉）。

**批量动作编排（不变）**：

- **不新增后端 API**：循环复用 `pauseTask` / `resumeTask` / `retryTask` / `removeTask`（`api/tasks.ts`）。
- 每条独立 `try/catch`：**单条失败走 `toast.pushError('toast.saveFailed', e)` 且不中断其余条目**；`failed > 0` 时额外推 `bulk.partialFailed` 汇总 toast，不静默吞。
- `resume_conflict` 仍复用 `isResumeConflict` 单点判定 → `uiStore.openResumeConflict(id)`。
- **一次刷新**：循环结束才 `tasksStore.refresh()` 一次，避免 N 条动作触发 N 次 `list_tasks`（性能盲区：循环内 IO 放大）。

**批量删除照搬单文件语义**：`deleteFilesFromKey(key)` 得出布尔值后**逐条**传给 `removeTask(id, deleteFiles)`。后端两条规则不同：`.part` 一律清（未完成任务），成品文件只在 `deleteFiles=true` 时删（已完成任务）。判据单点在后端 `http/ops.rs`，前端不复制该规则、也不写 `key === 'with-files'`。

**回归护栏**：`composables/useTaskSelection.test.ts`（selectOnly / Ctrl 切换 / Ctrl 连点 3 行无覆盖 / Ctrl+A 只作用 visible / 文本输入不拦截 / Esc / removeIds / selectIds / Shift 连选 / 筛选派生）、`composables/useBulkActions.test.ts`、`utils/bulk.test.ts`、`views/TaskListView.bulk.test.ts`（无批量条无复选框、点击/快捷键接线、单选菜单零「全部」、多选菜单有批量项、判据只走 `bulkTargetIds`、`deleteFilesFromKey` 单点、确认框按状态派生按钮、文件丢失呈现态未丢）、`components/task/FileMissing.guard.test.ts`、`composables/useMarqueeSelection.test.ts`、`views/Marquee.guard.test.ts`、`stores/tasks.defaultView.test.ts`。

### 2.9.1 空白区拖框多选（marquee，2026-11 第七轮用户实测）

用户原话：「鼠标从任务列表空白位置出开始按住左键可以画框，框覆盖的任务都被选中，就和选文件或文件夹一样」。

- **启动条件**：`mousedown` 的 `event.target === <main class="list">`（空白区本身）且为左键（`button === 0`）。从任务行按下时 `target` 是行，绝不劫持既有左键单选 / Ctrl 切换 / Shift 连选。监听挂在 `window`（不直接绑列表 DOM），避免子组件 `onMounted` 早于父组件模板 ref 赋值拿到 null；判 `target` 与 Vue `.self` 语义等价。
- **阈值 4px**（欧氏距离 `Math.hypot`）：阈值内移动＝普通点击，不画框、不提交、不吞 click，仍由 `@click.self="clearChecks"` 清空；超过阈值才画框。
- **关键坑（必须处理）**：拖动结束后浏览器仍会派发一次 `click`（目标是 mousedown / mouseup 的公共祖先，通常是 `<main>`），会命中 `@click.self` 把刚框好的选择立刻清空。用 `suppressNextClick` 标志位在 `window` 的 **capture 阶段**吞掉这一次 `click`（`stopPropagation` + `preventDefault`，只生效一次）；任意新 `mousedown` 复位标志，防止拖框后在窗口外释放时残留标志误吞后续无关点击。既有 `@click.self="clearChecks"` 保留不删。
- **命中判定**：`getBoundingClientRect()` 取行 rect，与鼠标 `clientX/clientY` 视口坐标比较（两者同坐标系，天然抵消列表 `scrollTop`，无需换算）；矩形与行 rect 相交即选中（仅擦边不算）。目标集合再过一遍当前 `visible` 的 id 白名单，**筛选隐藏的行永不参与**。
- **替换 / 追加**：普通框选＝替换（`selectIds(ids, false)`，先清空再选）；Ctrl / Shift / Meta 框选＝追加（`selectIds(ids, true)`，与既有集合取并集）。`selectIds` 内部再按 `visible` 白名单过滤一次兜底，并复位 Shift 锚点。
- **结束 / 取消**：`mouseup` 后矩形消失、选择集合保留；`Esc`（沿用 `useTaskSelection.onWindowKeydown` 清空选择）或窗口失焦中途取消画框 → 矩形消失、不提交。
- **矩形样式**：只用 token——`border: 1px solid var(--primary-bg)` + `background: var(--primary-soft)`（`opacity` 调透明度）、`pointer-events: none` 防干扰 mouseup；`position: fixed` 配视口坐标，`z-index` 低于菜单/弹窗。**严禁硬编码色值 / RGB 函数 / emoji**。
- **前置条件**：`.row` / `.list` 的 `user-select: none`（§2.3）保证拖框过程不出现蓝色文本高亮；`base.css` 的 `input, textarea { user-select: text }` 兜底。
- **范围外**：自动滚动、触摸手势、虚拟滚动（§2.6 已标注 >200 任务首版直接渲染）本轮不做。
- **可验证性**：`createMarqueeMachine` 刻意做成只吃普通数值事件对象 + 注入依赖的纯状态机（仓库 vitest `environment=node`，无 jsdom），阈值 / 追加 / 替换 / 相交命中 / 后续 click 不清空 / Esc 取消 / 失焦取消全部有行为用例；`useMarqueeSelection` 仅负责 DOM 监听与生命周期注销，静态接线由 `Marquee.guard.test.ts` 断言。**真实 WebView2 鼠标拖框未做 GUI 实测**。

### 2.10 已完成任务文件丢失的呈现态

> **定性：这是瞬时派生呈现态（transient derived presentation state），不是业务状态。**

用户场景：**用户在应用外**（资源管理器 / 清理软件）删除了硬盘上的下载文件，任务记录仍在。用户原话「任务里该任务就变成淡一些的颜色，一眼能看到下载的任务被删除了，但是任务没删」。

**为什么不是业务状态（四条理由，决定实现边界）**：

1. **事实源在应用外**：文件存在性由磁盘决定，不由下载引擎的任务状态机决定。把它写进 `TaskRecord` 等于让一份外部事实污染与 Rust serde 逐字段对齐的 IPC 契约（`api/types.ts` 一个字段都不加）。
2. **会自愈**：用户把文件放回来后，下一次检测返回空数组，徽标与降权应自动消失；若落成持久业务状态，就必须再造一个「解除标记」命令 + 一次状态迁移 + 一次落库，纯属多余且易漏。
3. **不是状态机的第六态**：`TaskStatus` 五态（`pending / downloading / paused / failed / completed`）描述的是**下载生命周期**；文件被删不改变下载结果，任务仍是 `completed`。新增枚举值会让所有状态映射表（§1.2）、筛选、托盘、通知语义同时分叉。
4. **不可落库、不可自动清理**：需求明确「绝对不要删除任务、不要改任务状态、不要自动清理记录」。呈现态只活在当前会话的 store 里，进程重启后由一次检测重新派生，不留任何持久化痕迹。

**唯一数据源与跨端契约（已冻结，SPEC §5.1）**：

```
命令名 check_files（snake_case，永不做 camelCase 转换）
参数   { taskIds: string[] }   // 前端传当前 store.tasks 全部 id
返回   string[]                // 关联正式文件不存在的「已完成任务」id 列表
```

`api/tasks.ts::checkFiles()` 走统一 `invoke` 封装；仅 `src/api/` 可直连 `@tauri-apps/api`。

**检测时机（事件驱动，不轮询）**：只在 ① `fetch()` **成功**后（`fetchRevision` 递增，`useMissingFileCheck` watch 它）与 ② `window` 的 `focus` 事件（覆盖「切到资源管理器删文件再切回来」这一最典型路径）重查。**不挂 4Hz 进度帧**（`applyFrame` 不涉及 `fetchRevision`）、**不做轮询**。并发重查用序号 `seq` 收敛，只认最后一次结果，旧响应不得覆盖新响应；组件卸载 `dispose()` 并解绑监听。

**判据单点**：`stores/tasks.ts::fileMissingIdsOf(tasks, missingFileIds)` 是「哪些任务算文件丢失」的**唯一实现**——`id` 命中后端返回集合 **且** 当前任务仍是 `completed`（防御性收敛：本地状态可能先于检测结果变化，不该给非完成行挂徽标）。`visible` 的独立筛选、`missingIdSet` getter、`missingCount`、TaskRow 的 `fileMissing` 全部由它派生，全项目不存在第二份判定。

**呈现（四条同时生效，任务记录/状态一律不动）**：

| 呈现 | 实现 | Token |
|---|---|---|
| 行内徽标 | `TaskRow.vue` 右侧 `FileWarning` 16 + 文案 `task.fileMissing`「文件已丢失」 | `--warn` 字 / `--warn-soft` 底 / `--radius-full` / `--text-xs` |
| 整行降权 | `.row-file-missing { opacity: 0.6 }`，150ms 过渡（§1.5） | **只用 opacity，不写死色值** |
| 禁用「打开文件」 | 行内 `ExternalLink` 图标按钮与「更多」菜单的「打开文件」项均 `:disabled="fileMissing"` | `IconButton` / `.menu-item:disabled` 已有 disabled 态 |
| 保留「打开目录」 | `FolderOpen` 两处入口均不禁用——用户可能想去看目录里还剩什么 | 不变 |

**可单独筛选**：顶栏 `FilterTabs.vue` 增加**独立开关** `missingOnly`（`role="switch"`，仅 `missingCount > 0` 时出现），与四值状态筛选是 **AND** 关系；切任一状态 Tab 走 `setFilter()` 单点并退出独立筛选。**不新增第五个 `TaskFilter` 值**，四值语义 `'all' \| 'downloading' \| 'completed' \| 'failed'` 原样保留。独立筛选无结果时 `EmptyState` 用 `empty.missingTitle / empty.missingSub` 给出下一步动作（「关联文件都在，切换到「全部」查看所有任务」），不留空洞占位。

**失败降级（不许零日志）**：`check_files` 是需求 2 的唯一数据源，命令名写错 / 后端没注册 / 参数形状不对时，若完全静默就会变成「功能做了但永远不生效、且没有任何报错」的静默失效家族。因此 `createMissingFileChecker` 的 `catch` 里**恰好一次** `console.warn('[check_files] …', e)`（与 `api/notification.ts` 同款，仅 dev 排查用）：**不弹 toast 打扰用户**、**不清空已有 `missingFileIds`**（失败时保留上次结果比清零更稳）、不改任务状态、不落库。

**不变量清单**：不写 `TaskRecord`、不改 `TaskStatus` 五态、不落库、不增删任务记录、不自动清理、不新增后端写命令、不轮询。文件放回后 focus 重查自动复原；`setMissingFileIds([])` 顺手关掉独立筛选，避免留一个空筛选。

**回归护栏**：`composables/useMissingFileCheck.test.ts`（成功写入 / 失败 warn 恰好 1 次且呈现态不变 / 放回后复原 / 并发收敛 / dispose / 无轮询）、`stores/tasks.missing.test.ts`（唯一判据 / 不污染 TaskRecord / 独立筛选与四值 AND / fetch 成功才重查 / 4Hz 帧不触发 / 契约字段不变）、`api/tasks.checkFiles.test.ts`（命令名 snake_case 与参数形状）、`components/task/FileMissing.guard.test.ts`（徽标 + 降权 + 禁用打开 + 保留打开目录 + 可筛选 + AC-13 文案）。

---

## 3. 页面二：添加任务弹窗（主界面模态，渐进披露）

### 3.1 容器与层级

- 宽 **480px**，自适应高度（max-height 80vh）；bg `--surface`、`--radius-lg`、`--elev-raised`、padding 24px；遮罩全屏 `--overlay`（点击遮罩 = 取消，若已输入内容先弹"放弃"确认：正文"已填入的内容将丢失"，按钮"继续编辑/放弃"）；z-index 1200。
- **头部/底部固定，仅内容区滚动**（2026-11 用户实测：滚动条贯穿整个弹窗，标题与底部按钮跟着滚）：`.panel` 为 `display:flex; flex-direction:column; max-height:80vh; overflow:hidden`；`.head { flex:none }` 固定顶部；默认插槽包一层 `.body { flex:1; min-height:0; overflow-y:auto }` 作**唯一滚动容器**；新增可选 `#footer` 具名插槽 `.foot { flex:none }` 固定底部。滚动条垂直范围只从标题栏下沿到底部操作区上沿。短内容（如确认弹窗）不出现滚动条，视觉位置不变。
- **滚动容器必须给焦点环留画环余量**（2026-11 用户实测："获得焦点时左右边框没有"）：`--focus-ring` 是 3px **外环**，而 `.body` 原本水平内边距为 0、宽度正好等于输入框宽度，`overflow-y:auto` 会把外环的左右两段（视觉上连同输入框的 1px 边框一起）裁掉，只剩上下两段，看起来就像"左右没有边框"。修法：`.body` 加 `padding: var(--space-1)` + **等量负** `margin: calc(var(--space-1) * -1)`——内容盒位置与宽高完全不变，只是给外环腾出 4px。判据：负 margin 必须与 padding 等量抵消、不改变内容盒几何，否则就是"把内容压上去"的布局 hack，一律退回。
- 头部：标题"新建下载任务"16px/500 `--fg` + 右上 X 16 图标按钮（28px hit，aria-label "关闭"）。头部下方 16px 间距进入主体。
- 底部按钮区移到 `#footer` 插槽后，间距靠 `.footer` 的 `margin-top: 24px`（= 原 form 内 16px gap + 原 8px margin）+ `padding-top: 16px` + 1px `--border-soft` 分隔线保持原观感。
- **跨插槽提交**：`<form id="add-task-form" @submit.prevent="submit">` 在默认插槽，提交按钮在 `#footer` 插槽（form 之外），用 `type="submit" form="add-task-form"` 关联。`BaseButton` 把 `form` 显式声明为 prop 并绑定到根 `<button>`（其模板首节点原为注释 → Fragment 根会静默吞掉透传属性，已修复）。**只有一份 `submit` 实现**：点击提交按钮，或在单行输入框（文件名 / 展开后的分片数）内按 Enter 触发隐式提交，两条路径都落到同一个 form `submit` 事件 → `@submit.prevent="submit"`；不写第二份 `@click="submit"`。URL `<textarea>` 内按 Enter 依 HTML 规范是换行（textarea 不参与隐式提交，多条 URL 靠换行分隔），不是提交；弹窗初态只有这一个 textarea，文件名 / 分片数输入为条件渲染。因 `form="add-task-form"` 已让该按钮成为表单 default button，隐式提交与「blocking field 数量」兜底规则无关。
- 进入动画 200ms fade + scale 0.98→1；关闭 150ms fade-out。
- **焦点管理**：打开即焦点 URL 输入框；Tab 循环困在弹窗内；Esc 关闭（同遮罩逻辑）。焦点困环 / Esc / 遮罩点击 / 进入动画 / z-index 均不因三段式布局改动。
- **信息行 / 目录行不被遮挡（2026-11 截图补充自检）**：`.info-row`（「1.8 GB ✓ 支持分段加速」）与其下方 `AddDirRow` 的「保存到」靠 `.form` 的 `gap: var(--space-4)` 分隔；样式链内**无绝对定位、无负 margin**（唯一例外是 `AddAdvancedOptions` 的 `::-webkit-slider-thumb { margin-top: -6px }`，在表单控件内部，不影响行间布局）。
  - **仓库内可复跑证据**：`components/ModalLayout.guard.test.ts`（15 用例）**全部是源码文本静态断言**——vitest `environment: 'node'`，仓库无 playwright / puppeteer / jsdom 依赖，新增 4 条只守结构不变量：`.form` flex 列 + gap16、`.info-row` display:flex、样式链零 `position:absolute|fixed` 与零负 margin、滑块 thumb 唯一例外、`.head`/`.foot` flex:none + `.body` 唯一滚动容器 + `.body` 的 padding/负 margin 必须等量成对出现（焦点环留白）。**已对该护栏做过一次变异验证**（过程见交付回执：注入 `margin-top:-12px` → 1 用例变红 → `cmp` 字节一致恢复 → 14/14 全绿；QA 另以 `margin-top:-8px` 独立复现，判别力非作者自述）。**这些断言不是浏览器实测，不构成视觉验收**。
  - **一次性外部测量（非仓库证据、不可从仓库复跑）**：曾把 `ui/dist/assets/*.css` 复制到临时目录、按真实 SFC DOM 带编译后 `data-v-*` 作用域属性还原弹窗，用已安装的 Chrome 无头 `--dump-dom` 读回 rect（夹具仅在测量时 `animation:none` 关闭 `panel-in` 的 scale 以免坐标漂移；临时夹具已删除）。该次观察：scrollTop=0 / 半程 / 到底三处 head/body/foot 互不重叠，info-row 与「保存到」间距 16px，底部按钮始终完整可见；截图态（高级收起 / 无警示 / 无错误）滚到底时 info-row +「保存到」+ 目录行 + 底部按钮同时完整可见。**这是一次性外部夹具观察，不是自动化用例，也不等于 Tauri WebView2 真实 GUI 验收**。
  - **未做 GUI 实测**：Tauri WebView2 真实窗口截图与人眼复核、深浅主题对比度、真实 GUI 滚动条与 border-top 贴合度均未做，本项明确记为「未验证」，不得计入功能验收结论（§9.1 补充口径：静态护栏 + 行为单测不等于功能验收）。

### 3.2 渐进披露三阶段

**阶段 1 —— 默认只露一个输入**：
- Label："下载链接"（13px/500 `--fg-2`）。
- URL 输入：textarea（rows=2，min-height 64px，可拉伸），`--font-mono` 13px，自动焦点；支持粘贴多条 URL（换行分隔，自动识别去重）。
- 粘贴即校验：每行须匹配 `^https?://`；不合法行标 `--danger` 下划线 + 输入框下方内联错误"第 {n} 行链接格式不正确，需以 http:// 或 https:// 开头"（12px `--danger`）。
- Helper text："支持 HTTP/HTTPS 直链，一行一个，可批量添加"（12px `--muted`）。
- **剪贴板预填**（F6）：弹窗打开时若剪贴板为单条合法直链 → 自动填入并直接进入解析，URL 框下方显示"已自动填入剪贴板链接"（12px `--meta`，随首次编辑消失）。
- 输入合法后 500ms 防抖自动触发 `probe_url` 解析（不必等 Enter）。

**解析中指示**（阶段 1→2 过渡）：输入框下方行内 Loader2 16（旋转）+ "正在解析文件信息…"（12px `--muted`）；超时 2s（AC-01）显示"解析超时，请检查链接或直接添加" + Ghost 按钮"仍然添加"（跳过元数据直接 add_task，文件名用 URL 末段）。

**阶段 2 —— 解析成功后展开**（各区块间 16px）：
- **文件名**：Label "文件名"（13px/500 `--fg-2`）+ 输入框（32px，13px 正文字体），预填探测值可改；实时校验非法字符 `\ / : * ? " < > |`，错误"文件名不能包含 \ / : * ? \" < > |"。
- **文件信息行**（只读，13px）：大小 mono `--fg-2`（"2.4 GB"）+ Range 探测结果——支持：Check 16 `--success` + "支持分段加速"（`--success` 12px）；不支持：TriangleAlert 16 `--warn` + "服务器不支持分段加速，将单连接下载"（`--warn` 12px，AC-04 如实展示）。
- **保存目录**：Label "保存到"（13px/500 `--fg-2`）+ 行容器（32px 高，bg `--surface-2`、`--radius-md`、padding 0 12px）：FolderOpen 16 `--muted` + 目录路径（mono 13px `--fg-2`，省略号）+ 右侧"更改"Ghost 按钮（13px）→ 调系统目录选择器；默认值为设置页下载目录。
- **多条 URL 时**：不显示单文件信息行，改为摘要行"将添加 {n} 个任务，均保存到 {目录}"（12px `--muted`）。

**阶段 3 —— 高级选项折叠区**（默认收起）：
- 折叠头：ChevronDown 16（收起指向下、展开旋转 180°，150ms）+ "高级选项"（13px/500 `--fg-2`）。
- 展开（200ms 高度过渡）后仅一项：**下载分片数**——Label + 数值输入（32px、宽 88px、mono、min 1 / max 16 / step 1）+ 滑块（track 4px `--progress-track`、thumb 16px 圆 `--primary-bg`，键盘 ←→ 调整）；默认 16（取设置页默认值）；helper "分片越多对服务器压力越大，16 通常已是最优"（12px `--muted`）。（2026-10-23 项目总监裁决：分片数上限 64→16，与 Spec 契约对齐）

**底部按钮区**（顶部 1px `--border-soft` 分隔线 + 上方 16px）：
- **单行三元素**（2026-11 第七轮用户实测：原两行布局把提示放右上、取消放左下且被裁切）：DOM 顺序 = `预计 {n} 个分片并行` → Ghost"取消" → Primary"开始下载"，同一行。`.footer` 为 `display:flex; align-items:center; justify-content:flex-end; gap:var(--space-3)`；提示行 `margin-right:auto` 顶到最左；多个 URL / 未探测成功时提示不渲染，两个按钮仍靠右（无 `.footer-right` 包裹层，死样式已删）。
- 不变：`border-top:1px solid var(--border-soft)` / `padding-top:var(--space-4)` / `margin-top:var(--space-6)` 的间距观感；`<form id="add-task-form">` 与提交按钮 `type="submit" form="add-task-form"` 的跨插槽关联（Enter / 点击共用唯一一份 `submit`）。
- 提示行文案（仅单条 URL 且已解析）："预计 {segments} 个分片并行"（12px `--meta`）；主按钮文案"开始下载"（多条 URL 变"添加 {n} 个任务"）。
- **HTTP 未加密降级确认**（Spec §10）：URL 为 `http://` 时，底部按钮区上方插入警示行——TriangleAlert 16 `--warn` + "该链接为未加密 HTTP 连接，下载内容将明文传输"（12px `--warn`，bg `--warn-soft`、`--radius-sm`、padding 8px 12px）；点击"开始下载"即视为用户确认。

**提交流程**：点击提交按钮（或单行输入框内 Enter 隐式提交）→ 按钮进入 Loading 态（Loader2 16 旋转替换 Plus，文字不变，disabled）→ 成功：弹窗 150ms 关闭 + Toast "已添加 {n} 个任务"（Check 图标），任务入列表自动开始；失败（404/403 等）：按钮恢复 + 顶部内联错误条（`--danger`，AlertCircle 16），弹窗不关（AC-02 不产生半成品记录）。内联错误文案规则同 §6.4 Toast 前缀规则：后端 AppError 原样展示，只有非 AppError 才补「添加失败：」。

### 3.3 弹窗图标映射

Plus 16（主按钮）· X 16（关闭）· Loader2 16（解析中/提交中）· Check 16（支持分段、成功 toast）· TriangleAlert 16（不支持分段、HTTP 警示）· FolderOpen 16（目录行）· ChevronDown 16（高级折叠）· AlertCircle 16（提交失败）。

---

## 4. 页面三：设置页（路由 `/settings`）

### 4.1 布局结构

- 复用主界面外壳（原生标题栏 + 顶栏 + 状态栏），主体区不同：**顶栏在此页显示**：App 名 + "设置"（16px/500 `--fg`，App 名与"设置"间 8px + 分隔点 `--meta`）；不显示筛选/搜索/新建/速度；**右上角按钮改为返回语义**：ArrowLeft 20（ghost 规格，hover bg `--surface-3`），aria-label 与 title 均为"返回任务列表"，点击回 `/`，键盘可达（focus-visible 环）——设置页里齿轮会被误读为"设置入口/当前页",与"点击返回"的行为冲突（2026-11 用户实测问题 4b）。
- 内容区：**内容列 max-width 720px + `margin-inline: auto` 水平居中**（页面整体左右对称留白；滚动容器仍满宽，滚动条贴窗口右缘），垂直 padding 24px，滚动。窗口 960px 时左右各留 120px。组标题与组容器同宽左对齐（同一列内对齐，不允许标题比卡片宽或窄）。2026-11 用户实测问题 4a：原规格 max-width 640 左对齐导致内容贴左、右侧大片空白。
- 分组结构（组间 32px）：组标题（13px/500 `--fg-2`）→ 12px → 组容器（bg `--surface`、1px `--border`、`--radius-lg`）→ 内部设置行（高 48px、水平 padding 16px、行间 1px `--border-soft` 分隔）。

### 4.2 设置行与分组（最小设置集，F9 + Phase 1 补充项）

**组「下载」**：
1. **下载目录**：左 label"下载目录"（14px `--fg`）+ 副行当前路径（mono 12px `--muted` 省略号、`title` 全文）；右侧**只有** FolderOpen 16 图标按钮（aria-label"更改下载目录"，调系统目录选择器 `pickDirectory`）。**「打开」按钮已移除**（2026-11）：前端 opener 受 ACL 路径作用域限制无法授权，点击必然 `Not allowed to open path ...`；需要的用户可从任务行「打开目录」（后端命令）进入。操作区右缘只剩一个 28px 图标按钮，与其它设置行控件右缘对齐。
2. **默认分片数**：label"默认分片数"+ helper"新建任务的默认分片数"（12px `--muted`）；右侧数值输入（32px、宽 88px、mono、1–16，同 §3.2 规格）。（2026-10-23 项目总监裁决：分片数上限 64→16，与 Spec 契约对齐）
3. **全局限速默认值**：label"全局限速"+ helper"应用启动时应用的默认限速，0 或留空为不限"；右侧输入框（88px mono，后缀"MB/s" 12px `--muted`）。

**组「通用」**：
4. **开机自启**：Toggle（规格见下）；label"开机自动启动"，helper"登录 Windows 后自动运行"（调 `set_autostart`）。
5. **关闭窗口时最小化到托盘**：Toggle，默认开；helper"关闭后仍在后台下载，可从托盘图标重新打开"（关 = 直接退出应用）。
6. **下载完成系统通知**：Toggle，默认开；helper"每个任务完成时发送系统通知"。

**组「数据」**：
7. **本地使用统计**：说明文字"统计数据仅保存在本机，用于改进产品，不上传任何数据"（12px `--muted`）；右侧 Destructive-soft 按钮"清除统计数据"（Trash2 16）→ 确认弹窗："清除统计数据？清除后无法恢复。"按钮 取消 / "清除"（destructive-soft）→ 成功 Toast"已清除本地统计"。

**组「更新」**（2026-11 第十轮新增，§4.4）：
8. **检查更新**：label"检查更新"；helper 一行显示**当前版本 + 上次检查状态**（`{version} · {status}`）——版本号来自 Tauri `getVersion()`（不硬编码，取不到显示"版本未知"），时间用既有 `formatCompletedAt`（"今天 14:32" / "MM-DD HH:mm"）；未检查显示"尚未检查更新"，失败显示"上次检查失败（{time}）"。右侧 Secondary 按钮"检查更新"（RefreshCw 16），checking 时 Loading、installing 时 disabled。**手动检查失败给可见 error toast**（"检查更新失败：{原因}"），与启动自动检查的完全静默策略区分；已是最新给 info toast"已是最新版本"。

**主题**：无手动切换项——跟随系统为锁定行为（Spec §8），页脚说明文字"外观跟随 Windows 系统设置（深色/浅色）"（12px `--meta`）。

**Toggle 规格**：track 36×20px `--radius-full`，off = bg `--surface-3` + 1px `--border`，on = bg `--primary-bg`；knob 16px 圆、off 时 `--surface`（带 1px `--border`）、on 时 `--primary-fg`；切换动画 150ms `--ease-standard`；hit 区 ≥ 44×28px（外扩）；键盘 Space 切换，focus-visible 环；aria-role switch。

**保存行为**：每项变更即时保存（调 `set_config` / `set_autostart`），成功后 Toast"设置已保存"（同类 toast 2s 内去重合并）。

- **契约注意（2026-11 实测）**：`set_config` 的实参必须是**单结构体包裹** `{ patch: {...} }`（后端签名 `set_config(patch: ConfigPatchArg)`，Tauri v2 按参数名取值）；铺平会报 `missing required key patch`，设置页全部保存失败。
- **全局限速走 `set_global_speed_limit`**（`configStore.applyGlobalLimit`），不走 `set_config`：后者的 `globalSpeedLimitBps` 是 `Option<Option<u64>>`，serde 把 JSON `null` 解成外层 `None`（= 本字段不改），因此 `patch({ globalSpeedLimitBps: null })` **无法解除限速**（静默保留旧值）。`set_global_speed_limit(Option<u64>)` 语义明确（null = 解除）且同样落库持久化 + 同步托盘菜单。

### 4.3 设置页图标映射

Settings 20（顶栏激活态）· FolderOpen 16（目录行：选择目录 / 状态栏只读图标 / 行操作组）· Trash2 16（清除统计）· Check 16（保存成功 toast）· AlertCircle 16（保存失败 toast"保存失败：{原因}"）· RefreshCw 16（更新组「检查更新」按钮）。

**顶栏图标（按路由态）**：主界面 Settings 20（进入设置）· 设置页 ArrowLeft 20（返回任务列表，见 §4.1）。

### 4.4 软件更新检查（2026-11 第十轮新增）

更新源为 GitHub Releases 静态 `latest.json`（**后端 / `tauri.conf.json` / capability 归后端同事**，本轮前端不动）。前端只经 `src/api/updater.ts` 调插件 JS API（`check` / `downloadAndInstall` / `relaunch` / `getVersion`），**不新增任何自定义 IPC 命令**、不经 `api/invoke.ts`，`check_contract.sh` 的 19 条命令契约不变。分层护栏见 `architecture.guard.test.ts` 的 P0 分层 describe（updater / process / dialog 插件包同样只允许 `api/` 直连）。

**两条检查路径（都要）**：
| 路径 | 触发 | 失败反馈 | 成功无更新 | 发现新版本 |
|---|---|---|---|---|
| 启动自动检查 | `App.vue` onMounted 后延迟 **3s**（不拖慢冷启动），卸载时 clearTimeout | **完全静默**：无 toast、无 console、不外抛；只在设置页留下「上次检查失败」状态 | 零打扰，不弹 toast | 弹更新确认框 |
| 设置页手动检查 | 「检查更新」按钮 | **可见 error toast**（"检查更新失败：{原因}"） | info toast"已是最新版本" | 弹更新确认框 |
| 共同 | `checkUpdate(mode)` 单实现，幂等守卫（checking / installing / confirmOpen 时不重复发请求）；`lastCheckedAt` / `lastCheckFailed` 落 store 供设置页显示 | | | `available` 元数据 + `confirmOpen` |

**更新确认框与退出提示（硬要求）**：复用 `ConfirmDialog.vue`，两按钮「稍后」（ghost，safe = Enter 默认最安全项）/「立即更新」（primary）。文案必须**在下载前**明示：「发现新版本 {version}。安装更新时应用会自动退出，安装完成后请重新打开；进行中的下载任务会自动恢复。」——Tauri v2 官方说明 Windows 安装步骤执行时应用自动退出，故**本项目不提供任何重启能力**（不引入 process 插件、`relaunch()` 不可达）。有 `body` 时追附"更新说明：{body}"。选「稍后」→ `discardPendingUpdate()` 释放 Rust 侧 Update 资源。

**确认后流程**：`confirmInstall()` 是唯一允许下载/安装的入口（`checkUpdate()` 绝不下载）；`installing` 时展示 `ModalShell`（`closeable=false`，不可误关）内的 `ProgressBar` + `formatBytes` 进度文本；`Started` 取 `contentLength` 作 total、`Progress` 累加 `chunkLength`、`Finished` 收尾，归一成 `{ downloaded, total }`。进度到 100% 显示「安装已开始，应用即将退出；完成后请重新打开」；安装器接管后应用自动退出，`installing` 保持 true 让进度框留到进程退出，**不调用任何重启 API**。安装失败给可见 error toast 并回到可重试状态。

**版本号来源**：`@tauri-apps/api/app` 的 `getVersion()`（读 Tauri 配置），**不在组件/文案里硬编码**；取不到时显示"版本未知"。日期沿用既有 `formatCompletedAt`，字节数沿用 `formatBytes`。

**范围外**：首版不代码签名；不做增量更新 / 静默自动安装 / 更新频率配置。真实 WebView2 端到端更新与深浅主题观感未做 GUI 实测。

---

## 5. 页面四：系统托盘（OS 原生，文本规格）

托盘为 Tauri 原生菜单（随系统主题渲染，不适用 Web Token；以下为结构与文案规格）：

- **托盘图标**：单色应用资产（深浅主题自适应：浅色任务栏用深图标、深色任务栏用浅图标），非 Lucide。
- **左键单击**：显示/隐藏主窗口（toggle）。
- **右键菜单**（自上而下）：
  ```
  显示主窗口            （窗口隐藏时） / 隐藏主窗口（窗口可见时）
  ─────────────
  暂停全部              （无活动任务时禁用）
  恢复全部              （无暂停/等待任务时禁用）
  ─────────────
  全局限速  ▸           子菜单（单选，当前项打勾）：
                          不限速
                          5 MB/s
                          10 MB/s
  ─────────────
  退出 wtf-downloader   （有活动任务时菜单项文案追加"（N 个任务仍在下载）"？——不：改为退出前确认由引擎层处理，MVP 菜单仅"退出"，活动任务退出即暂停并在下次启动恢复）
  ```
- **Tooltip**（Windows `TrayIcon::set_tooltip`，1Hz 仅活动任务时更新；Linux 无 tooltip 走菜单文本）：
  - 活动时："wtf-downloader — 3 个任务下载中 · 1.2 MB/s"（十进制，下同）
  - 空闲时："wtf-downloader — 空闲"
  - **总速度主展示位是应用内状态栏（只读）与托盘 tooltip**（每 1Hz 刷新"暂停全部 / 恢复全部"之间的状态行"当前总速度：12.4 MB/s"？——MVP 不加菜单内动态文本行，速度仅在 tooltip 与应用内。菜单项保持静态，避免菜单闪烁）。
- **系统通知的三行结构（2026-11 归属修复后定稿，文案与渲染口径）**：气泡自上而下是 ①应用名行 ②标题（粗体）③正文。**①由系统渲染，不由我们传**——Windows 从未打包应用注册的 AUMID `DisplayName` 取值（后端注册为 `wtf-downloader`）；**②只承担事件语义**（"下载完成"/"下载失败"），**③承担具体信息**（文件名 / 错误摘要）。注意：**禁止把标题写成应用名**——修复归属前应用名行显示的是 "Windows PowerShell"，标题写应用名恰好补了品牌位，看起来"没问题"；归属修好后标题与应用名行会连着重复同一句。
- **完成通知**（受 `notifyOnComplete` 开关控制）：标题"下载完成"，正文"「{文件名}」已下载完成"（`notify.completedTitle` / `notify.completedBody`）。MVP 不含通知点击回调（原稿"点击=打开所在目录"未实现，不在本期范围）。
- **失败通知**（不受开关控制，PRD F9）：标题"下载失败"，正文"「{文件名}」下载失败：{错误摘要}"；错误缺失时退化为"「{文件名}」下载失败"（`notify.failedTitle` / `notify.failedBody` / `notify.failedBodyNoReason`）。
- **发送通道与归属（2026-11 实测修复，缺陷 4）**：一律经 Rust 命令 `notify_user`（参数平铺 `title`/`body`，SPEC §13）发送，由 Rust 侧 `notify::prepare()` 注册的每用户级 AUMID 携带归属身份（实测 Windows 通知历史：应用 AUMID 桶 1 条、宿主 shell 桶 0 条）；**JS 侧不做任何权限判断、不依赖通知插件包**——`isPermissionGranted()` 在 Windows 上没有运行时权限语义，一旦返回 false/抛错就成了"第二道静默开关"把通知吞掉（与 P1-001 同类失败）。命令失败只 `console.warn` 一次（辅助通道，不弹 toast、不阻断下载）。**禁止**与插件的 `sendNotification` 并存，否则一个事件两条通知。

---

## 6. 文案清单（全量，真实场景，禁占位）

### 6.1 主界面

| 位置 | 文案 |
|---|---|
| 顶栏 App 名 | wtf-downloader |
| 筛选 Tab | 下载中 / 全部 / 已完成 / 失败（各带计数；下载中置顶且为默认视图，见 §2.2） |
| 搜索 placeholder | 搜索任务 |
| 新建按钮 | 新建任务（tooltip：Ctrl+N） |
| 状态栏总速度 | ↓ 12.4 MB/s（ArrowDown 图标，只读；无下载中任务时不显示） |
| 状态栏 | 共 {N} 个任务 · {M} 个下载中 · {K} 个失败 |
| 状态栏目录 | 展示当前默认目录路径（无按钮、无 aria-label） |
| 任务限速面板（行「更多」内联） | 标题"任务限速" / 占位"输入 MB/s" / 单位"MB/s" / 按钮"不限" / 非法输入内联提示"请输入大于 0 的数值" |
| 「文件已丢失」独立筛选开关 | 文件已丢失 + 计数（aria："仅显示关联文件已丢失的已完成任务"） |
| 文件已丢失行内徽标 | 文件已丢失（纯文本徽标，无复选框 aria） |
| 独立筛选空态（无结果） | 没有文件已丢失的任务 / 关联文件都在，切换到「全部」查看所有任务（按钮：查看全部） |
| 多选右键菜单（选中 >1 条） | 只读提示：已选 {n} 个任务（aria："批量任务操作"）/ 全部暂停 / 全部开始 / 全部重试 / 删除选中任务…；三项无可操作对象时 disabled 不隐藏 |
| 单选右键菜单（选中 1 条） | 打开文件 / 打开目录 / 任务限速 / 删除（4 项，零「全部 xxx」） |
| 批量删除确认 | 标题：批量删除任务；正文（无已完成任务）：将删除选中的 {n} 个任务。；正文（含已完成任务）：将删除选中的 {n} 个任务。已完成任务的正式文件不会被删除。；按钮：取消 / 仅删除任务 / 删除任务和文件 |
| 批量部分失败 | {total} 项中有 {failed} 项未完成，请查看错误提示 |

### 6.2 任务行状态文案

| 状态 | badge / 元数据 |
|---|---|
| 等待中 | 等待中 / 排队中 |
| 下载中 | （无 badge）已下载 {x} / {total} · {speed} · 剩余 {eta} · {done}/{total} 分片完成（无完成分片时为 {active} 分片并行中；全部完成或单片流式时省略该段） |
| 已暂停 | 已暂停 / 已暂停 · 已下载 {x} / {total} |
| 重试中 | 重试中 {n}/{N} / {秒} 秒后自动重试 · {n}/{N} 次 |
| 已完成 | 已完成 / {total} · 完成于 {今天 HH:mm 或 MM-DD HH:mm} |
| 已失败 | 已失败 / {错误摘要，如：服务器返回 404，文件不存在} |

> 文案不变，仅配色口径更新（第九轮）：「已暂停」在 badge 与元数据行均用 `--warn` 警告色，元数据行 sizeText 保持 `--fg-2`（§1.2）。

### 6.3 添加任务弹窗

| 场景 | 文案 |
|---|---|
| 标题 | 新建下载任务 |
| URL label / helper | 下载链接 / 支持 HTTP/HTTPS 直链，一行一个，可批量添加 |
| URL 错误 | 第 {n} 行链接格式不正确，需以 http:// 或 https:// 开头 |
| 剪贴板预填提示 | 已自动填入剪贴板链接 |
| 解析中 | 正在解析文件信息… |
| 解析超时 | 解析超时，请检查链接，或直接添加（按钮：仍然添加） |
| 分段支持 | 支持分段加速 / 服务器不支持分段加速，将单连接下载 |
| 文件名错误 | 文件名不能包含 \ / : * ? " < > \| |
| 目录 label | 保存到（按钮：更改 / 打开） |
| 高级选项 | 高级选项 / 下载分片数 / 分片越多对服务器压力越大，16 通常已是最优 |
| 并发提示 | 预计 {n} 个分片并行（footer 单行最左，仅单条 URL 且已解析时出现） |
| HTTP 警示 | 该链接为未加密 HTTP 连接，下载内容将明文传输 |
| 底部按钮区 | 单行三元素：预计 {n} 个分片并行（左） / 取消 / 开始下载（右），见 §3.2 |
| 主按钮 | 开始下载 / 添加 {n} 个任务 |
| 添加失败 | 后端 AppError 原样展示（如"无法解析 URL：…"、"服务器返回 403，拒绝访问"）；非 AppError 时"添加失败：{原因}"（规则同 §6.4） |
| 放弃确认 | 已填入的内容将丢失（继续编辑 / 放弃） |
| 成功 Toast | 已添加 {n} 个任务 |

### 6.4 确认弹窗 / Toast

| 场景 | 文案 |
|---|---|
| 删除未完成任务 | 标题：删除任务；正文：「{文件名}」尚未完成，是否同时删除已下载的部分文件？；按钮：取消 / 仅删除任务 / 删除任务和文件 |
| 移除已完成 | Toast：已移除「{文件名}」（操作：撤销） |
| 清除统计 | 标题：清除统计数据？；正文：清除后无法恢复。统计数据仅存本机，不上传任何数据。；按钮：取消 / 清除 |
| 批量 | Toast：**{total} 项中有 {failed} 项未完成，请查看错误提示**（部分失败汇总；单条失败仍各走 `toast.saveFailed`）。批量暂停/开始/重试成功**不弹汇总 toast**，由列表状态即时反馈 |
| 批量删除确认（含已完成任务） | 将删除选中的 {n} 个任务。选「删除任务和文件」才会删除已完成任务的文件。（AC-13 显式告知，避免误以为删任务必然连文件一起删） |
| 保存失败 | Toast：**后端 AppError → 原样展示**（"任务不存在: t1" / "开启开机自启失败: ..."）；**非 AppError → "保存失败：{原因}"** |
| 打开文件 / 打开目录失败 | Toast：**后端 AppError → 原样展示**（"文件不存在：{路径}" / "打开文件失败：{原因}" / "打开路径必须是绝对路径：{路径}" / "打开所在目录失败: ..."）；**非 AppError → "打开失败：{原因}"**（命令未注册、IPC 原始串等） |
| 列表加载失败 | 任务列表加载失败 / {错误详情}（按钮：重试） |

**错误文案前缀规则（2026-11 项目总监裁决「方案 A」，唯一实现点 `stores/toast.ts → pushError`）**：

| 错误来源 | message 形态 | 处理 |
|---|---|---|
| 后端 `AppError`（`ApiError`） | 自包含完整中文句（后端所有 `AppError::new` 的消息均带自身语义前缀，如"任务不存在: t1"、"开启开机自启失败: {e}"、"文件不存在：{path}"） | **原样上屏，前端不叠加任何业务前缀**——避免「保存失败：开启开机自启失败: …」「打开失败：文件不存在：…」的语义重复 |
| 前端运行时错误（`TypeError` 等）、字符串 rejection、命令未注册 | 裸原因 / 技术串，无业务语义 | 用调用点传入的 key 补前缀（`toast.saveFailed` / `toast.openFailed` / `add.addFailed`） |

- 调用点一律 `toast.pushError(key, e)`，**禁止**自行 `toast.push('error', ...)` 拼前缀；判定集中在 `pushError`（`ApiError` 实例 → 透传键 `toast.asIs`，否则用 key），文案键仍是文案唯一源。
- **动作分发不变量**：`TaskListView` 的 `onAction(task, type)` 必须**永不 reject**——行内按钮 / 更多菜单 / 键盘 Enter 三条入口都以 `void onAction(...)` fire-and-forget 调用，无人 catch。因此该函数带外层兜底 `try/catch`（结构保证，非装饰）：新增 case 即便漏写自身 catch，也会落到兜底出口给出可见反馈，而不是三处同时静默。
- 提醒：打开类操作（`open_path` / `open_file_location`）失败**必须**有可见反馈，不允许裸 `await` 造成未处理 Promise（"点了没反应"）。
- **引擎错误文案：归属引擎侧，前端零处理（2026-11 裁决 a+b，已落地）**：`EngineError` 直出的 `task.error` **同时上屏于两处**——失败通知正文（§5）与任务行第三层的错误摘要。原始英文串（如 `error decoding response body`）**不进 UI**，由引擎侧 `classify_reqwest()` 映射为中文摘要 + 括号技术标签，实测形如 `分片重试耗尽（3 次）：响应数据不完整（decode）`（5 类：timeout / connect / decode / body / other），原始错误只进日志。前端**不做任何中文化、不加前缀、不做二次拼装**：前端只有插值、没有错误语义，硬翻会丢错误码、把可定位的技术串变成不可定位的中文，也与本节"AppError 原样展示、不叠前缀"的契约冲突。错误码 → 用户语义的归属方只能是引擎侧（单一来源原则：同一份语义不得有两处实现）。若 QA 反馈"错误看不懂、不够具体"，正解是引擎侧补结构化日志，**不是**在前端拼字符串。

### 6.4.1 更新文案（2026-11 第十轮新增，全部在 `zh-CN.ts` 的 `update.*`）

| 场景 | 文案 |
|---|---|
| 设置页更新行 | 组标题"更新"；label/按钮"检查更新"；helper"{版本} · {状态}"（当前版本 {version} / 版本未知 · 尚未检查更新 · 上次检查 {time} · 上次检查失败（{time}）） |
| 已是最新 | Toast（仅手动检查）：已是最新版本 |
| 手动检查失败 | Toast：检查更新失败：{原因}（自动检查失败**无文案、完全静默**） |
| 更新确认框 | 标题"发现新版本 {version}"；正文"发现新版本 {version}。安装更新时应用会自动退出，安装完成后请重新打开；进行中的下载任务会自动恢复。"（有 body 时追加"更新说明：{body}"）；按钮"稍后" / "立即更新" |
| 下载安装 | 标题"正在安装更新"；"正在下载并安装更新，应用将在安装阶段自动退出"；进度"已下载 {downloaded} / {total}"（无总长时"已下载 {downloaded}"）；到 100% 显示"安装已开始，应用即将退出；完成后请重新打开"；失败 Toast"更新安装失败：{原因}" |

> 「安装更新时应用会自动退出，安装完成后请重新打开」是**下载前必须明示**的硬文案（Windows 安装器会使应用自动退出、`relaunch()` 不可达），不得省略或改成静默安装，也不得写成「自动重启」。

### 6.5 数字与单位格式（十进制，1 MB = 1000 KB）

| 类型 | 规则与示例 |
|---|---|
| 速度 | < 1000 → "x KB/s"；≥ 1000 → "x.x MB/s"（1 位小数）；≥ 1000 MB → "x.xx GB/s"；零值 "0 B/s" |
| 大小 | B / KB / MB / GB / TB，< 10 保留 1 位小数（"2.4 GB"），≥ 10 取整（"13 GB"）；未知 "--" |
| 百分比 | 1 位小数（"63.4%"），完成 "100%" |
| 剩余时间 | "< 1 秒" / "42 秒" / "3 分 20 秒" / "1 小时 12 分"；不可得 "--" |
| 分片 | "{已完成}/{总数}"（"16/32"） |
| 计数 | 纯整数 tabular-nums |

---

## 7. Do's & Don'ts

**应该做（Do）**：
1. 层级一律用亮度递进（`--bg → --surface → --surface-2 → --surface-3`），深色主题零装饰投影；
2. 所有实时数字 mono + tabular-nums；
3. hover 操作组隐藏/浮现保持 150ms，键盘 focus-within 同样唤出（不仅依赖鼠标）；
4. 图标按钮一律带 aria-label 或与可见文字配对；
5. 进度条 width 用 250ms linear 插值（不是 150ms ease——4Hz 帧间隔下 ease 会抖）；
6. 空态文案永远给出下一步动作（Ctrl+N / 查看全部）；
7. 弹窗焦点困环 + Esc 关闭 + Enter 提交；
8. 错误信息带具体原因（HTTP 状态码/超时/磁盘），带重试出口。

**禁止（Don't）**：
1. 禁 emoji 图标、禁第二套图标库、禁 lucide-vue-next；
2. 禁硬编码色值（含 rgba 字面量；遮罩用 `--overlay`）；
3. 禁彩色左边框强调、渐变文字、毛玻璃卡片、≥24px 圆角、幽灵卡片（1px 边框 + ≥16px 模糊）；
4. 禁 primary 大面积使用（每屏实心 ≤2：主界面 = 新建按钮 + 下载中进度条；弹窗 = 主按钮）；
5. 禁语义色大面积填充（success/warn/danger 仅 badge、文字、soft 底小面积）；
6. 禁 600+ 字重、禁 >300ms 过渡、禁弹跳缓动、禁装饰循环动画；
7. 禁"暂无法显示""加载中…"式占位长驻（Loading 必须有明确终点：数据或错误）；
8. 禁在组件内写死 px 颜色混用（尺寸可用具体 px，颜色必须 Token）。

---

## 8. 响应式与无障碍

- **桌面窗口**：无移动端断点概念；最小窗口 720×480，列表区随窗口伸缩（进度条全宽自适应）；添加弹窗固定 480px 居中（窗口 < 520px 时弹窗宽 = 窗口宽 - 32px）。
- **顶栏收缩配额（2026-11 复核）**：固定元素总宽 ≈660px（App 名 113 + 筛选 Tab + 搜索 200 + 新建按钮 + 设置 32 + 间距），只有搜索框允许收缩（`flex: 0 1 200px; min-width: 0`），其余一律 `flex: none` + `white-space: nowrap`（筛选 Tab 绝不折行、按钮文字不换行）。总速度 chip 移出顶栏后，窗口最小 720px 时设置入口不再有被挤出风险，原「≤860px 隐藏速度 chip」断点随之删除；该断点改用于**状态栏总速度**（`≤860px` `display: none`，见 §2.4），保证计数与目录优先可见。
- **对比度**：Spec §8 已验算全部正文/按钮 ≥4.5:1（fg/bg 16.7–17.0:1，primary 双向 ≥17:1）；`--meta` 仅用于 ≥12px 非关键短标签（时间戳/占位），不承载关键信息。
- **键盘**：全量路径见 §2.5；focus-visible 一律 `--focus-ring`（3px 中性半透明环，深浅主题各一值）；roving tabindex 列表导航。
- **触摸目标**：图标按钮 hit ≥28×28px（桌面工具标准，鼠标环境；设置 Toggle 外扩至 44×28px）。
- **reduced-motion**：design-tokens.css 全局规则已覆盖，所有动效瞬切，进度条/骨架屏/Loader2 静态化。
- **屏幕阅读器**：进度条 `role="progressbar"` + `aria-valuenow/min/max`；状态变更通过 `aria-live="polite"` 的 toast 播报；纯图标按钮 aria-label（清单见各页）。

---

## 9. Agent 实现指南（给前端）

1. **入口**：`main.ts` 中 `import "./styles/design-tokens.css"`（Token 唯一引入点）；主题由 Tauri `window.getCurrent().theme()` + `onThemeChanged` 写 `<html data-theme="...">`，CSS 兜底媒体查询已内建，**不要用 JS 切换 class 实现主题**。
2. **消费 Token**：组件样式 `var(--xxx)` 直引；TS 侧如需 Token 值（如 canvas/图表预留），`import tokens from "@/styles/design-tokens.json"`。
3. **进度流渲染**：Channel 4Hz 帧直接写 store，进度条 width 交给 CSS transition（`--motion-progress`）做平滑；**不要**在 JS 里再节流（Spec 硬约束：节流在生产端）。
4. **组件建议**：`TaskRow.vue`（三态 props：task + progress frame）、`StateBadge.vue`（§1.2 映射表驱动）、`StatusBar.vue`（三段只读网格：计数 / 总速度 / 目录）、`AddTaskDialog.vue`（三阶段渐进披露状态机）、`ConfirmDialog.vue`（通用）、`ToastHost.vue`（顶部居中堆叠）。**不再有 `SpeedChip.vue`**（2026-11 移除）。
5. **图标引入**：`import { Plus, Search, ... } from "@lucide/vue"` 按需 tree-shaking；尺寸用 class 控制三档（16/20/24），禁止随意内联尺寸。
6. **文案**：全部集中在 `ui/src/locales/zh-CN.ts` 资源文件（Spec 预留 i18n 接口），组件内禁写裸字符串（数字格式化函数 `formatSpeed/formatSize/formatEta` 放 `utils/format.ts`，十进制）。
7. **已知坑**（Spec §11 关联）：Channel 无界队列——前端句柄释放即停推，组件卸载必须 `unlisten`；托盘 tooltip Windows 专用，勿在菜单里做动态文本刷新（闪烁）；`lucide-vue-next` 已废弃勿装。
8. **单文件 ≤300 行**（架构硬约束）：任务行拆 `TaskRowHeader / TaskRowProgress / TaskRowMeta` 子组件。
9. **路径拼接**：目录 + 文件名一律走 `utils/path.ts → joinPath(dir, name)`，**禁止**裸拼 `` `${dir}/${name}` ``——下载目录由用户在选择器/手填指定，可能带尾分隔符（`D:\Downloads\`），裸拼会得到 `D:\Downloads\/x.zip`，该串会原样进入后端 `open_path` 的绝对路径校验与错误文案（"文件不存在：D:\Downloads\/x.zip"）。`joinPath` 只做"去尾分隔符 + 单 `/` 连接"，不做规范化/`..` 解析。
10. **错误文案前缀**：一律 `toast.pushError(key, e)`，不得自行拼前缀（规则与实现点见 §6.4）。
11. **多选交互按用户裁决锁定为迅雷式**（2026-11，取代 §10 第 9 条的批量条方案）：不加复选框、不加批量操作条；左键单选 / Ctrl 切换 / Shift 连选 / Ctrl+A 全选 `visible` / 右键按选中数量切换单选与多选菜单。两套菜单归 `TaskRow.vue`，`TaskListView.vue` 只持有选择状态机与 `selectedId` 焦点行（§2.9）。弹窗三段式布局（头尾固定、仅 `.body` 滚动）见 §3.1。
12. **第七轮实测 7 项裁决（2026-11-06）**：① footer 改单行三元素（hint 最左 / 取消 / 开始下载靠右，§3.2）；② 选中态加 `--primary-bg` inset 竖条 + 16px `Check` 对号，三态压过 hover、焦点环不丢（§2.3）；③ `more.taskLimit` 文案去省略号；④ Shift 连选 / 拖框禁文本选择（`.row` / `.list` 的 `user-select:none` + input 兜底）；⑤ 「下载中」置顶并成为默认视图，`TaskFilter` 四值契约不动（§2.2）；⑥ 空白区拖框多选拆成 `useMarqueeSelection.ts` + `MarqueeBox.vue` + `MarqueeLayer.vue`（§2.9.1）；⑦ **后端 / Rust / IPC 命令名 / `code` 值 / AC-13 / `check_files` 契约零改动**。
    - 决策依据（②）：用户反馈「第三个任务其实被选中了，但是颜色看不出来」，右键菜单显示「已选 3 个任务」已证明集合是 3 条。先用行为单测证伪「选择集合被逻辑覆盖」（`useTaskSelection.test.ts` 的 Ctrl 连点 3 行用例全绿），再改视觉，**禁止只改样式掩盖逻辑问题**。
    - 决策依据（⑥）：`TaskListView.vue` 基线 296 非空行，新增容器组件后 299 行，不触碰 300 行门禁；状态机与 DOM 监听分离以适配 `environment=node`。
    - 硬约束：不新增依赖、不改 design token 全局定义、颜色一律 `var(--token)`、单文件 ≤300 非空行、禁 emoji 作图标。
13. **第九轮实测 2 项裁决（2026-11-06）**：① **去掉选中行左侧竖条 / 描边框**——用户原话「选中时只显示对号，不要这个左边的框框，这个就是 ai 味道，写进约束，坚决不要」。`TaskRow.vue` 的 `.row.row-selected` 三态只保留 `background: var(--primary-soft)`（整行底色留），删除 `box-shadow: inset 3px 0 0 var(--primary-bg)`；`:focus-visible` 只保留 `--focus-ring`；`.select-mark` 保持纯图标、规则体内禁任何形成「框」的声明。**升级为 §0 P0-5 全案硬规则**并落成 `architecture.guard.test.ts` 的 `P0-3` 规则体切片护栏（禁用整文件 `not.toContain` 以免误伤 badge / 输入框的合法边框）。② **已暂停改警告色**：`StatusBadge.badge-paused` → `--warn` / `--warn-soft` / 500；`TaskRowMeta` 新增 `.meta-paused` 只染「已暂停」文字，sizeText 不染；pending / completed / failed 三态不动（§1.2 / §1.7 / §2.3）。**后端 / Rust / IPC / AC-13 / `check_files` 契约零改动，design token 全局定义零改动**。
14. **第十轮：更新机制前端侧（2026-11-07，与后端同事并行，文件互不重叠）**：新增依赖**仅** `@tauri-apps/plugin-updater`（`@tauri-apps/plugin-process` 经项目总监裁决撤销，见第 15 条）；新建 `api/updater.ts`（**唯一**直连插件的一层，`checkForUpdate` / `installUpdate` 进度归一 / `getVersion`，不新增自定义 IPC 命令、**不提供任何重启函数**）、`stores/updater.ts`（两条检查路径共用状态）、`components/UpdateDialogs.vue`（确认框 + 进度框）、`components/settings/UpdateSettingsRow.vue`（版本 / 上次检查 / 按钮）。启动 3s 延迟自动检查**失败完全静默但留失败态**，设置页手动检查**失败可见 toast**；发现新版本用 `ConfirmDialog` 两按钮确认，**下载前必须明示「安装更新时应用自动退出，完成后请重新打开」**；`confirmInstall()` 是唯一允许下载的入口（确认前不下载）。全部文案进 `zh-CN.ts` 的 `update.*`；`App.vue` 与 `SettingsView.vue` 只加接线，逻辑不塞进已 299 行的 `TaskListView.vue`。**后端 / Rust / `tauri.conf.json` / capability / SPEC / README 归后端同事，本轮零改动**；`check_contract.sh` 仍 19/19/19。
15. **第十轮裁决：撤销全部重启类依赖**（2026-11-08 执行）：后端曾为配套 `relaunch()` 额外新增第 4 个 Rust 依赖 `tauri-plugin-process`，超出用户授权的 3 个包；且 Tauri v2 官方明确「Windows 安装步骤执行时应用自动退出」「安装后立即重启非必需」，`downloadAndInstall()` 之后的 `relaunch()` 不可达。裁决整体撤销：`Cargo.toml` / `lib.rs` / capability 三处删除、`ui/package.json` 卸载 `@tauri-apps/plugin-process`、`api/updater.ts` 删除 `relaunchApp()`、`stores/updater.ts` 安装成功后不调任何重启 API（`installing` 保持 true 让进度框留到进程退出）。文案统一为「安装时应用自动退出，完成后请重新打开」，`update.relaunching` 死键删除。护栏：`api/updater.test.ts` 断言不导出 relaunch、`stores/updater.test.ts` 断言 store 源码不含 `relaunch`、`architecture.guard.test.ts` 的 `PLUGIN_NEEDLES` 移除 process 包。**零后端契约变化，19/19/19 不变**。

### 9.1 静态源码护栏与变异验证（工程守则，2026-11 定）

本项目有大量护栏是**静态源码断言**（读 `.vue`/`.ts` 源码做正则/切片断言，如 `TaskListView.test.ts`、`TaskActions.test.ts`），因为相关缺陷（未处理 Promise、柯里化 handler、裸拼路径、双前缀文案）在纯行为单测里难以复现。这类护栏必须按下述规则维护：

1. **新增静态护栏后，必须做一次变异验证**（缺一不可的四步）：① 备份被测文件；② 手工删除/破坏被测实现（如删掉 `catch`、改回错误写法）；③ 复跑该测试文件，确认目标护栏**变红**并记录红了几个用例；④ 从备份恢复并用 `cmp` 校验字节一致，再跑一次确认全绿。
2. **未做过变异验证的护栏只能视为文档**，不得作为"缺陷不会复发"的证据，也不得在回执中计入防护结论（"测试是绿的"只证明当前代码形状符合断言，不证明断言拦得住退化）。
3. **变异验证结论必须写进交付回执**：哪个护栏文件/用例名、删了什么实现、红了几个用例、恢复后是否字节一致。

补充口径（与后端一致）：静态护栏与行为单测**加起来也不等于功能验收**——功能唯一判据是人手 GUI 点击（如 `open_path` 是否真打开文件、toast 是否真的在顶部）。测试数只用于证明"缺陷不会悄悄回来"。

> **P0-3 / P0-4 护栏落地（2026-11 第九轮）**：`architecture.guard.test.ts` 新增两个 describe，用 `blockFrom()` **规则体切片**守住「状态指示不得套装饰性边框 / 竖条」与「已暂停必须警告色」。切片是硬要求——整文件 `not.toContain('border' / 'background')` 会误伤 `StatusBadge` 的语义底色、输入框的 1px 边框、`.missing-badge` 的 `--radius-full` 等合法声明。变异注入点：把 `inset 3px` 竖条加回 `.row.row-selected`、把 `.badge-paused` 改回 `--muted`，两者都必须让护栏变红。

4. **任何验证动作都必须先证明"它能失败"**（2026-11 补充，适用于门禁/护栏/验收样本，不止静态断言）：
   - 门禁脚本：注入一次真实违规（如把文档里的命令名改成 camelCase），确认它 `exit≠0` 且报出正确差异，再恢复并 `cmp` 校验字节一致
   - 复核他人结论：**必须复用门禁自身的实现**，不得另写等效计算（`wc -l` 复核非空行门禁 = 换尺子量同一个东西）
   - 验收样本：先确认它**能区分两种原因**（如"弹窗出现"在 code 与文本兜底都能为真时，该样本无判别力）
   - 无法证明失败能力的验证，结论只能记为**"未验证"**，不得记为"通过"
   - 理由：这轮出现的多起事故（门禁只报分子、hash 表覆盖不全、无判别力样本、变异注入未生效却"两组结果一致"）共性都是**假通过**；假通过比失败更危险，因为它让人停止排查。
   - **门禁自身也会被修**（2026-11 复核）：`scripts/check_lines.sh` 原实现只 `find -name '*.rs'`，对 `ui/src` 扫到 0 个文件仍打印 `LINE GATE PASSED` —— 整个前端从未被真实门禁覆盖。现已覆盖 `.rs/.ts/.tsx/.vue/.css/.js/.jsx`、排除 `node_modules|target|dist|gen`、**报告扫描文件数（分母）**、**空集直接 FAILED exit=1**。前端复核直接 `bash scripts/check_lines.sh ui/src` 即可，不得再用「把 .ts/.vue 复制成 .rs 镜像」之类的换尺子做法。门禁脚本的注入自证（空目录 / 301 非空行 .vue / 恢复后双 PASS）是**门禁自身**的变异验证，不替代各护栏文件的变异验证。

### 9.2 dev 环境排查纪律：reload / HMR 会引入无法归因的变量（2026-11 A/B 复测校正）

整页 reload 后控制台常见 `[TAURI] Couldn't find callback id …`。**实测（A/B 对照，同二进制同前端同文件）：该警告存在时，`task:completed → notify_user → toast` 链路仍可正常工作**（归属桶 app=1 / shell=0、toast XML 已读回）——因此**不能把这条警告当作"通知链断了"的依据**。（本节 2026-11 曾把该警告当作断链证据，经 A/B 对照实验证伪后改写；误判原因正是"看到警告 + 通知没发"就下因果，未做对照。）

唯一稳定复现"通知丢失"的做法：在 reload **过渡期**（新文档尚未装载完成，实测 +14ms 窗口）就调 `invoke('add_task')` —— 这次调用落在即将销毁的上下文里；任务仍会在 Rust 侧正常完成、列表显示 100% 已完成，但**通知不弹且没有任何 warn**。这属**测试/自动化手法**问题（用户不会在页面加载那一瞬间点新建），不是用户路径缺陷。

**关键反例（别反向误判）**：**不能用"列表有更新"反证事件链正常**——A/B 两组列表都有更新，但 B 组通知没发。列表状态走 progress Channel，通知走 `task:completed` 事件，两条独立通路，前者正常不能推出后者正常。

**纪律**：dev 下测通知前**先关掉进程完整重启应用**（不是刷新页面）——目的不是"修复断链"（不存在稳定断链），而是**消除 reload 引入的这类不可归因变量**；**这类现象不得作为缺陷上报依据**。触发条件：改 `src/locales/zh-CN.ts` 这类被大量模块引用的文件会触发整页 reload 而非局部 HMR，"改文案 → 测通知"最容易踩。

**通知链证据分级**（实测支撑）：**归属桶计数 > toast XML 原文 > `console.warn`**。`notify()` 的 warn 只能区分"命令被调用但失败"与"命令没被调用"，它有盲区——命令返回 Ok 但系统侧未落地（AUMID 注册失败、通知被策略抑制）时，warn 不出现、桶也不增加，必须**桶 + warn 一起看**才能定性；"没看到 warn/日志"不能反证命令没被调用（`window.__TAURI_INTERNALS__.invoke` 是只读属性，插桩赋值会静默失败）。

---

## 10. 与 Spec / Phase 1 的偏离说明（透明度清单）

| # | 偏离项 | 理由 |
|---|---|---|
| 1 | Token 在锁定的 27 个之外新增 2 个 C-extension：`--bg-translucent`（浅 rgba(247,248,250,.88) / 深 rgba(11,13,16,.88)）与 `--overlay`（浅 rgba(22,24,29,.45) / 深 rgba(0,0,0,.60)） | `--bg-translucent` 为 Phase 1 §9.1 架构师明确要求落档的 Mica 预留；`--overlay` 为模态遮罩必需——否则弹窗遮罩必须硬编码 rgba，违反 P0-4。27 个锁定值零改动 |
| 2 | 任务行高：Phase 1 的 64/84px 双档 → 统一 80px | 全状态均含进度条层（等待/完成同样显示轨道，保持节奏）；80px = 12+20+8+4+8+16+12，严格落在 4px 网格 |
| 3 | 骨架屏 shimmer 周期：Phase 1 "200ms 循环" → 1.2s | 200ms 循环视觉上是频闪不可用；行进入/状态切换等过渡仍 150–200ms 合规，shimmer 属持续加载指示器（非过渡动效） |
| 4 | 顶栏补"设置入口"图标按钮（Phase 1 顶栏清单未列） | `/settings` 是 Spec §7 锁定路由，必须有入口；Settings 20px ghost 图标按钮，不增加视觉噪音 |
| 5 | 任务行"更多"菜单内含"任务限速"入口 | F7 锁定"全局+单任务"限速且 `set_task_speed_limit` API 已锁定，Spec §7 未指定 UI 位置；放 Ellipsis 菜单是密度最低的落位，不进默认操作组 |
| 6 | 托盘菜单不加 1Hz 动态速度文本行 | 原生菜单高频重绘会闪烁；速度主展示位按 Phase 1 §9.3 结论在应用内（现为状态栏只读）+ tooltip，本条与 Phase 1 结论一致，仅显式写明"不做" |
| 7 | **顶栏总速度 chip 整体移除**（含 148px 定宽、限速下拉 popover、`≤860px` 隐藏断点）；总速度改为状态栏中段只读展示；全局限速只剩设置页入口 | 用户反馈「图标与数字间距过大不好看」，且「如果它只是显示总实时速度，是不是可以放到下面」——速度是状态信息不是操作入口。移除后顶栏回到「搜索 / 新建 / 设置」三项自然间距，定宽占位与窄窗断点一并消失（死代码清理）。此条取代原「固定 148px 防抖动」方案 |
| 7b | 状态栏目录取消「打开」功能；设置页下载目录行去掉「打开」按钮 | opener 前端调用受 ACL 路径作用域限制，用户下载目录不在 capability 白名单内必然 `Not allowed to open path ...`，且前端无法授权；不可依赖的功能不如不给入口（打开目录保留在任务行，走后端 `open_file_location`） |
| 7c | Toast 由右下角改**顶部水平居中**、向下滑出、多条向下堆叠、宽度上限 440px | 右下角 toast 与状态栏/目录信息区重叠；顶部居中更贴近"系统通知"位置预期，向下堆叠在新增时不会推挤已可见条目 |
| 8 | 设置页内容列 `max-width 640 左对齐` → `max-width 720 居中`；顶栏右上角齿轮 → ArrowLeft（返回任务列表） | 左对齐在宽窗口下右侧大片空白（用户实测问题 4a）；齿轮在设置页与"点击返回"行为冲突（问题 4b） |
| 9 | ~~任务列表新增 40px 常驻批量操作条（`BulkActionBar.vue`）~~ → **2026-11 裁决推翻：整条移除，改为迅雷式 Ctrl 多选 + Ctrl+A + 右键菜单**（`TaskContextMenu.vue`） | 用户原话「不是加复选框和批量操作栏，而是按住 ctrl 可以多选，ctrl+a 可以全选，然后右键操作，按选择数量决定菜单项，和迅雷一样」。复选框/批量条属上一轮理解偏差；删除后 `TaskListView.vue` 回到 296 非空行，两套菜单归 `TaskRow.vue` 按 `selectionCount` 切换（§9 第 8 条 300 行门禁不触碰）。详见 §2.9（第七轮接入框选后为 299 行，仍不触碰门禁） |
| 10 | 「仅看文件已丢失」用**独立开关** `missingOnly`，不新增第五个 `TaskFilter` 值 | 四值 `'all'\|'downloading'\|'completed'\|'failed'` 是 IPC 契约（`api/types.ts` 与 Rust serde 对齐），加值会让状态映射表 / 计数 / 后端筛选同时分叉；独立开关是与状态筛选 AND 的一层呈现态筛选，语义更窄且可逆（§2.10） |
| 11 | 已完成任务文件丢失**不做成业务状态**（不写 `TaskRecord`、不改 `TaskStatus`、不落库、不自动清理） | 事实源在应用外磁盘、会自愈、不改变下载结果、需求明确禁止清理记录；落成持久状态需额外造「解除标记」命令 + 状态迁移 + 落库，纯属多余。以 `check_files` 的瞬时派生呈现态表达（§2.10） |
| 12 | 筛选 Tab 顺序由 Phase 1 的「全部 / 下载中 / 已完成 / 失败」改为**「下载中 / 全部 / 已完成 / 失败」**，且默认视图由「全部」改为**「下载中」** | 2026-11 第七轮用户裁决「把下载中视图调整为第一位，并且是默认任务列表视图」。只把 downloading 提到第一位，其余相对顺序不变；`TaskFilter` 四值契约（IPC / Rust serde 对齐）与 `list_tasks` 参数一字未改，仅前端默认值与展示顺序变化，`viewAll()` 仍回 `all`（§2.2 / §2.6） |
| 13 | 选中行新增 16px `Check` 对号（固定前导槽）与 `--primary-bg` inset 竖条 | 用户「选中的时候是不是可以给任务上加个对号看起来会比较明显」+「第三个任务其实被选中了，但是颜色看不出来」。对号是**只读状态指示**（非复选框、不可交互），前导槽常驻避免文件名左右跳；竖条补 `--primary-soft` 与 hover 底色对比度不足的缺陷（§2.3）。已用行为单测证明选择集合逻辑无覆盖 bug，属纯视觉修复 |
| 14 | 新建下载任务弹窗 footer 由两行改**单行三元素** | 用户「预计分片哪个文本放到最左边，取消按钮和开始下载按钮放右边，三个元素同一行」（原截图取消在左下被裁切）。hint `margin-right:auto` 顶左、两按钮靠右、`.footer-right` 死样式删除；跨插槽 `form="add-task-form"` 关联与唯一一份 `submit` 均不变（§3.2） |
| 15 | 任务行 / 列表新增 `user-select:none`、新增空白区拖框多选 | 用户「shift 选中某几条任务时，有些文字被选中了……是没有设置文字的 user-select」+「鼠标从任务列表空白位置开始按住左键可以画框」。`base.css` 用 `input, textarea { user-select:text }` 兜底不误伤限速输入/搜索框；框选拆成 composable + 渲染组件 + 容器三件，主视图仅 3 行接线（§2.3 / §2.9.1） |
| 16 | 「下载中」升级为**分组视图**（`pending / downloading / paused`），且新建任务成功后**立即切到该视图**，不停留在原视图 | 用户「暂停的任务也属于下载中」+「新建任务后要立即切换到下载中视图，而不是当前停留的是全部，就停留在全部」。判据单点 `isInProgress(status)` 由 `counts` 与 `visible` 共用，避免两份状态枚举分叉；含 `pending` 是硬约束——后端 `add_task` 初始落 `TaskStatus::Pending`，否则切过去看不到新任务。`TaskFilter` 四值与 `list_tasks { filter? }` 一字未改（§2.2） |
| 17 | **第九轮推翻第 13 条的竖条方案**：选中行去掉左侧 `inset` 主色竖条 / 描边框，只留 `--primary-soft` 整行底色 + 行首 16px `Check` 对号；`.select-mark` 规则体禁一切形成「框」的声明；`:focus-visible` 只留 `--focus-ring` | 用户「选中时只显示对号，不要这个左边的框框，这个就是 ai 味道，写进约束，坚决不要」。竖条沿 `.row` 的圆角渲染成描边小框，属装饰性边框；已升级为 §0 **P0-5 全案硬规则**（状态指示只允许语义图标本身，禁止装饰性边框/描边胶囊/左侧竖条/发光底/渐变底），并落成 `architecture.guard.test.ts` 的 `P0-3` 规则体切片护栏。底色保留是因为用户只要求去掉框、未要求去掉底色（§2.3） |
| 18 | **已暂停改警告色**：`StatusBadge.badge-paused` → `--warn` / `--warn-soft` / 500；`TaskRowMeta` 新增 `.meta-paused { color: var(--warn) }` 只染「已暂停」文字，sizeText 保持 `--fg-2` | 用户「已暂停给一个颜色醒目一些，比如警告色」。原 `--muted` + `--surface-3` 与 pending 几乎同色、灰色不醒目；`--warn` / `--warn-soft` 是 design-tokens 现成的双主题醒目警告色，不改 token 全局定义、不用硬编码色值。pending / completed / failed 三态配色零改动（§1.2 / §1.7） |
| 19 | **第十轮新增软件更新检查（前端侧）**：启动 3s 延迟自动检查（失败完全静默、只留失败态）+ 设置页手动检查（失败可见 toast）；新增「更新」分组显示当前版本与上次检查时间；发现新版本用 `ConfirmDialog` 两按钮确认，下载前明示「安装更新时应用自动退出，完成后请重新打开」；确认后展示进度，安装器接管后应用自动退出、不调用任何重启 API | 用户已拍板「更新源 GitHub Releases 静态 latest.json、启动自动检查 + 设置页手动检查两者都要、设置页显示当前版本号与上次检查时间、首版不代码签名」。Windows 安装器执行时应用自动退出，会打断进行中的下载，故必须先确认并如实告知。前端只经插件 JS API（`check` / `downloadAndInstall` / `getVersion`），**不新增自定义 IPC 命令**，19 条命令契约不变；分层铁律由 `architecture.guard.test.ts` 扩展护栏守死。后端 / `tauri.conf.json` / capability / SPEC / README / docs/UPDATES.md 归后端同事，本轮零改动（§4.4 / §6.4.1 / §9 第 14 条） |
| 20 | **第十轮裁决：不引入重启类插件**（取代上一条中「确认后再 relaunch」的旧口径）：撤销 `tauri-plugin-process`（Rust）与 `@tauri-apps/plugin-process`（npm）、`relaunchApp()` 及全部相关 capability 权限 | 用户只授权 3 个依赖，第 4 个 Rust crate 属越界；且 Tauri v2 官方明确 Windows 安装阶段应用自动退出、`relaunch()` 不可达，该依赖无实际收益。安装成功后 `installing` 保持 true、进度框留到进程退出，由用户手动重新打开。文案与护栏同步收紧（§9 第 15 条） |
| 21 | **品牌图标 + 安装程序简体中文**（2026-11-09）：`bundle.icon` 四件套改引用 `wtf-downloader-32/128/256.png` + `wtf-downloader.ico`；ICO 由 1024 母版重生成六层；新增 `bundle.windows.nsis.languages: ["SimpChinese"]` 与 `installerIcon` | 用户截图：NSIS 向导全英文、exe 与标题栏仍是 Tauri 默认图标；用户已把 `wtf-downloader-*` 全套图标放进 `crates/app/icons/`。原 ICO 只有 256 单层，不符合官方 16/24/32/48/64/256 要求，故用母版重生成。欢迎页侧栏图需 164×314 BMP，用户未提供，保持 NSIS 默认并列为可选项（docs/UPDATES.md §8.1 / §9） |
