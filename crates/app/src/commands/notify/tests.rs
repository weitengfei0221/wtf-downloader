// Notification command tests. No toast is shown and no shell call happens:
// every case either fails validation or is a pure string assertion.

use super::*;

#[test]
fn rejects_empty_title() {
    for blank in ["", "   ", "\t\n"] {
        let err = normalize_notification(blank, "正文").unwrap_err();
        assert_eq!(err.code, "invalid_argument");
        assert!(err.message.contains("标题"));
    }
}

#[test]
fn rejects_empty_body() {
    for blank in ["", " ", "\r\n"] {
        let err = normalize_notification("标题", blank).unwrap_err();
        assert_eq!(err.code, "invalid_argument");
        assert!(err.message.contains("正文"));
    }
}

#[test]
fn rejects_nul_byte() {
    let err = normalize_notification("标题", "a\0b").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn trims_surrounding_whitespace() {
    let (title, body) = normalize_notification("  完成  ", "\n 文件已下载 \t").unwrap();
    assert_eq!(title, "完成");
    assert_eq!(body, "文件已下载");
}

#[test]
fn truncates_overlong_body_on_char_boundary() {
    // Multi-byte characters: a byte-wise cut would panic, a char-wise cut must
    // land exactly on the limit and stay valid UTF-8.
    let long = "下".repeat(BODY_MAX_CHARS + 50);
    let (_, body) = normalize_notification("标题", &long).unwrap();
    assert_eq!(body.chars().count(), BODY_MAX_CHARS);
    assert!(body.chars().all(|c| c == '下'));
}

#[test]
fn truncates_overlong_title() {
    let long = "x".repeat(TITLE_MAX_CHARS + 1);
    let (title, _) = normalize_notification(&long, "正文").unwrap();
    assert_eq!(title.chars().count(), TITLE_MAX_CHARS);
}

#[test]
fn keeps_short_input_verbatim() {
    let (title, body) = normalize_notification("下载完成", "ubuntu.iso 已保存到下载目录").unwrap();
    assert_eq!(title, "下载完成");
    assert_eq!(body, "ubuntu.iso 已保存到下载目录");
}
