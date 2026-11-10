// Notification identity tests. Nothing here touches the registry or shows a
// toast: the registered values are pinned as pure data so a future refactor
// cannot silently drift away from tauri.conf.json.

use super::*;

/// The AUMID in code and in the bundle config are the same identity; if they
/// diverge, the toast is attributed to something the installer never
/// registered.
#[test]
fn app_user_model_id_matches_bundle_identifier() {
    let raw = include_str!("../../tauri.conf.json");
    let conf: serde_json::Value = serde_json::from_str(raw).expect("tauri.conf.json parses");
    let identifier = conf["identifier"].as_str().expect("identifier is a string");
    assert_eq!(identifier, APP_USER_MODEL_ID);
}

#[test]
fn registry_subkey_targets_current_user_classes() {
    assert_eq!(
        registry_subkey(),
        r"Software\Classes\AppUserModelId\com.wtfdownloader.app"
    );
}

#[test]
fn display_name_is_the_product_name() {
    // The banner text the user sees; pinned so it cannot turn into a
    // placeholder or pick up the bundle identifier.
    assert_eq!(DISPLAY_NAME, "wtf-downloader");
    assert!(!DISPLAY_NAME.contains(APP_USER_MODEL_ID));
}

#[test]
fn icon_uri_is_a_forward_slash_file_uri() {
    let uri = icon_uri(std::path::Path::new(
        r"C:\Program Files\wtf-downloader\wtf-downloader.exe",
    ));
    assert_eq!(
        uri,
        "file:///C:/Program%20Files/wtf-downloader/wtf-downloader.exe"
    );
    assert!(!uri.contains('\\'));
}

#[test]
fn icon_uri_strips_verbatim_prefix() {
    let uri = icon_uri(std::path::Path::new(r"\\?\C:\apps\wtf-downloader.exe"));
    assert_eq!(uri, "file:///C:/apps/wtf-downloader.exe");
    assert!(!uri.contains(r"\\?"));
}

/// Manual smoke test: shows a real toast through the same call the
/// `notify_user` command makes, so the attribution can be checked from
/// outside the test process (Windows keeps notification history per app id).
/// `#[ignore]` by design - a normal `cargo test` must not pop a notification.
///
///     cargo test -p app -- --ignored toast_uses_app_identity --nocapture
#[cfg(windows)]
#[test]
#[ignore = "shows a real system notification; run with --ignored"]
fn toast_uses_app_identity() {
    windows::show_toast(APP_USER_MODEL_ID, DISPLAY_NAME, "notification identity smoke")
        .expect("toast shown with the app's AUMID");
}
