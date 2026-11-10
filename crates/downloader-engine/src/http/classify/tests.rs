use super::*;

#[test]
fn status_classification() {
    // Retryable.
    for s in [408, 429, 500, 502, 503, 504] {
        match classify_status(s, None) {
            Failure::Retryable { .. } => {}
            other => panic!("{} should be retryable, got {:?}", s, other),
        }
    }
    // Fatal 4xx.
    for s in [400, 401, 403, 404, 405, 410, 451] {
        match classify_status(s, None) {
            Failure::Fatal { .. } => {}
            other => panic!("{} should be fatal, got {:?}", s, other),
        }
    }
    // 416 special.
    assert!(matches!(classify_status(416, None), Failure::InvalidRange));
}

#[test]
fn retry_after_parsing() {
    assert_eq!(parse_retry_after("2"), Some(Duration::from_secs(2)));
    assert_eq!(parse_retry_after(" 7 "), Some(Duration::from_secs(7)));
    assert_eq!(parse_retry_after("120"), Some(Duration::from_secs(120)));
    assert_eq!(parse_retry_after("99999"), Some(Duration::from_secs(300)), "clamped");
    assert_eq!(parse_retry_after("Wed, 21 Oct 2026 07:28:00 GMT"), None);
    assert_eq!(parse_retry_after(""), None);
}

#[test]
fn retry_after_raises_backoff_floor() {
    let base = effective_backoff(0, None);
    assert_eq!(base, Duration::from_millis(500));
    let raised = effective_backoff(0, Some(Duration::from_secs(2)));
    assert_eq!(raised, Duration::from_secs(2));
    // Smaller Retry-After than the computed backoff: keep the backoff.
    let kept = effective_backoff(3, Some(Duration::from_millis(100)));
    assert_eq!(kept, Duration::from_millis(4000));
}

#[tokio::test]
async fn reqwest_errors_are_retryable() {
    // Connection refused on a reserved port: a transport-class error.
    // no_proxy() keeps the test deterministic on machines with a system
    // proxy configured (a proxy would answer instead of refusing).
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let e = client
        .get("http://127.0.0.1:1/")
        .send()
        .await
        .expect_err("expected error");
    match classify_reqwest(&e) {
        Failure::Retryable { message, retry_after } => {
            assert!(retry_after.is_none());
            // Refused connection on a loopback port is deterministic: no DNS,
            // no proxy (no_proxy above), the OS answers with RST, so the
            // mapping must land on the connect class.
            assert_eq!(message, "无法建立连接（connect）");
        }
        other => panic!("transport error must be retryable, got {:?}", other),
    }
}

#[test]
fn transport_message_maps_each_flag_to_its_own_sentence() {
    // Exactly one flag set: each class gets a distinct, self-describing copy.
    assert_eq!(transport_message(true, false, false, false), "连接超时（timeout）");
    assert_eq!(transport_message(false, true, false, false), "无法建立连接（connect）");
    assert_eq!(transport_message(false, false, false, true), "响应数据不完整（decode）");
    assert_eq!(transport_message(false, false, true, false), "读取响应中断（body）");
    // No flag set: still Chinese and still tagged, never empty.
    assert_eq!(transport_message(false, false, false, false), "网络错误（other）");
}

#[test]
fn transport_message_prefers_the_most_specific_flag() {
    // reqwest sets is_body for a body that fails to decode too, so decode must
    // win: otherwise a truncated response would be reported as a generic
    // body-read interruption.
    assert_eq!(transport_message(false, false, true, true), "响应数据不完整（decode）");
    // A timeout outranks connect/body/decode.
    assert_eq!(transport_message(true, true, true, true), "连接超时（timeout）");
    // Connect outranks body/decode.
    assert_eq!(transport_message(false, true, true, true), "无法建立连接（connect）");
    // Body still outranks the generic fallback.
    assert_eq!(transport_message(false, false, true, false), "读取响应中断（body）");
}

#[test]
fn transport_message_never_leaks_english_prose() {
    // Guard against a future edit restoring `e.to_string()`: every combination
    // must stay Chinese + tag, and no sentence may contain ASCII letters
    // outside the tag.
    for bits in 0u8..16 {
        let message = transport_message(
            bits & 1 != 0,
            bits & 2 != 0,
            bits & 4 != 0,
            bits & 8 != 0,
        );
        let (sentence, tag_part) =
            message.split_once('（').expect("message must carry a tag");
        assert!(!sentence.is_empty(), "empty sentence for bits {bits}");
        assert!(
            sentence.chars().all(|c| !c.is_ascii_alphabetic()),
            "english sentence for bits {bits}: {message}"
        );
        assert!(tag_part.ends_with('）'), "unterminated tag: {message}");
        let tag = tag_part.trim_end_matches('）');
        assert!(
            tag.chars().all(|c| c.is_ascii_lowercase()),
            "tag must be a bare technical label: {message}"
        );
    }
}
