# 软件更新机制（发布操作手册）

本文件只描述发布侧操作。前端「启动自动检查 + 设置页手动检查」由 `ui/` 实现，不在本文范围。

## 1. 机制与边界

- 更新源：GitHub Releases 上的静态 `latest.json`，无需自建服务。
- 更新端点：`crates/app/tauri.conf.json` 的 `plugins.updater.endpoints`，当前为占位地址，见 §7。
- 检查方式：应用启动自动检查 + 设置页手动检查（前端调用 `@tauri-apps/plugin-updater` 的 `check()`）。
- 安装后的行为：Windows 安装阶段应用会自动退出（Tauri v2 在 Windows 上的安装器限制），安装完成后请重新打开应用。**本项目不使用 relaunch 自动重启**：官方明确安装后立即重启并非必需，且 Windows 上 `downloadAndInstall()` 执行时应用已退出、`relaunch()` 不可达；因此未引入任何重启类插件依赖或权限。
- 验证链路：`pubkey`（配置内公钥）校验 `.sig`，再由 `.sig` 校验安装包。**updater 的签名不可禁用**，缺签名或签名不匹配的更新一律拒绝安装。
- 与「首版不做代码签名」是两件事：代码签名证书影响的是 Windows SmartScreen 首次运行提示；updater 用的是本次生成的 minisign 密钥对，与 SmartScreen 无关。安装包未签名仍会出现 SmartScreen 提示，属预期行为。
- `bundle.createUpdaterArtifacts: true` 让 bundler 在生成 NSIS 安装包时同时产出 `.sig`。该字段在 Tauri v3 会移除，当前 v2 必须用布尔 `true`（迁移用户才用 `"v1Compatible"`，本项目无历史用户，不用）。

## 2. 密钥（最高优先级资产）

密钥对已在本机生成，私钥**未写入仓库任何文件**，也不应写入任何 `.env` 文件（Tauri 明确不读取 `.env`）。

- 私钥绝对路径：见交付报告，本文件不记录任何私钥路径或文件名（同样不写进 `.gitignore`、示例、日志与仓库内任何其它文件）。
- 公钥内容已写入 `crates/app/tauri.conf.json` 的 `plugins.updater.pubkey`（必须是内容字符串，不能是文件路径）。
- 本次生成的私钥**未设置密码**，因此不需要 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。若日后重新生成带密码的密钥，构建时须同时提供该变量。
- **私钥丢失 = 永远无法给已安装用户发布更新**。已安装的应用内嵌了当前公钥，只有对应私钥能签出被接受的更新；换密钥对等于把全部存量用户钉死在旧版本。必须离线备份（加密 U 盘 / 密码管理器 / 离线介质），不要只留在本机磁盘，不要提交进任何仓库、聊天记录或 CI 日志。

## 3. 版本号规则

- `tauri.conf.json` 的 `version` 与 workspace `Cargo.toml` 的 `[workspace.package] version` 必须同步，当前均为 `0.1.0`。
- `latest.json` 的 `version` **必须严格大于** 应用当前版本才会触发更新；相等或更小返回「无更新」。首版发布时应用版本与 `latest.json` 相同，天然无法验证旧→新，见 §6。
- 发版顺序：先改两处版本号 → 构建 → 上传 → 发布 Release。
- updater 会先校验整个 `latest.json` 的结构，再比较版本号。因此 `platforms` 里列出的每个平台都必须同时具备合法的 `url` 与 `signature`，不能留空串或半成品条目。

## 4. 构建（每次发版）

在 `crates/app` 目录执行。先提供私钥，再构建：

```powershell
# PowerShell —— 私钥路径用生成时 -w 指定的那个文件，不要写死进仓库文件
$env:TAURI_SIGNING_PRIVATE_KEY = "<私钥文件绝对路径>"
# 本次密钥无密码，下一行不需要；若换了带密码的密钥才启用
# $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<密码>"
npx @tauri-apps/cli build
```

```bash
# Git Bash 等价写法
export TAURI_SIGNING_PRIVATE_KEY="<私钥文件绝对路径>"
npx @tauri-apps/cli build
```

