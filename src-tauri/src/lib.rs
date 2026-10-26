//! Native side of DSE Data Fetcher.
//!
//! Everything except drawing the UI happens here:
//!   * the whole fetch run (see fetch/): HTTP with a cookie jar per run,
//!     company-page parsing, retries, the xlsx, progress/log events
//!   * a connection monitor: internet and DSE, checked for as long as the
//!     app runs, with changes pushed to the window (see connectivity.rs)
//!   * temp-file bookkeeping: open the xlsx, save a copy, delete it, and a
//!     last-chance cleanup when the app exits.
//!   * the startup system check: temp folder, spreadsheet app (with a
//!     user-chosen override saved in settings.json).
//!   * settings, app/build info for the About page, and self-update from
//!     GitHub Releases (see updater.rs).

mod connectivity;
mod fetch;
mod settings;
mod spreadsheet;
mod updater;

use std::{
    collections::HashSet,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use serde::Serialize;
use settings::{Preferences, Settings, ThemePreference};
use spreadsheet::AppInfo;
use fetch::{
    log::{hl, hl_as, parts, Level, Tone},
    LogLine,
};
use tauri::{
    window::Color, AppHandle, Emitter, Manager, RunEvent, Runtime, State, Theme, WebviewWindow, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

struct AppState {
    /// Temp files this app created and must delete on exit.
    temp_files: Mutex<HashSet<PathBuf>>,
    /// Files the UI may open/reveal: temp files plus copies the user saved.
    known_files: Mutex<HashSet<PathBuf>>,
    settings: Mutex<Settings>,
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

fn ensure_known(state: &AppState, path: &Path) -> Result<(), String> {
    if state.known_files.lock().unwrap().contains(path) {
        Ok(())
    } else {
        Err("That file wasn't created by this app.".into())
    }
}

/// Write a file (the workbook) to the temp folder and track it for cleanup.
/// `name` must be a bare file name. Returns the full path.
fn write_temp_file(state: &AppState, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let name = Path::new(name).file_name().ok_or("Invalid file name.")?;
    let path = std::env::temp_dir().join(name);
    // Track before writing, so even a half-written file gets cleaned up.
    state.temp_files.lock().unwrap().insert(path.clone());
    state.known_files.lock().unwrap().insert(path.clone());
    std::fs::write(&path, bytes).map_err(|e| format!("Couldn't write {}: {e}", path.display()))?;
    Ok(path)
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
enum DeleteOutcome {
    Deleted,
    /// Still open in another app (Excel holds an exclusive lock).
    Locked,
    Gone,
}

fn delete_file(path: &Path) -> Result<DeleteOutcome, String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(DeleteOutcome::Deleted),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(DeleteOutcome::Gone),
        // 32 = ERROR_SHARING_VIOLATION, 33 = ERROR_LOCK_VIOLATION on Windows.
        Err(e) if e.kind() == ErrorKind::PermissionDenied || matches!(e.raw_os_error(), Some(32 | 33)) => {
            Ok(DeleteOutcome::Locked)
        }
        Err(e) => Err(format!("Couldn't delete {}: {e}", path.display())),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LockedFile {
    path: String,
    file_name: String,
}

/// Activity-log lines from outside a fetch (temp-file cleanup), for the UI's
/// log (`activity` events, see src/lib/native.ts).
fn log_activity<R: Runtime>(app: &AppHandle<R>, lines: Vec<LogLine>) {
    if !lines.is_empty() {
        let _ = app.emit("activity", lines);
    }
}

/// Delete one temp spreadsheet and say how it went, for the activity log.
fn delete_logged(path: &Path) -> (Result<DeleteOutcome, String>, LogLine) {
    let file_name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let outcome = delete_file(path);
    let line = match &outcome {
        Ok(DeleteOutcome::Deleted) => LogLine::now(Level::Success, parts!["Deleted the temporary spreadsheet ", hl(&file_name), "."]),
        Ok(DeleteOutcome::Gone) => {
            LogLine::now(Level::Info, parts!["The temporary spreadsheet ", hl(&file_name), " was already deleted."])
        }
        Ok(DeleteOutcome::Locked) => LogLine::now(
            Level::Warn,
            parts![
                "Couldn't delete the temporary spreadsheet ",
                hl(&file_name),
                ": it's still open in another app. Close it there, then try again."
            ],
        ),
        Err(error) => LogLine::now(
            Level::Error,
            parts!["Couldn't delete the temporary spreadsheet ", hl(&file_name), " ", hl_as(format!("({error})"), Tone::Subtle), "."],
        ),
    };
    (outcome, line)
}

fn locked_file(path: &Path) -> LockedFile {
    LockedFile {
        path: path.to_string_lossy().into_owned(),
        file_name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeleteReport {
    /// Deleted just now (not counting ones that were already gone).
    deleted: usize,
    /// Still open in another app; they stay tracked so a retry can try again.
    locked: Vec<LockedFile>,
}

/// Delete every temp file this app created, logging what happened to each
/// (on close, and before an update installs).
#[tauri::command]
fn delete_temp_files(app: AppHandle, state: State<'_, AppState>) -> DeleteReport {
    let mut temp_files = state.temp_files.lock().unwrap();
    let mut report = DeleteReport { deleted: 0, locked: Vec::new() };
    let mut lines = Vec::new();
    temp_files.retain(|path| {
        let (outcome, line) = delete_logged(path);
        lines.push(line);
        match outcome {
            Ok(DeleteOutcome::Deleted) => {
                report.deleted += 1;
                false
            }
            Ok(DeleteOutcome::Gone) => false,
            Ok(DeleteOutcome::Locked) => {
                report.locked.push(locked_file(path));
                true
            }
            Err(_) => true,
        }
    });
    drop(temp_files);
    log_activity(&app, lines);
    report
}

/// Workbooks this app writes, and the CLI before it: temp_stock_data_<time>.xlsx.
fn is_temp_spreadsheet(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("temp_stock_data_") && lower.ends_with(".xlsx")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TempSpreadsheet {
    path: String,
    file_name: String,
    size: u64,
    /// Last modified, in ms since the Unix epoch (0 if unknown).
    modified_ms: u64,
    /// Written by this run of the app (the result on the Fetch page).
    this_session: bool,
}

/// Every temp spreadsheet in `dir`, newest first.
fn find_in(dir: &Path, this_session: &HashSet<PathBuf>) -> Vec<TempSpreadsheet> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut found: Vec<TempSpreadsheet> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if !is_temp_spreadsheet(&file_name) {
                return None;
            }
            // Not following links: only real files in the temp folder itself.
            let meta = entry.metadata().ok().filter(|m| m.is_file())?;
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_millis() as u64);
            let path = entry.path();
            Some(TempSpreadsheet {
                this_session: this_session.contains(&path),
                path: path.to_string_lossy().into_owned(),
                file_name,
                size: meta.len(),
                modified_ms,
            })
        })
        .collect();
    found.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then_with(|| a.file_name.cmp(&b.file_name)));
    found
}

/// The temp spreadsheets in the temp folder: this session's, and any left
/// behind by earlier ones (a crash, a file that was open in Excel, the CLI).
#[tauri::command]
fn find_temp_spreadsheets(state: State<'_, AppState>) -> Vec<TempSpreadsheet> {
    let this_session = state.temp_files.lock().unwrap().clone();
    find_in(&std::env::temp_dir(), &this_session)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanupReport {
    deleted: usize,
    /// Bytes freed by the ones deleted.
    freed: u64,
    locked: Vec<LockedFile>,
    failed: usize,
}

/// Delete every temp spreadsheet in the temp folder (found afresh here, never
/// from a list the UI sends), logging each one and a summary.
#[tauri::command]
fn clean_temp_spreadsheets(app: AppHandle, state: State<'_, AppState>) -> CleanupReport {
    let this_session = state.temp_files.lock().unwrap().clone();
    let found = find_in(&std::env::temp_dir(), &this_session);
    let mut report = CleanupReport { deleted: 0, freed: 0, locked: Vec::new(), failed: 0 };
    let mut lines = Vec::new();
    if found.is_empty() {
        log_activity(&app, vec![LogLine::now(Level::Info, parts!["No temporary spreadsheets to clean up."])]);
        return report;
    }
    lines.push(LogLine::now(
        Level::Info,
        parts![
            "Cleaning up ",
            hl(format!("{} temporary spreadsheet{}", found.len(), if found.len() == 1 { "" } else { "s" })),
            " in the temp folder...",
        ],
    ));
    for file in &found {
        let path = PathBuf::from(&file.path);
        let (outcome, line) = delete_logged(&path);
        lines.push(line);
        match outcome {
            Ok(DeleteOutcome::Deleted) => {
                report.deleted += 1;
                report.freed += file.size;
            }
            Ok(DeleteOutcome::Gone) => {}
            Ok(DeleteOutcome::Locked) => {
                report.locked.push(locked_file(&path));
                continue; // still there: keep tracking it
            }
            Err(_) => {
                report.failed += 1;
                continue;
            }
        }
        state.temp_files.lock().unwrap().remove(&path);
        state.known_files.lock().unwrap().remove(&path);
    }
    let left = report.locked.len() + report.failed;
    let mut summary = parts![
        "Cleanup done: deleted ",
        hl(report.deleted),
        ", freed ",
        hl(fetch::metrics::format_bytes(report.freed)),
    ];
    if left > 0 {
        summary.push(", ".into());
        summary.push(hl_as(format!("{left} couldn't be deleted"), Tone::Danger));
    }
    summary.push(".".into());
    lines.push(LogLine::now(if left > 0 { Level::Warn } else { Level::Success }, summary));
    log_activity(&app, lines);
    report
}

/// Best-effort delete of every temp file (used on exit and before an update
/// installs). Files still open in Excel are left behind.
pub(crate) fn delete_all_temp_files<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<AppState>() {
        // "Delete temporary spreadsheets" off in Settings: keep them.
        if !state.settings.lock().unwrap().preferences.delete_temp_on_close {
            return;
        }
        for path in state.temp_files.lock().unwrap().drain() {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Open a file with the chosen spreadsheet app, or the system default.
#[tauri::command]
fn open_file(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<(), String> {
    open_known_file(&app, &state, Path::new(&path))
}

fn open_known_file(app: &AppHandle, state: &AppState, path: &Path) -> Result<(), String> {
    ensure_known(state, path)?;
    let custom = state.settings.lock().unwrap().spreadsheet_app.clone();
    match custom {
        Some(program) if program.is_file() => spreadsheet::launch(&program, path),
        Some(program) => Err(format!(
            "The chosen spreadsheet app ({}) no longer exists. Pick another one in Settings.",
            program.display()
        )),
        None => app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| e.to_string()),
    }
}

#[tauri::command]
fn reveal_file(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    ensure_known(&state, &path)?;
    app.opener().reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

/// Copy a temp file to a location the user picked in the Save dialog.
#[tauri::command]
fn save_copy(state: State<'_, AppState>, source: String, destination: String) -> Result<(), String> {
    let source = PathBuf::from(source);
    if !state.temp_files.lock().unwrap().contains(&source) {
        return Err("That file wasn't created by this app.".into());
    }
    let destination = PathBuf::from(destination);
    std::fs::copy(&source, &destination).map_err(|e| format!("Couldn't save to {}: {e}", destination.display()))?;
    state.known_files.lock().unwrap().insert(destination);
    Ok(())
}

// ---------------------------------------------------------------------------
// System check + settings
// ---------------------------------------------------------------------------

/// Make sure the temp folder is writable. Returns its path.
#[tauri::command]
fn check_temp_dir() -> Result<String, String> {
    let dir = std::env::temp_dir();
    let probe = dir.join(format!("dse_data_fetcher_probe_{}.tmp", std::process::id()));
    std::fs::write(&probe, b"ok").map_err(|e| format!("Can't write to {}: {e}", dir.display()))?;
    let _ = std::fs::remove_file(&probe);
    Ok(dir.to_string_lossy().into_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpreadsheetStatus {
    /// The app Windows opens .xlsx files with, if any.
    system_default: Option<AppInfo>,
    /// The user's override from Settings, if set...
    custom_path: Option<String>,
    /// ...and its details, or `None` when that file no longer exists.
    custom_app: Option<AppInfo>,
}

fn spreadsheet_status(state: &AppState) -> SpreadsheetStatus {
    let custom = state.settings.lock().unwrap().spreadsheet_app.clone();
    SpreadsheetStatus {
        system_default: spreadsheet::system_default(),
        custom_app: custom.as_deref().and_then(spreadsheet::describe),
        custom_path: custom.map(|p| p.to_string_lossy().into_owned()),
    }
}

#[tauri::command]
async fn get_spreadsheet_status(state: State<'_, AppState>) -> Result<SpreadsheetStatus, String> {
    Ok(spreadsheet_status(&state))
}

/// Set (Some) or clear (None = use the system default) the spreadsheet app.
#[tauri::command]
fn set_spreadsheet_app(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<SpreadsheetStatus, String> {
    let path = path.map(PathBuf::from);
    if let Some(path) = &path {
        spreadsheet::validate(path)?;
    }
    let mut updated = state.settings.lock().unwrap().clone();
    updated.spreadsheet_app = path;
    settings::save(&app, &updated)?;
    *state.settings.lock().unwrap() = updated;
    Ok(spreadsheet_status(&state))
}

/// Apply a change to the settings, save them, and return the result.
fn modify_settings(
    app: &AppHandle,
    state: &AppState,
    change: impl FnOnce(&mut Settings),
) -> Result<Settings, String> {
    let mut updated = state.settings.lock().unwrap().clone();
    change(&mut updated);
    settings::save(app, &updated)?;
    *state.settings.lock().unwrap() = updated.clone();
    Ok(updated)
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn set_preferences(app: AppHandle, state: State<'_, AppState>, preferences: Preferences) -> Result<Settings, String> {
    let theme = preferences.theme;
    let updated = modify_settings(&app, &state, |s| s.preferences = preferences)?;
    if let Some(window) = app.get_webview_window("main") {
        apply_theme(&window, theme);
    }
    Ok(updated)
}

#[tauri::command]
fn mark_update_checked(app: AppHandle, state: State<'_, AppState>, at: u64) -> Result<Settings, String> {
    modify_settings(&app, &state, |s| s.last_update_check = Some(at))
}

#[tauri::command]
fn set_last_seen_version(app: AppHandle, state: State<'_, AppState>, version: String) -> Result<Settings, String> {
    modify_settings(&app, &state, |s| s.last_seen_version = Some(version))
}

/// "Don't show this again" on the switch-to-Stable prompt.
#[tauri::command]
fn set_hide_stable_prompt(app: AppHandle, state: State<'_, AppState>, hide: bool) -> Result<Settings, String> {
    modify_settings(&app, &state, |s| s.hide_stable_prompt = hide)
}

/// Back to defaults. Keeps the bookkeeping so "What's new" doesn't pop up again.
#[tauri::command]
fn reset_settings(app: AppHandle, state: State<'_, AppState>) -> Result<Settings, String> {
    let updated = modify_settings(&app, &state, |s| {
        *s = Settings {
            last_update_check: s.last_update_check,
            last_seen_version: s.last_seen_version.clone(),
            hide_stable_prompt: s.hide_stable_prompt,
            ..Settings::default()
        }
    })?;
    if let Some(window) = app.get_webview_window("main") {
        apply_theme(&window, updated.preferences.theme);
    }
    Ok(updated)
}

#[tauri::command]
fn open_settings_folder(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildInfo {
    version: String,
    tauri_version: &'static str,
    /// WebView2 runtime version on Windows.
    webview_version: Option<String>,
    os: &'static str,
    arch: &'static str,
    debug: bool,
    settings_path: Option<String>,
    install_dir: Option<String>,
}

#[tauri::command]
fn build_info(app: AppHandle) -> BuildInfo {
    BuildInfo {
        version: app.package_info().version.to_string(),
        tauri_version: tauri::VERSION,
        webview_version: tauri::webview_version().ok(),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        debug: cfg!(debug_assertions),
        settings_path: settings::settings_path(&app).map(|p| p.to_string_lossy().into_owned()),
        install_dir: std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.to_string_lossy().into_owned())),
    }
}

// ---------------------------------------------------------------------------
// No white flash
// ---------------------------------------------------------------------------
//
// The window is created hidden (tauri.conf.json: "visible": false) and the
// frontend shows it after its first paint. Until then, and whenever the page
// can't cover it (resizing), the native window + webview background match the
// app's Fluent background for the current Windows theme.

/// Fluent `colorNeutralBackground3` in webLightTheme / webDarkTheme.
fn background_for(theme: Theme) -> Color {
    match theme {
        Theme::Dark => Color(0x14, 0x14, 0x14, 0xff),
        _ => Color(0xf5, 0xf5, 0xf5, 0xff),
    }
}

fn paint_background(window: &WebviewWindow, theme: Theme) {
    let _ = window.set_background_color(Some(background_for(theme)));
}

/// Force light/dark (title bar, native background, webview) or follow Windows.
fn apply_theme(window: &WebviewWindow, preference: ThemePreference) {
    let forced = match preference {
        ThemePreference::System => None,
        ThemePreference::Light => Some(Theme::Light),
        ThemePreference::Dark => Some(Theme::Dark),
    };
    let _ = window.set_theme(forced);
    paint_background(window, forced.unwrap_or_else(|| window.theme().unwrap_or(Theme::Light)));
}

// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let settings = settings::load(app.handle());
            let theme = settings.preferences.theme;
            app.manage(AppState {
                temp_files: Mutex::new(HashSet::new()),
                known_files: Mutex::new(HashSet::new()),
                settings: Mutex::new(settings),
            });
            app.manage(updater::UpdaterState::default());
            app.manage(fetch::FetchState::default());
            app.manage(connectivity::Connectivity::default());
            connectivity::start_monitor(app.handle().clone());

            if let Some(window) = app.get_webview_window("main") {
                apply_theme(&window, theme);
                // Safety net: show the window even if the frontend never says
                // it's ready (e.g. a crash during startup).
                let window = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(3));
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::ThemeChanged(theme) = event {
                if let Some(webview_window) = window.app_handle().get_webview_window(window.label()) {
                    paint_background(&webview_window, *theme);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            fetch::start_fetch,
            fetch::cancel_fetch,
            fetch::set_fetch_paused,
            connectivity::probe_connectivity,
            delete_temp_files,
            find_temp_spreadsheets,
            clean_temp_spreadsheets,
            open_file,
            reveal_file,
            save_copy,
            check_temp_dir,
            get_spreadsheet_status,
            set_spreadsheet_app,
            get_settings,
            set_preferences,
            mark_update_checked,
            set_last_seen_version,
            set_hide_stable_prompt,
            reset_settings,
            open_settings_folder,
            build_info,
            updater::check_for_update,
            updater::download_update,
            updater::install_update,
        ])
        .build(tauri::generate_context!())
        .expect("error while building DSE Data Fetcher")
        .run(|app, event| {
            // Last-chance cleanup (crash in the UI, killed window, etc.). Files
            // still open in Excel are skipped, like the CLI did.
            if let RunEvent::Exit = event {
                delete_all_temp_files(app);
            }
        });
}

#[cfg(test)]
mod temp_spreadsheet_tests {
    use super::*;

    #[test]
    fn recognises_only_our_workbooks() {
        assert!(is_temp_spreadsheet("temp_stock_data_2026-10-27_01_32_00.000_+0600.xlsx"));
        assert!(is_temp_spreadsheet("TEMP_STOCK_DATA_x.XLSX"));
        assert!(!is_temp_spreadsheet("stock_data.xlsx"));
        assert!(!is_temp_spreadsheet("temp_stock_data_x.xlsx.tmp"));
        assert!(!is_temp_spreadsheet("~$temp_stock_data_x.xlsx"), "Excel's lock file, not a workbook");
    }

    #[test]
    fn finds_them_newest_first_and_flags_this_sessions() {
        let dir = std::env::temp_dir().join(format!("dse_find_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("temp_stock_data_dir.xlsx")).unwrap(); // a folder: ignored
        std::fs::write(dir.join("notes.txt"), b"x").unwrap();
        let old = dir.join("temp_stock_data_old.xlsx");
        std::fs::write(&old, b"old").unwrap();
        std::thread::sleep(Duration::from_millis(20));
        let new = dir.join("temp_stock_data_new.xlsx");
        std::fs::write(&new, b"newer").unwrap();

        let found = find_in(&dir, &HashSet::from([new.clone()]));
        let names: Vec<_> = found.iter().map(|f| f.file_name.as_str()).collect();
        assert_eq!(names, ["temp_stock_data_new.xlsx", "temp_stock_data_old.xlsx"]);
        assert!(found[0].this_session && !found[1].this_session);
        assert_eq!(found[0].size, 5);
        assert!(found[0].modified_ms >= found[1].modified_ms && found[1].modified_ms > 0);

        assert!(find_in(&dir.join("missing"), &HashSet::new()).is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
