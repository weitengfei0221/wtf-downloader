// Long-lived engine loops (ARCHITECTURE sections 1.3 / 1.7 / 1.8):
//   scheduler_loop  pending queue -> slot-gated TaskRunner spawn
//   progress_loop   4Hz frames, measured-interval speed, try_send drop
//   snapshot_loop   1Hz dirty-segment batch UPSERT (L3)

use super::{HttpDownloader, TaskHandle};
use crate::consts::{PROGRESS_INTERVAL_MS, SNAPSHOT_INTERVAL_MS, UNKNOWN_END_BYTE};
use crate::protocol::{
    EngineEvent, ProgressFrame, SegmentProgress, TaskId, TaskStatus,
};
use crate::store::SegmentRow;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

pub(crate) async fn scheduler_loop(engine: Arc<HttpDownloader>, mut queue: mpsc::UnboundedReceiver<TaskId>) {
    loop {
        let next = tokio::select! {
            _ = engine.shutdown_token.cancelled() => break,
            id = queue.recv() => id,
        };
        let Some(id) = next else { break };
        // Skip stale queue entries (removed / paused / terminal). A resumed
        // task legitimately enters the queue already in Downloading: resume()
        // optimistically transitions before enqueueing (ARCHITECTURE 1.2
        // point 5), so Downloading entries must be dispatched, not dropped.
        let handle = {
            let tasks = engine.tasks.lock().unwrap();
            let Some(handle) = tasks.get(&id) else { continue };
            let status = handle.core.lock().unwrap().status;
            if status != TaskStatus::Pending && status != TaskStatus::Downloading {
                continue;
            }
            handle.clone()
        };
        // acquire_owned on the Arc-cloned semaphore yields a 'static permit;
        // the loop-owned engine Arc is not borrowed across the spawn below.
        let permit = engine.slots.clone().acquire_owned().await;
        if let Ok(permit) = permit {
            let engine = engine.clone();
            tokio::spawn(async move {
                engine
                    .active_runners
                    .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                super::runner::run_task(&engine, &handle, permit).await;
                engine
                    .active_runners
                    .fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
            });
        }
    }
}

pub(crate) async fn progress_loop(engine: Arc<HttpDownloader>) {
    let mut interval = tokio::time::interval(Duration::from_millis(PROGRESS_INTERVAL_MS));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    // (task, (instant, downloaded)) for measured-interval speed.
    let mut last: HashMap<TaskId, (tokio::time::Instant, u64)> = HashMap::new();
    loop {
        interval.tick().await;
        if engine.shutdown_token.is_cancelled() {
            break;
        }
        let now = tokio::time::Instant::now();
        let mut frames = Vec::new();
        let mut active = 0u64;
        let mut total_speed = 0u64;
        {
            let tasks = engine.tasks.lock().unwrap();
            for (id, handle) in tasks.iter() {
                if handle.core.lock().unwrap().status != TaskStatus::Downloading {
                    continue;
                }
                let (downloaded, total, segments) = snapshot_jobs(handle);
                let (speed, eta) = match last.get(id) {
                    Some((t, prev)) if downloaded >= *prev && t < &now => {
                        let elapsed = now.duration_since(*t).as_secs_f64();
                        let speed = if elapsed > 0.0 {
                            ((downloaded - prev) as f64 / elapsed) as u64
                        } else {
                            0
                        };
                        let eta = total
                            .filter(|_| speed > 0)
                            .map(|t| t.saturating_sub(downloaded) / speed);
                        (speed, eta)
                    }
                    _ => (0, None),
                };
                last.insert(id.clone(), (now, downloaded));
                frames.push(ProgressFrame {
                    task_id: id.clone(),
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                    speed_bps: speed,
                    eta_secs: eta,
                    segments,
                });
                active += 1;
                total_speed = total_speed.saturating_add(speed);
            }
        }
        // Drop bookkeeping for removed tasks.
        last.retain(|id, _| engine.tasks.lock().unwrap().contains_key(id));
        // try_send: a full queue drops this frame (idempotent snapshot;
        // the next frame 250ms later carries the correction). Never block
        // the download path on a slow consumer.
        for frame in frames {
            let _ = engine.progress_tx.try_send(frame);
        }
        engine.stats.store(active, total_speed);
    }
}