`TAURI_SIGNING_PRIVATE_KEY` 也可直接填私钥内容字符串（便于 CI secret），但绝不能把内容贴进仓库。`.env` 文件无效。

产物在仓库根：

```
target/release/bundle/nsis/wtf-downloader_<version>_x64-setup.exe
target/release/bundle/nsis/wtf-downloader_<version>_x64-setup.exe.sig
```

以 `0.1.1` 为例，即 `wtf-downloader_0.1.1_x64-setup.exe` 与其同名 `.sig`。`.sig` 由 bundler 自动生成，不要手工签名、不要改动两个文件的内容。

## 5. 发布 `latest.json` 与安装包

### 5.1 模板

字段大小写固定，来自 Tauri 官方 static JSON 规范。必填 `version`、`platforms.<target>.url`、`platforms.<target>.signature`；`notes` / `pub_date` 可选。`signature` 填 `.sig` 文件的**内容字符串**（base64），不是路径也不是 URL。`pub_date` 若填写必须是 RFC 3339。

```json
{
  "version": "0.1.1",
  "notes": "修复与改进说明（纯文本，会展示给用户）",
  "pub_date": "2026-11-07T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<粘贴 wtf-downloader_0.1.1_x64-setup.exe.sig 的全部内容>",
      "url": "https://github.com/<OWNER>/<REPO>/releases/download/v0.1.1/wtf-downloader_0.1.1_x64-setup.exe"
    }
  }
}
```

读取签名内容：

```powershell
Get-Content target\release\bundle\nsis\wtf-downloader_0.1.1_x64-setup.exe.sig -Raw
```

平台键格式为 `OS-ARCH`，Windows x64 即 `windows-x86_64`。本项目只打包 NSIS x64，不要为了凑格式添加未构建的平台条目。

### 5.2 GitHub Release 步骤

1. 新建 Release，tag 与版本一致（如 `v0.1.1`）。
2. 上传两个附件：`wtf-downloader_0.1.1_x64-setup.exe` 与 `latest.json`。
3. `.sig` 不需要作为附件上传——它的内容已写进 `latest.json` 的 `signature` 字段。
4. 确认 `latest.json` 里的 `url` 指向**本次 Release** 的 `.exe` 附件地址，且为 HTTPS（生产模式强制 TLS）。
5. 发布 Release（不要留在 draft）。端点用的是 `releases/latest/download/latest.json`，它只会读最新一个正式 Release。
6. 启动一个 `0.1.0` 的已安装副本，确认能检查到 `0.1.1`、下载并完成安装；应用在安装阶段自动退出后，重新打开确认版本变为 `0.1.1`。

## 6. 首版演练（必做，否则上线即盲发）

首版 `0.1.0` 发布时，应用版本与 `latest.json` 版本相同，**无法验证旧→新的真实更新链路**；而一旦有用户装了 `0.1.0`，后续更新必须用同一把私钥签名，密钥问题无法事后补救。因此正式对外前必须先做一次本地闭环演练：

1. 临时把版本号提到 `0.1.1`（两处），按 §4 构建，拿到 `.exe` 与 `.sig`。
2. 在本机起一个静态服务器同时提供 `.exe` 与 `latest.json`（例如 `python -m http.server 8000 --directory <目录>`）。
3. 临时把 `tauri.conf.json` 的 `endpoints` 指向本机，并临时加 `plugins.updater.dangerousInsecureTransportProtocol: true` 以允许 HTTP。
4. 用 `0.1.0` 的构建运行一次完整流程：检查 → 下载 → 安装（应用自动退出）→ 重新打开 → 版本号 `0.1.1`。
5. 演练结束后**必须**把 `endpoints` 改回生产地址、删除 `dangerousInsecureTransportProtocol`，再重新构建正式产物。生产配置里不允许存在该开关。
6. 也可改用自签 HTTPS 服务器跳过该开关，但需处理证书信任，成本更高。

演练只验证机制，不作为发版产物。

