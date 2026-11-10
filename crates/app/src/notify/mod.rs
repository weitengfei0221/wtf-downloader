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

use tauri::AppHandle;

/// Must match `identifier` in tauri.conf.json; a unit test enforces that.
pub const APP_USER_MODEL_ID: &str = "com.wtfdownloader.app";

/// Name the shell prints on the toast banner.
pub const DISPLAY_NAME: &str = "wtf-downloader";

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

/// Install this app's notification identity. Called once, first thing in the
/// Tauri `setup` hook, before any toast can be shown.
///
/// Never fails the caller: a notification that renders with a generic name is
/// strictly better than an app that refuses to start, so every error is
/// logged and swallowed.
pub fn prepare() {
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

        let exe = std::env::current_exe().ok();
        let icon = exe.as_deref().map(icon_uri);
        match windows::register_aumid(&registry_subkey(), DISPLAY_NAME, icon.as_deref()) {
            Ok(()) => println!(
                "[wtf-downloader] AUMID registered: {} ({DISPLAY_NAME})",
                registry_subkey()
            ),
            Err(err) => eprintln!(
                "[wtf-downloader] AUMID registration failed ({}): {err}",
                registry_subkey()
            ),
        }
    }
}

/// Show a toast that carries this app's identity.
#[cfg(windows)]
pub fn show(_app: &AppHandle, title: &str, body: &str) -> Result<(), String> {
    windows::show_toast(APP_USER_MODEL_ID, title, body)
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
