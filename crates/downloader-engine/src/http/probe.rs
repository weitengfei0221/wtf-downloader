// URL probing for the add-task dialog (AC-01) and for resume validation.

use crate::consts::PROBE_TIMEOUT_MS;
use crate::http::naming::{filename_from_content_disposition, filename_from_url};
use crate::http::resume::{parse_content_range_total, ResumeProbe};
use crate::protocol::{EngineError, ProbeResult};

/// Validate a user-supplied URL: parseable, http/https scheme only.
pub fn validate_url(url: &str) -> Result<url::Url, EngineError> {
    let parsed =
        url::Url::parse(url).map_err(|_| EngineError::InvalidUrl(url.to_string()))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(EngineError::InvalidUrl(format!(
            "不支持的协议 {}（仅支持 http/https）",
            parsed.scheme()
        )));
    }
    Ok(parsed)
}

fn header_string(resp: &reqwest::Response, name: reqwest::header::HeaderName) -> Option<String> {
    resp.headers().get(name).and_then(|v| v.to_str().ok()).map(|s| s.to_string())
}

/// Probe direct-link metadata: sends Range: bytes=0-0.
///   206 -> accept_ranges true, total from Content-Range
///   200 -> accept_ranges false, total from Content-Length
///   416 -> empty-resource edge, total from Content-Range (*/N)
///   other >= 400 -> HttpStatus error (bridge maps to http_status:N)
pub(crate) async fn probe_url(
    client: &reqwest::Client,
    url: &str,
    headers: &[(String, String)],
) -> Result<ProbeResult, EngineError> {
    let parsed = validate_url(url)?;
    let mut req = client
        .get(parsed)
        .header("Range", "bytes=0-0")
        .timeout(std::time::Duration::from_millis(PROBE_TIMEOUT_MS));
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| {
        if e.is_timeout() {
            EngineError::ProbeFailed("探测超时（2 秒内服务器未响应）".into())
        } else {
            EngineError::ProbeFailed(e.to_string())
        }
    })?;

    let filename = filename_from_content_disposition(
        &header_string(&resp, reqwest::header::CONTENT_DISPOSITION).unwrap_or_default(),
    )
    .or_else(|| filename_from_url(&resp.url().to_string()))
    .unwrap_or_else(|| "download".to_string());
    let final_url = resp.url().to_string();
    let etag = header_string(&resp, reqwest::header::ETAG);
    let last_modified = header_string(&resp, reqwest::header::LAST_MODIFIED);
    let cr_total = parse_content_range_total(
        resp.headers().get(reqwest::header::CONTENT_RANGE).and_then(|v| v.to_str().ok()),
    );

    match resp.status().as_u16() {
        206 => Ok(ProbeResult {
            filename,
            total_size: cr_total,
            accept_ranges: true,
            etag,
            last_modified,
            final_url,
        }),
        200 => Ok(ProbeResult {
            filename,
            total_size: resp.content_length(),
            accept_ranges: false,
            etag,
            last_modified,
            final_url,
        }),
        416 => Ok(ProbeResult {
            filename,
            total_size: Some(cr_total.unwrap_or(0)),
            accept_ranges: true,
            etag,
            last_modified,
            final_url,
        }),
        s if s >= 400 => Err(EngineError::HttpStatus(s)),
        s => Err(EngineError::ProbeFailed(format!("意外的响应状态 {}", s))),
    }
}

/// Resume-time probe: GET final_url with Range: bytes=0-0, expecting 206
/// (or 200 when the server ignores ranges). Redirects are followed by the
/// client (limit REDIRECT_LIMIT).
pub(crate) async fn probe_for_resume(
    client: &reqwest::Client,
    final_url: &str,
    headers: &[(String, String)],
) -> Result<ResumeProbe, EngineError> {
    let mut req = client.get(final_url).header("Range", "bytes=0-0");
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| EngineError::ProbeFailed(e.to_string()))?;
    let status = resp.status().as_u16();
    if status != 206 && status != 200 {
        return Err(EngineError::HttpStatus(status));
    }
    Ok(ResumeProbe {
        status,
        etag: header_string(&resp, reqwest::header::ETAG),
        last_modified: header_string(&resp, reqwest::header::LAST_MODIFIED),
        total: parse_content_range_total(
            resp.headers().get(reqwest::header::CONTENT_RANGE).and_then(|v| v.to_str().ok()),
        ),
        final_url: resp.url().to_string(),
    })
}
