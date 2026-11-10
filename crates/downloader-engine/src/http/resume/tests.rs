use super::*;

fn seg(start: u64, end: u64, downloaded: u64) -> SegmentRow {
    SegmentRow {
        task_id: "t".into(),
        seg_index: 0,
        start_byte: start,
        end_byte: end,
        downloaded_bytes: downloaded,
    }
}

fn probe(etag: Option<&str>, lm: Option<&str>, total: Option<u64>) -> ResumeProbe {
    ResumeProbe {
        status: 206,
        etag: etag.map(|s| s.to_string()),
        last_modified: lm.map(|s| s.to_string()),
        total,
        final_url: "http://x/f.zip".into(),
    }
}

/// The five-branch triple comparison table from ARCHITECTURE section 1.4.
#[test]
fn triple_table_branches() {
    let lm = Some("Wed, 21 Oct 2026 07:28:00 GMT");
    let total = Some(1024u64);

    // Branch 1: both ETags present, equal, Last-Modified equal -> Continue.
    assert!(matches!(
        validate_resume(Some("\"v1\""), lm, total, 100, &probe(Some("\"v1\""), lm, total)),
        ResumeDecision::Continue { .. }
    ));

    // Branch 1 violation: ETags differ -> Conflict.
    assert!(matches!(
        validate_resume(Some("\"v1\""), lm, total, 100, &probe(Some("\"v2\""), lm, total)),
        ResumeDecision::Conflict(_)
    ));

    // Branch 2: record has ETag, response lacks it, LM matches -> Continue.
    assert!(matches!(
        validate_resume(Some("\"v1\""), lm, total, 100, &probe(None, lm, total)),
        ResumeDecision::Continue { .. }
    ));

    // Branch 3: record lacks ETag, response has one -> Continue + backfill.
    match validate_resume(None, lm, total, 100, &probe(Some("\"v9\""), lm, total)) {
        ResumeDecision::Continue { backfill_etag, .. } => {
            assert_eq!(backfill_etag.as_deref(), Some("\"v9\""));
        }
        other => panic!("expected Continue, got {:?}", other),
    }

    // Branch 4: no ETags anywhere, LM matches -> Continue (weak guarantee).
    assert!(matches!(
        validate_resume(None, lm, total, 100, &probe(None, lm, total)),
        ResumeDecision::Continue { .. }
    ));

    // Branch 5: Last-Modified differs -> Conflict, even with equal ETags.
    assert!(matches!(
        validate_resume(
            Some("\"v1\""),
            lm,
            total,
            100,
            &probe(Some("\"v1\""), Some("Thu, 01 Jan 2027 00:00:00 GMT"), total)
        ),
        ResumeDecision::Conflict(_)
    ));
}

#[test]
fn total_mismatch_conflicts_even_without_etag() {
    let r = validate_resume(None, None, Some(2048), 100, &probe(None, None, Some(1024)));
    assert!(matches!(r, ResumeDecision::Conflict(_)));
}

#[test]
fn unknown_probe_total_does_not_conflict() {
    // Content-Range "bytes 0-0/*": nothing comparable.
    let r = validate_resume(Some("\"v1\""), None, Some(2048), 100, &probe(Some("\"v1\""), None, None));
    assert!(matches!(r, ResumeDecision::Continue { .. }));
}

#[test]
fn response_200_with_progress_is_conflict() {
    let p = ResumeProbe { status: 200, etag: None, last_modified: None, total: None, final_url: "u".into() };
    let r = validate_resume(Some("\"v1\""), None, Some(10), 5, &p);
    assert!(matches!(r, ResumeDecision::Conflict(_)));
}

#[test]
fn response_200_without_progress_restarts_fresh() {
    let p = ResumeProbe { status: 200, etag: None, last_modified: None, total: None, final_url: "http://new".into() };
    match validate_resume(None, None, None, 0, &p) {
        ResumeDecision::RestartFresh { final_url } => assert_eq!(final_url, "http://new"),
        other => panic!("expected RestartFresh, got {:?}", other),
    }
}

#[test]
fn final_url_change_still_continues() {
    let p = ResumeProbe {
        status: 206,
        etag: Some("\"v1\"".into()),
        last_modified: None,
        total: Some(1024),
        final_url: "http://signed-new-url/f.zip".into(),
    };
    match validate_resume(Some("\"v1\""), None, Some(1024), 10, &p) {
        ResumeDecision::Continue { final_url, .. } => {
            assert_eq!(final_url, "http://signed-new-url/f.zip")
        }
        other => panic!("expected Continue, got {:?}", other),
    }
}

#[test]
fn part_file_check_branches() {
    // Fresh: no progress recorded.
    assert_eq!(check_part_file(Some(0), &[seg(0, 1023, 0)]), PartFileCheck::Fresh);
    assert_eq!(check_part_file(None, &[seg(0, 1023, 0)]), PartFileCheck::Fresh);
    // Ok: part covers the highest written prefix.
    assert_eq!(check_part_file(Some(1024), &[seg(0, 511, 512), seg(512, 1023, 100)]), PartFileCheck::Ok);
    // Degraded (no prealloc) mode: len == highest offset written, accepted.
    assert_eq!(check_part_file(Some(612), &[seg(0, 511, 512), seg(512, 1023, 100)]), PartFileCheck::Ok);
    // Reset: part shorter than recorded progress.
    assert_eq!(check_part_file(Some(100), &[seg(0, 511, 512)]), PartFileCheck::Reset);
    // Reset: part missing entirely with progress.
    assert_eq!(check_part_file(None, &[seg(0, 511, 512)]), PartFileCheck::Reset);
}

#[test]
fn handle_416_branches() {
    assert_eq!(handle_416(1024, Some(1024)), RangeInvalidAction::MarkDone);
    assert_eq!(handle_416(2000, Some(1024)), RangeInvalidAction::MarkDone);
    assert_eq!(handle_416(0, Some(1024)), RangeInvalidAction::ResetSegment);
    assert_eq!(handle_416(512, Some(1024)), RangeInvalidAction::ResetSegment);
    assert_eq!(handle_416(512, None), RangeInvalidAction::ResetSegment);
}

#[test]
fn content_range_parsing() {
    assert_eq!(parse_content_range_total(Some("bytes 0-0/12345")), Some(12345));
    assert_eq!(parse_content_range_total(Some("bytes */12345")), Some(12345));
    assert_eq!(parse_content_range_total(Some("bytes 0-0/*")), None);
    assert_eq!(parse_content_range_total(Some("garbage")), None);
    assert_eq!(parse_content_range_total(None), None);
}
