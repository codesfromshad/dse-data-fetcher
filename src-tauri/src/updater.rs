//! Self-update from GitHub Releases.
//!
//! The release workflow (.github/workflows/release.yml) builds a signed NSIS
//! installer and publishes Tauri's `latest.json` manifest. It then copies that
//! manifest onto a fixed GitHub release tagged `updater`:
//!
//!   * `beta.json`   — updated by every release (betas and stable)
//!   * `stable.json` — updated by stable releases only
//!
//! tauri.conf.json → `plugins.updater.endpoints[0]` points at `stable.json`;
//! the other channel lives next to it. Installers are verified against the
//! public key in tauri.conf.json before they run.
//!
//! The flow is check → download (with progress) → install. Installing on
//! Windows hands over to the NSIS installer in passive mode, which closes
//! this app, updates it and starts it again.

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, Runtime, State, Url};
use tauri_plugin_updater::{Error as UpdaterError, Update, UpdaterExt};

use crate::settings::UpdateChannel;

#[derive(Default)]
pub struct UpdaterState {
    /// The update found by the last check.
    pending: Mutex<Option<Update>>,
    /// A downloaded, not yet installed package: (version, bytes).
    downloaded: Mutex<Option<(String, Vec<u8>)>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current_version: String,
    /// Release notes (the CHANGELOG section for that version).
    notes: Option<String>,
    /// RFC 3339 publish date, when the manifest has one.
    date: Option<String>,
    /// True when this version is already downloaded and ready to install.
    downloaded: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started { content_length: Option<u64> },
    #[serde(rename_all = "camelCase")]
    Progress { downloaded: u64 },
    Finished,
}

/// The manifest URL for a channel, derived from the configured stable one.
fn endpoint<R: Runtime>(app: &AppHandle<R>, channel: UpdateChannel) -> Result<Url, String> {
    let stable = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("endpoints"))
        .and_then(|endpoints| endpoints.get(0))
        .and_then(|url| url.as_str())
        .ok_or("No update server is configured.")?;
    let url = match channel {
        UpdateChannel::Stable => stable.to_string(),
        other => stable.replace("stable.json", &format!("{}.json", other.as_str())),
    };
    Url::parse(&url).map_err(|e| format!("Invalid update URL {url}: {e}"))
}

fn describe(error: UpdaterError, channel: UpdateChannel) -> String {
    match error {
        UpdaterError::ReleaseNotFound => format!(
            "No {} release has been published yet.",
            match channel {
                UpdateChannel::Stable => "stable",
                UpdateChannel::Beta => "beta",
            }
        ),
        UpdaterError::Reqwest(e) if e.is_connect() || e.is_timeout() => {
            "Couldn't reach the update server. Check your internet connection.".into()
        }
        other => other.to_string(),
    }
}

#[tauri::command]
pub async fn check_for_update<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, UpdaterState>,
    channel: UpdateChannel,
) -> Result<Option<UpdateInfo>, String> {
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint(&app, channel)?])
        .map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let update = updater.check().await.map_err(|e| describe(e, channel))?;

    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone().filter(|b| !b.trim().is_empty()),
        date: u.raw_json.get("pub_date").and_then(|d| d.as_str()).map(String::from),
        downloaded: state
            .downloaded
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|(version, _)| *version == u.version),
    });

    // A package downloaded for some other version is stale now.
    let mut downloaded = state.downloaded.lock().unwrap();
    if downloaded.as_ref().map(|(v, _)| Some(v) != update.as_ref().map(|u| &u.version)).unwrap_or(false) {
        *downloaded = None;
    }
    *state.pending.lock().unwrap() = update;
    Ok(info)
}

#[tauri::command]
pub async fn download_update(state: State<'_, UpdaterState>, on_event: Channel<DownloadEvent>) -> Result<(), String> {
    let update = state
        .pending
        .lock()
        .unwrap()
        .clone()
        .ok_or("There's no update to download. Check for updates first.")?;

    if state.downloaded.lock().unwrap().as_ref().is_some_and(|(v, _)| *v == update.version) {
        let _ = on_event.send(DownloadEvent::Finished);
        return Ok(());
    }

    let mut received: u64 = 0;
    let mut started = false;
    let mut last_sent = Instant::now();
    let bytes = update
        .download(
            |chunk, total| {
                if !started {
                    started = true;
                    let _ = on_event.send(DownloadEvent::Started { content_length: total });
                }
                received += chunk as u64;
                // Plenty for a progress bar without flooding the IPC channel.
                if last_sent.elapsed() >= Duration::from_millis(100) {
                    last_sent = Instant::now();
                    let _ = on_event.send(DownloadEvent::Progress { downloaded: received });
                }
            },
            || {},
        )
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    *state.downloaded.lock().unwrap() = Some((update.version.clone(), bytes));
    let _ = on_event.send(DownloadEvent::Finished);
    Ok(())
}

/// Verify and run the installer. On Windows this exits the app; the installer
/// starts the new version when it's done.
#[tauri::command]
pub fn install_update<R: Runtime>(app: AppHandle<R>, state: State<'_, UpdaterState>) -> Result<(), String> {
    let update = state.pending.lock().unwrap().clone().ok_or("There's no update to install.")?;
    let (version, bytes) = state
        .downloaded
        .lock()
        .unwrap()
        .take()
        .ok_or("The update hasn't been downloaded yet.")?;
    if version != update.version {
        return Err("The downloaded update is out of date. Check for updates again.".into());
    }

    crate::delete_all_temp_files(&app);
    update.install(bytes).map_err(|e| format!("Couldn't install the update: {e}"))?;
    // Only reached on platforms where install() returns (not Windows).
    app.restart();
}
