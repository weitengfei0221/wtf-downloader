// Downloader trait implementation, part 2: query / limits / subscription /
// restore / shutdown / config persistence.
// Rust forbids two `impl Downloader for HttpDownloader` blocks, so these
// live as free functions called from the single trait impl in ops.rs; this
// also keeps both files inside the 300-line budget.

use super::loops::{emit_restore_event, wait_runners_idle};
use super::naming::part_path;
use super::ops::current_downloaded;
use super::{apply_patch, HttpDownloader, TaskHandle};
use crate::protocol::{
    Downloader, EngineConfig, EngineConfigPatch, EngineError, EventSubscriber, TaskFilter,
    TaskId, TaskSnapshot, TaskStatus,
};
use std::sync::Arc;

pub(crate) async fn list(
    engine: &HttpDownloader,
    filter: TaskFilter,
) -> Result<Vec<TaskSnapshot>, EngineError> {
    let store = engine.store.clone();
    let rows = tokio::task::spawn_blocking(move || store.list_tasks(filter))
        .await
        .map_err(|e| EngineError::Engine(e.to_string()))??;
    Ok(rows
        .into_iter()
        .map(|(row, dl)| {
            let downloaded = {
                let tasks = engine.tasks.lock().unwrap();
                match tasks.get(&row.id) {
                    Some(handle) => current_downloaded(handle),
                    None => dl,
                }
            };
            let core_status = {
                let tasks = engine.tasks.lock().unwrap();
                tasks.get(&row.id).map(|h| h.core.lock().unwrap().status)
            };
            TaskSnapshot {
                id: row.id,
                url: row.url,
                final_url: row.final_url,
                filename: row.filename,
                dir: row.dir,
                total_bytes: row.total_bytes,
                status: core_status.unwrap_or(row.status),
                speed_limit: row.speed_limit,
                error: row.error,
                retry_count: row.retry_count,
                downloaded_bytes: downloaded,
                created_at: row.created_at,
                updated_at: row.updated_at,
            }
        })
        .collect())
}

pub(crate) async fn set_global_limit(
    engine: &HttpDownloader,
    bytes_per_sec: Option<u64>,
) -> Result<(), EngineError> {
    if let Some(bps) = bytes_per_sec {
        if bps < 1024 {
            return Err(EngineError::InvalidArgument(
                "全局限速最低 1 KB/s 或设为 null 解除".into(),
            ));
        }
    }
    // Hot-swap the limiter first (next chunk acquisition sees it), then
    // persist the whole engine config under the single canonical key
    // so the limit survives restarts.
    engine.throttle.set_global(bytes_per_sec);
    let cfg = {
        let mut cfg = engine.config.write().unwrap();
        cfg.global_speed_limit_bps = bytes_per_sec;
        cfg.clone()
    };
    let store = engine.store.clone();
    let raw = serde_json::to_string(&cfg)
        .map_err(|e| EngineError::Engine(e.to_string()))?;
    tokio::task::spawn_blocking(move || store.set_config_json("engine_config", &raw))
        .await
        .map_err(|e| EngineError::Engine(e.to_string()))??;
    Ok(())
}

pub(crate) async fn set_task_limit(
    engine: &HttpDownloader,
    id: &TaskId,
    bytes_per_sec: Option<u64>,
) -> Result<(), EngineError> {
    let handle = engine.get_task(id)?;
    if let Some(bps) = bytes_per_sec {
        if bps < 1024 {
            return Err(EngineError::InvalidArgument(
                "任务限速最低 1 KB/s 或设为 null 解除".into(),
            ));
        }
    }
    engine.throttle.set_task(id, bytes_per_sec);
    {
        let mut row = handle.row.lock().unwrap();
        row.speed_limit = bytes_per_sec;
    }
    let store = engine.store.clone();
    let id = id.clone();
    let bps = bytes_per_sec;
    tokio::task::spawn_blocking(move || store.update_task_speed_limit(&id, bps))
        .await
        .map_err(|e| EngineError::Engine(e.to_string()))??;
    Ok(())
}

pub(crate) fn subscribe(engine: &HttpDownloader) -> EventSubscriber {
    let mut slot = engine.subscriber.lock().unwrap();
    match slot.take() {
        Some(sub) => sub,
        None => {
            // Second subscriber: dead channels (MVP is single-subscriber).
            let (ltx, lrx) = tokio::sync::mpsc::unbounded_channel();
            drop(ltx);
            let (_ptx, prx) =
                tokio::sync::mpsc::channel(crate::consts::PROGRESS_CHANNEL_CAPACITY);
            EventSubscriber { lifecycle: lrx, progress: prx }
        }
    }
}

