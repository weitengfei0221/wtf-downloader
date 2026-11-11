// Config commands (Spec 5.1): settings read/write, autostart bridging,
// file location reveal, and the global speed limit hot path.

#[cfg(test)]
mod tests;

use crate::commands::error::{AppError, CmdResult};
use crate::commands::tasks::validate_limit;
use crate::state::AppState;
use downloader_engine::protocol::EngineConfigPatch;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;
use tauri_plugin_autostart::ManagerExt;

/// Full config shape returned to the frontend (ARCHITECTURE section 4):
/// DB-backed keys plus the OS-realtime autostart state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigResponse {
    pub download_dir: String,
    pub default_segments: u8,
    pub global_speed_limit_bps: Option<u64>,
    pub notify_on_complete: bool,
    pub minimize_to_tray: bool,
    pub autostart_enabled: bool,
}

/// Partial update payload (Spec 5.1 set_config: Partial<Config>).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPatchArg {
    pub download_dir: Option<String>,
    pub default_segments: Option<u8>,
    pub global_speed_limit_bps: Option<Option<u64>>,
    pub notify_on_complete: Option<bool>,
    pub minimize_to_tray: Option<bool>,
}

/// Validate the partial patch before it reaches the engine.
pub fn validate_patch(patch: &ConfigPatchArg) -> Result<(), AppError> {
    if let Some(segs) = patch.default_segments {
        if segs == 0 || segs > 16 {
            return Err(AppError::new(
                "invalid_argument",
                format!("默认分片数必须在 1-16 之间，当前 {}", segs),
            ));
        }
    }
    if let Some(Some(bps)) = patch.global_speed_limit_bps {
        validate_limit(Some(bps))?;
    }
    if let Some(dir) = &patch.download_dir {
        let path = PathBuf::from(dir);
        if !path.is_absolute() {
            return Err(AppError::new(
                "invalid_argument",
                format!("下载目录必须是绝对路径：{}", dir),
            ));
        }
    }
    Ok(())
}

async fn config_response(
    state: &State<'_, AppState>,
    app: &tauri::AppHandle,
) -> Result<ConfigResponse, AppError> {
    let cfg = state.engine.get_config().await?;
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    Ok(ConfigResponse {
        download_dir: cfg.download_dir.to_string_lossy().into_owned(),
        default_segments: cfg.default_segments,
        global_speed_limit_bps: cfg.global_speed_limit_bps,
        notify_on_complete: cfg.notify_on_complete,
        minimize_to_tray: cfg.minimize_to_tray,
        autostart_enabled,
    })
}

#[tauri::command]
pub async fn get_config(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> CmdResult<ConfigResponse> {
    config_response(&state, &app).await
}

#[tauri::command]
pub async fn set_config(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    patch: ConfigPatchArg,
) -> CmdResult<ConfigResponse> {
    validate_patch(&patch)?;
    let limit_changed = patch.global_speed_limit_bps.is_some();
    let engine_patch = EngineConfigPatch {
        download_dir: patch.download_dir.map(PathBuf::from),
        default_segments: patch.default_segments,
        global_speed_limit_bps: patch.global_speed_limit_bps,
        notify_on_complete: patch.notify_on_complete,
        minimize_to_tray: patch.minimize_to_tray,
    };
    // Keep the sync window-close handler's mirror in step with the new value.
    if let Some(v) = patch.minimize_to_tray {
        state.set_minimize_to_tray(v);
    }
    let cfg = state.engine.set_config(engine_patch).await?;
    if limit_changed {
        // Keep the tray submenu checked state in sync (section 3.4).
        crate::tray::sync_limit_menu(&app, cfg.global_speed_limit_bps);
    }
    config_response(&state, &app).await
}

#[tauri::command]
pub async fn set_global_speed_limit(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    bytes_per_sec: Option<u64>,
) -> CmdResult<()> {
    validate_limit(bytes_per_sec)?;
    state.engine.set_global_limit(bytes_per_sec).await?;
    crate::tray::sync_limit_menu(&app, bytes_per_sec);
    Ok(())
}

#[tauri::command]
pub async fn set_autostart(
    app: tauri::AppHandle,
    enabled: bool,
) -> CmdResult<()> {
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch
            .enable()
            .map_err(|e| AppError::new("engine_error", format!("开启开机自启失败: {}", e)))?;
    } else {
        autolaunch
            .disable()
            .map_err(|e| AppError::new("engine_error", format!("关闭开机自启失败: {}", e)))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_file_location(
    state: State<'_, AppState>,
    task_id: String,
) -> CmdResult<()> {
    if task_id.trim().is_empty() {
        return Err(AppError::new("invalid_argument", "task_id 不能为空"));
    }
    let tasks = state.engine.list(downloader_engine::protocol::TaskFilter::All).await?;
    let task = tasks
        .iter()
        .find(|t| t.id == task_id)
        .ok_or_else(|| AppError::new("task_not_found", format!("任务不存在: {}", task_id)))?;
    let final_path = task.dir.join(&task.filename);
    let part_path = task.dir.join(format!("{}.part", task.filename));
    let target = if final_path.exists() {
        final_path
    } else if part_path.exists() {
        part_path
    } else {
        return Err(AppError::new(
            "invalid_argument",
            format!("文件尚未下载完成，磁盘上没有 {}", final_path.display()),
        ));
    };
    tauri_plugin_opener::reveal_item_in_dir(&target)
        .map_err(|e| AppError::new("engine_error", format!("打开所在目录失败: {}", e)))?;
    Ok(())
}
