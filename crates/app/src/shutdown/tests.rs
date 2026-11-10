// Bounded-shutdown guarantees: the exit path must survive a hung engine, a
// failing engine, and no engine at all. No AppHandle needed here.

use super::*;
use std::time::Instant;

#[tokio::test]
async fn completed_shutdown_reports_completed() {
    let outcome = bounded_shutdown(Duration::from_secs(1), async { Ok::<(), String>(()) }).await;
    assert_eq!(outcome, ShutdownOutcome::Completed);
}

#[tokio::test]
async fn failing_shutdown_still_returns_an_outcome() {
    let outcome =
        bounded_shutdown(Duration::from_secs(1), async { Err::<(), String>("db locked".into()) })
            .await;
    assert_eq!(outcome, ShutdownOutcome::Failed);
}

#[tokio::test]
async fn hung_shutdown_is_abandoned_at_the_budget() {
    let budget = Duration::from_millis(50);
    let started = Instant::now();
    // A runner that never finishes: pause_all/flush hung on IO.
    let outcome = bounded_shutdown(budget, std::future::pending::<Result<(), String>>()).await;
    let elapsed = started.elapsed();
    assert_eq!(outcome, ShutdownOutcome::TimedOut);
    // Bounded by the budget, not by the stuck future.
    assert!(elapsed >= budget, "returned too early: {elapsed:?}");
    assert!(elapsed < Duration::from_secs(2), "budget not enforced: {elapsed:?}");
}

#[test]
fn budget_is_five_seconds() {
    // Product requirement: a hung engine may delay the exit by at most 5s.
    assert_eq!(SHUTDOWN_BUDGET, Duration::from_secs(5));
}

#[test]
fn outcomes_have_plain_text_labels() {
    // Diagnostics are log text, but keep them ASCII/plain per project rules.
    for (outcome, label) in [
        (ShutdownOutcome::Completed, "completed"),
        (ShutdownOutcome::Failed, "engine error"),
        (ShutdownOutcome::TimedOut, "timed out"),
        (ShutdownOutcome::NoEngine, "no engine state"),
    ] {
        assert_eq!(outcome.as_str(), label);
        assert!(label.is_ascii(), "non-ascii label: {label}");
    }
}
