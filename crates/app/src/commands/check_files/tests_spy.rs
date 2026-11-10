// Protocol-level purity guard. A `Downloader` spy panics on EVERY method
// except `list`, so `check_files_core` is mechanically proven to be a single
// read-only query, not N queries and not a state-changing / event path.

use super::check_files_core;
use super::tests_support::TempDir;
use async_trait::async_trait;
use downloader_engine::protocol::{
    Downloader, EngineConfig, EngineConfigPatch, EngineError, EventSubscriber, NewTask,
    ProbeResult, TaskFilter, TaskId, TaskSnapshot, TaskStatus,
};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

struct Spy {
    rows: Vec<TaskSnapshot>,
    list_calls: AtomicUsize,
}

impl Spy {
    fn new(rows: Vec<TaskSnapshot>) -> Self {
        Self { rows, list_calls: AtomicUsize::new(0) }
    }

    fn calls(&self) -> usize {
        self.list_calls.load(Ordering::SeqCst)
    }
}

fn snap(id: &str, status: TaskStatus, dir: &Path, filename: &str) -> TaskSnapshot {
    TaskSnapshot {
        id: id.into(),
        url: String::new(),
        final_url: String::new(),
        filename: filename.into(),
        dir: dir.to_path_buf(),
        total_bytes: None,
        status,
        speed_limit: None,
        error: None,
        retry_count: 0,
        downloaded_bytes: 0,
        created_at: 0,
        updated_at: 0,
    }
}

fn forbidden(what: &str) -> ! {
    panic!("check_files must not call {}", what)
}

#[async_trait]
impl Downloader for Spy {
    async fn probe(&self, _: &str, _: &[(String, String)]) -> Result<ProbeResult, EngineError> {
        forbidden("probe")
    }

    async fn add_task(&self, _: NewTask) -> Result<TaskId, EngineError> {
        forbidden("add_task")
    }

    async fn pause(&self, _: &TaskId) -> Result<TaskSnapshot, EngineError> {
        forbidden("pause")
    }

    async fn resume(&self, _: &TaskId) -> Result<TaskSnapshot, EngineError> {
        forbidden("resume")
    }

    async fn retry(&self, _: &TaskId) -> Result<TaskSnapshot, EngineError> {
        forbidden("retry")
    }

    async fn remove(&self, _: &TaskId, _: bool) -> Result<(), EngineError> {
        forbidden("remove")
    }

    async fn pause_all(&self) -> Result<(), EngineError> {
        forbidden("pause_all")
    }

    async fn resume_all(&self) -> Result<(), EngineError> {
        forbidden("resume_all")
    }

    async fn list(&self, filter: TaskFilter) -> Result<Vec<TaskSnapshot>, EngineError> {
        // Must NOT delegate the status decision to a SQL filter: the pure
        // function checks `status != Completed` itself (single implementation).
        assert_eq!(filter, TaskFilter::All, "check_files must read All rows");
        self.list_calls.fetch_add(1, Ordering::SeqCst);
        Ok(self.rows.clone())
    }

    async fn set_global_limit(&self, _: Option<u64>) -> Result<(), EngineError> {
        forbidden("set_global_limit")
    }

    async fn set_task_limit(&self, _: &TaskId, _: Option<u64>) -> Result<(), EngineError> {
        forbidden("set_task_limit")
    }

    fn subscribe(&self) -> EventSubscriber {
        forbidden("subscribe (event channel)")
    }

    async fn restore(&self) -> Result<usize, EngineError> {
        forbidden("restore")
    }

    async fn shutdown(&self) -> Result<(), EngineError> {
        forbidden("shutdown")
    }

    async fn get_config(&self) -> Result<EngineConfig, EngineError> {
        forbidden("get_config")
    }

    async fn set_config(&self, _: EngineConfigPatch) -> Result<EngineConfig, EngineError> {
        forbidden("set_config")
    }
}

fn fixture() -> (TempDir, Vec<TaskSnapshot>) {
    let tmp = TempDir::new("spy");
    let dir = tmp.path().to_path_buf();
    std::fs::write(dir.join("present.bin"), b"ok").unwrap();
    let rows = vec![
        snap("t1", TaskStatus::Completed, &dir, "present.bin"),
        snap("t2", TaskStatus::Completed, &dir, "gone.bin"),
        snap("t3", TaskStatus::Downloading, &dir, "part.bin"),
        snap("t4", TaskStatus::Failed, &dir, "failed.bin"),
    ];
    (tmp, rows)
}

#[tokio::test]
async fn one_batch_is_exactly_one_list_call_and_no_other_engine_method() {
    let (_tmp, rows) = fixture();
    let spy = Spy::new(rows);
    let ids: Vec<String> = ["t1", "t2", "t3", "t4", "ghost", "t2"]
        .iter()
        .map(|s| (*s).to_string())
        .collect();

    let out = check_files_core(&spy, &ids).await.unwrap();

    assert_eq!(out, vec!["t2".to_string()]);
    // Batch discipline: 6 ids (incl. duplicate + unknown) -> ONE list call,
    // never one IPC/query per id.
    assert_eq!(spy.calls(), 1, "check_files must query the engine exactly once");
}

#[tokio::test]
async fn empty_input_short_circuits_without_touching_the_engine() {
    let (_tmp, rows) = fixture();
    let spy = Spy::new(rows);

    let out = check_files_core(&spy, &[]).await.unwrap();

    assert!(out.is_empty());
    assert_eq!(spy.calls(), 0, "empty input must not even read the engine");
}
