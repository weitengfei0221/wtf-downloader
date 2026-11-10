// Lifecycle-path integration tests: remove, restore, fatal 404.

mod support;

use downloader_engine::consts::MIN_SEGMENT_BYTES;
use downloader_engine::http::HttpDownloader;
use downloader_engine::protocol::{Downloader, NewTask, TaskFilter, TaskStatus};
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
        let tasks = engine.list(downloader_engine::protocol::TaskFilter::All).await.unwrap();
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

/// Removing a task with delete_files removes the .part (AC-13).
#[tokio::test]
async fn remove_task_deletes_part_file() {
    let data = pseudo_data(3 * MIN_SEGMENT_BYTES as usize);
    let server = TestServer::start_with(data.clone(), 2, false, None);
    let (engine, dir) = make_engine("remove").await;

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
        if d >= 128 * 1024 {
            break;
        }
        if Instant::now() > deadline {
            panic!("no progress before remove");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let part = dir.join("file.bin.part");
    assert!(part.exists());
    engine.remove(&id, true).await.unwrap();
    assert!(!part.exists(), "delete_files must remove the .part");
    let tasks = engine.list(TaskFilter::All).await.unwrap();
    assert!(tasks.iter().all(|t| t.id != id));
}

/// Restore path: a fresh engine over an existing DB with a paused task
/// re-queues it as pending and finishes the download (AC-11 core).
#[tokio::test]
async fn restore_resumes_interrupted_task() {
    let data = pseudo_data(3 * MIN_SEGMENT_BYTES as usize);
    let server = TestServer::start_with(data.clone(), 2, false, None);
    let dir = temp_dir("restore");
    let db = dir.join("tasks.db");

    let id = {
        let engine = HttpDownloader::new(&db).await.unwrap();
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
                panic!("no progress before shutdown");
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        engine.pause(&id).await.unwrap();
        engine.shutdown().await.unwrap();
        id
    };

    // "Restart": fresh engine instance over the same DB.
    let engine2 = HttpDownloader::new(&db).await.unwrap();
    let restored = engine2.restore().await.unwrap();
    assert_eq!(restored, 1, "one task must be restored");
    let tasks = engine2.list(TaskFilter::All).await.unwrap();
    let task = tasks.iter().find(|t| t.id == id).expect("task survived restart");
    assert_ne!(task.status, TaskStatus::Completed);

    wait_for_status(&engine2, &id, TaskStatus::Completed, Duration::from_secs(60)).await;
    let on_disk = std::fs::read(dir.join("file.bin")).unwrap();
    assert_eq!(on_disk, data, "restored download must complete byte-identical");
}

/// Fatal HTTP status (404) fails the task without entering retry loops
/// (Spec section 12 step 5).
#[tokio::test]
async fn fatal_404_fails_without_retry_storm() {
    // A server that always answers 404 for the body but serves the probe:
    // emulate by pointing at a missing path on the same server.
    let server = TestServer::start(pseudo_data(1024));
    let (engine, dir) = make_engine("404").await;

    // Pre-insert a task whose URL misses (404 on the very first probe).
    let err = engine
        .add_task(NewTask {
            url: format!("{}/missing.bin", server.url.trim_end_matches("/file.bin")),
            filename: None,
            dir: Some(dir.clone()),
            headers: vec![],
            segments: Some(2),
        })
        .await;
    assert!(err.is_err(), "add_task must fail probing a 404");
    match err.unwrap_err() {
        downloader_engine::protocol::EngineError::HttpStatus(404) => {}
        other => panic!("expected HttpStatus(404), got {:?}", other),
    }
    // No task row was created (no half-finished records, AC-02).
    let tasks = engine.list(TaskFilter::All).await.unwrap();
    assert!(tasks.is_empty());
}
