//! Watches the internet connection and the DSE website for as long as the
//! app is open, so losing either is noticed without anyone pressing a
//! button. Every change is pushed to the window as a `connectivity` event
//! carrying the new status and a ready-made activity-log line ("Internet
//! connection lost.", "...restored.").
//!
//! The system check, the Fetch page and a fetch run all read this one
//! status, so they can't disagree about whether the app is online.

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use futures_util::future::select_ok;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::{net::TcpStream, time::timeout};

use crate::fetch::{
    dse::DSE_URL,
    http::HttpError,
    log::{hl, hl_as, parts, Level, Tone},
    LogLine,
};

/// How often the internet connection is checked. A TCP handshake: a few
/// hundred bytes, so this costs nothing.
const INTERNET_INTERVAL: Duration = Duration::from_secs(5);
/// How often DSE is checked while it's answering, and while it isn't.
const DSE_INTERVAL_OK: Duration = Duration::from_secs(15);
const DSE_INTERVAL_DOWN: Duration = Duration::from_secs(10);
const INTERNET_TIMEOUT: Duration = Duration::from_secs(3);
const DSE_TIMEOUT: Duration = Duration::from_secs(10);

/// Anycast DNS resolvers on port 443, plus a named host. Any one answering
/// means we're online. A real handshake, not a DNS lookup: Windows answers
/// lookups from its cache for minutes after the connection is gone.
const PROBE_ADDRESSES: [&str; 3] = ["1.1.1.1:443", "8.8.8.8:443", "www.google.com:443"];

const DSE_HOST: &str = "old.dsebd.org";

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// `None` until the first check.
    pub internet: Option<bool>,
    /// `None` when not known (offline, or not checked yet).
    pub dse: Option<bool>,
    /// Round trip of the last good DSE check.
    pub dse_ms: Option<u64>,
    /// Why the last DSE check failed.
    pub dse_error: Option<HttpError>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectivityEvent {
    #[serde(flatten)]
    status: Status,
    /// Activity-log lines for what changed (may be empty).
    lines: Vec<LogLine>,
}

pub struct Connectivity {
    status: Mutex<Status>,
    /// One check at a time (the timer, the system check and a fetch run may
    /// all ask at once); latecomers get the fresh result.
    probing: tokio::sync::Mutex<()>,
    last_dse_check: Mutex<Option<Instant>>,
    client: reqwest::Client,
}

impl Default for Connectivity {
    fn default() -> Self {
        Self {
            status: Mutex::default(),
            probing: tokio::sync::Mutex::new(()),
            last_dse_check: Mutex::new(None),
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::limited(5))
                .build()
                .expect("failed to build HTTP client"),
        }
    }
}

impl Connectivity {
    pub fn status(&self) -> Status {
        self.status.lock().unwrap().clone()
    }

    /// Check now, update the status, and tell the window if anything changed.
    /// `force_dse` checks DSE even if it isn't due.
    pub async fn probe<R: Runtime>(&self, app: &AppHandle<R>, force_dse: bool) -> Status {
        let _turn = self.probing.lock().await;
        let previous = self.status();

        let mut next = previous.clone();
        next.internet = Some(internet_reachable().await);
        if next.internet == Some(false) {
            // Some networks only allow traffic through a proxy or to certain
            // sites. If DSE itself answers, that's online enough for this app.
            // (Offline, this fails in milliseconds.)
            if let Ok(ms) = dse_round_trip(&self.client).await {
                *self.last_dse_check.lock().unwrap() = Some(Instant::now());
                (next.internet, next.dse, next.dse_ms, next.dse_error) = (Some(true), Some(true), Some(ms), None);
            }
        } else {
            let due = self.last_dse_check.lock().unwrap().is_none_or(|at| {
                at.elapsed() >= if previous.dse == Some(false) { DSE_INTERVAL_DOWN } else { DSE_INTERVAL_OK }
            });
            // Coming back online is a reason to look at DSE straight away.
            if force_dse || due || previous.internet != Some(true) || previous.dse.is_none() {
                *self.last_dse_check.lock().unwrap() = Some(Instant::now());
                match dse_round_trip(&self.client).await {
                    Ok(ms) => (next.dse, next.dse_ms, next.dse_error) = (Some(true), Some(ms), None),
                    // The connection may have dropped mid-check: ask again
                    // before blaming DSE.
                    Err(_) if !internet_reachable().await => next.internet = Some(false),
                    Err(error) => (next.dse, next.dse_error) = (Some(false), Some(error)),
                }
            }
        }
        if next.internet == Some(false) {
            (next.dse, next.dse_ms, next.dse_error) = (None, None, None);
        }

        if next != previous {
            *self.status.lock().unwrap() = next.clone();
            let lines = changes(&previous, &next);
            let _ = app.emit("connectivity", ConnectivityEvent { status: next.clone(), lines });
        }
        next
    }
}

