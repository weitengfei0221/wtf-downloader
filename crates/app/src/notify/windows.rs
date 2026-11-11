// Windows specifics for the notification identity: the AUMID registration and
// the toast itself. Kept apart from `mod.rs` so the unsafe shell call and the
// registry access sit in one reviewable place.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use tauri_winrt_notification::{IconCrop, Toast};
use windows_sys::Win32::UI::Shell::{
    GetCurrentProcessExplicitAppUserModelID, SetCurrentProcessExplicitAppUserModelID,
};

/// UTF-16, NUL-terminated, for the Win32 shell APIs.
fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(std::iter::once(0)).collect()
}

/// Tag the process with our app id. This does not fix the toast on its own
/// (the toast carries its own id), but it keeps taskbar grouping and the jump
/// list bound to this app instead of the launching shell.
pub(super) fn set_process_identity(aumid: &str) -> Result<(), String> {
    let wide_aumid = wide(aumid);
    // SAFETY: the pointer refers to a NUL-terminated UTF-16 buffer that
    // outlives the call; the API only reads it and reports failure via HRESULT.
    let hr = unsafe { SetCurrentProcessExplicitAppUserModelID(wide_aumid.as_ptr()) };
    if hr < 0 {
        return Err(format!(
            "SetCurrentProcessExplicitAppUserModelID failed: 0x{:08X}",
            hr as u32
        ));
    }
    Ok(())
}

/// Read the process app id back, so the startup log proves it took effect
/// instead of merely proving the call returned success.
pub(super) fn current_process_identity() -> Option<String> {
    let mut raw: *mut u16 = std::ptr::null_mut();
    // SAFETY: the API writes an allocated, NUL-terminated UTF-16 string to
    // `raw` and returns a failure HRESULT without writing on error, which is
    // checked before the pointer is read. The buffer is released with
    // CoTaskMemFree below, as documented for this API.
    let hr = unsafe { GetCurrentProcessExplicitAppUserModelID(&mut raw) };
    if hr < 0 || raw.is_null() {
        return None;
    }
    let mut len = 0usize;
    // SAFETY: the buffer is NUL-terminated, so this scan stops inside it.
    unsafe {
        while *raw.add(len) != 0 {
            len += 1;
        }
        let value = String::from_utf16_lossy(std::slice::from_raw_parts(raw, len));
        windows_sys::Win32::System::Com::CoTaskMemFree(raw as *const core::ffi::c_void);
        Some(value)
    }
}

/// Register the app id under HKCU (per user, no administrator required) so the
/// shell can map it to a display name on the toast banner.
pub(super) fn register_aumid(
    subkey: &str,
    display_name: &str,
    icon_uri: Option<&str>,
) -> Result<(), String> {
    let key = windows_registry::CURRENT_USER
        .create(subkey)
        .map_err(|e| format!("open HKCU\\{subkey}: {e}"))?;
    key.set_string("DisplayName", display_name)
        .map_err(|e| format!("write DisplayName: {e}"))?;
    if let Some(icon) = icon_uri {
        key.set_string("IconUri", icon)
            .map_err(|e| format!("write IconUri: {e}"))?;
    }
    Ok(())
}

/// Show a toast that carries `aumid`, so the shell attributes it to this app.
///
/// `icon` becomes the `<image placement="appLogoOverride">` slot, i.e. the
/// square logo on the left of the banner. It must be an absolute image file:
/// the library writes the path verbatim into the toast XML, so callers pass
/// the validated path from `super::toast_icon` and never an `.exe` (the shell
/// does not extract icons out of executables for this slot).
pub(super) fn show_toast(
    aumid: &str,
    title: &str,
    body: &str,
    icon: Option<&Path>,
) -> Result<(), String> {
    let mut toast = Toast::new(aumid).title(title).text1(body);
    if let Some(path) = icon {
        // Square keeps the artwork's own rounded card; Circular would mask it.
        toast = toast.icon(path, IconCrop::Square, "");
    }
    toast.show().map_err(|e| format!("toast show: {e}"))
}
