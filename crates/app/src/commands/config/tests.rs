// Config command validation tests.

use super::*;

#[test]
fn patch_validation_accepts_good_values() {
    let patch = ConfigPatchArg {
        download_dir: Some("D:/Downloads".into()),
        default_segments: Some(8),
        global_speed_limit_bps: Some(Some(1024 * 1024)),
        notify_on_complete: Some(false),
        minimize_to_tray: Some(false),
    };
    assert!(validate_patch(&patch).is_ok());
    assert!(validate_patch(&ConfigPatchArg::default()).is_ok());
}

#[test]
fn patch_validation_rejects_bad_segments() {
    for bad in [0u8, 17, 255] {
        let patch = ConfigPatchArg { default_segments: Some(bad), ..Default::default() };
        let err = validate_patch(&patch).unwrap_err();
        assert_eq!(err.code, "invalid_argument");
    }
}

#[test]
fn patch_validation_rejects_bad_limit() {
    let patch =
        ConfigPatchArg { global_speed_limit_bps: Some(Some(512)), ..Default::default() };
    assert!(validate_patch(&patch).is_err());
    // null (lift limit) is fine.
    let patch =
        ConfigPatchArg { global_speed_limit_bps: Some(None), ..Default::default() };
    assert!(validate_patch(&patch).is_ok());
}

#[test]
fn patch_validation_rejects_relative_dir() {
    let patch = ConfigPatchArg { download_dir: Some("relative/path".into()), ..Default::default() };
    let err = validate_patch(&patch).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn config_response_serializes_camel_case() {
    let resp = ConfigResponse {
        download_dir: "D:/dl".into(),
        default_segments: 8,
        global_speed_limit_bps: None,
        notify_on_complete: true,
        minimize_to_tray: false,
        autostart_enabled: false,
    };
    let json = serde_json::to_value(&resp).unwrap();
    assert_eq!(json["downloadDir"], "D:/dl");
    assert_eq!(json["defaultSegments"], 8);
    assert!(json["globalSpeedLimitBps"].is_null());
    assert_eq!(json["notifyOnComplete"], true);
    assert_eq!(json["minimizeToTray"], false);
    assert_eq!(json["autostartEnabled"], false);
}
