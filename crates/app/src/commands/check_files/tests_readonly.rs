// Invariant guard: `check_files` must be a pure read. Uses a REAL engine over
// a real SQLite DB, so "no state change / no DB write / no event" is checked
// against the actual thing, not a mock's claim of purity.
//
// Each equality assertion is paired with a control experiment that proves the
// assertion CAN fail (rule: a verification step must first be shown fallible).

use super::check_files_core;
use super::tests_support::TempDir;
use downloader_engine::http::HttpDownloader;
use downloader_engine::protocol::{Downloader, TaskFilter, TaskStatus};
use downloader_engine::store::{Store, TaskRow};
use std::path::Path;
use tokio::sync::mpsc::error::TryRecvError;

fn task_row(id: &str, status: TaskStatus, dir: &Path, filename: &str) -> TaskRow {
    TaskRow {
        id: id.into(),
        url: "http://example.invalid/f".into(),
        final_url: "http://example.invalid/f".into(),
        filename: filename.into(),
        dir: dir.to_path_buf(),
        total_bytes: Some(1),
        status,
        etag: None,
        last_modified: None,
        content_type: None,
        speed_limit: None,
        error: None,
        retry_count: 0,
        created_at: 1000,
        updated_at: 1000,
    }
}

fn db_rows(store: &Store) -> String {
    // Tasks + segments + config: covers every table the engine can write.
    // A config-only write (set_config / set_global_limit) must also be caught.
    format!(
        "{:?}|{:?}|{:?}",
        store.load_all().unwrap(),
        store.get_config_json("engine_config").unwrap(),
        store.get_config_json("stats").unwrap(),
    )
}

#[tokio::test]
async fn check_files_changes_no_state_writes_no_db_and_emits_no_events() {
    let tmp = TempDir::new("invariant");
    let db = tmp.path().join("tasks.db");
    let engine = HttpDownloader::new(&db).await.expect("engine init");

    // One subscriber, taken BEFORE the call, so any lifecycle event emitted
    // during check_files would be observable.
    let mut subscriber = engine.subscribe();

    // Seed rows through a second public Store handle (same WAL database).
    // Rows are inserted directly, so the engine's in-memory `tasks` map stays
    // empty and no background snapshot loop can write during the test.
    let store = Store::open(&db).expect("store open");
    std::fs::write(tmp.path().join("present.bin"), b"ok").unwrap();
    for (id, status, name) in [
        ("t1", TaskStatus::Completed, "present.bin"),
        ("t2", TaskStatus::Completed, "gone.bin"),
        ("t3", TaskStatus::Downloading, "partial.bin"),
        ("t4", TaskStatus::Paused, "paused.bin"),
    ] {
        store
            .insert_task(&task_row(id, status, tmp.path(), name))
            .unwrap();
    }

    let before_list = serde_json::to_value(engine.list(TaskFilter::All).await.unwrap()).unwrap();
    let before_rows = db_rows(&store);

    let task_ids = vec![
        "t1".to_string(),
        "t2".to_string(),
        "t3".to_string(),
        "t4".to_string(),
        "unknown-id".to_string(),
    ];
    let missing = check_files_core(&*engine, &task_ids).await.unwrap();

    // Functional expectation: only the completed row whose official file is
    // gone. Non-completed rows and unknown ids must not appear.
    assert_eq!(missing, vec!["t2".to_string()]);

    let after_list = serde_json::to_value(engine.list(TaskFilter::All).await.unwrap()).unwrap();
    let after_rows = db_rows(&store);

    // Invariant 1: list() is byte-identical before/after.
    assert_eq!(before_list, after_list, "task list must not change");
    // Invariant 2: no DB row changed (status, updated_at, segments, config).
    assert_eq!(before_rows, after_rows, "no DB row may be written");
    // Invariant 3: no lifecycle event emitted. `Empty` (not `Disconnected`)
    // also proves the receiver was live, so a real event would have been seen.
    assert!(
        matches!(subscriber.lifecycle.try_recv(), Err(TryRecvError::Empty)),
        "no lifecycle event may be emitted; receiver must be live and empty"
    );

    // CONTROL (proves the equality assertions above are fallible): a real
    // write through the same API must be detected by both comparisons.
    store
        .update_task_status("t1", TaskStatus::Failed, Some("control"), 7)
        .unwrap();
    let control_list = serde_json::to_value(engine.list(TaskFilter::All).await.unwrap()).unwrap();
    let control_rows = db_rows(&store);
    assert_ne!(before_list, control_list, "control: list comparison must detect a write");
    assert_ne!(before_rows, control_rows, "control: DB comparison must detect a write");
}
