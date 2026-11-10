// Resume validation (ARCHITECTURE section 1.4). The network-facing probe
// lives in probe.rs; this module holds the pure decision logic so the
// triple-comparison table and 416 rules are directly unit-testable.

#[cfg(test)]
mod tests;

use crate::store::SegmentRow;

/// Result of the resume network probe (GET final_url, Range: bytes=0-0).
#[derive(Debug, Clone)]
pub struct ResumeProbe {
    pub status: u16,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    /// Total length parsed from Content-Range (206 responses).
    pub total: Option<u64>,
    pub final_url: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ResumeDecision {
    /// Ranges proven identical: continue each segment from its offset.
    Continue {
        final_url: String,
        /// ETag to backfill into the DB when the record lacked one.
        backfill_etag: Option<String>,
    },
    /// Triple mismatch: the remote resource changed. The task must fail
    /// with resume_conflict (AC-09); the user decides whether to restart.
    Conflict(String),
    /// Server answered 200 with zero local progress: plan a fresh download.
    RestartFresh { final_url: String },
}

/// The triple-comparison table from ARCHITECTURE section 1.4. Comparison
/// rules: a field conflicts only when both sides have values and they
/// differ; absent fields never conflict (common for static-file servers).
pub fn validate_resume(
    record_etag: Option<&str>,
    record_lm: Option<&str>,
    record_total: Option<u64>,
    downloaded: u64,
    probe: &ResumeProbe,
) -> ResumeDecision {
    if probe.status == 200 {
        if downloaded > 0 {
            // Range not honored; local bytes cannot be proven same-origin.
            return ResumeDecision::Conflict(
                "服务器不支持断点续传（Range 请求未生效），无法证明本地数据与远端一致".into(),
            );
        }
        return ResumeDecision::RestartFresh { final_url: probe.final_url.clone() };
    }
    // 206: triple comparison.
    if let (Some(rec), Some(now)) = (record_etag, probe.etag.as_deref()) {
        if rec != now {
            return ResumeDecision::Conflict(format!(
                "ETag 已变化（记录 {}，服务器 {}），远端资源已更新",
                rec, now
            ));
        }
    }
    if let (Some(rec), Some(now)) = (record_lm, probe.last_modified.as_deref()) {
        if rec != now {
            return ResumeDecision::Conflict(format!(
                "Last-Modified 已变化（记录 {}，服务器 {}）",
                rec, now
            ));
        }
    }
    if let (Some(rec), Some(now)) = (record_total, probe.total) {
        if rec != now {
            return ResumeDecision::Conflict(format!(
                "Content-Length 已变化（记录 {}，服务器 {}）",
                rec, now
            ));
        }
    }
    ResumeDecision::Continue {
        final_url: probe.final_url.clone(),
        backfill_etag: if record_etag.is_none() { probe.etag.clone() } else { None },
    }
}

/// Local .part verification state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PartFileCheck {
    /// No recorded progress: nothing to verify, fresh start.
    Fresh,
    /// .part exists and covers every recorded write: safe to resume.
    Ok,
    /// Recorded progress exists but the .part is gone or short: wipe
    /// progress and restart the download (never stitch corrupt data).
    Reset,
}

/// Verify the .part file against recorded segment progress. `part_len` is
/// None when the file is missing. The invariant checked is that the file
/// covers every recorded (start_byte + downloaded_bytes) prefix: with
/// preallocation the file equals total; in degraded on-demand mode the file
/// ends at the highest written offset, which this accepts.
pub fn check_part_file(part_len: Option<u64>, segs: &[SegmentRow]) -> PartFileCheck {
    let has_progress = segs.iter().any(|s| s.downloaded_bytes > 0);
    if !has_progress {
        return PartFileCheck::Fresh;
    }
    let Some(len) = part_len else {
        return PartFileCheck::Reset;
    };
    let required = segs
        .iter()
        .map(|s| s.start_byte.saturating_add(s.downloaded_bytes))
        .max()
        .unwrap_or(0);
    if len >= required {
        PartFileCheck::Ok
    } else {
        PartFileCheck::Reset
    }
}

/// Action when a segment request answers 416 (range not satisfiable).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RangeInvalidAction {
    /// Request start equals (or exceeds) the resource total: the segment
    /// is effectively complete (0-byte / boundary cases).
    MarkDone,
    /// The remote range changed: wipe this segment's progress and retry.
    ResetSegment,
}

pub fn handle_416(start_plus_downloaded: u64, total: Option<u64>) -> RangeInvalidAction {
    match total {
        Some(total) if start_plus_downloaded >= total => RangeInvalidAction::MarkDone,
        _ => RangeInvalidAction::ResetSegment,
    }
}

/// Parse the total length out of a Content-Range header value.
/// Accepts "bytes 0-0/12345" and "bytes */12345"; total "*" -> None.
pub fn parse_content_range_total(value: Option<&str>) -> Option<u64> {
    let value = value?;
    let after_slash = value.split('/').nth(1)?.trim();
    if after_slash == "*" {
        return None;
    }
    after_slash.parse::<u64>().ok()
}
