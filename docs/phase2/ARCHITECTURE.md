# wtf-downloader Phase 2 详细设计（ARCHITECTURE.md）

- 生成日期：2026-10-24
- 作者：首席架构师（高见远）
- 基线：SPEC.md v1.0（2026-10-23，已确认）+ Phase 1 技术选型与架构调研报告（含 §10 设计联动确认）
- 状态：待团队评审
- 阅读对象：S1-S5 全体开发执行者

> 契约声明：本文是 Spec §4-§6 的**实现级细化**，与 Spec 冲突时**先改 Spec 再改代码**（活规格纪律）。本文所有代码片段均为设计示意（以 reqwest 0.13 / governor 0.10.4 / rusqlite 0.40 / tauri 2.12 的 API 风格为例，示例，非指定），落地签名以各库官方文档为准；类型字段名、枚举值、常量值是契约，不可擅自变更。
> P0 规则遵守：全文无 emoji；无占位文案；不使用紫色-粉色渐变方案（本文档不含视觉方案）。

---

## 目录

1. [downloader-engine 详细设计](#1-downloader-engine-详细设计)
2. [DB Schema DDL](#2-db-schema-ddl)
3. [桥接层设计（app crate）](#3-桥接层设计app-crate)
4. [前端 api 层 TS 类型定义](#4-前端-api-层-ts-类型定义)
5. [开发排期映射（S0-S5）](#5-开发排期映射s0-s5)
6. [新增风险与待回填清单](#6-新增风险与待回填清单)
7. [端到端验证步骤](#7-端到端验证步骤)

---

## 1. downloader-engine 详细设计

### 1.1 模块图与依赖关系

```
                      lib.rs（入口：只做模块声明与公共 re-export，不写逻辑）
                          │
        ┌─────────────────┼──────────────────┬─────────────────┐
        │                 │                  │                 │
   protocol/          http/              throttle.rs        store.rs
   (协议抽象层)      (HTTP 实现)          (全局限速)        (rusqlite 持久化)
        │          ┌─────┼─────┐               │                 │
        │       mod.rs segment resume writer   │                 │
        │          │      │      │    │        │                 │
        └──────┬───┴──────┴──────┴────┴────────┴─────────────────┘
               │
           task.rs（任务状态机，被 http 引用，引用 protocol 类型）
```

依赖铁律（违反即返工）：

| 模块 | 允许依赖 | 禁止 |
|------|----------|------|
| protocol/ | 仅 std/tokio 类型 | 依赖 http/store/throttle（抽象层不知道实现） |
| http/ | protocol、task、throttle、store | 依赖任何 Tauri 类型（engine 零 Tauri 依赖，AC-14） |
| task.rs | protocol | 依赖 http（状态机不感知传输方式） |
| throttle.rs | governor | 依赖 engine 其他模块（独立组件，被注入） |
| store.rs | rusqlite | 任何业务判断（纯数据存取） |

各模块职责与对外 API 签名：

#### protocol/mod.rs —— 协议抽象层（V2 BT 预留的落点）

```rust
// （示例，非指定——签名风格示意，字段名为契约）
pub type TaskId = String; // uuid v4，由引擎生成

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus { Pending, Downloading, Paused, Failed, Completed }

pub struct NewTask {
    pub url: String,
    pub filename: Option<String>,   // None = 用探测/URL 推断名
    pub dir: Option<PathBuf>,       // None = 用配置默认目录
    pub headers: Vec<(String, String)>,
    pub segments: Option<u8>,       // None = 用配置默认分片数
}

pub struct ProbeResult {
    pub filename: String,
    pub total_size: Option<u64>,    // None = 无 Content-Length（chunked）
    pub accept_ranges: bool,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub final_url: String,          // 重定向后的最终 URL
}

pub struct TaskSnapshot {           // list/控制命令的返回体（engine 侧视图）
    pub id: TaskId,
    pub url: String,
    pub final_url: String,
    pub filename: String,
    pub dir: PathBuf,
    pub total_bytes: Option<u64>,
    pub status: TaskStatus,
    pub speed_limit: Option<u64>,
    pub error: Option<String>,
    pub retry_count: u32,
    pub downloaded_bytes: u64,      // 聚合自 segments，供列表展示
    pub created_at: i64,            // unix epoch 毫秒
    pub updated_at: i64,
}

pub enum EngineEvent {
    TaskCreated { task_id: TaskId },
    TaskRemoved { task_id: TaskId },
    StateChanged { task_id: TaskId, from: TaskStatus, to: TaskStatus, error: Option<String> },
    Progress(ProgressFrame),
}
```

`Downloader` 协议 trait（V2 预留：BT 引擎实现同一 trait，桥接层与前端零改动）：

```rust
// （示例，非指定——方法集为契约，async 写法以 async_trait 或 RPITIT 落地时定）
#[async_trait]
pub trait Downloader: Send + Sync + 'static {
    /// 探测直链元数据（添加弹窗用，2 秒内返回，AC-01）
    async fn probe(&self, url: &str, headers: &[(String, String)]) -> Result<ProbeResult, EngineError>;
    /// 创建任务并入队，返回任务 ID
    async fn add_task(&self, task: NewTask) -> Result<TaskId, EngineError>;
    async fn pause(&self, id: &TaskId) -> Result<TaskSnapshot, EngineError>;
    async fn resume(&self, id: &TaskId) -> Result<TaskSnapshot, EngineError>;
    async fn retry(&self, id: &TaskId) -> Result<TaskSnapshot, EngineError>;
    async fn remove(&self, id: &TaskId, delete_files: bool) -> Result<(), EngineError>;
    async fn pause_all(&self) -> Result<(), EngineError>;
    async fn resume_all(&self) -> Result<(), EngineError>;
    /// 同步查询（DB 读，内部走 spawn_blocking），供 list_tasks
    fn list(&self, filter: TaskFilter) -> Result<Vec<TaskSnapshot>, EngineError>;
    /// 限速热调（即时生效，AC-12）
    fn set_global_limit(&self, bytes_per_sec: Option<u64>) -> Result<(), EngineError>;
    fn set_task_limit(&self, id: &TaskId, bytes_per_sec: Option<u64>) -> Result<(), EngineError>;
    /// 事件订阅：返回（生命周期事件流, 进度帧流）双通道，见 §1.7
    fn subscribe(&self) -> EventSubscriber;
    /// 启动恢复：读 DB、校验 .part、非终态任务统一回 pending，返回恢复任务数
    async fn restore(&self) -> Result<usize, EngineError>;
    /// 优雅停机：暂停全部、落最终快照（供托盘"退出"）
    async fn shutdown(&self) -> Result<(), EngineError>;
}

pub enum TaskFilter { All, Downloading, Completed, Failed }
```

设计说明：

- `pause_all/resume_all` 托盘与 UI 同源调用同一 trait 方法（Spec §7 托盘菜单与任务页共用端点）。
- trait 不含进度查询方法——进度只经事件流推送（拉模式会诱导前端轮询，违反 4Hz 通道设计）。
- `EventSubscriber` 是两个 mpsc Receiver 的封装：生命周期事件用无界通道（低频、不可丢），进度帧用有界通道（高频、可丢帧），见 §1.7。

### 1.2 task.rs —— 任务状态机

状态枚举与迁移表（与 Spec §6 锁定的状态机逐条对齐）：

```
pending ──start──> downloading ──pause──> paused ──resume──> downloading
                        │  ^                        │
                        │  └─(可重试错误,退避重试,任务内循环)──┘（不换状态）
                        │
                        ├─(退避耗尽 / 不可重试 404/403)──> failed ──(手动 retry)──> pending
                        └─(complete: 全片完成且校验通过)──> completed
任意非 removed 状态 ──(remove)──> 行删除（"removed" 不是存储状态）
```

实现设计：

```rust
// （示例，非指定）
pub struct TaskCore {                 // 每任务一份，Arc<Mutex<>> 共享
    pub id: TaskId,
    pub status: TaskStatus,
    pub error: Option<String>,
    pub retry_count: u32,             // 任务级重试总预算
    pub cancel: CancellationToken,    // 暂停/删除时取消全部分片 worker
}

impl TaskCore {
    /// 唯一迁移入口：非法迁移返回 Err(InvalidTransition)，成功时经共享
    /// mpsc::Sender<EngineEvent> 发送 StateChanged 事件——这是状态机对桥接层的导出方式
    pub fn transition(&mut self, to: TaskStatus,
                      events: &EventSink, error: Option<String>) -> Result<(), EngineError>;
}
```

要点：

1. **迁移方法唯一入口**：任何状态变更必须走 `transition()`，它同时完成三件事——改内存状态、发 `StateChanged` 事件、标记 DB 脏位（由 runner 落库）。散落各处的直接赋值即违规。
2. **事件导出 = mpsc channel**（方案定案，不用回调 trait）：理由是引擎多任务并发迁移时无回调重入问题；桥接层与引擎测试用同一 `subscribe()` 消费，测试断言事件序列即可验证状态机（不依赖 Tauri）。回调 trait 作为 V2 若需要多订阅者时的演进方向，MVP 单订阅者场景 mpsc 足够。
3. **退避重试不换状态**：分片级退避期间任务保持 `downloading`（PRD F10 语义：重试是任务内部行为，UI 不闪状态）；任务级 `retry_count` 仅在退避耗尽转 failed 时使用。
4. **暂停语义**：`pause()` → 置 cancel token → abort 全部分片 worker（reqwest 流在 drop 时即断开连接，满足 AC-10 的 1 秒内断连）→ 落一次即时快照（不等周期快照）→ 迁移 paused。
5. **恢复语义**：`resume()` 先迁移 `downloading`（乐观），runner 启动时先做 §1.4 续传校验；校验冲突则迁移 `failed`（error code = `resume_conflict`），UI 弹"是否重下"对话框（Spec AC-09），用户确认后前端执行 remove+add（见 §3.2）。

### 1.3 http/segment.rs —— 分片调度器

#### 常量（契约，写入 engine 顶部 consts.rs）

| 常量 | 值 | 说明 |
|------|-----|------|
| `MIN_SEGMENT_BYTES` | 8 MB（8_388_608） | 最小分片尺寸；小文件自动减片的依据 |
| `MAX_CONCURRENT_TASKS` | 3 | 任务级并发槽位（区间 3-5 取下限，见下方理由） |
| `CHUNK_BYTES` | 256 KB（262_144） | 流式读写与限速取令牌的粒度 |
| `SEGMENT_RETRIES` | 3 | 每分片默认重试次数（AC-06） |
| `RETRY_BACKOFF_BASE_MS` | 500 | 指数退避基数：500ms → 1s → 2s，上限 8s |
| `SPLIT_THRESHOLD_BYTES` | 8 MB | 失败段拆小的最小剩余尺寸门槛 |
| `TASK_RETRY_BUDGET` | 6 | 任务级重试总预算（防拆分导致无限重试） |
| `REDIRECT_LIMIT` | 10 | 重定向跟随上限（Spec §10） |

并发槽位取 3 的理由：默认 3 任务 × 8 分片 = 24 并发连接，是常规远端服务器单 IP 连接数的舒适区（更高易触发 429/连接重置，反而降低吞吐）；常驻内存目标 <80MB（AC-15）下 3 任务即 <150MB 的验收线也以 3 为基准。若实测吞吐不足，调节此常量即可（5 是上限，不引入配置面）。

#### 分片规划算法

```rust
// （示例，非指定——算法为契约）
pub fn plan_segments(total: Option<u64>, accept_ranges: bool, max_segments: u8)
    -> Vec<SegmentSpec>
{
    // 0 字节：无分片，任务直接 completed（Spec §10 边界）
    // 无 Content-Length 或 不支持 Range：单分片流式（total = None，UI 不显示百分比）
    // 其余：n = min(max_segments, ceil(total / MIN_SEGMENT_BYTES))，下限 1
    //       每片 base = total / n，前 n-1 片取 base，末片吃余数
}
```

规则展开：

1. **小文件自动减片**（Spec §10）：例如 20MB 文件、默认 8 片配置 → ceil(20/8) = 3 片；8MB 以下 → 1 片。
2. 分片边界只在任务创建/重规划时计算一次，持久化进 `segments` 表（PK task_id+seg_index）；拆段（见下）会追加新行，旧行标记完成。
3. 降级路径：探测到 `accept_ranges=false` → 1 片顺序下载，TaskSnapshot 附带降级原因（UI 展示"服务器不支持分段加速"，AC-04）——降级原因放 `error` 字段为空、走独立 `notice` 内存字段，不污染失败语义。

#### 调度与段级重试

```text
Engine 启动时：
  ┌─ task_slots: Semaphore(3)（全局任务并发）
  恢复/新增任务 → 入 pending 队列（VecDeque + 条件唤醒）

调度循环（单 tokio task）：
  while 队列非空 且 有空闲槽位：
    取队首 pending 任务 → acquire 槽位 → spawn TaskRunner

TaskRunner（每任务一个 supervisor）：
  1. 续传校验（§1.4；冲突→failed 退出）
  2. 为每个未完成 SegmentSpec spawn SegmentWorker（段并发 = 未完成分片数，
     上限即分片规划数；不再加第二层信号量——任务槽位已是全局闸门）
  3. select! { 全部完成 → complete 路径 | cancel 触发 → 清理退出 }

SegmentWorker（每分片一个）：
  loop {
    发 GET final_url, Range: bytes=(start+downloaded)-(end)      // 206 续读
    while chunk = stream.next() {
      throttle.acquire(task_id, CHUNK_BYTES).await               // §1.6
      writer.write_at(offset, chunk).await                       // §1.5
      metrics.seg_done[i] += chunk.len()                          // §1.7
    }
    分片完成 → store 即时写该分片行（§1.8）
  }
  on Err(e) = classify(e):
    可重试（超时/连接重置/5xx/408/429）→ backoff(500ms << attempt, cap 8s) → 重试
      第 2 次失败且剩余 >= SPLIT_THRESHOLD → 剩余区间拆两个子分片（新 seg_index 追加），
        子分片重试预算重置，任务级预算 -1；预算耗尽 → 任务退避耗尽路径
    不可重试（404/403/其余 4xx）→ 任务直达 failed（Spec §6）
    416 → 特殊处理（§1.4）
```

- 429 处理：计入可重试，但额外读取 `Retry-After` 头作为退避下限（尊重服务器）。
- 拆小的目的：把"坏区间"（服务器中途截断、特定偏移超时）隔离在更小范围内，避免 8MB 段反复整段重传。

### 1.4 http/resume.rs —— 断点续传校验

校验时机：任务从 paused 恢复、应用重启后 pending 任务被调度、手动 retry。三元组 =（ETag，Last-Modified，Content-Length）。

```text
validate_resume(task) 流程：
1. 本地 .part 检查：
   - .part 不存在 且 有分片进度 → 全部进度清零（.part 被用户删了），任务回 pending 从头下
   - .part 存在 且 文件长度 < 已记录的最大 (end_byte+1) → 预分配被破坏（换盘/拷贝中断），
     同上清零重下
   - 一致 → 进入网络校验
2. 网络探测：GET final_url, Range: bytes=0-0（跟随重定向 <= 10 跳），期待 206
   - 206: 读 Content-Range 总长 + ETag + Last-Modified，与 DB 记录三元组比对
       * 任一"双方都有值"的字段不一致 → EngineError::ResumeConflict → 任务 failed
         （error code = resume_conflict；UI 弹"是否重下"，AC-09——不静默拼坏数据）
       * 一致 → 各分片从 downloaded_bytes 续传（Range 起点非 0，AC-08）
       * 响应 final_url 与 DB 记录不同（签名 URL 换代）→ 更新 DB final_url，
         分片请求用新 final_url
   - 200（Range 未生效）且 downloaded > 0 → 无法证明同源 → ResumeConflict
     （宁可重下不可错拼；UI 文案区分"服务器不支持续传"）
   - 200 且 downloaded == 0 → 正常全新下载，重走分片规划
3. 416 处理（分片请求返回 416 时）：
   - 重新探测该分片区间：Content-Range 显示请求起点 == 总长（起点越界）→ 该分片按完成处理
   - 否则 → 该分片 downloaded 清零重下（服务端资源区间已变化）
4. Content-Length 未知（chunked）任务：跳过三元组校验（无可比对项），
   恢复时 .part 长度即唯一依据，单连接续传
```

三元组比对规则明细：

| ETag（DB） | ETag（响应） | Last-Modified | 判定 |
|------------|--------------|---------------|------|
| 有 | 有 | — | 不一致即 conflict（强校验，优先级最高） |
| 有 | 无（响应未给） | 双方一致 | 通过（以 Last-Modified 补位） |
| 无 | 有 | 双方一致 | 通过，并回填 ETag 到 DB |
| 无 | 无 | 双方一致 | 通过（仅弱保证，可接受——三方全空是常见静态文件场景） |
| — | — | 不一致 | conflict |

注：`If-Range` 头方案（RFC 9110）与上述探测比对等价；采用显式探测是因为 416/200 的分支处理在探测响应上更可控。落地时若 reqwest 中间件实现 If-Range 更简洁可替换，校验语义不变（以 reqwest 0.13 官方文档为准，示例，非指定）。

### 1.5 http/writer.rs —— 落盘（含 .part 方案定案）

**决策：单 `.part` 文件按偏移 seek 写入。** 完整论证见 §1.5.2 ADR-006。

```rust
// （示例，非指定）
pub struct PartWriter {
    path: PathBuf,          // {dir}/{filename}.part
    total: Option<u64>,     // 已知则预分配
}

impl PartWriter {
    /// 打开或创建 .part；total 已知时 set_len 预分配（NTFS 稀疏，零填充成本近 0）
    pub async fn open(path: PathBuf, total: Option<u64>) -> Result<Self, EngineError>;
    /// 每分片独立 File 句柄，写前 seek 到 (start_byte + downloaded)，写 CHUNK_BYTES
    pub async fn write_at(&self, seg: &SegmentSpec, offset: u64, buf: &[u8]) -> Result<(), EngineError>;
    /// 完成收尾：sync_all → 校验文件长度 == total（AC-07，偏差置 failed）→ rename 收名
    pub async fn finish(&self, expected: u64) -> Result<PathBuf, EngineError>;
}
```

写入顺序不变量（崩溃安全的核心，全引擎唯一铁律）：

```text
先写盘（write + 底层 flush）→ 再更新内存计数 → 周期性/即时写 DB
```

推论：任意时刻 `DB.downloaded_bytes <= 内存计数 <= 已落盘字节`。崩溃后恢复以 DB 为准重下，重下区间是"已落盘但未记库"的窗口（最多 1 个快照周期，§1.8），方向永远是**重下覆盖**而非**错拼**。

其他规则：

1. **目标同名文件保护**：add_task 时若目标路径已存在，自动改为 `name (1).ext` 递增后缀（不覆盖用户文件）；finish 时若目标仍存在（极端竞态），任务置 failed，error 指明目标路径。
2. **非 NTFS 退化**：目标盘为 FAT32/exFAT 时 `set_len` 预分配会实际写零（U 盘慢 + 磨损）——探测失败或首次写延迟异常时退化为按需扩展（不预分配），分片偏移写语义不变。
3. **删除清理**：`remove_task(delete_files=true)` 删 `.part`；已完成任务只删记录（AC-13）。

#### 1.5.2 ADR-006: .part 文件采用单文件偏移写入（而非多分片文件）

- **Status**: Accepted (2026-10-24)
- **Background**: 分片并行下载需要磁盘暂存方案。候选 A：多分片文件（目标名.part.NN，每分片独立文件，完成后合并）；候选 B：单 .part 文件按偏移 seek 写入（完成后重命名收名）。Spec §6 将此定为 Phase 2 必裁决项。
- **Decision**: 选 B（单 .part 偏移写入）。
- **理由**：
  1. **完成零合并**：A 在收尾时需要把 N 个分片文件合并为目标文件——额外一次 O(size) 顺序读写（10GB 文件在 HDD 上是分钟级停顿）+ 瞬时双倍磁盘占用（10GB 文件需要再 10GB 空闲）+ 合并中途崩溃的清理复杂度（合并到一半的半成品无法续）。B 的收尾是 `sync_all + rename`，原子、毫秒级、崩溃安全。
  2. **降级路径统一**：不支持 Range 的单连接顺序下载、无 Content-Length 的流式下载，在 B 下就是"偏移 0 开始的单分片"，与多分片共用同一 writer 代码路径；A 下要维护"单文件直写"与"多文件暂存"两套路径。
  3. **恢复校验单一**：B 只需校验一个 .part 的存在与长度；A 要遍历 N 个 .part.NN 并对齐 DB 分片表，失败模式多一种（部分分片文件丢失）。
  4. **并发写安全性已验证**：各分片写区间不重叠；Rust std File 在 Windows 默认以共享读写模式打开，多句柄各自 seek 写同一文件是安全的（Linux `pwrite`/Windows `seek+write` 语义均按写入区间生效）。
- **Consequences**:
  - 正面：完成时延与磁盘占用大幅优于 A；代码路径最少；AC-07 完整性校验直接对着最终文件做。
  - 负面：非稀疏文件系统上预分配有零填充成本（已设按需扩展退化路径，§1.5 条 2）；崩溃后未下载区间是"零洞"，依赖 §1.5 写入顺序不变量保证不会静默损坏（该不变量对 A 同样必须存在，故非净增成本）。
- **Related ADRs**: ADR-001（reqwest）、ADR-002（rusqlite/WAL，快照即恢复依据）

### 1.6 throttle.rs —— 限速集成

```rust
// （示例，非指定——governor 0.10.4 API 风格示意）
pub struct ThrottleRegistry {
    global: ArcSwapOption<RateLimiter<NotKeyed, DefaultClock, DefaultState>>, // 热替换
    per_task: Mutex<HashMap<TaskId, Arc<RateLimiter<...>>>>,
}

impl ThrottleRegistry {
    /// 每 256KB chunk 调用一次：对（全局, 任务级）两个 limiter 依次批量取令牌
    pub async fn acquire(&self, task_id: &TaskId, bytes: u32) { /* check_n 或异步等待 */ }
    pub fn set_global(&self, bps: Option<u64>) { /* 整体替换 Arc 或置 None */ }
    pub fn set_task(&self, id: &TaskId, bps: Option<u64>) { /* 同上 */ }
}
```

设计要点：

1. **注入方式**：engine 构造时创建 `ThrottleRegistry`（`Arc` 内部共享），`HttpDownloader::new(throttle, store, ...)` 注入；SegmentWorker 持引用，每 chunk 调 `acquire`——限速器对 worker 是环境设施而非依赖对象。
2. **热调速率路径**：`set_global_limit` 命令 → `registry.set_global(bps)` → **整体原子替换 limiter**（读端每 chunk 一次原子指针读，开销可忽略）。全部分片在下一次 acquire 即感知新速率，配合容量参数满足 AC-12 的 2 秒收敛。替换式而非 governor 原位调参的理由：`None`（不限速）语义天然表达为"无 limiter"，且规避 GCRA 离散 quota 的粒度问题；若实测切换瞬间出现毛刺，备选 governor 原位 `adjust_rate`（以 governor 0.10.4 官方 API 为准，示例，非指定），封装在 throttle.rs 单文件内替换，调用方零改动。
3. **令牌批量化**：每 256KB chunk 取一次令牌（`check_n`），避免每字节/每 KB 调用让限速器成为热点路径（调研报告 ADR-003 既定）。
4. **容量（burst）定案**：`capacity = clamp(bps / 4, 256KB, 1MB)`。下限 256KB 保证单 chunk 一次取满不抖动；上限 1MB 保证限速切换后 ≤1 秒收敛（AC-12 给 2 秒，留 1 秒余量）。
5. **单任务限速叠加语义**：chunk 同时受全局与任务级两个 limiter 约束（取慢者效果）；`null` 任一即解除该层。

### 1.7 进度聚合器

结构（engine 内部，聚合各分片字节计数）：

```rust
// （示例，非指定）
pub struct TaskMetrics {              // Arc 共享给全部分片 worker
    pub total: Option<u64>,
    pub seg_total: Vec<u64>,          // 各分片应有总量
    pub seg_done: Vec<AtomicU64>,     // 各分片已下字节（覆盖写计数器）
}
```

聚合循环（引擎启动时 spawn 单个 tokio task）：

```text
interval(250ms) 每 tick：
  1. 对每个 downloading 任务：快照 seg_done 各原子计数 → 累加 downloaded_bytes
  2. speed_bps = (本次 downloaded - 上次 downloaded) / 实际间隔
     （用 tokio::time::Instant 实测间隔，不用固定 250ms，消除 tick 抖动）
  3. eta_secs = total 已知且 speed > 0 时 = (total - downloaded) / speed，否则 None
  4. 组装 ProgressFrame → progress mpsc（bounded(64)）try_send
     - 队列满 → 丢当前帧（帧是幂等快照，250ms 后下一帧自带修正；丢帧优于背压阻塞下载路径）
  5. 同时刷新桥接层共享的 GlobalStats 缓存（供托盘 tooltip 1Hz 读取，§3.4）
```

Channel send Err 的处理分工（Spec 5.3 硬约束的落实）：

| 位置 | Err 场景 | 处理 |
|------|----------|------|
| 引擎侧 mpsc send 失败 | 订阅者（桥接层）drop | 聚合器跳过发送，下载循环完全不感知（引擎与推送解耦） |
| 桥接层 Tauri Channel send Err | 前端句柄释放（页面切换） | 注销该 Channel 订阅，不再向其转发帧；下载不中断 |

4Hz（250ms）节流在生产端（Rust 引擎聚合器）实现，禁止前端节流兜底（Spec §10 硬约束，防 Channel 无界队列积压）。

### 1.8 store.rs —— 持久化写入策略专项设计（PRD 风险 R5）

#### 连接与线程模型

- 单个 `rusqlite::Connection` 包 `Mutex`，engine 持有；**所有** DB 方法为同步函数，调用侧一律 `tokio::task::spawn_blocking` 隔离（硬约束，禁止 async 上下文直接持锁查询——Spec §11 已知坑）。
- 打开即执行 PRAGMA 组（见 §2）；`busy_timeout = 5000` 防外部工具占用时报锁死。

#### 写入策略（三层）

| 层 | 触发 | 内容 | 频率 |
|----|------|------|------|
| L1 即时写 | 任务元数据变更（状态迁移/错误/限速设置） | tasks 单行 UPDATE | 状态迁移天然低频（用户操作 + 终态） |
| L2 即时写 | 分片完成 | segments 单行 UPSERT | Spec 锁定；每任务最多 max_segments 次 |
| L3 周期快照 | 进行中分片进度 | 单事务批量 UPSERT 全部 dirty 分片行 + tasks.updated_at | **1000ms（定案）** |

#### 快照周期定案：1000ms

在 Spec 允许的 1-3 秒区间内取 **1 秒**，理由：

1. **崩溃代价线性于周期**：F4 允许丢最近 1 个快照周期 → 重下窗口 = 周期 × 当时速率。300Mbps 宽带下：1s ≈ 37MB，2s ≈ 75MB，3s ≈ 112MB——用户对"恢复后倒退多少"的感知差异显著，选下限。
2. **写入成本可忽略**：快照是单事务批量 UPSERT dirty 行，量级 = 活动任务 × 未完成分片 ≤ 3 × 8 = 24 行（多数 tick 远少于此）。WAL 模式下这是微秒级事务，比 SQLite 每秒可承受的写入量低三个数量级以上。
3. **与产品语义对齐**：tooltip 1Hz、进度帧 4Hz、快照 1Hz 构成 1-1-4 的整数倍节拍族，桥接层定时器逻辑同构（各自独立 interval，不共享循环，仅节拍对齐）。
4. **反面论证**：选 2s/3s 的唯一收益是"更少的 DB 写"，而 (2) 证明该成本不是负担——没有理由为不存在的成本付出 2-3 倍的重下窗口。

实现：engine 内 `snapshot_loop`（tokio interval 1s），每 tick 收集各任务 dirty 分片（`seg_done` 与上次快照值差 > 0 的行），单事务写入。暂停/退出路径额外触发一次即时快照（不等周期）。

#### WAL 配置（DDL 一起见 §2）

- `journal_mode = WAL`：崩溃/断电不损坏库文件。
- `synchronous = NORMAL`：WAL 的推荐搭配——断电最多丢最近事务，不损坏；与"允许丢 1 个快照周期"（F4）的产品语义精确一致。不用 FULL（每个事务 fsync，快照 1Hz 下无必要损耗）。

#### 启动恢复流程（AC-11，3 秒内）

```text
app 启动 → engine.restore()：
  1. 打开 DB（PRAGMA）→ SELECT tasks JOIN segments 全量载入（万行级 < 10ms）
  2. 非终态（pending/downloading/paused）统一改回 pending（Spec §6 锁定）
     —— DB 中 downloading 是崩溃现场，不代表可续
  3. .part 存在性与长度校验（§1.4 第 1 步，本地操作，无网络）
  4. 入 pending 队列，恢复完成（网络侧三元组校验延迟到调度时做，不阻塞启动 3s 指标）
  5. 返回恢复任务数 → 桥接层 emit task:state-changed 流，前端 list_tasks 刷新
```

---

## 2. DB Schema DDL

与 Spec §6 表清单逐字段对齐（rusqlite 在 `Store::init` 中执行，幂等 `IF NOT EXISTS`）：

```sql
-- 连接级 PRAGMA（每次打开执行）
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS tasks (
    id             TEXT PRIMARY KEY,              -- uuid v4
    url            TEXT NOT NULL,                 -- 用户输入原始 URL
    final_url      TEXT NOT NULL,                 -- 重定向后最终 URL（分片请求目标）
    filename       TEXT NOT NULL,
    dir            TEXT NOT NULL,                 -- 绝对路径
    total_bytes    INTEGER,                       -- NULL = 未知（chunked，无百分比）
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','downloading','paused','failed','completed')),
    etag           TEXT,
    last_modified  TEXT,                          -- HTTP 日期原文（RFC 9110 IMF-fixdate）
    content_type   TEXT,
    speed_limit    INTEGER,                       -- bytes/s；NULL = 不限
    error          TEXT,                          -- 人类可读错误（含 code 前缀，见 §3.2）
    retry_count    INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,              -- unix epoch 毫秒
    updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at);

CREATE TABLE IF NOT EXISTS segments (
    task_id          TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    seg_index        INTEGER NOT NULL,
    start_byte       INTEGER NOT NULL,
    end_byte         INTEGER NOT NULL,            -- 闭区间
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (task_id, seg_index)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL                            -- JSON 字符串
);
```

设计说明：

1. `segments` 用 `WITHOUT ROWID`：复合主键表去掉隐藏 rowid，聚簇索引即 (task_id, seg_index)，任务恢复时按 task_id 前缀扫描是顺序读。
2. `ON DELETE CASCADE`：remove_task 在单事务里删 tasks 行即可连带清 segments，应用层不写第二条 DELETE（store 层保持无业务逻辑）。
3. 索引即 Spec §6 锁定的两个，不追加（MVP 阶段不建复合索引，查询慢再加——数据库设计原则）。
4. config 键集（MVP）：`download_dir`（string）、`default_segments`（number，1-16）、`global_speed_limit_bps`（number|null）、`notify_on_complete`（boolean）。开机自启状态不入 DB——以 OS 注册表/启动项为唯一事实源，查询走 autostart 插件（§3.5）。
5. 时间戳统一 unix epoch **毫秒**（INTEGER），序列化到前端为 number。

---

## 3. 桥接层设计（app crate）

### 3.1 目录与装配

```
crates/app/src/
├── main.rs            # 入口：仅调 run()（Windows required 由模板生成）
├── lib.rs             # Builder 装配：插件注册（single-instance 必须第一个）+ 托盘 + commands
├── state.rs           # AppState { engine: Arc<dyn Downloader>, progress_channels, global_stats }
├── events.rs          # 引擎事件 → emit/Channel 转发（§3.3）
├── tray.rs            # 托盘装配 + tooltip 1Hz（§3.4）
└── commands/
    ├── tasks.rs       # 任务 CRUD/控制/探测/限速（薄层）
    └── config.rs      # 设置读写 + autostart + open_file_location
```

lib.rs 装配顺序（契约）：

```rust
// （示例，非指定）
tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(...))   // 必须第一个注册（官方要求）
    .plugin(tauri_plugin_autostart::init(...))
    .plugin(tauri_plugin_opener::init())               // open_file_location 用
    .plugin(tauri_plugin_notification::init())         // 完成通知用
    .manage(AppState::new(engine))                     // engine 在此构造（含 restore）
    .setup(|app| { tray::setup(app); events::spawn_forwarding(app); Ok(()) })
    .invoke_handler(tauri::generate_handler![ /* 全部 commands */ ])
    .on_window_event(|win, e| { /* CloseRequested → hide，§3.4 */ })
    .run(tauri::generate_context!())?;                 // 入口只装配，零业务逻辑
```

`tauri-plugin-opener` 与 `tauri-plugin-notification` 为 Spec §4 未列出的官方 desktop 插件族成员（分别服务 `open_file_location` 与"完成通知"设置项），补丁号在 S0 脚手架时回填并记入 Spec 变更记录（见 §6）。

### 3.2 Commands 处理流程（统一四步）

每个 command 严格遵循：**参数校验 → engine 调用 → 结果序列化（camelCase）→ 错误映射**。commands 层不写业务逻辑（发现即违规，逻辑全部在 engine）。

错误契约（AppError，前端 catch 的对象形状）：

```rust
// （示例，非指定）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError { pub code: String, pub message: String }
// code 枚举：invalid_url | invalid_argument | task_not_found | probe_failed |
//            http_status:<code> | resume_conflict | io_error | db_error | engine_error
```

各 command 流程表：

| Command | 参数校验 | engine 调用 | 返回 |
|---------|----------|-------------|------|
| `probe_url` | url::Url 解析；scheme ∈ {http, https}；2s 超时（AC-01） | `engine.probe()` | ProbeResult |
| `add_task` | 同上；filename 非法字符过滤（路径分隔符/控制字符）；segments clamp 1-16；同名文件冲突时由 engine 生成 `name (1)` | `engine.add_task()` | `{ taskId }` |
| `list_tasks` | filter 白名单枚举 | `engine.list()`（内部 spawn_blocking）；同时把调用携带的可选 `progress: Channel<ProgressFrame>` 注册为当前进度订阅（见 §3.3） | `TaskRecord[]` |
| `pause_task` / `resume_task` / `retry_task` | task_id 非空 | 对应 engine 方法 | TaskRecord |
| `remove_task` | delete_files 为 bool | `engine.remove()` | null |
| `pause_all` / `resume_all` | — | 对应方法 | null |
| `get_config` | — | `engine.list_config()`（DB 键集）+ autostart 插件 isEnabled 聚合 | Config |
| `set_config` | Partial 字段类型与范围（目录存在性、segments 1-16、限速 ≥ 1KB/s 或 null） | `engine.set_config()`；若含全局限速键则同步调 `set_global_limit` | Config |
| `set_global_speed_limit` | bytes_per_sec = null 或 ≥ 1KB/s | `engine.set_global_limit(None`或`Some)` | null |
| `set_task_speed_limit` | task_id 存在；bps 同上 | `engine.set_task_limit()` | null |
| `open_file_location` | task_id 存在且文件已在磁盘 | opener 插件 reveal（Windows: `explorer /select`） | null |
| `set_autostart` | enabled: bool | autostart 插件 enable/disable | null |

AC-09 的"是否重下"实现路径定案：resume 触发 `resume_conflict` 失败后，前端弹确认框；用户确认重下 = 前端依次调用 `remove_task(delete_files: true)` + `add_task(原 url/dir/filename)`。不为 MVP 增设 `restart_task` command（Spec 5.1 契约内组合可达，不扩端点）。

### 3.3 事件转发（engine 回调 → emit/Channel 映射表）

events.rs 在 setup 时 spawn 转发 task，消费 `engine.subscribe()` 的双通道：

| 引擎事件（EngineEvent） | Tauri 动作 | 载荷（camelCase） |
|--------------------------|------------|--------------------|
| `TaskCreated` | `emit("task:created", …)` | `{ taskId }` |
| `TaskRemoved` | `emit("task:removed", …)` | `{ taskId }` |
| `StateChanged` | `emit("task:state-changed", …)`；若 `to == completed` 追加 `emit("task:completed", …)`；若 `to == failed` 追加 `emit("task:failed", …)`（两事件都发，前者驱动列表刷新，后者驱动通知——前端按需各自 listen，不合并） | `{ taskId, from, to, error? }` / completed: `{ taskId }` / failed: `{ taskId, error }` |
| `Progress(frame)` | 对 AppState 中已注册的每个 Channel `send(frame)`；`send` 返回 Err → 注销该 Channel（前端句柄已释放），下载不中断 | ProgressFrame 本体 |

**进度 Channel 注册机制**（Spec 5.3"随 command 传入"的落点定案）：`list_tasks` 的参数含可选 `progress: Channel<ProgressFrame>`。每次调用以新 Channel 替换旧订阅（旧 Channel 后续 send 自然 Err，双保险）；前端在应用挂载与每次调用 list_tasks 时传入当前 Channel。单一主窗口场景下此机制最简且幂等。帧载荷内含 taskId，前端按需过滤，Rust 侧不做按任务分流的订阅簿。

GlobalStats 缓存：转发 task 同时把每帧聚合成全局统计（活跃任务数/合计速率）写入 AppState 的原子缓存——托盘 tooltip 定时器读它，不另建引擎查询接口（与 4Hz 聚合器共享数据源，Spec §7 设计要点的落实）。

### 3.4 托盘装配（tray.rs）

菜单结构（契约，菜单项 id 用常量）：

```text
wtf-downloader（托盘图标，多分辨率 .ico）
└── 右键菜单：
    显示主窗口
    ─────────────
    暂停全部
    恢复全部
    全局限速 ▸   ○ 不限速（默认勾选）
                 ○ 512 KB/s
                 ○ 1 MB/s
                 ○ 2 MB/s
                 ○ 5 MB/s
    ─────────────
    退出
```

- 菜单项动作直连 engine：暂停/恢复全部调 `pause_all/resume_all`（与 UI 同源，Spec §7）；限速子菜单调 `set_global_speed_limit`，并同步刷新菜单勾选态；应用内修改限速时（set_config 路径）也反向刷新托盘勾选（tray.rs 暴露 `sync_limit_menu(bps)` 给 commands 调用）。
- **tooltip 1Hz**：tray.rs 自己的 `interval(1000ms)` task，读 AppState 的 GlobalStats 缓存（§3.3，即 4Hz 帧流的聚合缓存——共享数据源、独立节流）；活跃任务数为 0 时恢复静态文案；格式 `wtf-downloader — 3 个任务 · 1.2 MB/s`（文案示例，非指定，以产品文案为准）。Windows set_title 角标不可用（Spec §11 已知坑），tooltip 是 Windows 唯一辅助显示位。
- 左键单击：切换主窗口显示/隐藏。
- **关窗驻留**：`on_window_event` 拦截 `CloseRequested` → `prevent_close()` + `window.hide()`（Spec F5，下载不中断）。
- **退出路径**：菜单"退出" → `engine.shutdown()`（暂停全部 + 最终快照落盘，保证退出不丢进度）→ `app.exit(0)`。

### 3.5 single-instance / autostart 注册位置

- `tauri-plugin-single-instance`：**Builder 插件链的第一个**（官方文档要求首个注册，否则 Linux 行为异常；本项目 Windows 优先但保持跨平台纪律）。回调内 `show + set_focus` 主窗口（AC-16）。MVP 不透传命令行参数（V2 预留 .torrent 文件关联拉起）。
- `tauri-plugin-autostart`：插件链随后注册；`set_autostart` command 经插件 ManagerExt enable/disable；**状态唯一事实源是 OS 注册项**（get_config 时实时读取 isEnabled，不入 DB），避免 DB 与系统状态漂移。

---

## 4. 前端 api 层 TS 类型定义

### 命名约定定案

| 面 | 约定 |
|----|------|
| Rust ↔ 前端 IPC 序列化 | **camelCase**（Rust 侧全部跨 IPC 结构体 `#[serde(rename_all = "camelCase")]`） |
| SQLite 列名 | snake_case（仅 Rust 内部，不跨 IPC） |
| TS 接口字段 | camelCase |
| 枚举值（状态等字符串） | 全小写单词（`"pending"` 等，serde lowercase） |
| 时间戳 | unix epoch 毫秒，TS `number` |

定案理由：Tauri 社区主流约定即 camelCase IPC，前端代码零转换层；DB 侧 snake_case 保持 SQL 惯例；两侧映射只发生在 engine 的 store 序列化边界一处。

`ui/src/api/types.ts`（契约，与 Rust 侧结构体逐字段对齐）：

```typescript
// （与 Rust 侧 serde 结构体精确对齐；字段名与可空性为契约，不可擅改）
export type TaskStatus = 'pending' | 'downloading' | 'paused' | 'failed' | 'completed';
export type TaskFilter = 'all' | 'downloading' | 'completed' | 'failed';

export interface TaskRecord {
  id: string;
  url: string;
  finalUrl: string;
  filename: string;
  dir: string;
  totalBytes: number | null;      // null = 未知（不显示百分比）
  status: TaskStatus;
  speedLimit: number | null;      // bytes/s
  error: string | null;
  retryCount: number;
  downloadedBytes: number;
  createdAt: number;              // epoch ms
  updatedAt: number;              // epoch ms
}

export interface SegmentProgress {
  index: number;
  downloaded: number;
  total: number;
}

export interface ProgressFrame {
  taskId: string;
  downloadedBytes: number;
  totalBytes: number | null;
  speedBps: number;
  etaSecs: number | null;
  segments: SegmentProgress[];
}

export interface ProbeResult {
  filename: string;
  totalSize: number | null;
  acceptRanges: boolean;
  etag: string | null;
  lastModified: string | null;
  finalUrl: string;
}

export interface Config {
  downloadDir: string;
  defaultSegments: number;        // 1-16
  globalSpeedLimitBps: number | null;
  notifyOnComplete: boolean;
  autostartEnabled: boolean;      // OS 实时状态，非 DB 字段
}

export interface AppErrorShape {  // invoke reject 时 catch 到的形状
  code: string;                   // 见 §3.2 code 枚举
  message: string;
}

export interface NewTaskPayload {
  url: string;
  filename?: string;
  dir?: string;
  headers?: Record<string, string>;
  segments?: number;
}
```

api/ 层文件划分（唯一允许 import `@tauri-apps/api` 的层，硬约束）：

| 文件 | 职责 |
|------|------|
| `api/types.ts` | 上述全部类型 |
| `api/tasks.ts` | 全部任务 commands 的 invoke 封装 + `listTasks(filter, progressChannel)`（创建 `Channel<ProgressFrame>` 并随 invoke 传入）+ `onTaskEvent` 系列 listen 封装 |
| `api/config.ts` | get/set_config、set_autostart、open_file_location、限速命令封装 |

前端只消费 `Promise<TaskRecord[]>` 等形状与 Channel/listen 订阅，组件层对 invoke 零感知。

---

## 5. 开发排期映射（S0-S5）

> 依据：Spec 六阶段 + 开发成本参考模型（桌面工具类 Tauri + Rust 核心 4-6 周 / 2-3 人月；引擎为难度峰值占 2-2.5 周）。每任务标注验收命令；手动验收项引用 Spec §12 步骤编号。

### S0 骨架（约 0.5 周）

| # | 任务 | 模块/文件 | 验收 |
|---|------|-----------|------|
| T0.1 | create-tauri-app vue-ts 脚手架 + 重组为 workspace（engine 空壳 crate + app crate + ui/） | 根 Cargo.toml、crates/ | `cargo test -p downloader-engine` 与 `npm --prefix ui run build` 均通过（AC-14 前置证明） |
| T0.2 | 版本锚定回填：Cargo/npm 清单对齐 Spec §4；回填 single-instance/autostart/opener/notification 补丁号 | Cargo.toml、ui/package.json | `cargo tree -p app`：无 sqlx、无 lucide-vue-next；版本表回填 Spec 变更记录 |
| T0.3 | 门禁脚本：单文件 ≤300 行检查 + cargo fmt/clippy + vue-tsc | scripts/ | 门禁命令在干净 checkout 跑通 |

### S1 引擎（约 2-2.5 周，难度峰值）

| # | 任务 | 模块/文件 | 验收 |
|---|------|-----------|------|
| T1.1 | protocol 层：类型 + Downloader trait + 事件模型 + 状态机（含全迁移表单测） | protocol/、task.rs | `cargo test -p downloader-engine task::`（迁移表全覆盖含非法迁移拒绝） |
| T1.2 | store 层：DDL + CRUD + WAL/spawn_blocking 封装 + 启动恢复加载 | store.rs | `cargo test -p downloader-engine store::`（临时 DB：建表幂等、CASCADE、恢复加载） |
| T1.3 | writer：单 .part 偏移写 + 预分配/退化 + finish 校验收名（ADR-006） | http/writer.rs | `cargo test -p downloader-engine writer::`（写读回哈希一致；长度偏差置 failed） |
| T1.4 | 分片调度器：规划算法 + 任务槽 + Range 循环 + 段级重试/拆小（本地 mock HTTP server，以 httpmock 类 dev-dependency 为例，示例，非指定） | http/segment.rs | `cargo test -p downloader-engine segment::`（规划边界：0 字节/<8MB/无长度/不支持 Range；重试退避；拆段） |
| T1.5 | 续传校验：三元组比对 + 416 + final_url 更新 | http/resume.rs | `cargo test -p downloader-engine resume::`（ETag 冲突/缺失组合全表、200 降级、416 分支） |
| T1.6 | 限速：ThrottleRegistry + 热调 + 收敛 | throttle.rs | `cargo test -p downloader-engine throttle::`（2s 窗口累计字节在目标 ±10%，AC-12 引擎侧） |
| T1.7 | 进度聚合器 + 事件双通道导出 | http/mod.rs（聚合 task） | `cargo test -p downloader-engine progress::`（4Hz 帧率上限、满队列丢帧不死、订阅 drop 不影响下载） |
| T1.8 | 引擎端到端（公网直链）：2 分片下载中途 kill 进程 → 续传 → 哈希一致 | tests/e2e.rs（#[ignore] 手动跑） | `cargo test -p downloader-engine -- --ignored e2e`（调研报告 §9 步骤 3 复现） |

### S2 桥接（约 0.5-1 周）

| # | 任务 | 模块/文件 | 验收 |
|---|------|-----------|------|
| T2.1 | AppState + commands/tasks.rs 全部命令 + AppError（mock Downloader 实现做单测） | state.rs、commands/tasks.rs | `cargo test -p app commands::tasks`（校验拒绝路径 + 错误码形状） |
| T2.2 | commands/config.rs + autostart + opener | commands/config.rs | `cargo test -p app commands::config` |
| T2.3 | events.rs 转发 + Channel 订阅注册/注销 | events.rs | `cargo test -p app events::`（EngineEvent→emit 映射表全覆盖；Channel Err 注销） |
| T2.4 | tray.rs：菜单 + tooltip 1Hz + 关窗驻留 + single-instance | tray.rs、lib.rs | `cargo tauri dev` 手动验收：Spec §12 步骤 7（托盘驻留 + 二次启动聚焦） |
| T2.5 | engine.restore 启动装配 + shutdown 退出落盘 | lib.rs | 手动：下载中强杀 → 重启 3s 内恢复（Spec §12 步骤 4） |

### S3 UI（约 1-1.5 周）

| # | 任务 | 模块/文件 | 验收 |
|---|------|-----------|------|
| T3.1 | api/ 层 + types.ts + Pinia stores（tasks/config） | ui/src/api/、stores/ | `npm --prefix ui run build`（vue-tsc 0 error） |
| T3.2 | 任务列表页：行组件/进度条/五态（Empty/Loading/Error/Populated/Edge）+ 筛选/搜索 | views/、components/ | `cargo tauri dev` 联调：进度 4Hz 刷新、tabular-nums |
| T3.3 | 添加任务弹窗：probe 流程 + 渐进披露 + 同名冲突提示 | components/ | 手动：AC-01/AC-02（2s 探测 + 非法 URL 拒绝） |
| T3.4 | 设置页：目录/分片/限速默认值/自启/通知开关 | views/ | 手动：设置读写 + 自启生效 |

### S4 体验（约 0.5 周）

| # | 任务 | 验收 |
|---|------|------|
| T4.1 | 快捷键 Ctrl+N/Ctrl/F、剪贴板预填、空态与边态打磨 | 手动：Spec §7 快捷键路径 |
| T4.2 | 完成通知（notifyOnComplete，tauri-plugin-notification） | 手动：完成弹系统通知 |
| T4.3 | 性能验证（AC-15）：常驻 <80MB、3 任务 <150MB、冷启动 <2s | 任务管理器 + 计时记录留档 |
| T4.4 | PRD §9 七组 EARS 全量回归 | 七组用例逐条打勾留档 |

### S5 发布（约 0.5-1 周）

| # | 任务 | 验收 |
|---|------|------|
| T5.1 | NSIS 打包配置 + WebView2 bootstrapper + 托盘/应用图标资源 | `cargo tauri build` 产出安装包 |
| T5.2 | Spec §12 端到端验证 1-7 步全绿（干净 Win10 + Win11 虚拟机各一轮） | 验证记录留档 |
| T5.3 | 发布产物校验（签名状态按 OPEN-DECISIONS R1 用户预算决策执行） | 产物清单 + SHA256 |

排期合计约 4-6 周（AI 辅助口径），与开发成本参考模型及调研报告 §8 一致；引擎 S1 为关键路径，T1.4/T1.5 可双人并行。

---

## 6. 新增风险与待回填清单

### 6.1 新增风险（本设计引入或放大的）

| 等级 | 风险 | 说明 | 缓解 |
|------|------|------|------|
| 中 | 非 NTFS 目标盘预分配零填充（U 盘/FAT32） | set_len 实际写零，慢 + 闪存磨损 | 已设计按需扩展退化路径（§1.5 条 2）；T1.3 验收含此分支 |
| 低 | 暂停走 abort 的瞬时资源占用 | 多 worker 同时 abort，句柄释放有微秒级窗口 | tokio abort 后 JoinHandle join 清理；AC-10 的 1s 指标余量大 |
| 低 | list_tasks 替换式 Channel 订阅在高频刷新下的抖动 | 每次刷新换 Channel，旧帧可能与新帧交错 1 帧 | 帧含 taskId 且为幂等快照，交错帧无副作用；前端 250ms 内自然覆盖 |
| 低 | "恢复 3 秒"指标在任务数极大时（>500）的 .part 校验耗时 | 逐任务 stat 文件 | 本地 stat 为微秒级，500 任务 <50ms；不影响指标，记录在上限测试用例 |

### 6.2 待回填（S0 脚手架时）

- [ ] `tauri-plugin-single-instance` / `tauri-plugin-autostart` 补丁号（承接调研报告 §6.3）
- [ ] `tauri-plugin-opener` / `tauri-plugin-notification` 补丁号（**新增**：Spec §4 未列，服务 open_file_location 与完成通知；回填时记入 Spec 变更记录——属官方 desktop 插件族新增，非技术栈变更）
- [ ] governor 热调在滑杆场景的平滑度（备选原位 adjust_rate，§1.6）
- [ ] mock HTTP server dev-dependency 选型定案（T1.4）

### 6.3 需要 Spec 侧知会的实现定案（非变更，落点澄清）

- 进度 Channel 经 `list_tasks` 可选参数传入（Spec 5.3"随 command 传入"的落点）
- resume_conflict 的"重下"由前端 remove+add 组合实现（不新增端点）
- `get_config` 返回值聚合 autostart 插件实时状态（OS 为唯一事实源）

---

## 7. 端到端验证步骤

```bash
# 1. 构建与自检
cargo test -p downloader-engine     # 断言：引擎测试全绿（零 Tauri 依赖，AC-14）
cargo test -p app                   # 断言：桥接层命令/事件映射测试全绿
npm --prefix ui run build           # 断言：vue-tsc 0 error + 构建通过
# 门禁：单文件 ≤300 行（scripts 门禁命令，T0.3）

# 2. 启动
cargo tauri dev                     # 主窗口出现；启动 3s 内恢复上次未完成任务（AC-11）

# 3. 核心成功流（覆盖 .part 单文件方案 + 单元组校验路径）
#    Ctrl+N 粘贴支持 Range 的公网大文件直链 → 确认
#    断言：任务下载中，进度 4Hz 刷新（DevTools 时间戳抽查）
#    暂停 → 确认磁盘存在 {filename}.part 单文件（非 .part.NN），大小 == total 预分配
#    恢复 → 日志验证 Range 起点为已下载偏移（非 0，AC-08）
#    完成 → .part 已重命名收名，文件大小 == Content-Length（AC-07）

# 4. 断电恢复流（覆盖快照周期 1s 定案）
#    下载中强杀进程 → 3 秒内重启恢复，进度回退 <= 1 秒速率（约几十 MB，肉眼可见小倒退）

# 5. 续传冲突流（覆盖三元组校验）
#    手工篡改 DB etag（或用本地 mock server 换内容）→ 恢复
#    断言：任务置 failed，error 含 resume_conflict；弹"是否重下"；确认后 remove+add 重下

# 6. 关键错误流 + 限速流 + 托盘与单实例
#    按 Spec §12 步骤 5/6/7 执行（404 不进重试循环；限速 2s 收敛 ±10%；托盘驻留/聚焦）

# 7. 引擎独立验收（AC-14 终验）
cargo test -p downloader-engine -- --ignored e2e   # 公网直链 kill+续传哈希一致
```

全绿判定：步骤 1-7 全部断言通过 + PRD §9 七组 EARS 回归零失败（T4.4 留档），方视为 Phase 2 设计的实证通过。

---

## 附：决策摘要（供评审快速裁决）

| 决策点 | 定案 | 章节 |
|--------|------|------|
| .part 文件方案 | 单 .part 偏移 seek 写入（ADR-006） | §1.5 |
| 快照周期 | 1000ms | §1.8 |
| 任务并发槽位 | 3（常量，区间 3-5 下限） | §1.3 |
| 分片规划 | n = min(max_segments, ceil(total/8MB))，下限 1 | §1.3 |
| 事件导出方式 | mpsc 双通道（生命周期无界 + 进度 bounded(64)） | §1.2/§1.7 |
| IPC 命名 | camelCase（serde rename_all），DB 保持 snake_case | §4 |
| 限速热调 | limiter 整体原子替换（备选 governor adjust_rate） | §1.6 |
| 限速 burst 容量 | clamp(bps/4, 256KB, 1MB) | §1.6 |
| 进度 Channel 注册 | list_tasks 可选参数携带，替换式 | §3.3 |
| resume_conflict 重下 | 前端 remove+add 组合，不新增端点 | §3.2 |
