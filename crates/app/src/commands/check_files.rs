// Batch existence probe for completed tasks' official files (Spec 5.1).
//
// User scenario: the file was deleted OUTSIDE the app (Explorer / cleaner),
// while the task row still says "Completed". "Open file" only reports the
// problem on click (commands/open.rs). This command lets the list detect it
// up front and hand the frontend a set of ids to render de-emphasised.
//
// This is a TRANSIENT, READ-ONLY existence check - NOT a new task state:
//   * no status transition, no TaskRecord / Downloader trait change,
//   * no DB write, no event emission, no file deletion (remove / AC-13
//     untouched: http/ops.rs only clears `.part` of non-Completed tasks, and
//     drops a finished file only when `delete_files` is true).
//
// Surface: reuse the existing `Downloader::list` read path ONCE for the whole
// batch; the "which rows lost their file" decision is a pure function over the
// returned snapshots. No engine-side query capability is added.
//
// Probe paths are derived from engine-owned rows (dir.join(filename)), never
// from the command argument, so the argument cannot steer filesystem access.

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_readonly;
#[cfg(test)]
mod tests_spy;
#[cfg(test)]
mod tests_support;

use crate::commands::error::{AppError, CmdResult};
use crate::state::AppState;
use downloader_engine::protocol::{Downloader, TaskFilter, TaskSnapshot, TaskStatus};
use std::collections::HashSet;
use std::io;
use std::path::Path;
use tauri::State;

/// Pure decision: among `task_ids`, which COMPLETED tasks have no official
/// file at `dir.join(filename)` any more.
///
/// `probe` is injected so unit tests never touch a real filesystem:
///   Ok(())                  -> file present
///   Err(NotFound)           -> file gone -> include the id
///   Err(anything else)      -> inconclusive -> SKIP
///
/// Rules (single implementation, all here):
///   * unknown id          -> skip, never an error
///   * status != Completed -> skip (an in-flight .part is out of scope)
///   * empty task_ids      -> empty result, no probe at all
///   * duplicate ids       -> collapsed (HashSet), no duplicate output
///   * ONLY `dir/filename` (the official file) is probed, never the `.part`
///
/// IO-error policy: PermissionDenied / sharing violation / transient errors
/// are NOT evidence that the user deleted the file. Reporting them as "lost"
/// would wrongly downgrade a healthy completed row. We therefore treat every
/// non-NotFound error (including NotADirectory when a parent component is a
/// file) as "present" and skip it silently - no log, no write, no event.
/// Only `ErrorKind::NotFound` is authoritative proof of a missing file.
pub(crate) fn missing_file_ids<P>(
    snapshots: &[TaskSnapshot],
    task_ids: &[String],
    probe: P,
) -> Vec<String>
where
    P: Fn(&Path) -> io::Result<()>,
{
    let requested: HashSet<&str> = task_ids.iter().map(String::as_str).collect();
    if requested.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for task in snapshots {
        if !requested.contains(task.id.as_str()) {
            continue; // unknown / not requested: skip, no error
        }
        if task.status != TaskStatus::Completed {
            continue; // non-completed: its .part is out of scope for this round
        }
        let official = task.dir.join(&task.filename);
        match probe(&official) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => out.push(task.id.clone()),
            // Permission / locked / other IO: NOT "file lost". Treat as
            // present and skip; never misreport, never write, never emit.
            Err(_) => {}
        }
    }
    out
}

/// Testable core. Exactly ONE `list(All)` read for the whole batch; all stat
/// calls run together in one blocking task, so no async worker is stalled and
/// the frontend never needs N IPC round-trips.
pub(crate) async fn check_files_core(
    engine: &dyn Downloader,
    task_ids: &[String],
) -> CmdResult<Vec<String>> {
    if task_ids.is_empty() {
        return Ok(Vec::new());
    }
    // Single read-only query; list() writes nothing and emits nothing.
    let snapshots = engine.list(TaskFilter::All).await?;
    let ids = task_ids.to_vec();
    let missing = tokio::task::spawn_blocking(move || {
        missing_file_ids(&snapshots, &ids, |p| std::fs::metadata(p).map(|_| ()))
    })
    .await
    .map_err(|e| AppError::new("engine_error", format!("文件检测失败：{}", e)))?;
    Ok(missing)
}

/// Contract-bound command (Spec 5.1): invoke('check_files', { taskIds }).
/// Rust keeps snake_case `check_files` / `task_ids`; Tauri v2 maps the wire
/// key to camelCase `taskIds`. Command names are NEVER camelCased.
/// Returns the ids of completed tasks whose official file has disappeared.
#[tauri::command]
pub async fn check_files(
    state: State<'_, AppState>,
    task_ids: Vec<String>,
) -> CmdResult<Vec<String>> {
    check_files_core(state.engine.as_ref(), &task_ids).await
}
