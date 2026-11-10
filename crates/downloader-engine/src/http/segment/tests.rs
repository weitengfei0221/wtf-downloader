use super::*;

/// Coverage property: segments exactly tile [0, total) without gaps or
/// overlaps, and indexes are 0..n.
fn assert_tiling(specs: &[SegmentSpec], total: u64) {
    assert!(!specs.is_empty());
    let covered: u64 = specs.iter().map(|s| s.end_byte - s.start_byte + 1).sum();
    assert_eq!(covered, total, "coverage must equal total exactly");
    assert_eq!(specs[0].start_byte, 0);
    assert_eq!(specs.last().unwrap().end_byte, total - 1);
    for pair in specs.windows(2) {
        assert_eq!(pair[0].end_byte + 1, pair[1].start_byte, "segments must be contiguous");
    }
    for (i, s) in specs.iter().enumerate() {
        assert_eq!(s.index, i as u32);
        assert!(s.start_byte <= s.end_byte);
    }
}

#[test]
fn zero_byte_file_plans_no_segments() {
    assert!(plan_segments(Some(0), true, 8).is_empty());
}

#[test]
fn unknown_length_plans_single_streaming_segment() {
    let specs = plan_segments(None, true, 8);
    assert_eq!(specs.len(), 1);
    assert_eq!(specs[0].start_byte, 0);
    assert_eq!(specs[0].end_byte, UNKNOWN_END_BYTE);
    // Even with Range unsupported it is a single segment.
    assert_eq!(plan_segments(Some(1024), false, 8).len(), 1);
    assert_eq!(plan_segments(Some(1024), false, 8)[0].end_byte, 1023);
}

#[test]
fn small_file_reduces_segment_count() {
    // 20 MB with 8 configured: ceil(20/8) = 3 segments (Spec section 10).
    let specs = plan_segments(Some(20 * 1024 * 1024), true, 8);
    assert_eq!(specs.len(), 3);
    assert_tiling(&specs, 20 * 1024 * 1024);

    // Below MIN_SEGMENT_BYTES entirely: a single segment.
    let specs = plan_segments(Some(MIN_SEGMENT_BYTES - 1), true, 16);
    assert_eq!(specs.len(), 1);
    assert_tiling(&specs, MIN_SEGMENT_BYTES - 1);
}

#[test]
fn exactly_min_segment_bytes_is_one_segment() {
    let specs = plan_segments(Some(MIN_SEGMENT_BYTES), true, 8);
    assert_eq!(specs.len(), 1);
    assert_tiling(&specs, MIN_SEGMENT_BYTES);
}

#[test]
fn min_segment_bytes_plus_one_is_two_segments() {
    let total = MIN_SEGMENT_BYTES + 1;
    let specs = plan_segments(Some(total), true, 8);
    assert_eq!(specs.len(), 2);
    assert_tiling(&specs, total);
    // Base size is floor(total/2); the last segment absorbs the remainder.
    let base = total / 2;
    assert_eq!(specs[0].end_byte - specs[0].start_byte + 1, base);
    assert_eq!(specs[1].end_byte - specs[1].start_byte + 1, total - base);
}

#[test]
fn large_file_respects_max_segments() {
    let total: u64 = 10 * 1024 * 1024 * 1024;
    for max in [1u8, 2, 8, 16] {
        let specs = plan_segments(Some(total), true, max);
        assert_eq!(specs.len() as u64, max as u64);
        assert_tiling(&specs, total);
    }
}

#[test]
fn every_segment_meets_min_size_when_unconstrained() {
    // An exact multiple of MIN: every planned segment is at least MIN.
    // (A non-multiple like 100 MB legitimately plans base segments just
    // below MIN under the locked n = ceil(total/MIN) formula, see
    // min_segment_bytes_plus_one_is_two_segments.)
    let total: u64 = 96 * 1024 * 1024;
    let specs = plan_segments(Some(total), true, 64);
    assert_eq!(specs.len() as u64, total.div_ceil(MIN_SEGMENT_BYTES));
    for s in &specs {
        assert!(s.end_byte - s.start_byte + 1 >= MIN_SEGMENT_BYTES);
    }
}