fn snapshot_jobs(handle: &TaskHandle) -> (u64, Option<u64>, Vec<SegmentProgress>) {
    let jobs = handle.jobs.lock().unwrap();
    let total = handle.row.lock().unwrap().total_bytes;
    let downloaded = jobs.iter().map(|j| j.downloaded).sum();
    let segments = jobs
        .iter()
        .map(|j| SegmentProgress {
            index: j.index,
            downloaded: j.downloaded,
            total: if j.end_byte == UNKNOWN_END_BYTE { 0 } else { j.end_byte - j.start_byte + 1 },
        })
        .collect();
    (downloaded, total, segments)
}

pub(crate) async fn snapshot_loop(engine: Arc<HttpDownloader>) {
    let mut interval = tokio::time::interval(Duration::from_millis(SNAPSHOT_INTERVAL_MS));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    // Last persisted downloaded value per task, position-aligned with the
    // job table (jobs only ever append).
    let mut last: HashMap<TaskId, Vec<u64>> = HashMap::new();
    loop {
        interval.tick().await;
        if engine.shutdown_token.is_cancelled() {
            break;
        }
        let mut batches: Vec<(TaskId, Vec<SegmentRow>, Vec<u64>)> = Vec::new();
        {
            let tasks = engine.tasks.lock().unwrap();
            for (id, handle) in tasks.iter() {
                let jobs = handle.jobs.lock().unwrap();
                if jobs.is_empty() {
                    continue;
                }
                let prev = last.get(id);
                let mut rows = Vec::new();
                let mut current = Vec::with_capacity(jobs.len());
                let mut changed = false;
                for (pos, j) in jobs.iter().enumerate() {
                    current.push(j.downloaded);
                    let dirty = match prev.and_then(|p| p.get(pos)) {
                        Some(v) => *v != j.downloaded,
                        None => true,
                    };
                    if dirty {
                        changed = true;
                        rows.push(SegmentRow {
                            task_id: id.clone(),
                            seg_index: j.index,
                            start_byte: j.start_byte,
                            end_byte: j.end_byte,
                            downloaded_bytes: j.downloaded,
                        });
                    }
                }
                if changed {
                    batches.push((id.clone(), rows, current));
                }
            }
        }
        for (id, rows, current) in batches {
            let store = engine.store.clone();
            let db_id = id.clone();
            let _ = tokio::task::spawn_blocking(move || store.upsert_segments(&db_id, &rows)).await;
            // Written values become the new baseline even if the DB write
            // failed (retrying the same values next tick is harmless).
            last.insert(id, current);
        }
        // Drop bookkeeping for removed tasks.
        last.retain(|id, _| engine.tasks.lock().unwrap().contains_key(id));
    }
}

/// Wait until no TaskRunner is active, or the timeout elapses. Used by the
/// graceful shutdown path.
pub(crate) async fn wait_runners_idle(engine: &HttpDownloader, timeout: Duration) {
    let deadline = tokio::time::Instant::now() + timeout;
    while engine.active_runners.load(std::sync::atomic::Ordering::SeqCst) > 0 {
        if tokio::time::Instant::now() >= deadline {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

/// Emit a StateChanged event for a restore-reset task (bridge forwards it
/// so the frontend refreshes its list, ARCHITECTURE section 1.8 step 5).
pub(crate) fn emit_restore_event(engine: &HttpDownloader, id: &TaskId, from: TaskStatus) {
    engine.lifecycle.emit(EngineEvent::StateChanged {
        task_id: id.clone(),
        from,
        to: TaskStatus::Pending,
        error: None,
        code: None,
    });
}
