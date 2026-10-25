//! Native side of DSE Data Fetcher.
//!
//! The fetch pipeline itself lives in the frontend (TypeScript). Rust provides
//! what a webview can't do on its own:
//!   * HTTP without CORS, with a cookie jar per run (replaces curl.exe + -b/-c)
//!   * a DNS check for "are we online at all"
//!   * temp-file bookkeeping: write the xlsx, open it, save a copy, delete it,
//!     and a last-chance cleanup when the app exits.
//!   * the startup system check: temp folder, spreadsheet app (with a
//!     user-chosen override saved in settings.json).
//!   * settings, app/build info for the About page, and self-update from
//!     GitHub Releases (see updater.rs).

mod settings;
mod spreadsheet;
mod updater;

use std::{
    collections::{HashMap, HashSet},
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use serde::Serialize;
use settings::{Preferences, Settings, ThemePreference};
use spreadsheet::AppInfo;
use tauri::{
    ipc::InvokeBody, window::Color, AppHandle, Manager, RunEvent, Runtime, State, Theme, WebviewWindow, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

struct AppState {
    /// Replaced at the start of every run, so each run gets a fresh cookie jar.
    http: Mutex<reqwest::Client>,
    /// Temp files this app created and must delete on exit.
    temp_files: Mutex<HashSet<PathBuf>>,
    /// Files the UI may open/reveal: temp files plus copies the user saved.
    known_files: Mutex<HashSet<PathBuf>>,
    settings: Mutex<Settings>,
}

fn new_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .cookie_store(true)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .expect("failed to build HTTP client")
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpError {
    /// "connect" | "timeout" | "status" | "body" | "other"
    kind: &'static str,
    message: String,
}

impl HttpError {
    fn from_reqwest(error: reqwest::Error) -> Self {
        let kind = if error.is_timeout() {
            "timeout"
        } else if error.is_connect() {
            "connect"
        } else if error.is_body() || error.is_decode() {
            "body"
        } else {
            "other"
        };
        // reqwest's top-level message embeds the URL; the root cause is what
        // actually says what went wrong ("dns error", "connection refused"...).
        let mut root: &dyn std::error::Error = &error;
        while let Some(source) = root.source() {
            root = source;
        }
        let message = match kind {
            "timeout" => "Operation timed out".to_string(),
            _ => root.to_string(),
        };
        Self { kind, message }
    }
}

/// Hop-by-hop headers are illegal over HTTP/2 and hyper rejects the request if
/// they're set, so drop them (curl used to just ignore them).
fn is_hop_by_hop(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "connection" | "keep-alive" | "proxy-connection" | "transfer-encoding" | "upgrade"
    )
}

/// GET a URL and return the body as text. Non-2xx counts as an error, like
/// `curl --fail`, so the caller retries instead of parsing an error page.
#[tauri::command]
async fn http_get(
    state: State<'_, AppState>,
    url: String,
    headers: HashMap<String, String>,
    timeout_ms: u64,
) -> Result<String, HttpError> {
    let client = state.http.lock().unwrap().clone();
    let mut request = client.get(&url).timeout(Duration::from_millis(timeout_ms));
    for (name, value) in headers.iter().filter(|(name, _)| !is_hop_by_hop(name)) {
        request = request.header(name, value);
    }

    let response = request.send().await.map_err(HttpError::from_reqwest)?;
    let status = response.status();
    if !status.is_success() {
        return Err(HttpError {
            kind: "status",
            message: format!("The requested URL returned error: {status}"),
        });
    }
    response.text().await.map_err(HttpError::from_reqwest)
}

/// Start a new HTTP session (fresh cookie jar).
#[tauri::command]
fn reset_http_session(state: State<'_, AppState>) {
    *state.http.lock().unwrap() = new_http_client();
}

/// Same check the CLI did: can we resolve www.google.com?
#[tauri::command]
async fn check_online() -> bool {
    tokio::net::lookup_host(("www.google.com", 443)).await.is_ok()
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

/// Write the workbook to the temp folder. Body: raw bytes. Header
/// `x-file-name`: the file name (no directories). Returns the full path.
#[tauri::command]
fn write_temp_file(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the file contents as raw bytes.".into());
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| Path::new(value).file_name())
        .ok_or("Missing or invalid x-file-name header.")?;

    let path = std::env::temp_dir().join(name);
    // Track before writing, so even a half-written file gets cleaned up.
    state.temp_files.lock().unwrap().insert(path.clone());
    state.known_files.lock().unwrap().insert(path.clone());
    std::fs::write(&path, bytes).map_err(|e| format!("Couldn't write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
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

/// Delete every temp file this app created. Returns the ones that are still
/// open in another app (those stay tracked so a retry can try again).
#[tauri::command]
fn delete_temp_files(state: State<'_, AppState>) -> Vec<LockedFile> {
    let mut temp_files = state.temp_files.lock().unwrap();
    let mut locked = Vec::new();
    temp_files.retain(|path| match delete_file(path) {
        Ok(DeleteOutcome::Locked) => {
            locked.push(LockedFile {
                path: path.to_string_lossy().into_owned(),
                file_name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            });
            true
        }
        Ok(_) => false,
        Err(_) => true,
    });
    locked
}

/// Best-effort delete of every temp file (used on exit and before an update
/// installs). Files still open in Excel are left behind.
pub(crate) fn delete_all_temp_files<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<AppState>() {
        for path in state.temp_files.lock().unwrap().drain() {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Open a file with the chosen spreadsheet app, or the system default.
#[tauri::command]
fn open_file(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    ensure_known(&state, &path)?;
    let custom = state.settings.lock().unwrap().spreadsheet_app.clone();
    match custom {
        Some(program) if program.is_file() => spreadsheet::launch(&program, &path),
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

/// Back to defaults. Keeps the bookkeeping so "What's new" doesn't pop up again.
#[tauri::command]
fn reset_settings(app: AppHandle, state: State<'_, AppState>) -> Result<Settings, String> {
    let updated = modify_settings(&app, &state, |s| {
        *s = Settings {
            last_update_check: s.last_update_check,
            last_seen_version: s.last_seen_version.clone(),
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
                http: Mutex::new(new_http_client()),
                temp_files: Mutex::new(HashSet::new()),
                known_files: Mutex::new(HashSet::new()),
                settings: Mutex::new(settings),
            });
            app.manage(updater::UpdaterState::default());

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
            http_get,
            reset_http_session,
            check_online,
            write_temp_file,
            delete_temp_files,
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
