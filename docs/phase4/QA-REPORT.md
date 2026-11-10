# 质量报告 - wtf-downloader v0.1.0（Phase 4 QA）

- 生成日期：2026-10-23（第 1 轮）；**2026-10-23 第 2 轮复验更新（P1-001 修复复验，见 §10）**
- QA：严过关（独立验证者，非实现作者；第 2 轮为新鲜视角独立复验，非橡皮图章）
- 输入基线：SPEC.md v1.0 §9（AC-01~AC-16 唯一依据）+ ARCHITECTURE.md §1.3/§1.4/§7 + Phase 3 交付代码 + P1-001 修复补丁
- 验证环境：Windows / MSVC / cargo 1.99.1 / Node 22；网络经本地代理（对结论的影响见 §3.3）

---

## 1. 概览

| 指标 | 值 | 目标 | 结论 |
|------|-----|------|------|
| 冒烟测试（全量复跑） | 通过 | 通过 | ✅ |
| 后端测试通过率 | 80/80（100%，第 2 轮复验仍全绿） | 100% | ✅ |
| 前端 vue-tsc + build | 通过（第 2 轮复验仍全绿） | 通过 | ✅ |
| 前端 vitest | **22/22**（16 旧 + 6 新通知用例，第 2 轮独立复跑） | 22/22 | ✅ |
| 公网 e2e（kill+续传+字节一致） | 1/1 实跑通过 | 通过 | ✅（QA 补写，见 §5） |
| **P0 缺陷** | **0** | 0 | ✅ |
| P1 缺陷 | **0**（P1-001 已修复并复验通过，见 §10） | ≤ 总数×20% 且修复率≥80% | ✅ |
| P2 缺陷 | 4 | 记录 Backlog | ✅ |
| 回归率 | 0（第 2 轮复验旧行为 80+16 全绿，无绿转红） | 0 | ✅ |
| 测试完整性反作弊 | 通过（第 1 轮 §2 + 第 2 轮修复增量审查 §10.3） | 通过 | ✅ |
| 返工轮次 | 1/3（P1-001 一轮修复） | ≤ 3 | ✅ |

**上线建议：GO-WITH-RISKS（第 2 轮复验后最终结论）。**
P1-001 修复经独立复验通过（调用链全通、22/22 + 80/80 复跑全绿、零回归、零新增 P0/P1）。剩余风险两项：① §7 GUI 手动验收清单（9 项）尚未执行留档，属部署前置必要环节；② 生产就绪总档 Bronze（安全 CSP/无障碍扫描/AC-15 性能实测/可观测/发布安全五维短板，见 §8）——面向内部/早期用户发布可行，商业生产交付需补齐 Silver 缺口。

---

## 2. 测试完整性反作弊审查

> 项目无 git 仓库，无法做 git diff 前后对比。替代手段：全部 80 个测试逐文件人工审查断言质量 + 对照 ARCHITECTURE 常量表/校验分支表核对契约锁定 + 独立复跑 + 公网 e2e 实跑。

### 2.1 五类作弊检测结果

| 检测项 | 结果 | 详情 |
|--------|------|------|
| 测试文件/用例被删 | ✅ 无迹象 | tests/ 含 integration.rs(6)+integration_lifecycle.rs(3)+support；src 内 8 个 tests.rs 全部实心 |
| 断言数下降/弱化 | ✅ 无迹象 | 逐文件抽查：断言具体（byte-identical、精确值、分支全覆盖），无 assert!(true)/空测试/被注释断言 |
| skip/xfail/ignore 新增 | ✅ 无 | 原交付 0 个 #[ignore]；无 .only/focus 等价物 |
| 断言硬编码实现输出 | ✅ 无 | 期望值来自 Spec/常量契约（如 12 illegal、500ms→8s 退避表、96MB→12 片），非"抄实现返回值" |
| 框架/门禁配置篡改 | ✅ 无 | 无 coverage 阈值可篡改；check_lines.sh 门禁通过（crates + ui/src 均 PASS） |

### 2.2 开发者自述修正过的 6 处测试复核（数学正解 vs 迁就实现）

