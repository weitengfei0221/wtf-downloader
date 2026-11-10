// Task commands (Spec 5.1): thin four-step layer -
// validate -> engine call -> camelCase serialization -> error mapping.
// No business logic here (that lives in the engine).

#[cfg(test)]
mod tests;

use crate::commands::error::{AppError, CmdResult};
use crate::state::AppState;
use downloader_engine::protocol::{NewTask, TaskFilter, TaskSnapshot};
use std::collections::HashMap;
use tauri::ipc::Channel;
use tauri::State;

/// Validate a URL: parseable with http/https scheme (engine re-validates;
/// this front-loads a precise error for the dialog, AC-02).
pub fn validate_url_arg(url: &str) -> Result<(), AppError> {
    let parsed = url::Url::parse(url)
        .map_err(|_| AppError::new("invalid_url", format!("无法解析 URL：{}", url)))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(AppError::new(
            "invalid_url",
            format!("不支持的协议 {}（仅支持 http/https）", parsed.scheme()),
        ));
    }
    Ok(())
}

fn headers_arg(headers: Option<HashMap<String, String>>) -> Vec<(String, String)> {
    headers
        .map(|m| m.into_iter().collect::<Vec<_>>())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn probe_url(
    state: State<'_, AppState>,
    url: String,
    headers: Option<HashMap<String, String>>,
) -> CmdResult<downloader_engine::protocol::ProbeResult> {
    validate_url_arg(&url)?;
    let headers = headers_arg(headers);
    Ok(state.engine.probe(&url, &headers).await?)
}

#[tauri::command]
pub async fn add_task(
    state: State<'_, AppState>,
    url: String,
    filename: Option<String>,
    dir: Option<String>,
    headers: Option<HashMap<String, String>>,
    segments: Option<u8>,
) -> CmdResult<TaskIdResponse> {
    validate_url_arg(&url)?;
    if let Some(n) = segments {
        if n == 0 || n > 16 {
            return Err(AppError::new(
                "invalid_argument",
                format!("分片数必须在 1-16 之间，当前 {}", n),
            ));
        }
    }
    let dir = dir.map(std::path::PathBuf::from);
    let task = NewTask {
        url,
        filename,
        dir,
        headers: headers_arg(headers),
        segments,
    };
    let task_id = state.engine.add_task(task).await?;
    Ok(TaskIdResponse { task_id })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskIdResponse {
    pub task_id: String,
}

/// Progress subscription rides along (Spec 5.3 landing decision): each call
/// replaces the previous Channel registration. tauri 2 cannot express
/// Option<Channel> (Channel deliberately lacks Deserialize), so the channel
/// is a required argument; the frontend always sends one (replace-on-register).
#[tauri::command]
pub async fn list_tasks(
    state: State<'_, AppState>,
    filter: Option<String>,
    progress: Channel<serde_json::Value>,
) -> CmdResult<Vec<TaskSnapshot>> {
    let filter = match filter.as_deref() {
        None | Some("all") => TaskFilter::All,
        Some("downloading") => TaskFilter::Downloading,
        Some("completed") => TaskFilter::Completed,
        Some("failed") => TaskFilter::Failed,
        Some(other) => {
            return Err(AppError::new(
                "invalid_argument",
                format!("非法的筛选值 {}（all/downloading/completed/failed）", other),
            ))
        }
    };
    state.replace_progress_channel(progress).await;
    Ok(state.engine.list(filter).await?)
}

#[tauri::command]
pub async fn pause_task(state: State<'_, AppState>, task_id: String) -> CmdResult<TaskSnapshot> {
    require_task_id(&task_id)?;
    Ok(state.engine.pause(&task_id).await?)
}

#[tauri::command]
pub async fn resume_task(state: State<'_, AppState>, task_id: String) -> CmdResult<TaskSnapshot> {
    require_task_id(&task_id)?;
    Ok(state.engine.resume(&task_id).await?)
}

#[tauri::command]
pub async fn retry_task(state: State<'_, AppState>, task_id: String) -> CmdResult<TaskSnapshot> {
    require_task_id(&task_id)?;
    Ok(state.engine.retry(&task_id).await?)
}

#[tauri::command]
pub async fn remove_task(
    state: State<'_, AppState>,
    task_id: String,
    delete_files: bool,
) -> CmdResult<()> {
    require_task_id(&task_id)?;
    Ok(state.engine.remove(&task_id, delete_files).await?)
}

#[tauri::command]
pub async fn pause_all(state: State<'_, AppState>) -> CmdResult<()> {
    Ok(state.engine.pause_all().await?)
}

#[tauri::command]
pub async fn resume_all(state: State<'_, AppState>) -> CmdResult<()> {
    Ok(state.engine.resume_all().await?)
}

#[tauri::command]
pub async fn set_task_speed_limit(
    state: State<'_, AppState>,
    task_id: String,
    bytes_per_sec: Option<u64>,
) -> CmdResult<()> {
    require_task_id(&task_id)?;
    validate_limit(bytes_per_sec)?;
    Ok(state.engine.set_task_limit(&task_id, bytes_per_sec).await?)
}

fn require_task_id(task_id: &str) -> Result<(), AppError> {
    if task_id.trim().is_empty() {
        return Err(AppError::new("invalid_argument", "task_id 不能为空"));
    }
    Ok(())
}

pub(crate) fn validate_limit(bytes_per_sec: Option<u64>) -> Result<(), AppError> {
    if let Some(bps) = bytes_per_sec {
        if bps < 1024 {
            return Err(AppError::new(
                "invalid_argument",
                "限速最低 1 KB/s，或传 null 解除限制",
            ));
        }
    }
    Ok(())
}
