// TaskRunner: the per-task supervisor (ARCHITECTURE section 1.3).
//   pending -> downloading -> [prepare: validation + writer] -> spawn
//   workers -> monitor (all done / cancel) -> finish or leave paused.
// The preparation/validation phase lives in prepare.rs; the segment worker
// loop lives in worker.rs.

use super::prepare::{complete_task, prepare, PrepareError, Prepared};
use super::segment::{all_settled, JobState};
use super::{HttpDownloader, TaskHandle};
use crate::protocol::TaskStatus;
use std::sync::Arc;
use tokio::sync::OwnedSemaphorePermit;

pub(crate) async fn run_task(
    engine: &Arc<HttpDownloader>,
    handle: &Arc<TaskHandle>,
    _permit: OwnedSemaphorePermit,
) {
    let cancel = handle.cancel.lock().unwrap().clone();

    // 1. pending -> downloading (single transition entry point).
    //    The resume path already moved paused -> downloading optimistically
    //    (ARCHITECTURE 1.2 point 5); re-transitioning here would be an
    //    illegal downloading -> downloading move and abort the run.
    {
        let mut core = handle.core.lock().unwrap();
        if core.status == TaskStatus::Pending {
            if core.transition(TaskStatus::Downloading, &engine.lifecycle, None, None).is_err() {
                return; // removed or already terminal while queued
            }
        } else if core.status != TaskStatus::Downloading {
            return; // terminal while queued
        }
    }
    engine.persist_status(handle).await;

    // 2. Resume validation + writer setup.
    let prepared = match prepare(engine, handle).await {
        Ok(p) => p,
        Err(PrepareError { code, message }) => {
            engine.fail_task(handle, code, message).await;
            return;
        }
    };

    match prepared {
        Prepared::AlreadyComplete => {
            super::prepare::settle_jobs(handle);
            return complete_task(engine, handle, None).await;
        }
        Prepared::Writer(writer) => {
            // 3. Spawn one worker per pending job.
            let worker_count = {
                let jobs = handle.jobs.lock().unwrap();
                jobs.iter().filter(|j| j.state == JobState::Pending).count()
            };
            if worker_count == 0 {
                // 0-byte task (or everything already done).
                super::prepare::settle_jobs(handle);
                complete_task(engine, handle, Some(&writer)).await;
                return;
            }
            let mut workers = tokio::task::JoinSet::new();
            for _ in 0..worker_count {
                workers.spawn(super::worker::run_worker(
                    engine.clone(),
                    handle.clone(),
                    writer.clone(),
                    cancel.clone(),
                ));
            }
            // 4. Monitor: wait for all workers or cancellation.
            let cancelled = monitor(engine, &cancel, workers).await;
            if cancelled {
                // Pause / failure / shutdown: flush an immediate snapshot
                // so at most one snapshot period of progress is at risk.
                engine.flush_task_snapshot(handle).await;
            } else {
                let failed = { handle.core.lock().unwrap().status == TaskStatus::Failed };
                let settled = { all_settled(&handle.jobs.lock().unwrap()) };
                if !failed && settled {
                    complete_task(engine, handle, Some(&writer)).await;
                } else if !failed {
                    // Defensive: workers exited without settling and without
                    // recording a failure. Fail loudly rather than hang.
                    engine
                        .fail_task(
                            handle,
                            None,
                            "内部错误：下载工作线程提前退出且未记录失败".to_string(),
                        )
                        .await;
                }
            }
        }
    }
}

/// Wait for every worker to exit. Returns true when the run was cancelled
/// (pause, sibling failure, or engine shutdown).
async fn monitor(
    engine: &Arc<HttpDownloader>,
    cancel: &tokio_util::sync::CancellationToken,
    mut workers: tokio::task::JoinSet<()>,
) -> bool {
    let mut cancelled = false;
    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                cancelled = true;
                workers.abort_all();
                break;
            }
            _ = engine.shutdown_token.cancelled() => {
                cancelled = true;
                workers.abort_all();
                break;
            }
            joined = workers.join_next() => {
                if joined.is_none() {
                    // All workers exited on their own.
                    break;
                }
            }
        }
    }
    // Drain aborted remains so no task is silently detached.
    while workers.join_next().await.is_some() {}
    cancelled
}
