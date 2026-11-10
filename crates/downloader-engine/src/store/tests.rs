use super::*;

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir()
        .join(format!("wtf-engine-test-{}-{}", tag, uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn sample_row(id: &str, status: TaskStatus) -> TaskRow {
    TaskRow {
        id: id.into(),
        url: "http://example.com/a.zip".into(),
        final_url: "http://example.com/a.zip".into(),
        filename: "a.zip".into(),
        dir: temp_dir("row"),
        total_bytes: Some(1024),
        status,
        etag: Some("\"abc\"".into()),
        last_modified: Some("Wed, 21 Oct 2026 07:28:00 GMT".into()),
        content_type: Some("application/zip".into()),
        speed_limit: None,
        error: None,
        retry_count: 0,
        created_at: 1000,
        updated_at: 1000,
    }
}

fn seg(task_id: &str, index: u32, start: u64, end: u64, downloaded: u64) -> SegmentRow {
    SegmentRow {
        task_id: task_id.into(),
        seg_index: index,
        start_byte: start,
        end_byte: end,
        downloaded_bytes: downloaded,
    }
}

#[test]
fn open_is_idempotent_and_creates_schema() {
    let dir = temp_dir("idem");
    let db = dir.join("t.db");
    {
        let _store = Store::open(&db).unwrap();
    }
    // Re-open on the same file must not fail (IF NOT EXISTS).
    let store = Store::open(&db).unwrap();
    assert!(store.load_all().unwrap().is_empty());
}

#[test]
fn insert_load_roundtrip_preserves_fields() {
    let dir = temp_dir("roundtrip");
    let store = Store::open(&dir.join("t.db")).unwrap();
    let row = sample_row("t1", TaskStatus::Paused);
    store.insert_task(&row).unwrap();
    store
        .upsert_segments(
            "t1",
            &[seg("t1", 0, 0, 511, 100), seg("t1", 1, 512, 1023, 200)],
        )
        .unwrap();

    let all = store.load_all().unwrap();
    assert_eq!(all.len(), 1);
    let (loaded, segs) = &all[0];
    assert_eq!(loaded.id, "t1");
    assert_eq!(loaded.status, TaskStatus::Paused);
    assert_eq!(loaded.etag.as_deref(), Some("\"abc\""));
    assert_eq!(loaded.total_bytes, Some(1024));
    assert_eq!(segs.len(), 2);
    assert_eq!(segs[0].downloaded_bytes, 100);
    assert_eq!(segs[1].end_byte, 1023);
}

#[test]
fn upsert_segments_updates_existing_rows() {
    let dir = temp_dir("upsert");
    let store = Store::open(&dir.join("t.db")).unwrap();
    store.insert_task(&sample_row("t1", TaskStatus::Downloading)).unwrap();
    store.upsert_segments("t1", &[seg("t1", 0, 0, 999, 10)]).unwrap();
    // Same PK again: must update, not duplicate.
    store.upsert_segments("t1", &[seg("t1", 0, 0, 999, 500)]).unwrap();
    let (_, segs) = &store.load_all().unwrap()[0];
    assert_eq!(segs.len(), 1);
    assert_eq!(segs[0].downloaded_bytes, 500);
}

#[test]
fn delete_task_cascades_segments() {
    let dir = temp_dir("cascade");
    let store = Store::open(&dir.join("t.db")).unwrap();
    store.insert_task(&sample_row("t1", TaskStatus::Failed)).unwrap();
    store.insert_task(&sample_row("t2", TaskStatus::Pending)).unwrap();
    store.upsert_segments("t1", &[seg("t1", 0, 0, 9, 5)]).unwrap();
    store.delete_task("t1").unwrap();
    let all = store.load_all().unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].0.id, "t2");
    assert!(all[0].1.is_empty());
}

#[test]
fn list_tasks_aggregates_downloaded_and_filters() {
    let dir = temp_dir("list");
    let store = Store::open(&dir.join("t.db")).unwrap();
    store.insert_task(&sample_row("t1", TaskStatus::Downloading)).unwrap();
    store.insert_task(&sample_row("t2", TaskStatus::Completed)).unwrap();
    store.insert_task(&sample_row("t3", TaskStatus::Failed)).unwrap();
    store.upsert_segments("t1", &[seg("t1", 0, 0, 49, 30), seg("t1", 1, 50, 99, 20)]).unwrap();
    store.upsert_segments("t2", &[seg("t2", 0, 0, 1023, 1024)]).unwrap();

    let all = store.list_tasks(TaskFilter::All).unwrap();
    assert_eq!(all.len(), 3);
    let t1 = all.iter().find(|(r, _)| r.id == "t1").unwrap();
    assert_eq!(t1.1, 50, "SUM over segments for t1");

    let completed = store.list_tasks(TaskFilter::Completed).unwrap();
    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0].0.id, "t2");
    assert_eq!(completed[0].1, 1024);

    let failed = store.list_tasks(TaskFilter::Failed).unwrap();
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].0.id, "t3");

    let downloading = store.list_tasks(TaskFilter::Downloading).unwrap();
    // Downloading filter includes queued non-terminal states (pending/paused).
    assert_eq!(downloading.len(), 1);
    assert_eq!(downloading[0].0.id, "t1");
}

#[test]
fn update_task_status_persists_error_and_retry_count() {
    let dir = temp_dir("status");
    let store = Store::open(&dir.join("t.db")).unwrap();
    store.insert_task(&sample_row("t1", TaskStatus::Downloading)).unwrap();
    store.update_task_status("t1", TaskStatus::Failed, Some("http_status:404"), 2).unwrap();
    let (row, _) = &store.load_all().unwrap()[0];
    assert_eq!(row.status, TaskStatus::Failed);
    assert_eq!(row.error.as_deref(), Some("http_status:404"));
    assert_eq!(row.retry_count, 2);
}

#[test]
fn update_task_meta_applies_only_provided_fields() {
    let dir = temp_dir("meta");
    let store = Store::open(&dir.join("t.db")).unwrap();
    store.insert_task(&sample_row("t1", TaskStatus::Paused)).unwrap();
    store
        .update_task_meta("t1", Some("http://new/final.zip"), Some("\"new\""), None, None, None)
        .unwrap();
    let (row, _) = &store.load_all().unwrap()[0];
    assert_eq!(row.final_url, "http://new/final.zip");
    assert_eq!(row.etag.as_deref(), Some("\"new\""));
    // Untouched fields keep their values.
    assert_eq!(row.last_modified.as_deref(), Some("Wed, 21 Oct 2026 07:28:00 GMT"));
    assert_eq!(row.total_bytes, Some(1024));
}

#[test]
fn config_json_roundtrip_and_overwrite() {
    let dir = temp_dir("config");
    let store = Store::open(&dir.join("t.db")).unwrap();
    assert!(store.get_config_json("download_dir").unwrap().is_none());
    store.set_config_json("download_dir", "\"C:/dl\"").unwrap();
    assert_eq!(store.get_config_json("download_dir").unwrap().as_deref(), Some("\"C:/dl\""));
    store.set_config_json("download_dir", "\"C:/dl2\"").unwrap();
    assert_eq!(store.get_config_json("download_dir").unwrap().as_deref(), Some("\"C:/dl2\""));
}

#[test]
fn wal_mode_is_active() {
    let dir = temp_dir("wal");
    let db = dir.join("t.db");
    let store = Store::open(&db).unwrap();
    let mode: String = store
        .conn
        .lock()
        .unwrap()
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .unwrap();
    assert_eq!(mode.to_lowercase(), "wal");
}
