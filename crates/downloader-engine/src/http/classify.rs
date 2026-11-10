// Error classification for segment transfers (ARCHITECTURE section 1.3):
// which failures are retryable, which are fatal, and how 429 Retry-After
// and 416 shape the behavior.

#[cfg(test)]
mod tests;

use crate::throttle::backoff_delay;
use std::time::Duration;

#[derive(Debug, Clone)]
pub enum Failure {
    /// Non-retryable (404/403/other 4xx, ignored Range, disk errors):
    /// the task goes straight to failed. `code` is the machine-readable
    /// identity of the failure when one exists (see
    /// `protocol::CODE_RESUME_CONFLICT`), so consumers do not have to parse
    /// the user-facing `message`.
    Fatal { message: String, code: Option<&'static str> },
    /// Retryable (timeout / connect / reset / 5xx / 408 / 429): backoff and
    /// retry; `retry_after` (429) raises the backoff floor.
    Retryable { message: String, retry_after: Option<Duration> },
    /// 416 from a segment request: special handling via resume rules.
    InvalidRange,
}

pub fn classify_status(status: u16, retry_after: Option<&str>) -> Failure {
    match status {
        408 | 429 => Failure::Retryable {
            message: format!("HTTP {}", status),
            retry_after: retry_after.and_then(parse_retry_after),
        },
        416 => Failure::InvalidRange,
        s if (500..600).contains(&s) => {
            Failure::Retryable { message: format!("HTTP {}", s), retry_after: None }
        }
        s => Failure::Fatal { message: format!("HTTP {}", s), code: None },
    }
}

pub fn classify_reqwest(e: &reqwest::Error) -> Failure {
    // Any transport-level failure (connect, timeout, mid-body reset) is
    // network-class and retryable at segment level (AC-06).
    let message = transport_message(e.is_timeout(), e.is_connect(), e.is_body(), e.is_decode());
    Failure::Retryable { message, retry_after: None }
}

/// Chinese sentence + stable technical tag for a transport failure.
///
/// Why this exists: `reqwest::Error::to_string()` is English engine text
/// ("error decoding response body") and it used to travel straight into
/// user-visible surfaces - the failure toast body and the task row summary
/// (`TaskRowMeta.vue`). User-facing copy must be self-contained Chinese
/// (DESIGN 6.4), while the tag keeps the failure class diagnosable instead of
/// flattening it into a generic sentence.
///
/// Takes the four `reqwest` flags instead of `&reqwest::Error` because that
/// type cannot be constructed in tests (private constructors); flags make the
/// mapping directly testable.
///
/// Priority is most-specific-first: `is_body` is also set when the body fails
/// to decode, so `is_decode` is checked before it; a timeout always reports as
/// a timeout even if the connection also failed.
pub fn transport_message(
    is_timeout: bool,
    is_connect: bool,
    is_body: bool,
    is_decode: bool,
) -> String {
    let (sentence, tag) = if is_timeout {
        ("连接超时", "timeout")
    } else if is_connect {
        ("无法建立连接", "connect")
    } else if is_decode {
        ("响应数据不完整", "decode")
    } else if is_body {
        ("读取响应中断", "body")
    } else {
        // Includes request-construction failures, which never reach this
        // funnel in practice (they surface from `send` as `is_request`).
        ("网络错误", "other")
    };
    format!("{sentence}（{tag}）")
}

/// Backoff for an attempt, honoring a server-provided Retry-After floor.
pub fn effective_backoff(attempt: u32, retry_after: Option<Duration>) -> Duration {
    let base = backoff_delay(attempt);
    match retry_after {
        Some(ra) if ra > base => ra.min(Duration::from_secs(60)),
        _ => base,
    }
}

/// Parse a Retry-After header: seconds form only (HTTP-date form is rare
/// for download servers; a large constant fallback covers it).
pub fn parse_retry_after(value: &str) -> Option<Duration> {
    let secs: u64 = value.trim().parse().ok()?;
    Some(Duration::from_secs(secs.min(300)))
}