pub(crate) async fn restore(engine: &HttpDownloader) -> Result<usize, EngineError> {
    let store = engine.store.clone();
    let rows = tokio::task::spawn_blocking(move || store.load_all())
        .await
        .map_err(|e| EngineError::Engine(e.to_string()))??;
    let mut restored = 0usize;
    for (row, segs) in rows {
        if row.status.is_terminal() {
            let handle =
                Arc::new(TaskHandle::from_restored(row, segs, &engine.shutdown_token));
            engine.tasks.lock().unwrap().insert(handle.id.clone(), handle);
            continue;
        }
        let mut row = row;
        let from = row.status;
        // Local .part validation before requeue (step 3, no network).
        let part_len = std::fs::metadata(part_path(&row.dir, &row.filename))
            .ok()
            .map(|m| m.len());
        let check = super::resume::check_part_file(part_len, &segs);
        let mut segs = segs;
        if matches!(check, super::resume::PartFileCheck::Reset) {
            for s in segs.iter_mut() {
                s.downloaded_bytes = 0;
            }
        }
        row.status = TaskStatus::Pending;
        row.error = None;
        let handle =
            Arc::new(TaskHandle::from_restored(row, segs.clone(), &engine.shutdown_token));
        let id = handle.id.clone();
        engine.tasks.lock().unwrap().insert(id.clone(), handle);
        {
            let store = engine.store.clone();
            let row_status = TaskStatus::Pending;
            let id2 = id.clone();
            let segs2 = segs.clone();
            let retry = 0;
            tokio::task::spawn_blocking(move || {
                store.update_task_status(&id2, row_status, None, retry)?;
                store.upsert_segments(&id2, &segs2)
            })
            .await
            .map_err(|e| EngineError::Engine(e.to_string()))??;
        }
        emit_restore_event(engine, &id, from);
        engine.queue_tx.send(id.clone()).map_err(|_| EngineError::Engine("scheduler gone".into()))?;
        restored += 1;
    }
    Ok(restored)
}

pub(crate) async fn shutdown(engine: &HttpDownloader) -> Result<(), EngineError> {
    // Pause everything downloading, wait for runners, flush snapshots.
    engine.pause_all().await?;
    wait_runners_idle(engine, std::time::Duration::from_secs(3)).await;
    let handles: Vec<Arc<TaskHandle>> =
        engine.tasks.lock().unwrap().values().cloned().collect();
    for handle in handles {
        engine.flush_task_snapshot(&handle).await;
    }
    engine.shutdown_token.cancel();
    Ok(())
}

pub(crate) async fn get_config(engine: &HttpDownloader) -> Result<EngineConfig, EngineError> {
    Ok(engine.config.read().unwrap().clone())
}

pub(crate) async fn set_config(
    engine: &HttpDownloader,
    patch: EngineConfigPatch,
) -> Result<EngineConfig, EngineError> {
    if let Some(segs) = patch.default_segments {
        if segs == 0 || segs > 16 {
            return Err(EngineError::InvalidArgument(format!(
                "默认分片数必须在 1-16 之间，当前 {}",
                segs
            )));
        }
    }
    if let Some(Some(bps)) = patch.global_speed_limit_bps {
        if bps < 1024 {
            return Err(EngineError::InvalidArgument(
                "全局限速最低 1 KB/s 或设为 null 解除".into(),
            ));
        }
    }
    {
        let mut cfg = engine.config.write().unwrap();
        apply_patch(&mut cfg, &patch);
    }
    let cfg = engine.config.read().unwrap().clone();
    let store = engine.store.clone();
    let raw = serde_json::to_string(&cfg)
        .map_err(|e| EngineError::Engine(e.to_string()))?;
    tokio::task::spawn_blocking(move || store.set_config_json("engine_config", &raw))
        .await
        .map_err(|e| EngineError::Engine(e.to_string()))??;
    // Global limit change takes effect immediately (AC-12).
    if patch.global_speed_limit_bps.is_some() {
        engine.throttle.set_global(cfg.global_speed_limit_bps);
    }
    Ok(cfg)
}
