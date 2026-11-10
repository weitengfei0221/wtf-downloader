// Engine event forwarding (ARCHITECTURE section 3.3): consumes the engine's
// two-channel subscription and maps events onto Tauri emits plus Channel
// frame pushes. Pure mapping logic is factored out for unit tests that do
// not need an AppHandle.

#[cfg(test)]
mod tests;

use crate::state::AppState;
use downloader_engine::protocol::{EngineEvent, TaskStatus};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateChangedPayload {
    pub task_id: String,
    pub from: TaskStatus,
    pub to: TaskStatus,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskIdPayload {
    pub task_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskFailedPayload {
    pub task_id: String,
    pub error: String,
    /// Machine-readable failure identity from the engine (e.g.
    /// `resume_conflict`). Consumers must prefer this over matching the
    /// message text: `error` is user-facing copy and may be reworded.
    /// Omitted entirely when the engine reported no code, so the frontend's
    /// optional-field contract stays honest (absent, never an empty string).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

/// The mapping table (ARCHITECTURE 3.3): one engine lifecycle event maps to
/// one or more (event-name, payload) emit actions. StateChanged additionally
/// appends task:completed / task:failed so the frontend can listen
/// separately for list refresh vs notifications.
pub fn map_lifecycle_event(
    event: &EngineEvent,
) -> Vec<(&'static str, Option<serde_json::Value>)> {
    match event {
        EngineEvent::TaskCreated { task_id } => {
            vec![("task:created", json_payload(&TaskIdPayload { task_id: task_id.clone() }))]
        }
        EngineEvent::TaskRemoved { task_id } => {
            vec![("task:removed", json_payload(&TaskIdPayload { task_id: task_id.clone() }))]
        }
        EngineEvent::StateChanged { task_id, from, to, error, code } => {
            let mut out = vec![(
                "task:state-changed",
                json_payload(&StateChangedPayload {
                    task_id: task_id.clone(),
                    from: *from,
                    to: *to,
                    error: error.clone(),
                }),
            )];
            if *to == TaskStatus::Completed {
                out.push((
                    "task:completed",
                    json_payload(&TaskIdPayload { task_id: task_id.clone() }),
                ));
            }
            if *to == TaskStatus::Failed {
                out.push((
                    "task:failed",
                    json_payload(&TaskFailedPayload {
                        task_id: task_id.clone(),
                        error: error.clone().unwrap_or_default(),
                        code: code.clone(),
                    }),
                ));
            }
            out
        }
        EngineEvent::Progress(_) => vec![],
    }
}

fn json_payload<T: Serialize>(payload: &T) -> Option<serde_json::Value> {
    serde_json::to_value(payload).ok()
}

/// Spawn the forwarding task at setup time. Single consumer of the engine
/// subscription; exits when the engine drops its senders.
pub fn spawn_forwarding(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let subscriber = {
            let state: tauri::State<'_, AppState> = app.state();
            state.engine.subscribe()
        };
        let mut lifecycle = subscriber.lifecycle;
        let mut progress = subscriber.progress;
        loop {
            tokio::select! {
                event = lifecycle.recv() => {
                    let Some(event) = event else { break };
                    for (name, payload) in map_lifecycle_event(&event) {
                        if let Some(payload) = payload {
                            let _ = app.emit(name, payload);
                        }
                    }
                }
                frame = progress.recv() => {
                    let Some(frame) = frame else { continue };
                    let state: tauri::State<'_, AppState> = app.state();
                    state.broadcast_progress(&frame).await;
                }
            }
        }
    });
}
