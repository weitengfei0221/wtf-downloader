// Minimal HTTP/1.1 test server for engine integration tests. Thread-per
// connection, supports Range requests, optional per-chunk delay, optional
// scoped request failures, and mutable content (for resume-conflict tests).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct TestServer {
    pub url: String,
    pub data: Arc<Mutex<Vec<u8>>>,
    pub etag: Arc<Mutex<String>>,
    pub requests: Arc<AtomicU64>,
    delay_ms: u64,
    ignore_range: bool,
    /// (range_start, range_end, fail_count): GETs whose Range start falls in
    /// [start, end] fail with 503 until fail_count requests have failed.
    fail_zone: Option<(u64, u64, Arc<AtomicU64>)>,
}

impl TestServer {
    pub fn start(data: Vec<u8>) -> Self {
        Self::start_with(data, 0, false, None)
    }

    pub fn start_with(
        data: Vec<u8>,
        delay_ms: u64,
        ignore_range: bool,
        fail_zone: Option<(u64, u64, u64)>,
    ) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = Self {
            url: format!("http://{}/file.bin", addr),
            data: Arc::new(Mutex::new(data)),
            etag: Arc::new(Mutex::new("\"v1\"".to_string())),
            requests: Arc::new(AtomicU64::new(0)),
            delay_ms,
            ignore_range,
            fail_zone: fail_zone.map(|(s, e, n)| (s, e, Arc::new(AtomicU64::new(n)))),
        };
        let data = server.data.clone();
        let etag = server.etag.clone();
        let requests = server.requests.clone();
        let delay_ms = server.delay_ms;
        let ignore_range = server.ignore_range;
        let fail_zone = server.fail_zone.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { break };
                let data = data.clone();
                let etag = etag.clone();
                let requests = requests.clone();
                let fail_zone = fail_zone.clone();
                std::thread::spawn(move || {
                    let _ = handle(stream, data, etag, requests, delay_ms, ignore_range, fail_zone);
                });
            }
        });
        server
    }

    // Used by the integration.rs test binary; lifecycle tests do not touch
    // them, hence the allow for its copy of this module.
    #[allow(dead_code)]
    pub fn set_data(&self, new_data: Vec<u8>) {
        *self.data.lock().unwrap() = new_data;
        *self.etag.lock().unwrap() = "\"v2\"".to_string();
    }

    #[allow(dead_code)]
    pub fn request_count(&self) -> u64 {
        self.requests.load(Ordering::SeqCst)
    }
}

fn handle(
    mut stream: TcpStream,
    data: Arc<Mutex<Vec<u8>>>,
    etag: Arc<Mutex<String>>,
    requests: Arc<AtomicU64>,
    delay_ms: u64,
    ignore_range: bool,
    fail_zone: Option<(u64, u64, Arc<AtomicU64>)>,
) -> std::io::Result<()> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    // Read until end of headers.
    loop {
        let n = stream.read(&mut tmp)?;
        if n == 0 {
            return Ok(());
        }
        buf.extend_from_slice(&tmp[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
        if buf.len() > 64 * 1024 {
            return Ok(());
        }
    }
    let text = String::from_utf8_lossy(&buf);
    let first_line = text.lines().next().unwrap_or_default();
    requests.fetch_add(1, Ordering::SeqCst);

    // Only /file.bin exists; anything else is a 404.
    let path = first_line.split_whitespace().nth(1).unwrap_or_default();
    if path != "/file.bin" {
        let head =
            "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        stream.write_all(head.as_bytes())?;
        stream.flush()?;
        return Ok(());
    }

    let mut headers = HashMap::new();
    for line in text.lines().skip(1) {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    let data = data.lock().unwrap();
    let len = data.len();
    let etag = etag.lock().unwrap().clone();

    // Parse Range: bytes=a-b (b may be empty for open-ended).
    let range = if ignore_range {
        None
    } else {
        headers.get("range").and_then(|r| {
            let spec = r.strip_prefix("bytes=")?;
            let (a, b) = spec.split_once('-')?;
            let start: u64 = a.parse().ok()?;
            let end: u64 = if b.is_empty() { len as u64 - 1 } else { b.parse().ok()? };
            Some((start, end))
        })
    };

    // Scoped failure injection (503) before serving.
    if let Some((zs, ze, counter)) = &fail_zone {
        if let Some((start, _)) = range {
            if start >= *zs && start <= *ze {
                let remaining = counter.fetch_sub(1, Ordering::SeqCst);
                if remaining > 0 {
                    write_response(&mut stream, 503, &[], None, &etag)?;
                    return Ok(());
                }
            }
        } else if range.is_none() && *zs == 0 {
            // Fresh single-connection request in the fail zone.
            let remaining = counter.fetch_sub(1, Ordering::SeqCst);
            if remaining > 0 {
                write_response(&mut stream, 503, &[], None, &etag)?;
                return Ok(());
            }
        }
    }

    match range {
        Some((_, _)) if len == 0 => {
            // Empty resource: any range is unsatisfiable.
            let cr = format!("bytes */0");
            write_416(&mut stream, &cr, &etag)
        }
        Some((start, _)) if start >= len as u64 => {
            let cr = format!("bytes */{}", len);
            write_416(&mut stream, &cr, &etag)
        }
        Some((start, end)) => {
            let end = (end + 1).min(len as u64);
            let slice = &data[start as usize..end as usize];
            let cr = format!("bytes {}-{}/{}", start, end - 1, len);
            // Optional delay to make pause/resume deterministic.
            if delay_ms > 0 {
                let mut sent = 0usize;
                let chunk = 32 * 1024;
                let head = format!(
                    "HTTP/1.1 206 Partial Content\r\nContent-Type: application/octet-stream\r\nContent-Range: {}\r\nETag: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    cr, etag, slice.len()
                );
                stream.write_all(head.as_bytes())?;
                while sent < slice.len() {
                    let take = chunk.min(slice.len() - sent);
                    stream.write_all(&slice[sent..sent + take])?;
                    stream.flush()?;
                    sent += take;
                    std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                }
                Ok(())
            } else {
                write_response_partial(&mut stream, slice, &cr, &etag)
            }
        }
        None => {
            if len == 0 {
                write_response(&mut stream, 200, &[], None, &etag)
            } else {
                write_response(&mut stream, 200, &data, None, &etag)
            }
        }
    }
}

fn write_416(stream: &mut TcpStream, content_range: &str, etag: &str) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: {}\r\nETag: {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        content_range, etag
    );
    stream.write_all(head.as_bytes())?;
    stream.flush()
}

fn write_response(
    stream: &mut TcpStream,
    status: u16,
    body: &[u8],
    _extra: Option<&str>,
    etag: &str,
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        503 => "Service Unavailable",
        _ => "Unknown",
    };
    let head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/octet-stream\r\nETag: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status,
        reason,
        etag,
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

fn write_response_partial(
    stream: &mut TcpStream,
    body: &[u8],
    content_range: &str,
    etag: &str,
) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 206 Partial Content\r\nContent-Type: application/octet-stream\r\nContent-Range: {}\r\nETag: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        content_range,
        etag,
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}
