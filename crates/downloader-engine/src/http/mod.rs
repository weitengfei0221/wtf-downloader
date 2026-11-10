// HTTP engine implementation. Module layout follows ARCHITECTURE section 1.1:
//   mod.rs      engine struct, task handle, constructor, subscribe
//   loops.rs    scheduler / progress aggregation (4Hz) / snapshot (1Hz)
//   runner.rs   TaskRunner supervisor + SegmentWorker loop
//   ops.rs      Downloader trait implementation (task lifecycle)
//   probe.rs    URL probing for the add-task dialog
//   segment.rs  segment planning + job model
//   resume.rs   resume validation decision logic
//   writer.rs   single .part offset writer (ADR-006)
//   classify.rs failure classification
//   naming.rs   filename sanitize / dedupe / inference

pub mod classify;
pub mod loops;
pub mod naming;
pub mod ops;
pub mod ops_query;
pub mod prepare;
pub mod probe;
pub mod resume;
pub mod runner;
pub mod segment;
pub mod worker;
pub mod writer;

use crate::protocol::{
    EngineConfig, EngineError, EventSubscriber, GlobalStats, TaskId, TaskStatus,
};
use crate::store::{SegmentRow, Store, TaskRow};
use crate::task::{EventSink, TaskCore};
use crate::throttle::ThrottleRegistry;
use segment::{SegmentJob, SharedJobs};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::AtomicU32;
use std::sync::{Arc, Mutex, RwLock};
use tokio::sync::{mpsc, Semaphore};
use tokio_util::sync::CancellationToken;

/// Per-task runtime state shared between the engine, the runner supervisor
/// and segment workers.
pub struct TaskHandle {
    pub id: TaskId,
    pub core: Mutex<TaskCore>,
    /// Cancellation token for the current run; replaced on resume.
    pub cancel: Mutex<CancellationToken>,
    /// Dynamic job table (splits append; indexes never reorder).
    pub jobs: SharedJobs,
    /// Task metadata; mutated on final_url refresh / ETag backfill.
    pub row: Mutex<TaskRow>,
    /// Extra request headers supplied at add_task time.
    pub headers: Mutex<Vec<(String, String)>>,
    /// Remaining task-level retry budget (split guard).
    pub retry_budget: AtomicU32,
}

impl TaskHandle {
    pub fn new(
        row: TaskRow,
        jobs: Vec<SegmentJob>,
        headers: Vec<(String, String)>,
        shutdown: &CancellationToken,
    ) -> Self {
        let id = row.id.clone();
        Self {
            id,
            core: Mutex::new(TaskCore::new(row.id.clone())),
            cancel: Mutex::new(shutdown.child_token()),
            jobs: Mutex::new(jobs),
            row: Mutex::new(row),
            headers: Mutex::new(headers),
            retry_budget: AtomicU32::new(crate::consts::TASK_RETRY_BUDGET),
        }
    }

    /// Build a handle from persisted state (restore path). Job states:
    /// completed tasks are fully Done; everything else stays claimable so
    /// resume/retry continue from the persisted progress. Request headers
    /// are runtime-only (not part of the locked DB schema) and start empty.
    pub fn from_restored(row: TaskRow, segs: Vec<SegmentRow>, shutdown: &CancellationToken) -> Self {
        let jobs = segs
            .into_iter()
            .map(|s| SegmentJob {
                index: s.seg_index,
                start_byte: s.start_byte,
                end_byte: s.end_byte,
                downloaded: s.downloaded_bytes,
                state: if row.status == TaskStatus::Completed {
                    segment::JobState::Done
                } else {
                    segment::JobState::Pending
                },
            })
            .collect();
        let id = row.id.clone();
        let mut core = TaskCore::new(row.id.clone());
        core.status = row.status;
        core.retry_count = row.retry_count;
        Self {
            id,
            core: Mutex::new(core),
            cancel: Mutex::new(shutdown.child_token()),
            jobs: Mutex::new(jobs),
            row: Mutex::new(row),
            headers: Mutex::new(Vec::new()),
            retry_budget: AtomicU32::new(crate::consts::TASK_RETRY_BUDGET),
        }
    }
}

pub struct HttpDownloader {
    pub(crate) client: reqwest::Client,
    pub(crate) throttle: Arc<ThrottleRegistry>,
    pub(crate) store: Arc<Store>,
    pub(crate) tasks: Arc<Mutex<HashMap<TaskId, Arc<TaskHandle>>>>,
    pub(crate) queue_tx: mpsc::UnboundedSender<TaskId>,
    pub(crate) slots: Arc<Semaphore>,
    pub(crate) lifecycle: EventSink,
    pub(crate) progress_tx: mpsc::Sender<crate::protocol::ProgressFrame>,
    pub(crate) subscriber: Mutex<Option<EventSubscriber>>,
    pub(crate) stats: Arc<GlobalStats>,
    pub(crate) config: Arc<RwLock<EngineConfig>>,
    pub(crate) shutdown_token: CancellationToken,
    /// Currently running TaskRunner supervisors (for graceful shutdown).
    pub(crate) active_runners: Arc<std::sync::atomic::AtomicUsize>,
}

