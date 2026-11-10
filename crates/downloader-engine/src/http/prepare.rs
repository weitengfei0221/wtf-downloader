// Runner preparation phase (ARCHITECTURE section 1.4): local .part check,
// network triple validation with retry, PartWriter open, and the task
// completion path (finish + transition). The supervisor loop that calls
// into this lives in runner.rs.

use super::probe::probe_for_resume;
use super::resume::{check_part_file, validate_resume, PartFileCheck, ResumeDecision};
use super::writer::PartWriter;
use super::{HttpDownloader, TaskHandle};
use crate::consts::UNKNOWN_END_BYTE;
use crate::http::segment::JobState;
use crate::protocol::{EngineError, TaskStatus, CODE_RESUME_CONFLICT};
use crate::store::SegmentRow;
use std::sync::Arc;

pub(crate) enum Prepared {
    Writer(Arc<PartWriter>),
    /// The final file already exists with the exact expected size (a
    /// completion raced a pause); just settle the status.
    AlreadyComplete,
}

/// Why preparation failed: the user-facing message plus, when the failure has
/// one, the machine-readable code (`protocol::CODE_RESUME_CONFLICT`).
/// `From<String>` keeps the plain-message sites unchanged.
pub(crate) struct PrepareError {
    pub code: Option<&'static str>,
    pub message: String,
}

impl From<String> for PrepareError {
    fn from(message: String) -> Self {
        Self { code: None, message }
    }
}

/// Resume conflicts are identified by code, not by the text of the message.
fn resume_conflict(message: String) -> PrepareError {
    PrepareError { code: Some(CODE_RESUME_CONFLICT), message }
}

/// Resume-time preparation: local .part check, network triple validation,
/// PartWriter open. Returns Err(message) for resume conflicts (task fails
/// with the resume_conflict semantics of AC-09).
pub(crate) async fn prepare(
    engine: &Arc<HttpDownloader>,
    handle: &Arc<TaskHandle>,
) -> Result<Prepared, PrepareError> {
    let (dir, filename, final_url, total, record_etag, record_lm) = {
        let row = handle.row.lock().unwrap();
        (
            row.dir.clone(),
            row.filename.clone(),
            row.final_url.clone(),
            row.total_bytes,
            row.etag.clone(),
            row.last_modified.clone(),
        )
    };
    let part = super::naming::part_path(&dir, &filename);
    let final_path = dir.join(&filename);
    let part_len = std::fs::metadata(&part).ok().map(|m| m.len());

    // Completion raced a pause: the rename happened but the status write
    // did not. Short-circuit to Completed.
    if part_len.is_none() {
        if let Some(total) = total {
            if let Ok(meta) = std::fs::metadata(&final_path) {
                if meta.len() == total {
                    return Ok(Prepared::AlreadyComplete);
                }
            }
        }
    }

    let segs_snapshot: Vec<SegmentRow> = {
        let mut jobs = handle.jobs.lock().unwrap();
        // Normalize leftovers from an aborted run: a worker killed by
        // abort() cannot release its Running claim, so reopen those jobs.
        for j in jobs.iter_mut() {
            if j.state == JobState::Running {
                j.state = JobState::Pending;
            }
        }
        jobs.iter()
            .map(|j| SegmentRow {
                task_id: handle.id.clone(),
                seg_index: j.index,
                start_byte: j.start_byte,
                end_byte: j.end_byte,
                downloaded_bytes: j.downloaded,
            })
            .collect()
    };

    match check_part_file(part_len, &segs_snapshot) {
        PartFileCheck::Fresh => {}
        PartFileCheck::Reset => {
            // .part gone or short: wipe recorded progress and restart.
            // The guard lives strictly inside this block so no lock is ever
            // held across the DB await below (future must stay Send).
            let rows: Vec<SegmentRow> = {
                let mut jobs = handle.jobs.lock().unwrap();
                for j in jobs.iter_mut() {
                    j.downloaded = 0;
                    if j.state != JobState::Split {
                        j.state = JobState::Pending;
                    }
                }
                jobs.iter()
                    .map(|j| SegmentRow {
                        task_id: handle.id.clone(),
                        seg_index: j.index,
                        start_byte: j.start_byte,
                        end_byte: j.end_byte,
                        downloaded_bytes: 0,
                    })
                    .collect()
            };
            let store = engine.store.clone();
            let id = handle.id.clone();
            let _ = tokio::task::spawn_blocking(move || store.upsert_segments(&id, &rows)).await;
        }
        PartFileCheck::Ok => validate_remote(engine, handle, &part_len, &final_url, total, record_etag, record_lm).await?,
    }

    let writer = PartWriter::open(part, total).map_err(|e| format!("io_error: {}", e))?;
    Ok(Prepared::Writer(Arc::new(writer)))
}