/// Runs for the life of the app.
pub fn start_monitor<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        let connectivity = app.state::<Connectivity>();
        loop {
            connectivity.probe(&app, false).await;
            tokio::time::sleep(INTERNET_INTERVAL).await;
        }
    });
}

/// Check now (system check, "Check again", Windows reporting a network
/// change). Resolves with the fresh status; changes also go out as events.
#[tauri::command]
pub async fn probe_connectivity(app: AppHandle, connectivity: State<'_, Connectivity>) -> Result<Status, ()> {
    Ok(connectivity.probe(&app, true).await)
}

pub async fn internet_reachable() -> bool {
    let attempts = PROBE_ADDRESSES.map(|address| {
        Box::pin(async move {
            match timeout(INTERNET_TIMEOUT, TcpStream::connect(address)).await {
                Ok(Ok(_)) => Ok(()),
                _ => Err(()),
            }
        })
    });
    select_ok(attempts).await.is_ok()
}

/// A HEAD request: proves DSE answers without downloading the page. 5xx and
/// timeouts count as down; anything else means the site is there.
async fn dse_round_trip(client: &reqwest::Client) -> Result<u64, HttpError> {
    let started = Instant::now();
    let response = client.head(DSE_URL).timeout(DSE_TIMEOUT).send().await?;
    let status = response.status();
    if status.is_server_error() {
        return Err(HttpError { kind: "status", message: format!("The requested URL returned error: {status}") });
    }
    Ok(started.elapsed().as_millis() as u64)
}

/// Log lines for what changed between two statuses.
fn changes(previous: &Status, next: &Status) -> Vec<LogLine> {
    let mut lines = Vec::new();
    match (previous.internet, next.internet) {
        (Some(true), Some(false)) => lines.push(LogLine::now(
            Level::Warn,
            parts!["Internet connection lost. The app will notice when it’s back."],
        )),
        (None, Some(false)) => lines.push(LogLine::now(Level::Warn, parts!["No internet connection."])),
        (Some(false), Some(true)) => lines.push(LogLine::now(Level::Success, parts!["Internet connection restored."])),
        _ => {}
    }
    match (previous.dse, next.dse) {
        (Some(true) | None, Some(false)) => {
            let reason = next.dse_error.as_ref().map(|e| e.message.as_str()).unwrap_or("no answer");
            lines.push(LogLine::now(
                Level::Warn,
                parts![
                    "The DSE website (",
                    hl(DSE_HOST),
                    ") can’t be reached ",
                    hl_as(format!("({reason})"), Tone::Subtle),
                    "."
                ],
            ));
        }
        (Some(false), Some(true)) => lines.push(LogLine::now(
            Level::Success,
            parts![
                "The DSE website is reachable again ",
                hl_as(format!("({} ms)", next.dse_ms.unwrap_or_default()), Tone::Subtle),
                "."
            ],
        )),
        _ => {}
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(internet: Option<bool>, dse: Option<bool>) -> Status {
        Status {
            internet,
            dse,
            dse_ms: dse.filter(|d| *d).map(|_| 120),
            dse_error: (dse == Some(false)).then(|| HttpError { kind: "timeout", message: "Operation timed out".into() }),
        }
    }

    fn texts(previous: Status, next: Status) -> Vec<String> {
        changes(&previous, &next)
            .iter()
            .map(|l| serde_json::to_value(l).unwrap()["parts"].as_array().unwrap().iter().map(|p| p.as_str().map(str::to_owned).unwrap_or_else(|| p["text"].as_str().unwrap().to_owned())).collect())
            .collect()
    }

    #[test]
    fn logs_internet_going_and_coming_back() {
        assert_eq!(
            texts(status(Some(true), Some(true)), status(Some(false), None)),
            ["Internet connection lost. The app will notice when it’s back."]
        );
        assert_eq!(texts(status(Some(false), None), status(Some(true), Some(true))), ["Internet connection restored."]);
        assert_eq!(texts(status(None, None), status(Some(false), None)), ["No internet connection."]);
    }

    #[test]
    fn logs_dse_going_and_coming_back() {
        assert_eq!(
            texts(status(Some(true), Some(true)), status(Some(true), Some(false))),
            ["The DSE website (old.dsebd.org) can’t be reached (Operation timed out)."]
        );
        assert_eq!(
            texts(status(Some(true), Some(false)), status(Some(true), Some(true))),
            ["The DSE website is reachable again (120 ms)."]
        );
    }

    #[test]
    fn quiet_when_nothing_changes_or_all_is_well_at_start() {
        assert!(texts(status(Some(true), Some(true)), status(Some(true), Some(true))).is_empty());
        assert!(texts(status(None, None), status(Some(true), Some(true))).is_empty());
        // Offline hides DSE's state; that's not "DSE went down".
        assert_eq!(texts(status(Some(true), Some(true)), status(Some(false), None)).len(), 1);
    }

}
