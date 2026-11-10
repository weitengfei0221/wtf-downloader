// Segment planning (ARCHITECTURE section 1.3). The dynamic scheduling and
// worker loop live in runner.rs; this file holds the plan algorithm and the
// SegmentJob model shared by runner, progress aggregation and snapshots.

#[cfg(test)]
mod tests;

use crate::consts::{MIN_SEGMENT_BYTES, UNKNOWN_END_BYTE};
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq)]
pub struct SegmentSpec {
    pub index: u32,
    pub start_byte: u64,
    pub end_byte: u64,
}

/// Plan segments for a resource.
///
/// - total None (chunked) or no Range support: one streaming segment
///   covering [0, UNKNOWN_END_BYTE).
/// - total 0: no segments; the task completes immediately.
/// - otherwise: n = min(max_segments, ceil(total / MIN_SEGMENT_BYTES)),
///   clamped to at least 1. The first n-1 segments take the base size and
///   the last absorbs the remainder; coverage is exactly [0, total).
pub fn plan_segments(total: Option<u64>, accept_ranges: bool, max_segments: u8) -> Vec<SegmentSpec> {
    let Some(total) = total else {
        return vec![SegmentSpec { index: 0, start_byte: 0, end_byte: UNKNOWN_END_BYTE }];
    };
    if total == 0 {
        return Vec::new();
    }
    if !accept_ranges {
        return vec![SegmentSpec { index: 0, start_byte: 0, end_byte: total - 1 }];
    }
    let max_n = max_segments.max(1) as u64;
    let by_min = total.div_ceil(MIN_SEGMENT_BYTES);
    let n = by_min.clamp(1, max_n);
    let base = total / n;
    (0..n)
        .map(|i| {
            let start = i * base;
            let end = if i == n - 1 { total - 1 } else { (i + 1) * base - 1 };
            SegmentSpec { index: i as u32, start_byte: start, end_byte: end }
        })
        .collect()
}

/// Work item for the runner: a byte range plus its progress. Splits append
/// new jobs (fresh indexes); existing indexes are never reordered, so
/// position-based bookkeeping in the snapshot loop stays valid.
#[derive(Debug, Clone)]
pub struct SegmentJob {
    pub index: u32,
    pub start_byte: u64,
    pub end_byte: u64,
    pub downloaded: u64,
    pub state: JobState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobState {
    Pending,
    Running,
    Done,
    /// Covered by two child jobs after a split; never scheduled again.
    Split,
}

/// Shared job table for one task.
pub type SharedJobs = Mutex<Vec<SegmentJob>>;

impl SegmentJob {
    pub fn from_spec(spec: &SegmentSpec) -> Self {
        Self {
            index: spec.index,
            start_byte: spec.start_byte,
            end_byte: spec.end_byte,
            downloaded: 0,
            state: JobState::Pending,
        }
    }

    pub fn len(&self) -> u64 {
        if self.end_byte == UNKNOWN_END_BYTE {
            u64::MAX - self.start_byte
        } else {
            self.end_byte - self.start_byte + 1
        }
    }

    pub fn is_complete(&self) -> bool {
        self.end_byte != UNKNOWN_END_BYTE && self.downloaded >= self.len()
    }
}

/// Claim the next pending job for a worker, marking it Running.
pub fn claim_next(jobs: &mut Vec<SegmentJob>) -> Option<usize> {
    let pos = jobs.iter().position(|j| j.state == JobState::Pending)?;
    jobs[pos].state = JobState::Running;
    Some(pos)
}

/// True when no job remains to be scheduled (Done/Split only).
pub fn all_settled(jobs: &[SegmentJob]) -> bool {
    jobs.iter().all(|j| j.state == JobState::Done || j.state == JobState::Split)
}

/// Split the remaining range of a failing job into two child jobs.
/// Returns the new job positions, or None when the remaining range is too
/// small to split. The task-level retry budget is consumed by the caller.
pub fn split_job(jobs: &mut Vec<SegmentJob>, pos: usize, min_split: u64) -> Option<(usize, usize)> {
    let (start, downloaded, orig_end) = {
        let job = &jobs[pos];
        (job.start_byte, job.downloaded, job.end_byte)
    };
    if orig_end == crate::consts::UNKNOWN_END_BYTE {
        return None; // streams cannot be range-split
    }
    // A fully-downloaded (or over-complete) job has no remaining range;
    // guard the subtraction instead of wrapping (debug panic / release wrap).
    let remaining_start = start.saturating_add(downloaded);
    if remaining_start > orig_end {
        return None;
    }
    let remaining_len = orig_end - remaining_start + 1;
    if remaining_len < min_split {
        return None;
    }
    let mid = remaining_start + remaining_len / 2;
    let next_index = jobs.iter().map(|j| j.index).max().unwrap_or(0) + 1;
    {
        let job = &mut jobs[pos];
        // The parent keeps only what it already wrote; children cover the rest.
        job.end_byte = if downloaded > 0 { remaining_start - 1 } else { start };
        job.state = JobState::Split;
    }
    jobs.push(SegmentJob {
        index: next_index,
        start_byte: remaining_start,
        end_byte: mid - 1,
        downloaded: 0,
        state: JobState::Pending,
    });
    let a_pos = jobs.len() - 1;
    jobs.push(SegmentJob {
        index: next_index + 1,
        start_byte: mid,
        end_byte: orig_end,
        downloaded: 0,
        state: JobState::Pending,
    });
    let b_pos = jobs.len() - 1;
    Some((a_pos, b_pos))
}
