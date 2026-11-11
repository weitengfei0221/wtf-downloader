// System notification identity, and the only place this app shows toasts.
//
// Symptom being fixed (user report, 2026-11-05): the "download finished" toast
// was attributed to the host shell instead of this application.
//
// Root cause, traced through the dependency tree (sources read, not guessed):
//   1. tauri-plugin-notification 2.7.0 `src/desktop.rs` (`build()`): the
//      per-notification app id is set ONLY when the exe does not live under
//      `target/debug` or `target/release`. In dev and portable runs it stays
//      unset, so no identity is ever attached.
//   2. notify-rust 4.18.2 `src/windows.rs`: an unset app id falls back to
//      `Toast::POWERSHELL_APP_ID` - a hardcoded shell identity whose own doc
//      comment says "the toast will erroneously report its origin as
//      powershell". That is exactly the name the user saw.
//   3. tauri-winrt-notification 0.8.1 always shows through
//      `CreateToastNotifierWithId(<that id>)`, i.e. the id travels with the
//      toast payload. A process-level AUMID therefore cannot override it.
//
// Point 3 is the load-bearing one and it was measured, not assumed: with the
// process AUMID set to APP_USER_MODEL_ID, a toast created with the shell id
// still landed in the shell's notification bucket while this app's bucket
// stayed empty. So `SetCurrentProcessExplicitAppUserModelID` on its own does
// NOT fix the banner name - the toast must carry our id.
//
// Hence: this app sends its own toasts with APP_USER_MODEL_ID, and registers
// that id per user (HKCU, no administrator needed) so the shell can resolve it
// to DISPLAY_NAME.
//
// Maintenance constraint - do not delete either half:
//   * the id registered in `prepare()` and the id used in `show()` must stay
//     byte-identical, otherwise the toast loses its display name;
//   * every toast must go through `show()`. Re-introducing the frontend
//     `sendNotification` JS API would regress dev builds to the shell name
//     because of point 1 above.

#[cfg(windows)]
mod windows;

#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

/// Must match `identifier` in tauri.conf.json; a unit test enforces that.
pub const APP_USER_MODEL_ID: &str = "com.wtfdownloader.app";

/// Name the shell prints on the toast banner.
pub const DISPLAY_NAME: &str = "wtf-downloader";

/// Banner logo, shipped as a bundle resource (see `bundle.resources` in
/// tauri.conf.json). A real image file is required: pointing `IconUri` at the
/// `.exe` - the previous behaviour - leaves the slot empty because the shell
/// does not extract icons out of executables for the toast layout.
pub const TOAST_ICON_RESOURCE: &str = "icons/notify.png";

/// Upper bounds for the toast fields, enforced by the command layer.
pub const TITLE_MAX_CHARS: usize = 128;
pub const BODY_MAX_CHARS: usize = 512;

/// HKCU subkey that registers the app id for the current user.
pub fn registry_subkey() -> String {
    format!(r"Software\Classes\AppUserModelId\{APP_USER_MODEL_ID}")
}

/// `IconUri` value for the registered app id.
///
/// The shell wants a URI, so backslashes are flipped and spaces escaped.
/// A verbatim (`\\?\`) prefix from the OS is stripped: it is not valid in a
/// URI and the shell would reject the value.
pub fn icon_uri(exe: &std::path::Path) -> String {
    let raw = exe.to_string_lossy();
    let raw = raw.strip_prefix(r"\\?\").unwrap_or(&raw);
    let slashed = raw.replace('\\', "/");
    let encoded = slashed.replace(' ', "%20");
    format!("file:///{}", encoded.trim_start_matches('/'))
}

/// Resolve the banner logo that ships with the bundle.
///
/// Returns `None` when the resource is missing (plain `cargo test`, or a
/// portable run that never installed the resources): callers must then fall
/// back instead of pointing a toast at a path that does not exist.
pub fn toast_icon(app: &AppHandle) -> Option<PathBuf> {
    let path = app
        .path()
        .resolve(TOAST_ICON_RESOURCE, BaseDirectory::Resource)
        .ok()?;
    is_usable_icon(&path).then_some(path)
}

/// The path is written verbatim into the toast XML, with no escaping by the
/// library, so an XML metacharacter would make the shell reject the whole
/// notification. A user profile literally named `a&b` must degrade to "no
/// icon", not "no notification".
fn is_usable_icon(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    !path
        .to_string_lossy()
        .chars()
        .any(|c| matches!(c, '&' | '<' | '>' | '"' | '\''))
}

/// Install this app's notification identity. Called once, first thing in the
/// Tauri `setup` hook, before any toast can be shown.
///
/// Never fails the caller: a notification that renders with a generic name is
/// strictly better than an app that refuses to start, so every error is
/// logged and swallowed.
pub fn prepare(app: &AppHandle) {
    #[cfg(windows)]
    {
        match windows::set_process_identity(APP_USER_MODEL_ID) {
            Ok(()) => {
                let readback = windows::current_process_identity()
                    .unwrap_or_else(|| "<unreadable>".to_string());
                println!("[wtf-downloader] notification identity: {readback}");
            }
            Err(err) => eprintln!("[wtf-downloader] notification identity not set: {err}"),
        }

        // Prefer the bundled logo; the exe only as a last resort, because the
        // shell cannot render an executable in an image slot.
        let icon_path = toast_icon(app).or_else(|| std::env::current_exe().ok());
        let icon = icon_path.as_deref().map(icon_uri);
        match windows::register_aumid(&registry_subkey(), DISPLAY_NAME, icon.as_deref()) {
            Ok(()) => println!(
                "[wtf-downloader] AUMID registered: {} ({DISPLAY_NAME}) icon={}",
                registry_subkey(),
                icon.as_deref().unwrap_or("<none>")
            ),
            Err(err) => eprintln!(
                "[wtf-downloader] AUMID registration failed ({}): {err}",
                registry_subkey()
            ),
        }
    }

    #[cfg(not(windows))]
    {
        let _ = app;
    }
}

/// Show a toast that carries this app's identity.
#[cfg(windows)]
pub fn show(app: &AppHandle, title: &str, body: &str) -> Result<(), String> {
    let icon = toast_icon(app);
    windows::show_toast(APP_USER_MODEL_ID, title, body, icon.as_deref())
}

/// Non-Windows platforms have no AUMID concept; the plugin path is already
/// correct there (macOS resolves the bundle identifier, Linux uses the desktop
/// entry) so it stays in use.
#[cfg(not(windows))]
pub fn show(app: &AppHandle, title: &str, body: &str) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}
