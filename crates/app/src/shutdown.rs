// Graceful exit orchestration (ARCHITECTURE section 3.4). The tray "quit"
// item and the direct window-close path share one bounded shutdown so the
// process always terminates, even when a download runner refuses to wind down.

#[cfg(test)]
mod tests;

use crate::state::AppState;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Hard ceiling for the whole graceful stop. Whatever the engine is doing
/// (stuck runner, slow snapshot flush), the exit fires once this elapses.
pub const SHUTDOWN_BUDGET: Duration = Duration::from_secs(5);

/// Only one exit sequence may run: a second trigger while the first shutdown
/// is in flight must not call into the engine again.
static EXIT_STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShutdownOutcome {
    /// Runners paused and snapshots flushed inside the budget.
    Completed,
    /// Engine reported an error; the process exits anyway.
    Failed,
    /// Budget exhausted; the process exits anyway.
    TimedOut,
    /// No engine in state (setup never completed); nothing to stop.
    NoEngine,
}

impl ShutdownOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            ShutdownOutcome::Completed => "completed",
            ShutdownOutcome::Failed => "engine error",
            ShutdownOutcome::TimedOut => "timed out",
            ShutdownOutcome::NoEngine => "no engine state",
        }
    }
}

/// Await the engine shutdown future for at most `budget`. Every outcome is
/// returned, never propagated: the caller exits on all of them.
pub async fn bounded_shutdown<F, E>(budget: Duration, shutdown: F) -> ShutdownOutcome
where
    F: Future<Output = Result<(), E>>,
    E: std::fmt::Display,
{
    match tokio::time::timeout(budget, shutdown).await {
        Ok(Ok(())) => ShutdownOutcome::Completed,
        Ok(Err(err)) => {
            log(&format!("engine shutdown failed: {err}"));
            ShutdownOutcome::Failed
        }
        Err(_) => {
            log(&format!(
                "engine shutdown exceeded {budget:?}, exiting without waiting further"
            ));
            ShutdownOutcome::TimedOut
        }
    }
}

/// Start the single bounded exit sequence. Returns immediately; the process
/// is gone within `SHUTDOWN_BUDGET` (plus scheduling slack) regardless of the
/// engine's state. `reason` only labels the diagnostic line.
pub fn begin_exit(app: &AppHandle, reason: &str) {
    if EXIT_STARTED.swap(true, Ordering::SeqCst) {
        log(&format!("exit already in progress, duplicate request ({reason}) ignored"));
        return;
    }
    let app = app.clone();
    let reason = reason.to_string();
    tauri::async_runtime::spawn(async move {
        let engine = app.try_state::<AppState>().map(|state| state.engine.clone());
        let outcome = match engine {
            Some(engine) => bounded_shutdown(SHUTDOWN_BUDGET, engine.shutdown()).await,
            None => ShutdownOutcome::NoEngine,
        };
        log(&format!("exit ({reason}): shutdown {}", outcome.as_str()));
        app.exit(0);
    });
}

/// Non-panicking diagnostics: a release GUI build has no console attached, so
/// a failing write must never abort the sequence before `app.exit` runs.
fn log(line: &str) {
    use std::io::Write;
    let _ = writeln!(std::io::stderr(), "[wtf-downloader] {line}");
}