| # | 测试 | 复核结论 |
|---|------|----------|
| 1 | illegal_transitions == 12 | ✅ **数学正解**。5 状态全序对 25 − 自身 5 − 合法 8 = 12；8 条合法迁移与 Spec §6 锁定状态机逐条一致 |
| 2 | writer offset 区间 | ✅ 数学正解。0..300 与 700..900 两段不重叠写 + 洞区零校验 + 预分配长度断言，精确验证 ADR-006 核心 |
| 3 | sanitize 计数 | ✅ 数学正解。3 个非法字符（BEL///BS）各 1 个下划线，一一对应；边界（首尾点/空格、长度 200 截断）齐备 |
| 4 | segment 96MB | ✅ 数学正解。96MB 是 8MB 的精确倍数 → 12 片每片恰 8MB ≥ MIN；测试注释明确说明非倍数时 base < MIN 是锁定公式 `n=ceil(total/MIN)` 的**合法**结果（由 min+1 用例锁定），未为凑数改公式 |
| 5 | split 4×MIN | ✅ 数学正解。parent 保已写前缀 [start, start+downloaded)，children 精确平铺剩余区间，覆盖守恒断言 covered == 原长；同步验证 sibling 不受扰动 |
| 6 | throttle settle | ✅ 数学正解。burst = clamp(512KB/4, 256KB, 1MB) = 256KB，在 512KB/s 下 0.5s 排空，1.2s settle 充分；AC-12 的"2 秒收敛"语义对应稳态窗口，测后 2s 窗口 ±10% 断言严格 |

### 2.3 关键契约测试锁定核对（对照 ARCHITECTURE §1.3/§1.4）

| 契约 | 锁定测试 | 结论 |
|------|----------|------|
| 分片规划边界（0 字节/无 CL/不支持 Range/精确 MIN/MIN+1/大文件 max/tiling 性质） | segment/tests.rs 9 个用例 + assert_tiling 性质断言 | ✅ 全锁定 |
| 三元组 5 分支表 | resume/tests.rs::triple_table_branches + total_mismatch + 200 两分支 + final_url 变更 | ✅ 全锁定 |
| 416 处理（起点==总长→完成；否则重置分片） | handle_416_branches 5 断言 | ✅ |
| 错误分类（可重试 408/429/5xx vs 致命 4xx）+ Retry-After 抬底 + 退避 8s 上限 | classify/tests.rs 3 用例 + backoff_delay_progression_is_capped | ✅ |
| 同名递增 name (1)/(2) + .part 占位 | naming/tests.rs::dedupe_increments_suffix | ✅ |
| 状态机全表（合法 8 + 非法 12）+ 事件发射/错误清空 | task/tests.rs 4 用例 | ✅ |
| 事件映射表 + camelCase 载荷 | app events/tests.rs 6 用例 | ✅ |
| WAL 模式 / CASCADE / 往返持久化 / 聚合 SUM | store/tests.rs 9 用例 | ✅ |
| 引擎零 Tauri 依赖 | `cargo tree -p downloader-engine` 无 tauri 节点（实测）+ 独立测试通过 | ✅ AC-14 |

### 2.4 弱断言发现（未构成作弊，属加固建议 → P2-001）

`integration.rs::pause_resume_continues_from_recorded_offsets` 中 AC-08 的「Range 起点非 0」仅断言 `request_count 增加`（TestServer 不记录 Range 头起点），从零重启也会通过该断言。缓解：QA 补写的 e2e（§5）以「崩溃后 downloaded_bytes > 0 存活 + 最终字节一致」锁定了 AC-08 实质（进度不清零），该弱点不再有放行风险。建议 TestServer 记录 Range 起点最小值并断言 > 0。

### 2.5 sleep 代替同步原语检查

集成测试的 50ms 轮询（wait_for_status/downloaded_of）是对异步状态机的合理等待模式，断言含超时上限保护，非「sleep 换绿」。throttle 测试的 settle() 是对真实 GCRA 排空的建模，非时间作弊。未发现 sleep 掩盖竞态。

---

## 3. 独立复跑证据（机械证据）

### 3.1 cargo test --workspace（QA 独立执行）

```
app 单元:        16 passed; 0 failed
downloader-engine 单元: 55 passed; 0 failed
tests/integration.rs:      6 passed; 0 failed
tests/integration_lifecycle.rs: 3 passed; 0 failed
tests/e2e.rs:              0 passed; 0 failed; 1 ignored（#[ignore] 公网手动跑，见 §3.3/§5）
合计 80 passed / 0 failed / 1 ignored
```

