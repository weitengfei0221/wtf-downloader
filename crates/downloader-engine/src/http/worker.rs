// SegmentWorker (ARCHITECTURE section 1.3): claim a job, stream its range
// chunk by chunk (throttle -> disk write -> memory counter), retry with
// exponential backoff, split persistently-failing large ranges, and stop
// the whole task on non-retryable errors.

use super::classify::{classify_reqwest, classify_status, effective_backoff, Failure};
use super::resume::{handle_416, parse_content_range_total, RangeInvalidAction};
use super::segment::{claim_next, split_job, JobState, SegmentJob};
use super::{HttpDownloader, TaskHandle};
use crate::consts::{CHUNK_BYTES, SEGMENT_RETRIES, SPLIT_THRESHOLD_BYTES, UNKNOWN_END_BYTE};
use crate::protocol::{TaskStatus, CODE_RESUME_CONFLICT};
use crate::store::SegmentRow;
use futures_util::StreamExt;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

enum SegmentResult {
    Done,
    Cancelled,
    Failed(Failure),
}

pub(crate) async fn run_worker(
    engine: Arc<HttpDownloader>,
    handle: Arc<TaskHandle>,
    writer: Arc<super::writer::PartWriter>,
    cancel: CancellationToken,
) {
    loop {
        if cancel.is_cancelled() {
            return;
        }
        let pos = {
            let mut jobs = handle.jobs.lock().unwrap();
            claim_next(&mut jobs)
        };
        let Some(pos) = pos else { return };

        let mut attempt: u32 = 0;
        loop {
            if cancel.is_cancelled() {
                release_claim(&handle, pos);
                return;
            }
            match download_segment(&engine, &handle, &writer, &cancel, pos).await {
                SegmentResult::Done => {
                    {
                        let mut jobs = handle.jobs.lock().unwrap();
                        jobs[pos].state = JobState::Done;
                    }
                    persist_segment(&engine, &handle, pos).await; // L2 write
                    break;
                }
                SegmentResult::Cancelled => {
                    release_claim(&handle, pos);
                    return;
                }
                SegmentResult::Failed(failure) => {
                    attempt += 1;
                    match failure {
                        Failure::Fatal { message, code } => {
                            engine.fail_task(&handle, code, message).await;
                            return;
                        }
                        Failure::InvalidRange => {
                            // Handled inside download_segment; unreachable.
                            release_claim(&handle, pos);
                            return;
                        }
                        Failure::Retryable { message, retry_after } => {
                            // Second failure on a large remaining range:
                            // split it to isolate the bad region.
                            if attempt >= 2 {
                                let budget =
                                    handle.retry_budget.try_update(
                                        std::sync::atomic::Ordering::SeqCst,
                                        std::sync::atomic::Ordering::SeqCst,
                                        |v| if v > 0 { Some(v - 1) } else { None },
                                    );
                                if budget.is_ok() {
                                    let split = {
                                        let mut jobs = handle.jobs.lock().unwrap();
                                        split_job(&mut jobs, pos, SPLIT_THRESHOLD_BYTES)
                                    };
                                    if split.is_some() {
                                        break; // claim a child / next job
                                    }
                                }
                            }
                            if attempt > SEGMENT_RETRIES {
                                engine
                                    .fail_task(
                                        &handle,
                                        None,
                                        format!("分片重试耗尽（{} 次）：{}", SEGMENT_RETRIES, message),
                                    )
                                    .await;
                                return;
                            }
                            let delay = effective_backoff(attempt - 1, retry_after);
                            tokio::select! {
                                _ = cancel.cancelled() => {
                                    release_claim(&handle, pos);
                                    return;
                                }
                                _ = tokio::time::sleep(delay) => {}
                            }
                        }
                    }
                }
            }
        }
    }
}

fn release_claim(handle: &Arc<TaskHandle>, pos: usize) {
    let mut jobs = handle.jobs.lock().unwrap();
    if jobs[pos].state == JobState::Running {
        jobs[pos].state = JobState::Pending;
    }
}

async fn persist_segment(engine: &Arc<HttpDownloader>, handle: &Arc<TaskHandle>, pos: usize) {
    let row = {
        let jobs = handle.jobs.lock().unwrap();
        let j = &jobs[pos];
        SegmentRow {
            task_id: handle.id.clone(),
            seg_index: j.index,
            start_byte: j.start_byte,
            end_byte: j.end_byte,
            downloaded_bytes: j.downloaded,
        }
    };
    let store = engine.store.clone();
    let task_id = row.task_id.clone();
    let _ = tokio::task::spawn_blocking(move || store.upsert_segments(&task_id, &[row])).await;
}

