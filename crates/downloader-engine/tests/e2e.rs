// Public-network end-to-end test (ARCHITECTURE T1.8, Spec section 12 step 4).
// Covers AC-05 (progress frame rate), AC-07 (final byte identity),
// AC-08 (crash resume from recorded offsets), AC-11 (restore window).
//
// Authored by QA (Phase 4) to close the missing T1.8 deliverable; the file
// was absent from the Phase 3 handoff. #[ignore] by design: it needs real
// internet access and takes ~15-30 s. Run manually:
//   cargo test -p downloader-engine --test e2e -- --ignored --nocapture
//
// Hard-kill simulation: phase 1 runs the engine inside its own tokio
// Runtime which is dropped mid-download. Runtime drop aborts every spawned
// task (scheduler / progress / snapshot / segment workers) at an arbitrary
// await point while the SQLite DB and .part file stay on disk - the same
// on-disk aftermath a process kill leaves behind.

mod support;

use downloader_engine::http::HttpDownloader;
use downloader_engine::protocol::{Downloader, NewTask, TaskFilter, TaskStatus};
use std::path::PathBuf;
use std::time::{Duration, Instant};

/// Stable public direct link: versioned release artifact on the Huawei
/// Cloud mirror (ETag + Last-Modified + Content-Disposition + Range,
/// fast endpoint reachable from the QA network).
const PUBLIC_URL: &str = "https://mirrors.huaweicloud.com/nodejs/v22.14.0/node-v22.14.0-win-x64.zip";
const FINAL_FILENAME: &str = "node-v22.14.0-win-x64.zip";
/// Throttle phase 1 so the kill reliably lands mid-download (~35 MB / 4 MB/s
/// ~= 9 s total; we kill after ~10 MB).
const PHASE1_LIMIT_BPS: u64 = 4 * 1024 * 1024;
/// Kill after this many bytes are recorded (well past every segment start).
const KILL_AFTER_BYTES: u64 = 10 * 1024 * 1024;