## 7. 待补齐的外部值

| 项 | 当前状态 | 处理 |
|----|----------|------|
| GitHub 仓库地址 | **已替换**为 `https://github.com/weitengfei0221/wtf-downloader/releases/latest/download/latest.json` | 端点编译进 exe，替换后**必须重新打包**；已安装旧版客户端的端点无法远程修改 |
| 本地 git 仓库 | **已初始化**，`main` 已推送到 origin | 见 §9.1；`.gitignore` / `.gitattributes` 已就绪 |
| Release tag 与附件命名 | 模板用 `v0.1.1` | 与实际 Release 保持一致 |
| 私钥离线备份 | 尚未确认已完成 | 由用户执行，见 §2 |
| 品牌图标 | **已配置**：`wtf-downloader-*` 四件套 + 六层 ICO，安装程序简体中文 | 见 §8.1；欢迎页侧栏大图仍需 BMP，未配置 |
| 打包 | **已执行**：`npx --no-install @tauri-apps/cli build`（release + updater 签名），产物在 `target/release/bundle/nsis/` | 见 README「打包」与 §4 |
| 已发布版本 | `v0.1.0`、`v0.1.1`，均为 Public 仓库的非 draft Release，各带 `.exe` + `latest.json` 两个附件 | 0.1.1 的 `latest.json` 由 `.sig` 内容生成，`url` 指向 v0.1.1 附件；匿名 curl 端点返回 HTTP 200 |

## 8. 明确未验证

本轮只做配置与编译校验，**未**执行 `tauri build`、未生成安装包、未发布任何 Release。以下均属未验证，不能视为通过：真实 GitHub Release 的端到端更新、生产 TLS 与 2XX/非 2XX 分支行为、WebView2 运行期、安装完成后手动重新打开的行为、SmartScreen 表现、Windows 安装阶段自动退出的衔接。

> **2026-11-11 更新**：`v0.1.0`、`v0.1.1` 已实际打包并发布，端点匿名可达（HTTP 200，返回 0.1.1）。
> 但「**旧版客户端 → 检测到更新 → 下载 → 校验签名 → 安装 → 重启**」这条完整链路**仍未做过真实演练**，
> 也就是本节列的项依旧是未验证状态，只是前置条件已具备。

### 8.1 品牌图标与安装界面（已配置，未做安装包实测）

- `crates/app/icons/` 下 `wtf-downloader.png`（1024×1024 母版）、`wtf-downloader-32/128/256.png`、`wtf-downloader.ico` 为品牌图标集。`wtf-downloader.ico` 由 1024 母版经 `tauri icon` 重新生成，含 **16/24/32/48/64/256 六层**（用户原始 ICO 只有 256 单层，小尺寸会糊）；旧脚手架图标 `icon.ico` / `32x32.png` / `128x128.png` / `128x128@2x.png` 已不再被引用。
- `tauri.conf.json` 的 `bundle.icon` 引用上述四个 `wtf-downloader-*` 文件，决定 **exe 文件图标、窗口/任务栏、托盘、系统通知图标**。
- `bundle.windows.nsis`：`languages: ["SimpChinese"]`（安装向导简体中文）、`installerIcon: "icons/wtf-downloader.ico"`（安装程序窗口/快捷方式图标）、`installMode: "currentUser"`。
- **欢迎页左侧大图仍是 NSIS 默认位图**：Tauri 要求 `sidebarImage` 为 164×314 BMP、`headerImage` 为 150×57 BMP，用户当前只提供 PNG/ICO，故未配置；需要时用品牌素材转出两张 BMP 再加入。
- 以上均经 `tauri info` 与 `cargo check -p app` 解析校验通过，但**未重新打包**，实际安装界面截图需用户打包后确认。

## 9. 首次上线：建仓与发布到 GitHub（用户执行）

### 9.1 本地仓库初始化

在仓库根 `D:\WorkBuddy\Development\wtf-downloader` 执行：

```bash
git init
git add -A
git commit -m "baseline: v0.1.0"
```