#[test]
fn claim_and_settle_semantics() {
    let specs = plan_segments(Some(MIN_SEGMENT_BYTES * 2), true, 4);
    let mut jobs: Vec<SegmentJob> = specs.iter().map(SegmentJob::from_spec).collect();
    assert!(!all_settled(&jobs));
    assert_eq!(claim_next(&mut jobs), Some(0));
    assert_eq!(claim_next(&mut jobs), Some(1));
    // No more pending: later claims return None even with Running jobs.
    assert_eq!(claim_next(&mut jobs), None);
    jobs[0].state = JobState::Done;
    jobs[1].state = JobState::Done;
    assert!(all_settled(&jobs));
}

#[test]
fn split_covers_remaining_range_exactly() {
    // 2 x 16 MB segments: the first has a remaining range (>= MIN) to split
    // after some progress; the second sibling must stay untouched.
    let specs = plan_segments(Some(MIN_SEGMENT_BYTES * 4), true, 2);
    let mut jobs: Vec<SegmentJob> = specs.iter().map(SegmentJob::from_spec).collect();
    jobs[0].downloaded = 1024;
    let parent_orig_len = jobs[0].end_byte - jobs[0].start_byte + 1;
    let sibling_len = jobs[1].end_byte - jobs[1].start_byte + 1;
    let downloaded_before = 1024u64;

    let (a, b) = split_job(&mut jobs, 0, MIN_SEGMENT_BYTES).expect("splittable");
    let parent = &jobs[0];
    assert_eq!(parent.state, JobState::Split);
    assert_eq!(parent.end_byte, parent.start_byte + downloaded_before - 1);
    // Children tile [downloaded, original end).
    let ja = &jobs[a];
    let jb = &jobs[b];
    assert_eq!(ja.start_byte, parent.start_byte + downloaded_before);
    assert_eq!(ja.end_byte + 1, jb.start_byte);
    // Coverage conservation: parent (written part) + children (remaining) == original.
    let covered = (parent.end_byte - parent.start_byte + 1)
        + (ja.end_byte - ja.start_byte + 1)
        + (jb.end_byte - jb.start_byte + 1);
    assert_eq!(covered, parent_orig_len);
    assert_eq!(sibling_len, jobs[1].end_byte - jobs[1].start_byte + 1);
}

#[test]
fn split_refuses_small_remaining() {
    let specs = plan_segments(Some(MIN_SEGMENT_BYTES * 2), true, 2);
    let mut jobs: Vec<SegmentJob> = specs.iter().map(SegmentJob::from_spec).collect();
    // Almost complete: remaining < threshold.
    jobs[0].downloaded = jobs[0].end_byte - jobs[0].start_byte + 1 - 1024;
    assert!(split_job(&mut jobs, 0, MIN_SEGMENT_BYTES).is_none());
    // Fully complete: nothing to split.
    jobs[0].downloaded = jobs[0].end_byte - jobs[0].start_byte + 1;
    assert!(split_job(&mut jobs, 0, MIN_SEGMENT_BYTES).is_none());
}

#[test]
fn split_with_zero_downloaded_keeps_parent_empty() {
    let specs = plan_segments(Some(MIN_SEGMENT_BYTES * 2), true, 2);
    let mut jobs: Vec<SegmentJob> = specs.iter().map(SegmentJob::from_spec).collect();
    let (a, _) = split_job(&mut jobs, 0, MIN_SEGMENT_BYTES).expect("splittable");
    let parent = &jobs[0];
    assert_eq!(parent.end_byte, parent.start_byte, "empty parent range");
    assert_eq!(jobs[a].start_byte, parent.start_byte, "children start where parent did");
}