### 3.2 UI 复跑

```
npm run build  → vue-tsc --noEmit 0 error + vite build ✓（产物 9 个 chunk，共 ~190KB gzip）
npm run test   → vitest 16/16 passed（src/utils/format.test.ts）
```

### 3.3 公网 e2e 实跑（QA 补写 tests/e2e.rs 后执行）

```
cargo test -p downloader-engine --test e2e -- --ignored --nocapture
→ e2e OK: restored 1 task in 0.00s, kill point ~7 MB, frames 10/2.5s, final 34906389 bytes identical
→ test result: ok. 1 passed; 0 failed  （12.6s）
```

覆盖：公网探测（重定向+TLS+CDN，<2s，AC-01）→ 4MB/s 限速下载 → **运行中硬杀**（drop tokio runtime，等价 kill 后的磁盘现场）→ 新引擎 restore（0.00s < 3s，AC-11 引擎侧）→ 进度不清零（kill 点内存 10MB / 落库 7MB，符合"丢最近 1 个快照周期"语义）→ 续传完成 → **最终 34,906,389 字节与源逐字节一致**（AC-07+AC-08）→ 帧率实测 4.0 帧/s ≥ 2（AC-05）。

**网络环境记录**（如实区分环境问题与产品缺陷）：
- 首选 nodejs.org 直链因路由慢（267KB/s）未达 kill 点超时 → **环境**，非产品缺陷
- OVH proof.ovh.net 中途被代理拒连（TunnelUnsuccessful ×3，curl 同样 000）→ **环境**
- 最终源华为云镜像 11.4MB/s，测试稳定通过
- e2e 中曾出现一次 phase-2 显式 resume() 失败（`downloading -> downloading` 非法迁移）——**测试竞态非产品缺陷**（restore 后调度器已自动拉起，真实用户路径无此调用）；已修正测试依赖调度器自动重拉

### 3.4 构建与门禁

| 项 | 结果 |
|----|------|
| cargo build --release -p downloader-engine | ✅ 通过（首次失败为 rustc 进程级瞬时崩溃 STATUS_ACCESS_VIOLATION，与并发构建争用相关，重试干净通过——环境故障非代码缺陷） |
| scripts/check_lines.sh（≤300 行门禁） | ✅ crates 与 ui/src 双 PASS |
| 版本锚定（Cargo.lock 实测） | ✅ tauri 2.12.5 / reqwest 0.13.5 / rusqlite 0.40.2 / governor 0.10.4，与 Spec §4 逐项一致；插件补丁号已回填（single-instance 2.5.4 / autostart 2.7.0 / opener 2.7.2 / notification 2.7.0 / dialog 2.8.3）；无 sqlx |
| 完整 tauri build（NSIS） | 未执行（按分工留给运维/Phase 5） |

---

## 4. 视觉与团队级 P0 规则合规

| 规则 | 扫描方法 | 结果 |
|------|----------|------|
| 禁 emoji 作为 UI 功能图标 | 全量正则扫描 ui/src + index.html（U+1F000-1FAFF/2190-2BFF/FE0F） | ✅ 真 emoji 0 匹配；仅代码注释中的 CJK 箭头 →/←（排版字符，非 UI 图标），模板/文案零匹配 |
| 禁紫→粉渐变 | purple/pink/7C3AED/A855F7/EC4899/from-purple 全扫 | ✅ 0 匹配 |
| 禁 AI 模板味占位文案 | Welcome to / Lorem ipsum / Sign up today | ✅ 0 匹配 |
| 图标库唯一 @lucide/vue | package.json + import 全扫 | ✅ 全部经 @lucide/vue；lucide-vue-next 零引用 |
| 颜色禁硬编码（Token 纪律） | 抽查 design-tokens.css 引用 | ✅ 组件一律 var(--token) |

---

## 5. 缺陷清单与回归集更新

### P0（必须归零才上线）

| ID | 描述 | 状态 |
|----|------|------|
| — | 无 | — |

### P1（阻断项 — 上线前必须修复）

