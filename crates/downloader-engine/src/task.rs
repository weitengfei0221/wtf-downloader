// Task state machine (ARCHITECTURE section 1.2). All status changes must go
// through TaskCore::transition; direct field assignment elsewhere is a
// contract violation.

#[cfg(test)]
mod tests;

use crate::protocol::{EngineError, EngineEvent, TaskId, TaskStatus};
use tokio::sync::mpsc;

/// Sink used by the state machine (and the engine) to export lifecycle
/// events onto the unbounded channel. Cloneable and shareable.
#[derive(Clone)]
pub struct EventSink {
    tx: mpsc::UnboundedSender<EngineEvent>,
}

impl EventSink {
    pub fn new(tx: mpsc::UnboundedSender<EngineEvent>) -> Self {
        Self { tx }
    }

    /// Send fails only when the receiver was dropped (no listener left);
    /// dropping the event is correct in that case.
    pub fn emit(&self, event: EngineEvent) {
        let _ = self.tx.send(event);
    }
}

/// Per-task in-memory core. Shared as Arc<TaskHandle> wrapping this plus
/// runtime handles (see http/mod.rs).
pub struct TaskCore {
    pub id: TaskId,
    pub status: TaskStatus,
    pub error: Option<String>,
    /// Count of times this task entered the failed state (persisted).
    pub retry_count: u32,
    /// Remaining task-level retry budget guarding split-induced retries.
    pub retry_budget: u32,
}

impl TaskCore {
    pub fn new(id: TaskId) -> Self {
        Self {
            id,
            status: TaskStatus::Pending,
            error: None,
            retry_count: 0,
            retry_budget: crate::consts::TASK_RETRY_BUDGET,
        }
    }

    /// Legal transition table, locked to the Spec section 6 state machine:
    /// pending -> downloading; downloading -> paused/failed/completed;
    /// paused -> downloading/failed; failed -> pending.
    /// Removal is a row deletion, not a status.
    pub fn is_legal(from: TaskStatus, to: TaskStatus) -> bool {
        use TaskStatus::*;
        matches!(
            (from, to),
            (Pending, Downloading)
                | (Pending, Failed)
                | (Downloading, Paused)
                | (Downloading, Failed)
                | (Downloading, Completed)
                | (Paused, Downloading)
                | (Paused, Failed)
                | (Failed, Pending)
        )
    }

    /// The single transition entry point. Validates the move, mutates
    /// in-memory state, and emits StateChanged on the shared event sink.
    /// The DB write (L1) is performed by the caller after this returns.
    ///
    /// `code` is the machine-readable identity of a failure (see
    /// `protocol::CODE_RESUME_CONFLICT`); it is emitted alongside the message
    /// so consumers never have to parse user-facing text. Callers that have no
    /// code pass `None`.
    ///
    /// Contract enforced here: `code` is failure-only and never empty. Any
    /// non-`Failed` transition drops it, and an empty string is normalized to
    /// `None` - consumers treat "code present" as authoritative ("if there is
    /// a code it decides, the text cannot override it"), so a stray `Some("")`
    /// would silently mean "not a resume conflict".
    pub fn transition(
        &mut self,
        to: TaskStatus,
        events: &EventSink,
        error: Option<String>,
        code: Option<&'static str>,
    ) -> Result<(), EngineError> {
        let from = self.status;
        if !Self::is_legal(from, to) {
            return Err(EngineError::Engine(format!(
                "illegal state transition {} -> {} for task {}",
                from.as_str(),
                to.as_str(),
                self.id
            )));
        }
        self.status = to;
        // Failure-only, never empty: an empty code would read as "a code is
        // present but it is not the one you are looking for" on the consumer
        // side and silently suppress the recovery prompt.
        let failure_code = if to == TaskStatus::Failed {
            code.filter(|c| !c.is_empty()).map(str::to_string)
        } else {
            None
        };
        events.emit(EngineEvent::StateChanged {
            task_id: self.id.clone(),
            from,
            to,
            error: if to == TaskStatus::Failed { error.clone() } else { None },
            code: failure_code,
        });
        self.error = if to == TaskStatus::Failed { error } else { None };
        if to == TaskStatus::Failed {
            self.retry_count = self.retry_count.saturating_add(1);
        }
        Ok(())
    }
}
