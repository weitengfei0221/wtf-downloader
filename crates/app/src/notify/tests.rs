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

/// The logo has to travel with the installer: the shell needs a real image
/// file, and a path that only exists on the build machine is worse than none.
#[test]
fn toast_icon_is_declared_as_a_bundle_resource() {
    let raw = include_str!("../../tauri.conf.json");
    let conf: serde_json::Value = serde_json::from_str(raw).expect("tauri.conf.json parses");
    let resources = conf["bundle"]["resources"]
        .as_array()
        .expect("bundle.resources is an array");
    let declared: Vec<&str> = resources.iter().filter_map(|v| v.as_str()).collect();
    assert!(
        declared.contains(&TOAST_ICON_RESOURCE),
        "bundle.resources must ship {TOAST_ICON_RESOURCE}, got {declared:?}"
    );
}

/// A missing or misnamed asset would fail silently at runtime (no icon at
/// all), so the file itself is pinned here.
#[test]
fn toast_icon_asset_is_a_square_png() {
    let bytes = include_bytes!("../../icons/notify.png");
    assert_eq!(
        &bytes[..8],
        b"\x89PNG\r\n\x1a\n",
        "notify.png must be a real PNG, not a renamed file"
    );
    // IHDR carries width and height as big-endian u32 at offsets 16 and 20.
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    assert_eq!(
        width, height,
        "the appLogoOverride slot is square; a non-square asset gets letterboxed"
    );
    assert!(
        width >= 48,
        "give the shell more than the rendered 48px so it stays sharp above 100% scaling, got {width}"
    );
}

#[test]
fn bundled_icon_path_is_usable() {
    let icon = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(TOAST_ICON_RESOURCE);
    assert!(is_usable_icon(&icon), "{icon:?} must exist and be XML-safe");
}

#[test]
fn unusable_icon_paths_degrade_to_no_icon() {
    assert!(
        !is_usable_icon(std::path::Path::new(r"C:\definitely\missing\notify.png")),
        "a path that does not resolve must not be handed to the toast"
    );

    // The library writes the path verbatim into the toast XML, so one `&`
    // would make the shell drop the entire notification.
    let dir = std::env::temp_dir().join("wtf-notify-a&b");
    std::fs::create_dir_all(&dir).expect("temp dir");
    let file = dir.join("notify.png");
    std::fs::write(&file, b"not-a-real-png").expect("temp file");
    assert!(!is_usable_icon(&file), "an '&' in the path breaks the toast XML");
    std::fs::remove_file(&file).ok();
    std::fs::remove_dir(&dir).ok();
}

/// Manual smoke test: shows a real toast through the same call the
/// `notify_user` command makes, so the attribution and the bundled logo can be
/// checked from outside the test process (Windows keeps notification history
/// per app id). `#[ignore]` by design - a normal `cargo test` must not pop a
/// notification.
///
///     cargo test -p app -- --ignored toast_uses_app_identity --nocapture
#[cfg(windows)]
#[test]
#[ignore = "shows a real system notification; run with --ignored"]
fn toast_uses_app_identity() {
    let icon = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(TOAST_ICON_RESOURCE);
    windows::show_toast(
        APP_USER_MODEL_ID,
        DISPLAY_NAME,
        "notification identity smoke",
        Some(icon.as_path()),
    )
    .expect("toast shown with the app's AUMID");
}