| ID | 描述 | 违反需求 | 证据 | 建议 | 状态 |
|----|------|----------|------|------|------|
| **P1-001** | **完成通知是 no-op**（第 1 轮发现）：设置项 notifyOnComplete 持久化正常、tauri-plugin-notification 已注册、`task:completed` 事件已发射、前端 `onTaskCompleted()` 封装已存在——但**全链路无任何消费者发送系统通知** | PRD F9（P1 基础设置）、Spec §7 设置页「完成通知」、ARCHITECTURE T4.2、Spec §5.2 task:completed「完成通知用」注记 | 第 1 轮：`grep onTaskCompleted` 仅命中 api/tasks.ts:94 定义无调用者；`grep sendNotification/isPermissionGranted` 0 命中；ui/package.json 无 plugin-notification | 前端 App.vue 接 onTaskCompleted → 读 config.notifyOnComplete → 经 @tauri-apps/plugin-notification 发通知；补映射单测 | **✅ 已修复，第 2 轮复验通过（见 §10）** |

**P1 修复率：1/1 = 100%（≥80% 门禁达成），P1 存量 = 0。**

### P2（记录 Backlog，不阻断）

| ID | 描述 | 建议 |
|----|------|------|
| P2-001 | 集成测试 AC-08 断言弱（request_count only，不验证 Range 起点>0） | TestServer 记录 Range 起点最小值并断言 > 0（e2e 已锁实质，此项为加固） |
| P2-002 | progress_loop/snapshot_loop/scheduler_loop 零单测（ARCHITECTURE T1.7 的「满队列丢帧不死/订阅 drop 不影响下载」未以单测交付；帧率已由 e2e 实测覆盖） | 补聚合循环单测：bounded(64) 满队列 try_send 不阻塞、drop 订阅者后下载照常 |
| P2-003 | events.rs spawn_forwarding 中 progress.recv() 返回 None 时 `continue`，理论上通道关闭会忙等（engine 生命周期内 progress_tx 恒持有，实际不触发） | None 时 break 或计数守卫 |
| P2-004 | tauri.conf.json `csp: null`（CSP 关闭）。单机本地应用攻击面小，但 Tauri 官方建议显式 CSP | Phase 5 打包前配置基础 CSP |

### 回归集更新

| 新增回归用例 | 对应缺口 | 文件路径 |
|--------------|----------|----------|
| `public_net_kill_resume_completes_byte_identical`（#[ignore]，公网手动跑） | ARCHITECTURE T1.8 交付物缺失（Phase 3 未交付 tests/e2e.rs）；锁定 AC-01/05/07/08/11 | `crates/downloader-engine/tests/e2e.rs`（QA 补写，随报告入库） |
| 通知 6 用例（已授权发送 / 未授权先请求 / 拒绝静默 / 失败含错误摘要 / 错误缺失退化文案 / 插件抛错吞掉） | P1-001 修复回归锁定：权限门卫三分支 + 失败通知 fire-and-forget 不抛错 | `ui/src/api/notification.test.ts`（修复轮交付，QA 复验通过） |

---

## 6. AC 覆盖矩阵（AC-01~AC-16）

