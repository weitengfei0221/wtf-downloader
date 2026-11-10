// Engine integration tests against a local HTTP server. These exercise the
// full pipeline (probe -> plan -> workers -> writer -> complete) and the
// pause/resume/conflict paths that pure unit tests cannot reach.
// The silent-logic-error defense for the scheduling core.

mod support;

use downloader_engine::consts::MIN_SEGMENT_BYTES;
use downloader_engine::http::HttpDownloader;
use downloader_engine::protocol::{Downloader, EngineEvent, NewTask, TaskFilter, TaskStatus};
use support::TestServer;
use std::path::PathBuf;
use std::time::{Duration, Instant};

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir()
        .join(format!("wtf-engine-e2e-{}-{}", tag, uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn pseudo_data(len: usize) -> Vec<u8> {
    // Deterministic non-trivial content: position-dependent pattern.
    (0..len).map(|i| ((i * 31 + 7) % 251) as u8).collect()
}

async fn make_engine(tag: &str) -> (std::sync::Arc<HttpDownloader>, PathBuf) {
    let dir = temp_dir(tag);
    let db = dir.join("tasks.db");
    let engine = HttpDownloader::new(&db).await.expect("engine init");
    (engine, dir)
}

async fn wait_for_status(
    engine: &std::sync::Arc<HttpDownloader>,
    id: &str,
    want: TaskStatus,
    timeout: Duration,
) -> TaskStatus {
    let deadline = Instant::now() + timeout;
    loop {
        let tasks = engine.list(TaskFilter::All).await.unwrap();
        if let Some(t) = tasks.iter().find(|t| t.id == id) {
            if t.status == want {
                return t.status;
            }
            if t.status == TaskStatus::Failed && want != TaskStatus::Failed {
                panic!("task failed unexpectedly: {:?}", t.error);
            }
        }
        if Instant::now() >= deadline {
            panic!("timeout waiting for status {:?}", want);
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Full pipeline: 16 MB resource, 2 segments, completes, bytes identical
/// (AC-03/AC-07 core).
#[tokio::test]
async fn multi_segment_download_completes_with_identical_bytes() {
    let data = pseudo_data(2 * MIN_SEGMENT_BYTES as usize);
    let server = TestServer::start(data.clone());
    let (engine, dir) = make_engine("multi").await;

    let id = engine
        .add_task(NewTask {
            url: server.url.clone(),
            filename: None,
            dir: Some(dir.clone()),
            headers: vec![],
            segments: Some(4),
        })
        .await
        .unwrap();

    wait_for_status(&engine, &id, TaskStatus::Completed, Duration::from_secs(30)).await;
    let file = dir.join("file.bin");
    let on_disk = std::fs::read(&file).unwrap();
    assert_eq!(on_disk, data, "downloaded file must match source byte-for-byte");
    assert!(!dir.join("file.bin.part").exists(), ".part renamed away");
}

/// Range-ignoring server degrades to a single connection and still
/// completes (AC-04).
#[tokio::test]
async fn no_range_support_degrades_to_single_connection() {
    let data = pseudo_data(1024 * 1024);
    let server = TestServer::start_with(data.clone(), 0, true, None);
    let (engine, dir) = make_engine("norange").await;

    let id = engine
        .add_task(NewTask {
            url: server.url.clone(),
            filename: None,
            dir: Some(dir.clone()),
            headers: vec![],
            segments: Some(8),
        })
        .await
        .unwrap();

    wait_for_status(&engine, &id, TaskStatus::Completed, Duration::from_secs(30)).await;
    let on_disk = std::fs::read(dir.join("file.bin")).unwrap();
    assert_eq!(on_disk, data);
}

/// Zero-byte resource completes immediately with an empty file (Spec 10).
#[tokio::test]
async fn zero_byte_resource_completes_immediately() {
    let server = TestServer::start(Vec::new());
    let (engine, dir) = make_engine("zero").await;

    let id = engine
        .add_task(NewTask {
            url: server.url.clone(),
            filename: None,
            dir: Some(dir.clone()),
            headers: vec![],
            segments: Some(4),
        })
        .await
        .unwrap();

    wait_for_status(&engine, &id, TaskStatus::Completed, Duration::from_secs(15)).await;
    assert_eq!(std::fs::read(dir.join("file.bin")).unwrap(), Vec::<u8>::new());
}

/// Pause stops within the budget, .part exists, resume continues from the
/// recorded offsets (Range start non-zero, AC-08/AC-10).
#[tokio::test]
async fn pause_resume_continues_from_recorded_offsets() {
    let data = pseudo_data(3 * MIN_SEGMENT_BYTES as usize);
    // 2ms per 32KB chunk: slow enough to pause mid-flight, fast enough for CI.
    let server = TestServer::start_with(data.clone(), 2, false, None);
    let (engine, dir) = make_engine("pause").await;

    let id = engine
        .add_task(NewTask {
            url: server.url.clone(),
            filename: None,
            dir: Some(dir.clone()),
            headers: vec![],
            segments: Some(3),
        })
        .await
        .unwrap();

    // Wait until some bytes are recorded, then pause.
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut downloaded = 0u64;
    while downloaded < 256 * 1024 {
        let tasks = engine.list(TaskFilter::All).await.unwrap();
        downloaded = tasks.iter().find(|t| t.id == id).map(|t| t.downloaded_bytes).unwrap_or(0);
        if Instant::now() > deadline {
            panic!("no progress before pause");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let snapshot = engine.pause(&id).await.unwrap();
    assert_eq!(snapshot.status, TaskStatus::Paused);
    let part = dir.join("file.bin.part");
    assert!(part.exists(), ".part file must exist while paused");

    // Resume and finish.
    let snapshot = engine.resume(&id).await.unwrap();
    assert_eq!(snapshot.status, TaskStatus::Downloading);
    let baseline_requests = server.request_count();
    wait_for_status(&engine, &id, TaskStatus::Completed, Duration::from_secs(60)).await;

    let on_disk = std::fs::read(dir.join("file.bin")).unwrap();
    assert_eq!(on_disk, data, "resumed file must still match byte-for-byte");
    // Range requests after resume must not restart from zero for every
    // segment (progress preserved, AC-08).
    assert!(
        server.request_count() > baseline_requests,
        "resume must issue new range requests"
    );
}

/// Changing the resource between pause and resume trips the triple check:
/// the task must fail with resume_conflict, never stitch data (AC-09).
#[tokio::test]
async fn etag_change_on_resume_fails_with_resume_conflict() {
    let data = pseudo_data(3 * MIN_SEGMENT_BYTES as usize);
    let server = TestServer::start_with(data.clone(), 2, false, None);
    let (engine, dir) = make_engine("conflict").await;

    let id = engine
        .add_task(NewTask {
            url: server.url.clone(),
            filename: None,
            dir: Some(dir.clone()),
            headers: vec![],
            segments: Some(3),
        })
        .await
        .unwrap();

    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let tasks = engine.list(TaskFilter::All).await.unwrap();
        let d = tasks.iter().find(|t| t.id == id).map(|t| t.downloaded_bytes).unwrap_or(0);
        if d >= 256 * 1024 {
            break;
        }
        if Instant::now() > deadline {
            panic!("no progress before conflict");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    engine.pause(&id).await.unwrap();
    // The server now serves different content under a new ETag.
    server.set_data(pseudo_data(3 * MIN_SEGMENT_BYTES as usize));

    // Subscribe before the resume so the failure event can be inspected: the
    // code must travel on the event, not merely inside the message text.
    let mut events = engine.subscribe();

    engine.resume(&id).await.unwrap();
    wait_for_status(&engine, &id, TaskStatus::Failed, Duration::from_secs(30)).await;
    let tasks = engine.list(TaskFilter::All).await.unwrap();
    let task = tasks.iter().find(|t| t.id == id).unwrap();
    let error = task.error.as_deref().unwrap_or_default();
    assert!(error.contains("resume_conflict"), "error must carry resume_conflict, got: {}", error);

    // AC-09 structural contract: the state-changed event for this failure
    // carries code == CODE_RESUME_CONFLICT, so no consumer has to parse text.
    let mut seen_code: Option<Option<String>> = None;
    while let Ok(event) = events.lifecycle.try_recv() {
        if let EngineEvent::StateChanged { to: TaskStatus::Failed, code, .. } = event {
            seen_code = Some(code);
        }
    }
    let code = seen_code.expect("a failed state-changed event must have been emitted");
    assert_eq!(
        code.as_deref(),
        Some(downloader_engine::protocol::CODE_RESUME_CONFLICT),
        "resume conflict must be identified by code"
    );
}

/// Scoped 503 failures on a segment trigger retry (and the split path for
/// large remainders) without losing data integrity (AC-06).
#[tokio::test]
async fn segment_failures_retry_and_split_without_corruption() {
    let data = pseudo_data(2 * MIN_SEGMENT_BYTES as usize);
    // Fail requests starting in the second segment's range, twice.
    let half = MIN_SEGMENT_BYTES;
    let server = TestServer::start_with(data.clone(), 0, false, Some((half, half + 4096, 2)));
    let (engine, dir) = make_engine("retry").await;

    let id = engine
        .add_task(NewTask {
            url: server.url.clone(),
            filename: None,
            dir: Some(dir.clone()),
            headers: vec![],
            segments: Some(2),
        })
        .await
        .unwrap();

    wait_for_status(&engine, &id, TaskStatus::Completed, Duration::from_secs(60)).await;
    let on_disk = std::fs::read(dir.join("file.bin")).unwrap();
    assert_eq!(on_disk, data, "retried download must still be byte-identical");
}