`.gitignore` 已就绪，排除 `target/`、`ui/node_modules/`、`ui/dist/`、`.tauri/`、`*.key`、`*.key.pub`、`*.sig`、`.env*`。提交前自检：

```bash
git status --short | grep -E '\.key|\.sig|target/|node_modules/'   # 应无输出
```

**私钥绝不入库**；它只应在用户主目录的 `~/.tauri/` 下，并已离线备份。

### 9.2 建 GitHub 仓库并推送

1. 在 GitHub 网页新建仓库。**建议 Public**：`releases/latest/download/...` 是匿名请求，私有仓库的 Release 附件需要认证，updater 默认不带 token 会取不到 `latest.json`。私有仓库须另配带鉴权的动态更新服务，不在本方案范围。
2. 记下 `OWNER/REPO`，然后：

```bash
git remote add origin https://github.com/OWNER/REPO.git
git branch -M main
git push -u origin main
```

### 9.3 替换更新端点（唯一一处）

改 `crates/app/tauri.conf.json` 的 `plugins.updater.endpoints[0]`：

```
https://github.com/OWNER/REPO/releases/latest/download/latest.json
```

全仓库只此一处。端点会编译进 exe，**改完必须重新构建**；已安装旧版客户端的端点无法远程修改。

### 9.4 首个 Release（v0.1.0）

1. 按 §4 用 `0.1.0` 构建，得到 `..._0.1.0_x64-setup.exe` 与同名 `.sig`。
2. 新建 Release，tag `v0.1.0`，上传两个附件：`.exe` 与 `latest.json`（**不要留在 draft**）。
3. `latest.json` 按 §5.1 模板填：`version: "0.1.0"`，`platforms.windows-x86_64.signature` = 本次 `.sig` 全文，`url` = 该 exe 的 Release 附件地址（HTTPS）。
4. 浏览器直接访问端点 URL，确认能拿到 JSON、且 `url` 可匿名下载。

> 首版 `latest.json.version` 与应用版本相同，**不会触发更新**，这是正常的；它的作用是让端点可用、给后续版本做基线。

### 9.5 测试更新（发 0.1.1）

1. 同步改两处版本号为 `0.1.1`：`crates/app/tauri.conf.json` 的 `version` 与根 `Cargo.toml` 的 `[workspace.package] version`。
2. 按 §4 重新构建 → 新 `.exe` + 新 `.sig`。
3. 新建 Release `v0.1.1`，上传新 exe，并**更新 `latest.json`**：`version: "0.1.1"`、`signature` 换成本次 `.sig` 全文、`url` 换成 v0.1.1 的 exe 地址。`releases/latest/download/latest.json` 自动指向最新正式 Release。
4. 在**装着 0.1.0** 的机器上启动应用：启动 3s 后自动检查，或到设置页点「检查更新」。
5. 期望链路：弹「发现新版本 0.1.1」→「立即更新」→ 下载进度 → 100% 显示「安装已开始，应用即将退出」→ 安装阶段应用自动退出 → 手动重新打开 → 设置页版本号显示 `0.1.1`。
6. 失败排查顺序：① 浏览器访问端点看 JSON 是否为最新且非 404；② 核对 `signature` 与本次 `.sig` 逐字节一致（换行/空格都不能差）；③ 核对 `url` 是 HTTPS 且返回 200；④ 确认构建用的私钥与 `tauri.conf.json` 的 `pubkey` 是同一对；⑤ 确认 `latest.json.version` 严格大于已安装版本。

### 9.6 发布前检查清单

- [ ] 私钥已离线备份（丢失不可逆）
- [ ] `.gitignore` 生效，仓库无 `.key` / `.sig` / `target` / `node_modules`
- [ ] `endpoints` 已替换为真实 `OWNER/REPO`
- [ ] 品牌图标与简体中文安装界面已随本次构建生效（打包后看安装向导截图）
- [ ] 两处版本号一致，`latest.json.version` > 已安装版本
- [ ] Release 非 draft，`.exe` 与 `latest.json` 可匿名下载
- [ ] 每次发版都用同一把私钥签名