| AC | 需求 | 验证方式 | 结论 | 证据 |
|----|------|----------|------|------|
| AC-01 | 2s 探测 + 创建等待任务 | **已自动化**（引擎侧）+ GUI 部分 | ✅ | PROBE_TIMEOUT_MS=2000；e2e 公网探测 <2s 实测；超时文案 + UI 仍可"仍然添加" |
| AC-02 | 非法 URL 拒绝、无半成品 | **已自动化** | ✅ | commands/tests::url_validation_rejects_bad_input；集成 fatal_404：add 失败 + 任务表为空 |
| AC-03 | Range 分片并行、偏移写入 | **已自动化** | ✅ | 集成 multi_segment 字节一致；plan tiling 性质单测；writer offset 单测 |
| AC-04 | 不支持 Range 降级 + 如实展示 | **已自动化**（引擎）+ GUI 展示 | ✅ | 集成 no_range_support_degrades；UI `add.noRanges`=「服务器不支持分段加速，将单连接下载」 |
| AC-05 | 进度 ≥2 次/秒 | **已自动化**（e2e 实测） | ✅ | 4Hz 生产端节流（PROGRESS_INTERVAL_MS=250）+ 有界通道丢帧；e2e 实测 4.0 帧/s |
| AC-06 | 分片自动重试 3 次退避不影响他片 | **已自动化** | ✅ | 集成 503 注入重试+拆段字节一致；classify/backoff 单测（500ms→8s cap） |
| AC-07 | 完成尺寸==Content-Length，偏差置失败 | **已自动化** | ✅ | writer finish_rejects_size_mismatch；集成+e2e 字节级一致 |
| AC-08 | 续传从分片已完字节继续、进度不清零 | **已自动化** | ✅ | resume 三元组全表单测；集成 pause/resume；**e2e 崩溃续传：落库 7MB 存活 + 最终字节一致** |
| AC-09 | 续传校验冲突终止不静默拼坏 | **已自动化**（引擎）+ GUI 弹窗代码审查 | ✅ | 集成 etag_change → resume_conflict 失败；UI 冲突确认 → remove+add 组合（ARCHITECTURE §3.2 定案） |
| AC-10 | 暂停 1s 内断连 + 持久化 | **已自动化**（路径）+ 时间指标 GUI | ✅ | pause → cancel token → worker abort + runner 即时 flush_task_snapshot；集成断言 Paused + .part 存在 |
| AC-11 | 重启 3s 内恢复全部记录、进度完整 | **已自动化**（引擎侧）| ✅ | 集成 restore_resumes_interrupted_task；e2e 崩溃恢复实测 0.00s；GUI 全链路 3s → 手动清单 #3 |
| AC-12 | 限速 2s 收敛 ±10% | **已自动化** | ✅ | throttle_converges_within_10_percent（512KB/s 稳态 2s 窗口 ±10%）+ 任务级叠加/解除单测 |
| AC-13 | 删除连文件；已完成文件永不删 | **已自动化** + UI 代码审查 | ✅ | 集成 remove_task_deletes_part_file；ops.rs `status != Completed` 守卫；UI 未完成三按钮确认/已完成只删记录+5s 撤销 |
| AC-14 | 引擎零 Tauri 依赖、独立测试 | **已自动化** | ✅ | cargo tree 无 tauri；`cargo test -p downloader-engine` 独立全绿 |
| AC-15 | 吞吐 ≥3x / 内存 / 冷启动 | **未覆盖** → GUI 手动 #10 | ⏳ | 属 S4/T4.3 性能实测项（任务管理器+计时留档） |
| AC-16 | 单实例聚焦不新开 | 代码审查 + GUI 手动 #6 | ⏳ | single-instance 插件第一个注册（lib.rs），回调 show+set_focus |

自动化覆盖：13/16 全绿 + 2/16 代码审查通过待 GUI 实证 + 1/16（AC-15）纯手动。**无任何一条 AC 处于"未覆盖且无计划"状态。**

---

## 7. GUI 手动验收清单（部署前必须逐项执行并留档）

对应 Spec §12 端到端验证 7 步 + ARCHITECTURE §7：

1. **启动**：`cargo tauri dev` → 主窗口出现；上次未完成任务 3s 内恢复（AC-11 GUI 全链路）
2. **核心成功流**：Ctrl+N 粘贴公网大文件直链 → 确认；进度条 4Hz 刷新（DevTools 时间戳抽查）、速度/剩余时间十进制 MB/s；暂停 → 恢复 → 日志验证 Range 起点非 0；完成 → 文件大小 == Content-Length
3. **断电恢复流**：下载中任务管理器强杀 → 重启 → 3 秒内恢复且进度完整（引擎侧已由 e2e 实证，此项验 GUI 感知）
4. **错误流**：404 链接 → 失败信息含 HTTP 状态码、不进重试循环；非法 URL → 拒绝并提示原因
5. **限速流**：全局限速 1MB/s + 2 任务并行 → 合计 2s 收敛 ±10%
6. **托盘与单实例**：关窗 → 驻留托盘、下载不中断；二次启动 → 仅聚焦已有窗口（AC-16）；托盘菜单暂停/恢复全部、限速子菜单勾选同步、tooltip 1Hz、退出落盘
7. **主题**：跟随系统深浅切换即时生效（深色优先）
8. **交互细节**：剪贴板预填（F6）、Ctrl+F 搜索、同名文件自动 `name (1)` 递增、HTTP 明链警告、resume_conflict 弹「是否重下」
9. **性能实测（AC-15）**：常驻内存 <80MB、3 任务 <150MB、冷启动 <2s、分片吞吐 ≥3 倍单连接（同源对比留档）

