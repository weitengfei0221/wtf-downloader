// Notification command (defect fix, 2026-11-05): the frontend used to call the
// plugin's JS `sendNotification`, whose toast carries the host shell's identity
// in dev and portable runs (upstream trace in `crate::notify`). The toast is
// now built on the Rust side so it always carries this app's AUMID.

#[cfg(test)]
mod tests;

use crate::commands::error::{AppError, CmdResult};
use crate::notify::{self, BODY_MAX_CHARS, TITLE_MAX_CHARS};
use tauri::AppHandle;

/// Trim and shape-check one field of the toast.
///
/// Over-long copy is truncated instead of rejected: a notification is an
/// auxiliary channel, so a long download name must not swallow the whole
/// signal (the failure toast on a 300-character filename still has value).
/// Truncation happens on a character boundary, never mid-codepoint.
fn normalize_field(raw: &str, max_chars: usize, label: &str) -> Result<String, AppError> {
    if raw.contains('\0') {
        return Err(AppError::new(
            "invalid_argument",
            format!("{label}包含非法字符"),
        ));
    }
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(
            "invalid_argument",
            format!("{label}不能为空"),
        ));
    }
    Ok(trimmed.chars().take(max_chars).collect())
}

/// Validate the pair before it reaches the shell.
pub fn normalize_notification(title: &str, body: &str) -> Result<(String, String), AppError> {
    Ok((
        normalize_field(title, TITLE_MAX_CHARS, "通知标题")?,
        normalize_field(body, BODY_MAX_CHARS, "通知正文")?,
    ))
}

/// Show a system notification belonging to this app.
///
/// Contract-bound shape: command name `notify_user`, scalar parameters `title`
/// and `body` (the frontend calls `invoke('notify_user', { title, body })`).
#[tauri::command]
pub async fn notify_user(app: AppHandle, title: String, body: String) -> CmdResult<()> {
    let (title, body) = normalize_notification(&title, &body)?;
    notify::show(&app, &title, &body)
        .map_err(|e| AppError::new("notification_failed", format!("系统通知发送失败：{e}")))
}
