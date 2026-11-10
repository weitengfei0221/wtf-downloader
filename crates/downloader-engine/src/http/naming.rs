// Filename handling: sanitization, same-name protection, and inference
// from URL / Content-Disposition (ARCHITECTURE section 1.5 rules 1).

#[cfg(test)]
mod tests;

use std::path::Path;

/// Strip characters that are invalid in a filename on Windows targets:
/// path separators, control characters, reserved punctuation, plus leading
/// and trailing dots/spaces. Returns "download" when nothing survives.
pub fn sanitize_filename(name: &str) -> String {
    let mut out: String = name
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    // Windows silently drops trailing dots and spaces (and strips leading
    // ones when resolving): drop them explicitly on both ends.
    while out.ends_with('.') || out.ends_with(' ') {
        out.pop();
    }
    while out.starts_with('.') || out.starts_with(' ') {
        out.remove(0);
    }
    // Reasonable length guard (NTFS path component limit is 255).
    if out.chars().count() > 200 {
        out = out.chars().take(200).collect();
    }
    if out.is_empty() {
        "download".to_string()
    } else {
        out
    }
}

/// Same-name protection: if the target file (or a stale .part for it)
/// already exists in `dir`, append " (1)", " (2)", ... before the extension.
/// Never overwrites user files.
pub fn dedupe_filename(dir: &Path, filename: &str) -> String {
    let taken = |name: &str| dir.join(name).exists() || with_part_suffix(dir, name).exists();
    if !taken(filename) {
        return filename.to_string();
    }
    let (stem, ext) = match filename.rfind('.') {
        Some(pos) if pos > 0 => (&filename[..pos], &filename[pos..]),
        _ => (filename, ""),
    };
    for n in 1..10_000u32 {
        let candidate = format!("{} ({}){}", stem, n, ext);
        if !taken(&candidate) {
            return candidate;
        }
    }
    // Practically unreachable; keep a deterministic fallback.
    format!("{} ({})", stem, uuid::Uuid::new_v4().simple())
}

pub fn part_path(dir: &Path, filename: &str) -> std::path::PathBuf {
    dir.join(format!("{}.part", filename))
}

fn with_part_suffix(dir: &Path, name: &str) -> std::path::PathBuf {
    part_path(dir, name)
}

/// Infer a filename from a URL: last path segment, percent-decoded.
pub fn filename_from_url(url: &str) -> Option<String> {
    let path = url::Url::parse(url).ok()?.path().to_string();
    let last = path.rsplit('/').next()?.trim();
    if last.is_empty() || last == "." || last == ".." {
        return None;
    }
    let decoded = percent_decode(last);
    let clean = sanitize_filename(&decoded);
    if clean.is_empty() || clean == "download" && decoded != "download" {
        return None;
    }
    Some(clean)
}

/// Parse a Content-Disposition header for filename / filename* (RFC 6266).
/// Raw names carrying path separators or traversal segments are rejected
/// outright (None) rather than mangled: a header is untrusted input and a
/// mangled-but-accepted name is worse than falling back to URL inference.
pub fn filename_from_content_disposition(value: &str) -> Option<String> {
    fn is_traversal(name: &str) -> bool {
        let t = name.trim_matches('"').trim();
        t.contains('/') || t.contains('\\') || t == "." || t == ".."
    }
    for part in value.split(';') {
        let part = part.trim();
        if let Some(rest) = part.strip_prefix("filename*=") {
            // filename*=UTF-8''%e4%b8%ad.zip
            if let Some(encoded) = rest.split("''").nth(1) {
                if is_traversal(encoded) {
                    return None;
                }
                let decoded = percent_decode(encoded);
                let clean = sanitize_filename(&decoded);
                if !clean.is_empty() {
                    return Some(clean);
                }
            }
        } else if let Some(rest) = part.strip_prefix("filename=") {
            if is_traversal(rest) {
                return None;
            }
            let name = rest.trim_matches('"').trim();
            let clean = sanitize_filename(name);
            if !clean.is_empty() && clean != "download" {
                return Some(clean);
            }
        }
    }
    None
}

/// Minimal RFC 3986 percent-decoding (UTF-8 passthrough on invalid escapes).
pub fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |b: u8| (b as char).to_digit(16);
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