---

## 8. 生产就绪评级（7 维 × Bronze/Silver/Gold）

| 维度 | 档位 | 证据 |
|------|------|------|
| 测试 + 回归 | **Silver** | 影响图定向覆盖好（契约表逐项锁定）；回归率 0；独立 e2e 已入库；关键路径 pass^1（Gold 需 pass^k/变异加固——变异定向未做） |
| 契约 | **Silver** | types.ts ↔ Rust serde 结构体逐字段对齐（app 事件映射 + config camelCase 序列化均有单测）；错误模型统一 AppError；无 CI 契约破坏即红（未到 Gold） |
| 安全 | **Bronze** | 输入校验齐（URL/limit 1KB/s/segments 1-16/绝对目录）；Content-Disposition 路径穿越拒绝；无密钥无鉴权场景；扣分：CSP null（P2-004）、无 SAST/供应链扫描 |
| 无障碍 | **Bronze** | 键盘路径完整（Tab 困环/Ctrl+N/F/↑↓/Space/Delete/Enter、aria-label）；对比度设计时验算 ≥4.5:1；自动扫描与屏读走查未做 |
| 性能 | **Bronze** | 热点路径审查合理（批量快照单事务/复合主键聚簇/超时齐备/无 N+1）；AC-15 指标未实测 |
| 可观测 | **Bronze** | 结构化错误码（AppError code 枚举）+ 启动恢复日志；无日志框架/指标/SLI |
| 发布安全 | **Bronze** | 可回退（重装旧版）；NSIS 未打包、无回滚演练、未签名 |
| **总档（取最低）** | **Bronze** | 未达 Silver 不交付商业生产 |

> 评级说明：Bronze 总档是 MVP Phase 4 的**可解释**结果——缺口集中在安全/无障碍/性能/可观测/发布五维的 Gold/Silver 加分项，核心交付质量（引擎正确性、契约、测试回归）已达 Silver。按记分卡纪律如实评级，不用强项（测试）掩盖短板（CSP/性能实测）。

---

## 9. 结论与裁决（第 2 轮复验后最终版）

### 结构化 RoleVerdict

- **verdict**: **pass（GO-WITH-RISKS）** —— P1-001 修复经独立复验通过；P0=0、P1=0、回归率=0；带 2 项已知风险放行（见上线建议）
- **blocking**: 无（原 P1-001 已修复复验通过，见 §10）
- **advisory**（不阻断）:
  1. P2-001 集成测试 Range 起点断言加固
  2. P2-002 聚合循环单测（丢帧/订阅 drop）
  3. P2-003 progress 通道关闭忙等守卫
  4. P2-004 CSP 配置（Phase 5 打包前）
  5. e2e 测试网络源建议常备 2-3 个候选直链（本次环境切换 3 次才稳定）
  6. （已裁）失败通知 error code 文案技术化（如 http_status:404 直出正文）——项目总监裁定 MVP 可接受，不阻断
  7. （第 2 轮新记，观察项非缺陷）App.vue `onMounted` 中 config 异步加载与事件监听注册并发，理论上存在「config 未加载完成时完成事件到达 → 开关读 undefined → 不通知」的毫秒级窗口；实际任务恢复+完成远慢于本地 invoke 加载，不可达，记录备查
