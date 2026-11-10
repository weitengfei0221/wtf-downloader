# wtf-downloader

一款界面现代、轻量、无广告的 Windows 多分片下载器：把大文件 HTTP/HTTPS 直链下载做到快、稳、可恢复。

## 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 桌面框架 | Tauri | 2.12.x |
| 前端 | Vue 3 + TypeScript + Vite | 3.5.x / 5.9.x / 8.3.x |
| 状态/路由 | Pinia + vue-router | 4.1 / 5.4 |
| 下载引擎 | 纯 Rust（reqwest + governor + rusqlite） | reqwest 0.13 / rusqlite 0.40 |
| 数据库 | SQLite（bundled，WAL 模式） | 3.53.x |
| 打包 | NSIS 安装包（WebView2 bootstrapper） | NSIS 3.13 |

Cargo workspace 结构：`crates/downloader-engine`（零 Tauri 依赖的下载引擎，可独立测试）+ `crates/app`（Tauri 桥接层）+ `ui/`（Vue 3 前端）。

## 环境要求

- Windows 10 21H2 / Windows 11（WebView2 Runtime 缺失时安装包会联网引导安装）
- Rust 工具链 ≥ 1.90（MSVC target）
- Node.js ≥ 22

## 开发启动

```bash
# 首次：安装前端依赖
cd ui && npm install && cd ..

# 启动开发模式（会自动拉起 vite dev server 与桌面窗口）
cd crates/app
npx @tauri-apps/cli dev
```

注意：`tauri` CLI 未全局安装，统一通过 `npx @tauri-apps/cli` 调用，且需在 `crates/app` 目录下执行（`tauri.conf.json` 所在目录）。

## 测试

```bash
# 后端全量测试（引擎单元测试 + 集成测试）
cargo test --workspace

# 引擎独立测试（验证零 Tauri 依赖约束）
cargo test -p downloader-engine

# 前端测试（vitest）
npm --prefix ui run test

# 前端类型检查 + 构建
npm --prefix ui run build
```

## 打包

在 `crates/app` 目录执行。**必须先提供 updater 签名私钥**（签名不可禁用），否则不会产出 `.sig`：

```powershell
# PowerShell
$env:TAURI_SIGNING_PRIVATE_KEY = "C:\Users\<你>\.tauri\wtf-downloader.key"
npx --no-install @tauri-apps/cli build
```

```bash
# Git Bash
cd crates/app
export TAURI_SIGNING_PRIVATE_KEY="/c/Users/<你>/.tauri/wtf-downloader.key"
npx --no-install @tauri-apps/cli build
```

私钥也可以用内容字符串传入（便于 CI secret），但**绝不能写进仓库或 `.env`**（Tauri 不读 `.env`）。`--no-install` 可避免 npx 联网下载 CLI；本机已有 `tauri-cli 2.12.4`。

产物在仓库根：

```
target/release/bundle/nsis/wtf-downloader_<version>_x64-setup.exe
target/release/bundle/nsis/wtf-downloader_<version>_x64-setup.exe.sig
```

`.sig` 是更新包的 minisign 签名，发布时把它的**内容**填进 `latest.json` 的 `signature` 字段，见 `docs/UPDATES.md`。完整发版流程（版本号、`latest.json` 模板、GitHub Release、首版演练）都在该文档。

安装程序已配置为**简体中文界面**（`bundle.windows.nsis.languages: ["SimpChinese"]`），并使用 `crates/app/icons/wtf-downloader.ico` 作为安装程序与 exe 图标；应用图标集为该目录下的 `wtf-downloader-*.png`。安装包自带 WebView2 引导策略（downloadBootstrapper，静默）：目标机器缺失 WebView2 Runtime 时联网引导安装，已装则跳过。

> 首次运行未代码签名的安装包会触发 SmartScreen，属预期行为，见「已知限制」。

## 使用说明

1. 双击 `wtf-downloader_0.1.0_x64-setup.exe` 安装（默认按当前用户安装，无需管理员权限）
2. Ctrl+N 或点击「新建任务」，粘贴 HTTP/HTTPS 直链（支持批量，一行一个）
3. 应用自动探测文件名与大小（2 秒内），确认后开始多分片并行下载
4. 关闭窗口后应用驻留系统托盘，下载不中断；托盘菜单可暂停/恢复全部、退出

## 软件更新

应用启动时自动检查更新，设置页也可手动检查。更新源为 GitHub Releases 上的静态 `latest.json`，安装前由 updater 用内置公钥校验签名（签名不可禁用）。Windows 安装阶段应用会自动退出，安装完成后请重新打开应用；本项目不使用 relaunch 自动重启（安装后立即重启非必需）。发布流程、密钥备份要求与 `latest.json` 模板见 `docs/UPDATES.md`。

## 已知限制

- **安装包未签名**：首次运行时 Windows SmartScreen 会弹出「Windows 已保护你的电脑」提示。应对方式：
  - 点击「更多信息」→「仍要运行」；
  - 或右键安装包 → 属性 → 勾选「解除锁定」→ 确定后再安装；
  - 该提示仅出现在首次运行，属未签名分发的预期行为（对应 PRD R1 风险项），后续版本计划引入代码签名证书。此处的「未签名」仅指缺少 Windows 代码签名证书（影响 SmartScreen），与更新机制无关：updater 使用独立的 minisign 密钥对强制验签，签名不可禁用。
- 仅支持 HTTP/HTTPS 直链；BT/磁力/视频站点解析不在 MVP 范围。
- 仅承诺 Windows；macOS 引擎天然可移植但未打包。
- 界面语言仅简体中文。

## 文档索引

- 产品需求：`docs/PRD.md`
- 技术规格：`docs/SPEC.md`
- 架构设计：`docs/ARCHITECTURE.md`
- QA 质量报告：`docs/phase4/QA-REPORT.md`
- 发布与更新操作手册：`docs/UPDATES.md`
