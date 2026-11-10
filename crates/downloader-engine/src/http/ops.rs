// Downloader trait implementation, part 1: task lifecycle (probe / add /
// pause / resume / retry / remove / pause_all / resume_all). Query, limit,
// restore and config operations live in ops_query.rs.
// Commands-layer thinness rule: all business decisions live here in the
// engine, the bridge only validates and forwards.

use super::naming::{dedupe_filename, part_path, sanitize_filename};
use super::probe::{probe_url, validate_url};
use super::segment::{plan_segments, SegmentJob};
use super::{HttpDownloader, TaskHandle};
use crate::consts::TASK_RETRY_BUDGET;
use crate::protocol::{
    EngineConfig, EngineConfigPatch, EngineError, EngineEvent, EventSubscriber,
    NewTask, ProbeResult, TaskFilter, TaskId, TaskSnapshot, TaskStatus,
};
use crate::store::{SegmentRow, TaskRow};
use async_trait::async_trait;
use std::sync::atomic::Ordering;
use std::sync::Arc;

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub(crate) fn snapshot_of(handle: &TaskHandle, downloaded: u64) -> TaskSnapshot {
    // One row guard + one core guard, released before constructing the
    // snapshot: repeated re-locking per field buys nothing.
    let row = handle.row.lock().unwrap();
    let (status, error, retry_count) = {
        let core = handle.core.lock().unwrap();
        (core.status, core.error.clone(), core.retry_count)
    };
    TaskSnapshot {
        id: row.id.clone(),
        url: row.url.clone(),
        final_url: row.final_url.clone(),
        filename: row.filename.clone(),
        dir: row.dir.clone(),
        total_bytes: row.total_bytes,
        status,
        speed_limit: row.speed_limit,
        error,
        retry_count,
        downloaded_bytes: downloaded,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

pub(crate) fn current_downloaded(handle: &TaskHandle) -> u64 {
    handle.jobs.lock().unwrap().iter().map(|j| j.downloaded).sum()
}

#[async_trait]
impl crate::protocol::Downloader for HttpDownloader {
    async fn probe(
        &self,
        url: &str,
        headers: &[(String, String)],
    ) -> Result<ProbeResult, EngineError> {
        probe_url(&self.client, url, headers).await
    }

    async fn add_task(&self, task: NewTask) -> Result<TaskId, EngineError> {
        validate_url(&task.url)?;
        if let Some(name) = &task.filename {
            if sanitize_filename(name).is_empty() {
                return Err(EngineError::InvalidArgument("文件名不能为空".into()));
            }
        }
        let segments = task.segments.unwrap_or(self.config.read().unwrap().default_segments);
        if segments == 0 || segments > 16 {
            return Err(EngineError::InvalidArgument(format!(
                "分片数必须在 1-16 之间，当前 {}",
                segments
            )));
        }
        let probe = probe_url(&self.client, &task.url, &task.headers).await?;

        let dir = task
            .dir
            .clone()
            .unwrap_or_else(|| self.config.read().unwrap().download_dir.clone());
        let raw_name = task.filename.clone().unwrap_or(probe.filename.clone());
        let filename = dedupe_filename(&dir, &sanitize_filename(&raw_name));

        let specs = plan_segments(probe.total_size, probe.accept_ranges, segments);
        let id = uuid::Uuid::new_v4().to_string();
        let row = TaskRow {
            id: id.clone(),
            url: task.url.clone(),
            final_url: probe.final_url.clone(),
            filename: filename.clone(),
            dir: dir.clone(),
            total_bytes: probe.total_size,
            status: TaskStatus::Pending,
            etag: probe.etag.clone(),
            last_modified: probe.last_modified.clone(),
            content_type: None,
            speed_limit: None,
            error: None,
            retry_count: 0,
            created_at: now_ms(),
            updated_at: now_ms(),
        };
        let seg_rows: Vec<SegmentRow> = specs
            .iter()
            .map(|s| SegmentRow {
                task_id: id.clone(),
                seg_index: s.index,
                start_byte: s.start_byte,
                end_byte: s.end_byte,
                downloaded_bytes: 0,
            })
            .collect();
        {
            let store = self.store.clone();
            let row = row.clone();
            let segs = seg_rows.clone();
            tokio::task::spawn_blocking(move || {
                store.insert_task(&row)?;
                store.upsert_segments(&row.id, &segs)
            })
            .await
            .map_err(|e| EngineError::Engine(e.to_string()))??;
        }

        let jobs: Vec<SegmentJob> = specs.iter().map(SegmentJob::from_spec).collect();
        let handle = Arc::new(TaskHandle::new(row, jobs, task.headers, &self.shutdown_token));
        self.tasks.lock().unwrap().insert(id.clone(), handle);
        self.lifecycle.emit(EngineEvent::TaskCreated { task_id: id.clone() });
        self.queue_tx.send(id.clone()).map_err(|_| EngineError::Engine("scheduler gone".into()))?;
        Ok(id)
    }

    async fn pause(&self, id: &TaskId) -> Result<TaskSnapshot, EngineError> {
        let handle = self.get_task(id)?;
        {
            let mut core = handle.core.lock().unwrap();
            core.transition(TaskStatus::Paused, &self.lifecycle, None, None)?;
        }
        // Abort all segment connections immediately (AC-10, sub-second).
        handle.cancel.lock().unwrap().cancel();
        self.persist_status(&handle).await;
        Ok(snapshot_of(&handle, current_downloaded(&handle)))
    }

    async fn resume(&self, id: &TaskId) -> Result<TaskSnapshot, EngineError> {
        let handle = self.get_task(id)?;
        {
            let mut core = handle.core.lock().unwrap();
            core.transition(TaskStatus::Downloading, &self.lifecycle, None, None)?;
        }
        // Fresh run token; the old runner (if still draining) is tied to
        // the cancelled one and will not interfere.
        *handle.cancel.lock().unwrap() = self.shutdown_token.child_token();
        self.persist_status(&handle).await;
        self.queue_tx.send(id.clone()).map_err(|_| EngineError::Engine("scheduler gone".into()))?;
        Ok(snapshot_of(&handle, current_downloaded(&handle)))
    }

    async fn retry(&self, id: &TaskId) -> Result<TaskSnapshot, EngineError> {
        let handle = self.get_task(id)?;
        {
            let mut core = handle.core.lock().unwrap();
            core.transition(TaskStatus::Pending, &self.lifecycle, None, None)?;
        }
        handle.retry_budget.store(TASK_RETRY_BUDGET, Ordering::SeqCst);
        self.persist_status(&handle).await;
        self.queue_tx.send(id.clone()).map_err(|_| EngineError::Engine("scheduler gone".into()))?;
        Ok(snapshot_of(&handle, current_downloaded(&handle)))
    }

    async fn remove(&self, id: &TaskId, delete_files: bool) -> Result<(), EngineError> {
        let handle = self.get_task(id)?;
        handle.cancel.lock().unwrap().cancel();
        let (dir, filename, status) = {
            let row = handle.row.lock().unwrap();
            (row.dir.clone(), row.filename.clone(), handle.core.lock().unwrap().status)
        };
        self.tasks.lock().unwrap().remove(id);
        self.throttle.clear_task(id);
        {
            let store = self.store.clone();
            let id = id.clone();
            tokio::task::spawn_blocking(move || store.delete_task(&id))
                .await
                .map_err(|e| EngineError::Engine(e.to_string()))??;
        }
        // AC-13: never touch files of completed tasks; only .part cleanup.
        if delete_files && status != TaskStatus::Completed {
            let part = part_path(&dir, &filename);
            let _ = std::fs::remove_file(part);
        }
        self.lifecycle.emit(EngineEvent::TaskRemoved { task_id: id.clone() });
        Ok(())
    }

    async fn pause_all(&self) -> Result<(), EngineError> {
        let targets: Vec<Arc<TaskHandle>> = {
            let tasks = self.tasks.lock().unwrap();
            tasks
                .values()
                .filter(|h| h.core.lock().unwrap().status == TaskStatus::Downloading)
                .cloned()
                .collect()
        };
        for handle in targets {
            let _ = self.pause(&handle.id).await;
        }
        Ok(())
    }

    async fn resume_all(&self) -> Result<(), EngineError> {
        let targets: Vec<Arc<TaskHandle>> = {
            let tasks = self.tasks.lock().unwrap();
            tasks
                .values()
                .filter(|h| h.core.lock().unwrap().status == TaskStatus::Paused)
                .cloned()
                .collect()
        };
        for handle in targets {
            let _ = self.resume(&handle.id).await;
        }
        Ok(())
    }

    // Query / limits / subscription / restore / shutdown / config delegate
    // to ops_query free functions (single trait impl, split file budget).
    async fn list(&self, filter: TaskFilter) -> Result<Vec<TaskSnapshot>, EngineError> {
        super::ops_query::list(self, filter).await
    }

    async fn set_global_limit(&self, bytes_per_sec: Option<u64>) -> Result<(), EngineError> {
        super::ops_query::set_global_limit(self, bytes_per_sec).await
    }

    async fn set_task_limit(
        &self,
        id: &TaskId,
        bytes_per_sec: Option<u64>,
    ) -> Result<(), EngineError> {
        super::ops_query::set_task_limit(self, id, bytes_per_sec).await
    }

    fn subscribe(&self) -> EventSubscriber {
        super::ops_query::subscribe(self)
    }

    async fn restore(&self) -> Result<usize, EngineError> {
        super::ops_query::restore(self).await
    }

    async fn shutdown(&self) -> Result<(), EngineError> {
        super::ops_query::shutdown(self).await
    }

    async fn get_config(&self) -> Result<EngineConfig, EngineError> {
        super::ops_query::get_config(self).await
    }

    async fn set_config(&self, patch: EngineConfigPatch) -> Result<EngineConfig, EngineError> {
        super::ops_query::set_config(self, patch).await
    }
}