- **evidence**:
  - 第 2 轮独立复跑：cargo test --workspace **80 passed / 0 failed / 1 ignored**；npm run build ✓（1.37s，vue-tsc 0 error）；npm run test **22/22**（16 旧 + 6 新）
  - 通知链路 fresh-eyes 审查全通：SettingsView 开关 → configStore.patch 持久化 → App.vue `onTaskCompleted` 读 `config?.notifyOnComplete`（事件时实时读，改设置即时生效）→ `sendTaskCompletedNotification` → @tauri-apps/plugin-notification（npm **2.7.0** ↔ Rust crate **2.7.0** 同版，Cargo.lock/package-lock 双锚定实测）→ 后端 `lib.rs:30` `.plugin(tauri_plugin_notification::init())` 已注册 + capabilities `notification:default` 已授权
  - 失败通知语义正确：`onTaskFailed` **无条件**通知（PRD F9「失败必通知」），resume_conflict 弹窗与通知并存不冲突；文件名经 `tasksStore.byId` 取、缺失退化为「未知文件」
  - 权限门卫三分支正确：已授权直发 / 未授权先 requestPermission / 拒绝或插件抛错静默返回不抛错（辅助通道不阻断主流程）
  - fire-and-forget 正确：App.vue 全部 `void send...()`，不 await，事件循环不被通知 IO 阻塞
  - 回归检查通过：App.vue 116 行（≤300 门禁）；emoji / 紫粉渐变 / 占位文案三扫零匹配；无硬编码颜色；分层合规（plugin-notification 仅 api/notification.ts import，全前端唯一命中）；check_lines.sh LINE GATE PASSED
  - 第 1 轮证据全部维持有效（80/80 后端、e2e 崩溃续传字节一致、反作弊五项、契约锁定、团队级 P0 规则零匹配）
- **缺陷统计**: P0=0；P1=0（1 发现 1 修复 1 复验）；P2=4；回归率=0；返工轮次=1/3
- **上线建议**: **GO-WITH-RISKS**。风险项：① §7 GUI 手动验收清单（9 项）未执行留档——部署前必须补；② 生产就绪总档 Bronze（CSP/无障碍扫描/AC-15 性能实测/可观测/发布安全五维短板）——内部/早期用户发布可行，商业生产交付需补齐 Silver 缺口。P2 Backlog 4 项随版本迭代消化。

### 失效模式核对（6 类）

| 失效模式 | 结果 | 详情 |
|----------|------|------|
| Happy-path 偏差 | ✅ | 错误/边界/超时分支各有用例（404/503 注入/416/降级/0 字节/无 CL/非法输入/磁盘错误）；通知路径含权限拒绝/插件异常分支 |
| 沉默逻辑错误 | ✅（经 e2e 补强） | 最贵的崩溃续传路径已用「字节一致」终验；进度聚合的速度/ETA 计算无专测（P2-002） |
| 幻觉依赖/接口 | ✅ | 构建即验证；版本全部锚定实测一致（含通知插件 npm 2.7.0 ↔ Rust 2.7.0）；无编造 API |
| 缺失系统上下文 | ✅ | 单机无鉴权场景合理；限速/重试预算/重定向上限/并发槽位等系统约束全部显式常量+测试 |
| 性能盲区 | ⚠️ | 复杂度审查通过，AC-15 实测未做（GUI 手动 #9） |
| 静默缺失 | ✅ | vue-tsc 0 error；第 1 轮唯一静默缺失 P1-001 已修复并以 6 用例锁定，不再静默 |

---

## 10. 第 2 轮复验记录（P1-001 修复复验，2026-10-23）

> 复验人：严过关（对修复代码以新鲜视角独立验证，所有命令为本轮真实执行，非转述）。

### 10.1 独立复跑（机械证据，真实输出摘录）

```
cargo test --workspace（QA 第 2 轮独立执行）
  app 单元:              16 passed; 0 failed
  downloader-engine 单元: 55 passed; 0 failed
  tests/integration.rs:   6 passed; 0 failed
  tests/integration_lifecycle.rs: 3 passed; 0 failed
  tests/e2e.rs:           0 passed; 0 failed; 1 ignored（#[ignore] 公网手动，同第 1 轮）
  合计 80 passed / 0 failed / 1 ignored ✅（与第 1 轮基线一致，零回归）

cd ui && npm run build
  vue-tsc --noEmit 0 error；vite build ✓ 2042 modules，built in 1.37s ✅

cd ui && npm run test
  ✓ src/utils/format.test.ts (16 tests)   ← 旧 16 个原样存活
  ✓ src/api/notification.test.ts (6 tests) ← 新增
  Test Files 2 passed; Tests 22 passed (22) ✅
```

### 10.2 通知链路 fresh-eyes 审查（逐环独立核实）