fn temp_dir() -> PathBuf {
    let dir = std::env::temp_dir()
        .join(format!("wtf-engine-e2e-pubnet-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

async fn wait_for_status(
    engine: &std::sync::Arc<HttpDownloader>,
    id: &str,
    want: TaskStatus,
    timeout: Duration,
) {
    let deadline = Instant::now() + timeout;
    loop {
        let tasks = engine.list(TaskFilter::All).await.unwrap();
        if let Some(t) = tasks.iter().find(|t| t.id == id) {
            if t.status == want {
                return;
            }
            if t.status == TaskStatus::Failed && want != TaskStatus::Failed {
                panic!(
                    "task failed unexpectedly (error: {:?}) after reaching {} bytes",
                    t.error, t.downloaded_bytes
                );
            }
        }
        if Instant::now() >= deadline {
            panic!("timeout waiting for status {:?}", want);
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn downloaded_of(engine: &std::sync::Arc<HttpDownloader>, id: &str) -> u64 {
    engine
        .list(TaskFilter::All)
        .await
        .unwrap()
        .iter()
        .find(|t| t.id == id)
        .map(|t| t.downloaded_bytes)
        .unwrap_or(0)
}

/// Plain single-connection GET of the whole resource: the byte-level
/// reference the engine must reproduce exactly. Retried: shared proxies
/// occasionally refuse CONNECT tunnels (environment, not product).
async fn fetch_reference() -> Vec<u8> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .unwrap();
    let mut last_err = None;
    for attempt in 0..3u32 {
        match client.get(PUBLIC_URL).send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    panic!("reference GET status {}", resp.status());
                }
                match resp.bytes().await {
                    Ok(bytes) => return bytes.to_vec(),
                    Err(e) => last_err = Some(e),
                }
            }
            Err(e) => {
                eprintln!("reference GET attempt {} failed: {e}", attempt + 1);
                last_err = Some(e);
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    }
    panic!(
        "reference GET failed after 3 attempts (network environment): {:?}",
        last_err
    );
}

#[test]
#[ignore = "needs public internet access; run with --ignored"]
fn public_net_kill_resume_completes_byte_identical() {
    // ---- Reference bytes (own runtime, network-bound). ----
    let reference = tokio::runtime::Runtime::new().unwrap().block_on(fetch_reference());
    assert!(!reference.is_empty());

    let dir = temp_dir();
    let db = dir.join("tasks.db");

    // ---- Phase 1: download under a fresh runtime, hard-drop mid-flight. ----
    let frame_stats: (u64, f64) = {
        let dir = dir.clone();
        let db = db.clone();
        let reference_len = reference.len();
        tokio::runtime::Runtime::new().unwrap().block_on(async move {
            let engine = HttpDownloader::new(&db).await.expect("engine A init");

            // Probe against the real internet (redirects + TLS + CDN, AC-01).
            let t0 = Instant::now();
            let probe = engine.probe(PUBLIC_URL, &[]).await.expect("public probe");
            assert!(t0.elapsed() < Duration::from_secs(2), "probe must stay under 2 s (AC-01)");
            assert!(probe.accept_ranges, "expected a Range-capable server");
            assert_eq!(probe.total_size, Some(reference_len as u64));

            engine
                .set_global_limit(Some(PHASE1_LIMIT_BPS))
                .await
                .expect("phase-1 throttle");

            let id = engine
                .add_task(NewTask {
                    url: PUBLIC_URL.into(),
                    filename: None,
                    dir: Some(dir.clone()),
                    headers: vec![],
                    segments: Some(2),
                })
                .await
                .expect("add task");

            // AC-05: consume 4Hz frames while downloading; require >= 2/s.
            let mut sub = engine_subscriber(engine.clone());

            let start = Instant::now();
            let mut frames = 0u64;
            let mut frame_stats = (0u64, 0.0f64);
            loop {
                while sub.progress.try_recv().is_ok() {
                    frames += 1;
                }
                let d = downloaded_of(&engine, &id).await;
                let elapsed = start.elapsed();
                if d >= KILL_AFTER_BYTES && elapsed >= Duration::from_millis(1500) {
                    frame_stats = (frames, elapsed.as_secs_f64());
                    break;
                }
                assert!(
                    elapsed < Duration::from_secs(60),
                    "no progress toward kill point within 60 s (network too slow?)"
                );
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            let (frames, secs) = frame_stats;
            assert!(
                frames as f64 >= 2.0 * secs,
                "AC-05 violated: {} frames over {:.2}s (< 2/s)",
                frames,
                secs
            );
            // Leave the runtime: dropping it hard-kills scheduler, workers,
            // snapshot and progress loops mid-download (crash aftermath).
            frame_stats
        })
    };

    // ---- Phase 2: fresh engine over the same DB, timed restore, resume. ----
    {
        let dir = dir.clone();
        let db = db.clone();
        let reference = reference.clone();
        tokio::runtime::Runtime::new().unwrap().block_on(async move {
            let engine = HttpDownloader::new(&db).await.expect("engine B init");
            let t0 = Instant::now();
            let restored = engine.restore().await.expect("restore after kill");
            let restore_secs = t0.elapsed().as_secs_f64();
            assert_eq!(restored, 1, "exactly one task must be restored");
            assert!(restore_secs < 3.0, "AC-11 violated: restore took {:.2}s", restore_secs);

            let tasks = engine.list(TaskFilter::All).await.unwrap();
            let task = tasks.first().expect("restored task present");
            // Spec 6: crashed tasks are requeued as pending; the scheduler
            // may already have re-pulled it to downloading by the time we
            // look - both are legal post-restore states.
            assert!(
                task.status == TaskStatus::Pending || task.status == TaskStatus::Downloading,
                "unexpected post-restore status {:?}",
                task.status
            );
            assert!(
                task.downloaded_bytes > 0,
                "recorded progress must survive the kill (got {})",
                task.downloaded_bytes
            );
            let id = task.id.clone();

            // Spec 6: restore re-queues and the scheduler re-pulls the task
            // automatically - no explicit resume() (it would race the
            // scheduler's pending -> downloading transition).
            wait_for_status(&engine, &id, TaskStatus::Completed, Duration::from_secs(300)).await;

            let final_path = dir.join(FINAL_FILENAME);
            assert!(!dir.join(format!("{FINAL_FILENAME}.part")).exists(), ".part renamed away");
            let on_disk = std::fs::read(&final_path).expect("final file readable");
            assert_eq!(
                on_disk.len(),
                reference.len(),
                "AC-07: final size {} != Content-Length {}",
                on_disk.len(),
                reference.len()
            );
            assert!(
                on_disk == reference,
                "AC-08: resumed file is NOT byte-identical after crash+resume"
            );
            println!(
                "e2e OK: restored 1 task in {:.2}s, kill point ~{} MB, frames {:.0}/{:.1}s, final {} bytes identical",
                restore_secs,
                task.downloaded_bytes / (1024 * 1024),
                frame_stats.0,
                frame_stats.1,
                on_disk.len()
            );
        });
    }
}

/// Take the engine's single subscription slot (same call path the Tauri
/// bridge uses in production).
fn engine_subscriber(
    engine: std::sync::Arc<HttpDownloader>,
) -> downloader_engine::protocol::EventSubscriber {
    use downloader_engine::protocol::Downloader;
    let dyn_engine: std::sync::Arc<dyn Downloader> = engine;
    dyn_engine.subscribe()
}
