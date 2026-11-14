// Theme preference (settings page / Spec 5.1 set_config). Kept in its own file
// because protocol/mod.rs already sits at the 300-non-empty-line gate.

use serde::{Deserialize, Serialize};

/// UI theme preference. Serialized lowercase, so the wire value is exactly
/// `"system" | "light" | "dark"` - a locked contract with the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ThemePreference {
    #[default]
    System,
    Light,
    Dark,
}

#[cfg(test)]
mod tests {
    // `http` is used by tests only to exercise the patch merge; production code
    // in `protocol` still has no http dependency (module header rule).
    use super::*;
    use crate::http::apply_patch;
    use crate::protocol::{EngineConfig, EngineConfigPatch};

    #[test]
    fn wire_values_are_lowercase() {
        assert_eq!(
            serde_json::to_string(&ThemePreference::System).unwrap(),
            "\"system\""
        );
        assert_eq!(
            serde_json::to_string(&ThemePreference::Light).unwrap(),
            "\"light\""
        );
        assert_eq!(
            serde_json::to_string(&ThemePreference::Dark).unwrap(),
            "\"dark\""
        );
    }

    #[test]
    fn default_is_system() {
        assert_eq!(ThemePreference::default(), ThemePreference::System);
    }

    /// Regression: configs persisted before `theme` existed carry no such key.
    /// Without `#[serde(default)]` on the field they would fail to load.
    #[test]
    fn legacy_config_without_theme_loads_as_system() {
        let legacy = r#"{
            "downloadDir": "D:/dl",
            "defaultSegments": 8,
            "globalSpeedLimitBps": null,
            "notifyOnComplete": true,
            "minimizeToTray": true
        }"#;
        let cfg: EngineConfig = serde_json::from_str(legacy).unwrap();
        assert_eq!(cfg.theme, ThemePreference::System);
        // The rest of the payload still lands unchanged.
        assert_eq!(cfg.default_segments, 8);
        assert!(cfg.minimize_to_tray);
    }

    #[test]
    fn patch_only_touches_theme() {
        let mut cfg = EngineConfig::default();
        cfg.default_segments = 8;
        cfg.notify_on_complete = false;
        let before = (
            cfg.download_dir.clone(),
            cfg.default_segments,
            cfg.global_speed_limit_bps,
            cfg.notify_on_complete,
            cfg.minimize_to_tray,
        );
        let patch = EngineConfigPatch {
            theme: Some(ThemePreference::Dark),
            ..Default::default()
        };
        apply_patch(&mut cfg, &patch);
        assert_eq!(cfg.theme, ThemePreference::Dark);
        assert_eq!(
            (
                cfg.download_dir.clone(),
                cfg.default_segments,
                cfg.global_speed_limit_bps,
                cfg.notify_on_complete,
                cfg.minimize_to_tray,
            ),
            before
        );
    }

    #[test]
    fn unknown_theme_value_is_rejected_by_serde() {
        assert!(serde_json::from_str::<ThemePreference>("\"blue\"").is_err());
        // An unknown value must be rejected at the IPC boundary, never silently
        // coerced to the default.
        assert!(serde_json::from_str::<EngineConfigPatch>(r#"{"theme":"blue"}"#).is_err());
    }
}