| 环节 | 核实方法 | 结论 |
|------|----------|------|
| 设置开关 → 配置 | SettingsView.vue:141-145 `SettingsRow`+toggle → `configStore.patch({notifyOnComplete})`；types.ts/config store 字段在位 | ✅ |
| 事件监听 | App.vue:74 `onTaskCompleted`（api/tasks.ts:94 → listen `task:completed`）真正被调用（第 1 轮缺陷即此环节缺失） | ✅ |
| 开关判断 | App.vue:75 `if (configStore.config?.notifyOnComplete)`——事件到达时实时读响应式 store，改设置即时生效；未加载 config 时安全跳过（见 advisory #7 毫秒级窗口，不可达） | ✅ |
| 失败通知不受开关 | App.vue:70 `onTaskFailed` 回调**无条件** `sendTaskFailedNotification`，PRD F9「失败必通知」语义正确；resume_conflict 弹窗与通知并存合理 | ✅ |
| api 封装 | notification.ts：`ensurePermission`（拒绝/异常 → return false 静默）→ `notify`（发送异常吞掉）——辅助通道不抛错不阻断主流程 | ✅ |
| 插件版本对齐 | npm `@tauri-apps/plugin-notification` 安装 **2.7.0**（package-lock 实测）↔ Rust `tauri-plugin-notification` **2.7.0**（Cargo.lock 实测），同大版本同小版本 | ✅ |
| 后端注册 | crates/app/src/lib.rs:30 `.plugin(tauri_plugin_notification::init())`；capabilities/default.json 含 `notification:default` | ✅ |
| fire-and-forget | App.vue 两处均 `void send...()` 不 await；回调不阻塞事件循环 | ✅ |
| 文件名获取 | 事件载荷仅 taskId → `tasksStore.byId(taskId)?.filename`，缺失退化为 `notify.unknownFile`（locale 键在位） | ✅ |
| 文案 | zh-CN.ts 4 键（completedBody/failedBody/failedBodyNoReason/unknownFile）实测在位，测试断言与文案逐字一致 | ✅ |

### 10.3 修复轮反作弊增量审查

| 检测项 | 结果 | 详情 |
|--------|------|------|
| 测试删除/弱化 | ✅ | 旧 format.test.ts 16 个用例原样存活且全绿；只增未删 |
| 断言质量 | ✅ | 6 新用例断言具体（精确 title/body 文案、toHaveBeenCalledExactlyOnceWith、拒绝分支断言 not.toHaveBeenCalled），无 assert(true) 等价物；期望值来自 locale 文案（Spec 可见物）非抄实现 |
| skip/only 新增 | ✅ | notification.test.ts 无 skip/only/xfail |
| 框架配置篡改 | ✅ | package.json scripts（test=vitest run, build=vue-tsc+vite）与第 1 轮一致，未动 |
| 硬编码断言 | ✅ | 断言值即用户可见文案契约，属合法锁定 |

### 10.4 回归检查（修复未引入新问题）

| 项 | 结果 |
|----|------|
| App.vue 行数 | 116 ≤ 300 ✅；check_lines.sh LINE GATE PASSED ✅ |
| emoji 扫描（U+1F300-1F9FF/2600-26FF/2700-27BF） | 0 匹配 ✅ |
| 紫粉渐变（purple/pink/7C3AED/A855F7/EC4899） | 0 匹配 ✅ |
| 占位文案（Welcome to/Lorem ipsum/Sign up today） | 0 匹配 ✅ |
| 硬编码颜色（#hex/rgb 且非 var(--token)） | 0 匹配 ✅ |
| 分层纪律（plugin 包仅 api/ 层 import） | `@tauri-apps/plugin-notification` 全前端仅 notification.ts + notification.test.ts 命中，组件层零直接引用 ✅ |
| package.json ↔ package-lock | `"^2"` 声明、实装 2.7.0，锁文件一致 ✅ |

### 10.5 第 2 轮结论

**P1-001 复验通过。** 调用链从设置开关到系统通知全通、失败通知语义正确、权限与异常静默策略正确、6 新单测质量合格、80/80 + 22/22 复跑全绿、零回归、零新增 P0/P1、团队级规则与分层纪律全部合规。**最终上线建议：GO-WITH-RISKS**（风险 = §7 GUI 手动清单未执行留档 + Bronze 档五维短板，见 §9）。