impl HttpDownloader {
    /// Construct the engine, apply persisted config, spawn the three
    /// long-lived loops (scheduler, 4Hz progress, 1Hz snapshot).
    pub async fn new(db_path: &Path) -> Result<Arc<Self>, EngineError> {
        let store = Arc::new(Store::open(db_path)?);
        let config = load_config(&store).await;
        let throttle = Arc::new(ThrottleRegistry::new());
        if let Some(bps) = config.global_speed_limit_bps {
            throttle.set_global(Some(bps));
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(crate::consts::REDIRECT_LIMIT))
            .connect_timeout(std::time::Duration::from_secs(10))
            .read_timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| EngineError::Engine(format!("http client init failed: {}", e)))?;

        let (ltx, lrx) = mpsc::unbounded_channel();
        let (ptx, prx) = mpsc::channel(crate::consts::PROGRESS_CHANNEL_CAPACITY);
        let (qtx, qrx) = mpsc::unbounded_channel();
        let shutdown_token = CancellationToken::new();

        let engine = Arc::new(Self {
            client,
            throttle,
            store,
            tasks: Arc::new(Mutex::new(HashMap::new())),
            queue_tx: qtx,
            slots: Arc::new(Semaphore::new(crate::consts::MAX_CONCURRENT_TASKS)),
            lifecycle: EventSink::new(ltx),
            progress_tx: ptx,
            subscriber: Mutex::new(Some(EventSubscriber { lifecycle: lrx, progress: prx })),
            stats: Arc::new(GlobalStats::new()),
            config: Arc::new(RwLock::new(config)),
            shutdown_token: shutdown_token.clone(),
            active_runners: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        });

        tokio::spawn(loops::scheduler_loop(engine.clone(), qrx));
        tokio::spawn(loops::progress_loop(engine.clone()));
        tokio::spawn(loops::snapshot_loop(engine.clone()));
        Ok(engine)
    }

    pub(crate) fn get_task(&self, id: &TaskId) -> Result<Arc<TaskHandle>, EngineError> {
        self.tasks
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| EngineError::TaskNotFound(id.clone()))
    }

    /// Shared global statistics (bridge tooltip reads the same instance the
    /// 4Hz aggregator writes; single data source by design).
    pub fn stats(&self) -> Arc<GlobalStats> {
        self.stats.clone()
    }

    /// L1 immediate write for the current status of a task.
    pub(crate) async fn persist_status(&self, handle: &TaskHandle) {
        let (id, status, error, retry_count) = {
            let core = handle.core.lock().unwrap();
            (core.id.clone(), core.status, core.error.clone(), core.retry_count)
        };
        let store = self.store.clone();
        let _ = tokio::task::spawn_blocking(move || {
            store.update_task_status(&id, status, error.as_deref(), retry_count)
        })
        .await;
    }

    /// Mark a task failed, cancel sibling workers, persist.
    /// Fail a task, carrying the machine-readable `code` when the failure has
    /// one (`protocol::CODE_RESUME_CONFLICT`). Pass `None` - never `Some("")` -
    /// when there is no code: consumers treat a present code as authoritative.
    pub(crate) async fn fail_task(
        &self,
        handle: &Arc<TaskHandle>,
        code: Option<&'static str>,
        message: String,
    ) {
        {
            let mut core = handle.core.lock().unwrap();
            let _ = core.transition(TaskStatus::Failed, &self.lifecycle, Some(message), code);
        }
        handle.cancel.lock().unwrap().cancel();
        self.persist_status(handle).await;
    }

    /// Flush one task's current job progress to the DB immediately
    /// (pause / shutdown paths; skips the 1s snapshot wait).
    pub(crate) async fn flush_task_snapshot(&self, handle: &TaskHandle) {
        let (id, rows) = {
            let jobs = handle.jobs.lock().unwrap();
            let rows: Vec<SegmentRow> = jobs
                .iter()
                .map(|j| SegmentRow {
                    task_id: handle.id.clone(),
                    seg_index: j.index,
                    start_byte: j.start_byte,
                    end_byte: j.end_byte,
                    downloaded_bytes: j.downloaded,
                })
                .collect();
            (handle.id.clone(), rows)
        };
        if rows.is_empty() {
            return;
        }
        let store = self.store.clone();
        let _ = tokio::task::spawn_blocking(move || store.upsert_segments(&id, &rows)).await;
    }
}

async fn load_config(store: &Arc<Store>) -> EngineConfig {
    let store = store.clone();
    tokio::task::spawn_blocking(move || -> EngineConfig {
        let mut cfg = EngineConfig::default();
        if let Ok(Some(raw)) = store.get_config_json("engine_config") {
            if let Ok(saved) = serde_json::from_str::<EngineConfig>(&raw) {
                cfg = saved;
            } else if let Ok(partial) = serde_json::from_str::<crate::protocol::EngineConfigPatch>(&raw) {
                apply_patch(&mut cfg, &partial);
            }
        }
        cfg
    })
    .await
    .unwrap_or_default()
}

pub(crate) fn apply_patch(cfg: &mut EngineConfig, patch: &crate::protocol::EngineConfigPatch) {
    if let Some(v) = &patch.download_dir {
        cfg.download_dir = v.clone();
    }
    if let Some(v) = patch.default_segments {
        cfg.default_segments = v.clamp(1, 16);
    }
    if let Some(v) = patch.global_speed_limit_bps {
        cfg.global_speed_limit_bps = v.filter(|bps| *bps >= 1024);
    }
    if let Some(v) = patch.notify_on_complete {
        cfg.notify_on_complete = v;
    }
    if let Some(v) = patch.minimize_to_tray {
        cfg.minimize_to_tray = v;
    }
}
