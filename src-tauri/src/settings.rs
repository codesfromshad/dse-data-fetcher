//! Persistent user settings, stored as JSON in the app's config folder
//! (%APPDATA%\com.codesfromshad.dse-data-fetcher\settings.json on Windows).
//!
//! Every field has a default, so a settings file from an older version (or a
//! missing one) just fills in the gaps.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemePreference {
    /// Follow the Windows light/dark setting.
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
    Stable,
    Beta,
}

impl UpdateChannel {
    pub fn as_str(self) -> &'static str {
        match self {
            UpdateChannel::Stable => "stable",
            UpdateChannel::Beta => "beta",
        }
    }
}

/// Everything the Settings page edits directly (the spreadsheet app has its
/// own command because it needs validating).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    pub theme: ThemePreference,
    /// Run the system check on launch and start fetching if it passes.
    pub auto_fetch_on_launch: bool,
    /// Open the workbook in the spreadsheet app when a fetch finishes.
    pub open_after_fetch: bool,
    /// Check GitHub for a newer version on launch and every few hours.
    pub check_for_updates: bool,
    /// Download a found update in the background (installing still waits for
    /// the user to restart).
    pub auto_download_updates: bool,
    /// `None` = follow the installed build: beta builds get the beta channel.
    pub update_channel: Option<UpdateChannel>,
    /// How many times to fetch a company page again when the request fails or
    /// the page comes back with missing/NaN values. `None` = keep retrying
    /// until it works (or the user cancels).
    pub fetch_retries: Option<u32>,
    /// Show data transferred/processed and the transfer rate while fetching
    /// (progress card and log).
    pub show_network_metrics: bool,
    /// Delete this session's temporary spreadsheets when the app closes (and
    /// before an update installs). Off: they stay in the temp folder, for
    /// Settings → Advanced to clean up later.
    pub delete_temp_on_close: bool,
}

pub const DEFAULT_FETCH_RETRIES: u32 = 5;

impl Default for Preferences {
    fn default() -> Self {
        Self {
            theme: ThemePreference::System,
            auto_fetch_on_launch: true,
            open_after_fetch: true,
            check_for_updates: true,
            auto_download_updates: true,
            update_channel: None,
            fetch_retries: Some(DEFAULT_FETCH_RETRIES),
            show_network_metrics: true,
            delete_temp_on_close: true,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Full path to a spreadsheet app's .exe. `None` = use the system default.
    pub spreadsheet_app: Option<PathBuf>,
    #[serde(flatten)]
    pub preferences: Preferences,
    /// Unix time (ms) of the last successful update check.
    pub last_update_check: Option<u64>,
    /// The version whose "What's new" the user has already seen.
    pub last_seen_version: Option<String>,
    /// "Don't show this again" on the switch-to-Stable prompt.
    pub hide_stable_prompt: bool,
}

pub fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("settings.json"))
}

/// Missing or unreadable settings fall back to defaults.
pub fn load(app: &AppHandle) -> Settings {
    settings_path(app)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app).ok_or("Couldn't find the app's config folder.")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Couldn't save settings: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_settings_files_still_load() {
        let s: Settings = serde_json::from_str(r#"{ "spreadsheetApp": "C:\\x.exe" }"#).unwrap();
        assert_eq!(s.spreadsheet_app, Some(PathBuf::from("C:\\x.exe")));
        assert!(s.preferences.auto_fetch_on_launch);
        assert!(s.preferences.update_channel.is_none());
        assert_eq!(s.preferences.fetch_retries, Some(DEFAULT_FETCH_RETRIES));
        assert!(s.preferences.show_network_metrics);
        assert!(!s.hide_stable_prompt);
        assert!(s.preferences.delete_temp_on_close, "files from before the setting keep deleting");
    }

    #[test]
    fn unlimited_retries_round_trip() {
        let mut s = Settings::default();
        s.preferences.fetch_retries = None;
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains(r#""fetchRetries":null"#));
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.preferences.fetch_retries, None);
    }

    #[test]
    fn round_trip() {
        let mut s = Settings::default();
        s.preferences.theme = ThemePreference::Dark;
        s.preferences.update_channel = Some(UpdateChannel::Stable);
        let back: Settings = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(back.preferences.theme, ThemePreference::Dark);
        assert_eq!(back.preferences.update_channel, Some(UpdateChannel::Stable));
    }
}