async fn download_segment(
    engine: &Arc<HttpDownloader>,
    handle: &Arc<TaskHandle>,
    writer: &Arc<super::writer::PartWriter>,
    cancel: &CancellationToken,
    pos: usize,
) -> SegmentResult {
    let (start, end) = {
        let jobs = handle.jobs.lock().unwrap();
        let j = &jobs[pos];
        (j.start_byte, j.end_byte)
    };
    let (final_url, headers) = {
        let row = handle.row.lock().unwrap();
        (row.final_url.clone(), handle.headers.lock().unwrap().clone())
    };
    let downloaded = { handle.jobs.lock().unwrap()[pos].downloaded };
    let start_offset = start + downloaded;

    let range = if end == UNKNOWN_END_BYTE {
        format!("bytes={}-", start_offset)
    } else {
        format!("bytes={}-{}", start_offset, end)
    };
    let mut req = engine.client.get(&final_url).header("Range", range);
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => return SegmentResult::Failed(classify_reqwest(&e)),
    };
    let status = resp.status().as_u16();

    if status == 416 {
        let cr_total = parse_content_range_total(
            resp.headers().get(reqwest::header::CONTENT_RANGE).and_then(|v| v.to_str().ok()),
        );
        let total = cr_total.or(handle.row.lock().unwrap().total_bytes);
        return match handle_416(start_offset, total) {
            RangeInvalidAction::MarkDone => SegmentResult::Done,
            RangeInvalidAction::ResetSegment => {
                let mut jobs = handle.jobs.lock().unwrap();
                jobs[pos].downloaded = 0;
                SegmentResult::Failed(Failure::Retryable {
                    message: "远端资源区间已变化，重下该分片".into(),
                    retry_after: None,
                })
            }
        };
    }

    if status != 206 && status != 200 {
        let ra = resp.headers().get(reqwest::header::RETRY_AFTER).and_then(|v| v.to_str().ok());
        return SegmentResult::Failed(classify_status(status, ra));
    }

    // A 200 answer carries the body from byte 0: safe only when this job
    // covers the whole resource from the start.
    let covers_from_zero = start == 0
        && (end == UNKNOWN_END_BYTE
            || handle.row.lock().unwrap().total_bytes == Some(end + 1));
    let mut write_offset = start_offset;
    if status == 200 {
        if !covers_from_zero {
            return SegmentResult::Failed(Failure::Fatal {
                message: "服务器忽略了 Range 请求，无法安全续传（resume_conflict）".into(),
                code: Some(CODE_RESUME_CONFLICT),
            });
        }
        if start_offset > 0 {
            // Single-connection stream restart from byte 0.
            let mut jobs = handle.jobs.lock().unwrap();
            jobs[pos].downloaded = 0;
            write_offset = start;
        }
    }

    let seg_len: Option<u64> =
        if end == UNKNOWN_END_BYTE { None } else { Some(end - start + 1) };
    let mut current = { handle.jobs.lock().unwrap()[pos].downloaded };
    let mut stream = resp.bytes_stream();

    loop {
        tokio::select! {
            _ = cancel.cancelled() => return SegmentResult::Cancelled,
            chunk = stream.next() => match chunk {
                None => {
                    // Stream ended.
                    return match seg_len {
                        Some(len) if current < len => SegmentResult::Failed(Failure::Retryable {
                            message: "连接提前关闭（下载数据不完整）".into(),
                            retry_after: None,
                        }),
                        _ => SegmentResult::Done,
                    };
                }
                Some(Err(e)) => return SegmentResult::Failed(classify_reqwest(&e)),
                Some(Ok(chunk)) => {
                    let mut data: &[u8] = &chunk;
                    if let Some(len) = seg_len {
                        let space = (len - current) as usize;
                        if data.len() > space {
                            data = &data[..space];
                        }
                    }
                    let mut wrote: u64 = 0;
                    while !data.is_empty() {
                        let take = data.len().min(CHUNK_BYTES);
                        let piece = &data[..take];
                        tokio::select! {
                            _ = cancel.cancelled() => return SegmentResult::Cancelled,
                            _ = engine.throttle.acquire(&handle.id, take as u32) => {}
                        }
                        // Ordering invariant: disk write BEFORE memory update.
                        if let Err(e) = writer.write_at(write_offset, piece) {
                            return SegmentResult::Failed(Failure::Fatal {
                                message: format!("io_error: {}", e),
                                code: None,
                            });
                        }
                        write_offset += take as u64;
                        wrote += take as u64;
                        data = &data[take..];
                    }
                    if wrote > 0 {
                        let mut jobs = handle.jobs.lock().unwrap();
                        jobs[pos].downloaded = current + wrote;
                    }
                    current += wrote;
                    if let Some(len) = seg_len {
                        if current >= len {
                            return SegmentResult::Done;
                        }
                    }
                }
            },
        }
    }
}

/// Guard: workers only run while the task is downloading; used by tests.
#[allow(dead_code)]
pub(crate) fn is_downloading(handle: &Arc<TaskHandle>) -> bool {
    handle.core.lock().unwrap().status == TaskStatus::Downloading
}

#[allow(dead_code)]
pub(crate) fn job_at(handle: &Arc<TaskHandle>, pos: usize) -> SegmentJob {
    handle.jobs.lock().unwrap()[pos].clone()
}
