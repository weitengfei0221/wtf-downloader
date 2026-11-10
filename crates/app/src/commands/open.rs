// Open command (task row "open file", Spec F5): hands a path to the OS
// default program from the Rust side.
//
// Why not the JS `plugin-opener` API: `openPath` travels through the plugin
// ACL, whose path scope entries are parsed and compared literally
// (`scope_entry.rs::EntryRaw::Path` -> `app_handle.path().parse(path)`), with
// no globbing. So no capability can authorise "wherever the user saves
// files", and every call fails with `Not allowed to open path ...`. The
// Rust-side free function skips the scope by design, which is exactly what
// makes arbitrary download directories work.

#[cfg(test)]
mod tests;

use crate::commands::error::{AppError, CmdResult};
use std::path::Path;

/// Shape checks only: reject input that can never be a real user path.
/// No glob expansion and no traversal collapsing - once a path passes it is
/// forwarded verbatim, so nothing is rewritten behind the UI's back.
pub fn validate_open_path(path: &str) -> Result<(), AppError> {
    if path.trim().is_empty() {
        return Err(AppError::new("invalid_argument", "打开路径不能为空"));
    }
    // A NUL byte would truncate the path inside the OS call, silently opening
    // a different file than the one the user clicked.
    if path.contains('\0') {
        return Err(AppError::new("invalid_argument", "打开路径包含非法字符"));
    }
    if !Path::new(path).is_absolute() {
        return Err(AppError::new(
            "invalid_argument",
            format!("打开路径必须是绝对路径：{}", path),
        ));
    }
    Ok(())
}

/// Open a downloaded file or folder with the system default program.
///
/// Contract-bound shape: command name `open_path`, single scalar parameter
/// `path` (the frontend calls `invoke('open_path', { path })`).
#[tauri::command]
pub async fn open_path(path: String) -> CmdResult<()> {
    validate_open_path(&path)?;
    match tokio::fs::metadata(&path).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // Rendered as-is by the frontend toast.
            return Err(AppError::new("io_error", format!("文件不存在：{}", path)));
        }
        Err(e) => {
            return Err(AppError::new(
                "io_error",
                format!("无法访问路径 {}：{}", path, e),
            ))
        }
    }
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| AppError::new("io_error", format!("打开文件失败：{}", e)))
}
