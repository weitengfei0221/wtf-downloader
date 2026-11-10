use super::*;
use crate::consts::CHUNK_BYTES;
use std::time::Instant;

/// Finer token granularity for the low-rate tests: at 256 KB/s a 256 KB
/// chunk is admitted only once per second, which makes a 1.5 s window
/// quantize to +-33 percent. 16 KB tokens keep the limiter logic identical
/// while shrinking the measurement error below 5 percent.
const FINE_TOKEN: u32 = 16 * 1024;

/// Consume the pre-filled burst credit so the measured window starts in
/// steady state. The burst (clamp(bps/4, 256KB, 1MB), ARCHITECTURE 1.6.4)
/// is a bounded one-second transient by design; AC-12's window applies
/// after the <= 1 s convergence.
async fn settle(reg: &ThrottleRegistry, task: &str, token: u32, ms: u64) {
    let end = Instant::now() + Duration::from_millis(ms);
    while Instant::now() < end {
        reg.acquire(task, token).await;
    }
}

#[test]
fn backoff_delay_progression_is_capped() {
    assert_eq!(backoff_delay(0), Duration::from_millis(500));
    assert_eq!(backoff_delay(1), Duration::from_millis(1000));
    assert_eq!(backoff_delay(2), Duration::from_millis(2000));
    assert_eq!(backoff_delay(3), Duration::from_millis(4000));
    assert_eq!(backoff_delay(4), Duration::from_millis(8000));
    assert_eq!(backoff_delay(5), Duration::from_millis(8000), "cap at 8s");
    assert_eq!(backoff_delay(9), Duration::from_millis(8000), "shift clamped");
}

/// AC-12, engine side: with a 512 KB/s limit, bytes admitted in a 2s window
/// must land within the target (512KB) plus/minus 10 percent.
#[tokio::test]
async fn throttle_converges_within_10_percent() {
    let reg = ThrottleRegistry::new();
    reg.set_global(Some(512 * 1024));
    // Drain the initial burst credit (<= 1 s convergence by design).
    settle(&reg, "t1", CHUNK_BYTES as u32, 1200).await;

    let start = Instant::now();
    let mut admitted: u64 = 0;
    // Pull chunks as fast as the limiter allows for ~2 seconds.
    while start.elapsed() < Duration::from_millis(2000) {
        reg.acquire("t1", CHUNK_BYTES as u32).await;
        admitted += CHUNK_BYTES as u64;
    }
    let elapsed = start.elapsed().as_secs_f64();
    let rate = admitted as f64 / elapsed;
    let target = 512.0 * 1024.0;
    assert!(
        rate >= target * 0.90 && rate <= target * 1.10,
        "rate {} outside {} +/- 10 percent",
        rate,
        target
    );
}

/// Per-task limit stacks with the global limit; the slower layer wins.
#[tokio::test]
async fn task_limit_stacks_with_global() {
    let reg = ThrottleRegistry::new();
    reg.set_global(Some(10 * 1024 * 1024));
    reg.set_task(&"t1".to_string(), Some(256 * 1024));
    settle(&reg, "t1", FINE_TOKEN, 1200).await;

    let start = Instant::now();
    let mut admitted: u64 = 0;
    while start.elapsed() < Duration::from_millis(1500) {
        reg.acquire("t1", FINE_TOKEN).await;
        admitted += FINE_TOKEN as u64;
    }
    let rate = admitted as f64 / start.elapsed().as_secs_f64();
    let target = 256.0 * 1024.0;
    assert!(
        rate <= target * 1.15 && rate >= target * 0.80,
        "task limit must dominate: rate {} vs target {}",
        rate,
        target
    );
}

/// Removing the task limit lifts only that layer; global stays in force.
#[tokio::test]
async fn removing_task_limit_keeps_global() {
    let reg = ThrottleRegistry::new();
    reg.set_global(Some(300 * 1024));
    reg.set_task(&"t1".to_string(), Some(1024 * 1024 * 1024));
    reg.set_task(&"t1".to_string(), None);
    settle(&reg, "t1", FINE_TOKEN, 1200).await;

    let start = Instant::now();
    let mut admitted: u64 = 0;
    while start.elapsed() < Duration::from_millis(1200) {
        reg.acquire("t1", FINE_TOKEN).await;
        admitted += FINE_TOKEN as u64;
    }
    let rate = admitted as f64 / start.elapsed().as_secs_f64();
    let target = 300.0 * 1024.0;
    assert!(
        rate <= target * 1.15 && rate >= target * 0.80,
        "global limit must still hold, rate {}",
        rate
    );
}

/// Unset global limit means acquire never blocks.
#[tokio::test]
async fn no_limit_does_not_block() {
    let reg = ThrottleRegistry::new();
    let start = Instant::now();
    for _ in 0..64 {
        reg.acquire("t1", CHUNK_BYTES as u32).await;
    }
    assert!(start.elapsed() < Duration::from_millis(500), "unlimited acquire must not block");
}