/// Network triple validation for the Ok case (rule table in section 1.4).
#[allow(clippy::too_many_arguments)]
async fn validate_remote(
    engine: &Arc<HttpDownloader>,
    handle: &Arc<TaskHandle>,
    part_len: &Option<u64>,
    final_url: &str,
    total: Option<u64>,
    record_etag: Option<String>,
    record_lm: Option<String>,
) -> Result<(), PrepareError> {
    if total.is_none() {
        // Unknown Content-Length: the .part length is the only basis
        // (rule 4); adopt it for the streaming segment.
        let mut jobs = handle.jobs.lock().unwrap();
        if jobs.len() == 1 && jobs[0].end_byte == UNKNOWN_END_BYTE {
            jobs[0].downloaded = part_len.unwrap_or(0);
        }
        return Ok(());
    }
    // A transient network failure during validation must not kill the
    // task: retry the probe a few times with backoff.
    let headers = handle.headers.lock().unwrap().clone();
    let mut probe = Err(EngineError::Engine("unreachable".into()));
    for attempt in 0..3u32 {
        match probe_for_resume(&engine.client, final_url, &headers).await {
            Ok(p) => {
                probe = Ok(p);
                break;
            }
            Err(EngineError::HttpStatus(s)) => {
                probe = Err(EngineError::HttpStatus(s));
                break; // a definitive server answer: do not retry
            }
            Err(e) => {
                probe = Err(e);
                if attempt < 2 {
                    tokio::time::sleep(std::time::Duration::from_millis(500u64 << attempt)).await;
                }
            }
        }
    }
    let probe = probe.map_err(|e| resume_conflict(format!("resume_conflict: 续传校验失败: {}", e)))?;
    let downloaded: u64 = handle.jobs.lock().unwrap().iter().map(|j| j.downloaded).sum();
    match validate_resume(record_etag.as_deref(), record_lm.as_deref(), total, downloaded, &probe)
    {
        ResumeDecision::Conflict(m) => Err(resume_conflict(format!("resume_conflict: {}", m))),
        ResumeDecision::RestartFresh { .. } => Err(resume_conflict(
            "resume_conflict: 服务器不支持断点续传，本地数据无法续用".to_string(),
        )),
        ResumeDecision::Continue { final_url: new_url, backfill_etag } => {
            let url_changed = new_url != final_url;
            {
                let mut row = handle.row.lock().unwrap();
                if url_changed {
                    row.final_url = new_url.clone();
                }
                if let Some(etag) = backfill_etag.as_ref() {
                    row.etag = Some(etag.clone());
                }
            }
            if url_changed || backfill_etag.is_some() {
                let store = engine.store.clone();
                let id = handle.id.clone();
                let url_opt = if url_changed { Some(new_url) } else { None };
                let etag_opt = backfill_etag;
                let _ = tokio::task::spawn_blocking(move || {
                    store.update_task_meta(
                        &id,
                        url_opt.as_deref(),
                        etag_opt.as_deref(),
                        None,
                        None,
                        None,
                    )
                })
                .await;
            }
            Ok(())
        }
    }
}

pub(crate) fn settle_jobs(handle: &Arc<TaskHandle>) {
    let mut jobs = handle.jobs.lock().unwrap();
    for j in jobs.iter_mut() {
        if j.state != JobState::Split {
            j.state = JobState::Done;
        }
    }
}

/// Completion path: finish the file (sync + verify + rename, AC-07), then
/// transition. `writer` is None for the AlreadyComplete shortcut.
pub(crate) async fn complete_task(
    engine: &Arc<HttpDownloader>,
    handle: &Arc<TaskHandle>,
    writer: Option<&Arc<PartWriter>>,
) {
    let total = handle.row.lock().unwrap().total_bytes;
    if let Some(writer) = writer {
        if let Err(e) = writer.finish(total) {
            engine.fail_task(handle, None, e.to_string()).await;
            return;
        }
    }
    {
        let mut core = handle.core.lock().unwrap();
        if core.status != TaskStatus::Downloading {
            // A pause raced the completion; the renamed file plus persisted
            // progress lets the next resume short-circuit via prepare().
            return;
        }
        if core.transition(TaskStatus::Completed, &engine.lifecycle, None, None).is_err() {
            return;
        }
    }
    engine.persist_status(handle).await;
}
