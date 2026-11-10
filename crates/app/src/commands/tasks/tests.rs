// Command-layer validation tests (pure functions; no AppHandle needed).

use super::*;

#[test]
fn url_validation_accepts_http_and_https() {
    assert!(validate_url_arg("http://example.com/f.zip").is_ok());
    assert!(validate_url_arg("https://example.com/f.zip").is_ok());
}

#[test]
fn url_validation_rejects_bad_input() {
    for bad in [
        "not a url",
        "ftp://example.com/f.zip",
        "file:///C:/x",
        "",
        "example.com/f.zip",
    ] {
        let err = validate_url_arg(bad).unwrap_err();
        assert_eq!(err.code, "invalid_url", "input: {}", bad);
        assert!(!err.message.is_empty());
    }
}

#[test]
fn limit_validation_bounds() {
    assert!(validate_limit(None).is_ok());
    assert!(validate_limit(Some(1024)).is_ok());
    assert!(validate_limit(Some(10_000_000)).is_ok());
    let err = validate_limit(Some(1023)).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    assert!(validate_limit(Some(0)).is_err());
}
