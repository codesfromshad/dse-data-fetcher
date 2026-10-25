//! Fetching DSE data, end to end: HTTP, parsing, the workbook, and the run
//! itself. The UI only starts/cancels a run and renders the events it gets
//! back over a channel.

pub mod dse;
pub mod http;
pub mod log;
pub mod metrics;
pub mod parse;
pub mod pipeline;
pub mod time;
pub mod workbook;

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use chrono::{Local, Utc};
use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, State};
use tokio_util::sync::CancellationToken;

use crate::AppState;
use dse::DSE_URL;
use http::{describe_error, HttpError};
use log::{hl, hl_as, parts, Level, Part, Tone};
use metrics::{Meter, Metrics, Snapshot, SAMPLE_INTERVAL};
use pipeline::{Counts, Options, RunError, Sink, Stage};

/// The running fetch, if any, so `cancel_fetch` can stop it.
#[derive(Default)]
pub struct FetchState {
    cancel: Mutex<Option<CancellationToken>>,
}

/// Clears the running-fetch slot however the run ends.
struct RunSlot<'a>(&'a Mutex<Option<CancellationToken>>);

impl Drop for RunSlot<'_> {
    fn drop(&mut self) {
        *self.0.lock().unwrap() = None;
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum FetchEvent {
    /// `time` is Unix time in ms.
    Log { level: Level, parts: Vec<Part>, time: i64 },
    Progress { stage: Stage, status: String, counts: Counts },
    /// Network metrics, a few times a second (only with the setting on).
    Metrics(Snapshot),
}

struct ChannelSink(Channel<FetchEvent>);

impl ChannelSink {
    fn metrics(&self, snapshot: Snapshot) {
        let _ = self.0.send(FetchEvent::Metrics(snapshot));
    }
}

impl Sink for ChannelSink {
    fn log(&self, level: Level, parts: Vec<Part>) {
        let _ = self.0.send(FetchEvent::Log { level, parts, time: Utc::now().timestamp_millis() });
    }

    fn progress(&self, stage: Stage, status: String, counts: Counts) {
        let _ = self.0.send(FetchEvent::Progress { stage, status, counts });
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResult {
    file_name: String,
    file_path: String,
    counts: Counts,
    failed_symbols: Vec<String>,
    elapsed_ms: u64,
    opened: bool,
    /// Final network numbers for the fetching part of the run.
    network: Snapshot,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchError {
    /// "cancelled" | "offline" | "busy" | "failed"
    kind: &'static str,
    message: String,
}

impl FetchError {
    fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }
}

enum Failure {
    Cancelled,
    Offline,
    Failed(String),
}

impl From<RunError> for Failure {
    fn from(error: RunError) -> Self {
        match error {
            RunError::Cancelled => Failure::Cancelled,
            RunError::Failed(message) => Failure::Failed(message),
        }
    }
}

const OFFLINE_MESSAGE: &str = "No internet connection. Please connect to the internet and try again.";

/// Run a whole fetch. Logs and progress stream over `on_event`; resolves with
/// the workbook's location, or a `FetchError` (already logged).
#[tauri::command]
pub async fn start_fetch(
    app: AppHandle,
    state: State<'_, AppState>,
    fetch: State<'_, FetchState>,
    open_after: bool,
    on_event: Channel<FetchEvent>,
) -> Result<FetchResult, FetchError> {
    let cancel = {
        let mut slot = fetch.cancel.lock().unwrap();
        if slot.is_some() {
            return Err(FetchError::new("busy", "A fetch is already running."));
        }
        let token = CancellationToken::new();
        *slot = Some(token.clone());
        token
    };
    let _slot = RunSlot(&fetch.cancel);
    let sink = ChannelSink(on_event);

    match run(&app, &state, &sink, &cancel, open_after).await {
        Ok(result) => Ok(result),
        Err(Failure::Cancelled) => {
            sink.log(Level::Warn, parts!["Fetch cancelled."]);
            Err(FetchError::new("cancelled", "Fetch cancelled."))
        }
        Err(Failure::Offline) => {
            sink.log(Level::Error, parts![OFFLINE_MESSAGE]);
            Err(FetchError::new("offline", OFFLINE_MESSAGE))
        }
        Err(Failure::Failed(reason)) => {
            let message = format!("Fetch failed: {reason}");
            sink.log(Level::Error, parts![message.clone()]);
            Err(FetchError::new("failed", message))
        }
    }
}

/// Stop the running fetch (no-op when none is running).
#[tauri::command]
pub fn cancel_fetch(fetch: State<'_, FetchState>) {
    if let Some(token) = fetch.cancel.lock().unwrap().as_ref() {
        token.cancel();
    }
}

/// Startup check: is the DSE site reachable? Returns the round trip in ms.
#[tauri::command]
pub async fn check_dse() -> Result<u64, HttpError> {
    let started = Instant::now();
    http::get_once(&http::new_client(), DSE_URL, &[], Duration::from_secs(10), &Metrics::default()).await?;
    Ok(started.elapsed().as_millis() as u64)
}

async fn run(
    app: &AppHandle,
    state: &AppState,
    sink: &ChannelSink,
    cancel: &CancellationToken,
    open_after: bool,
) -> Result<FetchResult, Failure> {
    let started = Instant::now();
    sink.progress(Stage::Connecting, "Checking internet connection...".into(), Counts::default());
    if !http::check_online().await {
        return Err(Failure::Offline);
    }
    if cancel.is_cancelled() {
        return Err(Failure::Cancelled);
    }

    // Settings are read live, so changing them mid-run applies at once.
    let max_retries = || state.settings.lock().unwrap().preferences.fetch_retries;
    let show_metrics = || state.settings.lock().unwrap().preferences.show_network_metrics;
    let metrics = Metrics::default();
    let mut meter = Meter::new(started);
    let fetch_all = pipeline::fetch_all(Options {
        base_url: DSE_URL,
        cancel,
        metrics: &metrics,
        sink,
        max_retries: &max_retries,
        retry_unit: Duration::from_secs(1),
        retry_cap: Duration::from_secs(15),
    });
    tokio::pin!(fetch_all);
    // Sample the counters on a timer while the fetch runs.
    let mut ticker = tokio::time::interval(SAMPLE_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let fetched = loop {
        tokio::select! {
            result = &mut fetch_all => break result,
            _ = ticker.tick() => {
                let snapshot = meter.sample(&metrics);
                if show_metrics() {
                    sink.metrics(snapshot);
                }
            }
        }
    };
    let elapsed = started.elapsed();
    let network = meter.finish(&metrics, elapsed);
    let show = show_metrics();
    if show {
        sink.metrics(network);
    }
    let mut fetched = fetched?;
    pipeline::log_complete(sink, &fetched, elapsed, show.then_some(&network));

    let counts = fetched.counts;
    sink.progress(Stage::Writing, "Creating spreadsheet...".into(), counts);
    let file_name = format!("temp_stock_data_{}.xlsx", time::file_timestamp(Local::now()));
    let rows = std::mem::take(&mut fetched.rows);
    let bytes = tokio::task::spawn_blocking(move || workbook::build(&rows))
        .await
        .map_err(|e| Failure::Failed(e.to_string()))?
        .map_err(|e| Failure::Failed(format!("Couldn't create the spreadsheet: {e}")))?;
    let path = crate::write_temp_file(state, &file_name, &bytes).map_err(Failure::Failed)?;
    let file_path = path.to_string_lossy().into_owned();
    sink.log(Level::Success, parts!["Created ", hl(&file_name), " with the fetched stock data."]);
    sink.log(
        Level::Info,
        parts![
            hl(&file_name),
            " is a temporary file and WILL BE DELETED when you close this app. Use “Save a copy” to keep it."
        ],
    );

    let mut result = FetchResult {
        file_name,
        file_path,
        counts,
        failed_symbols: fetched.failed_symbols,
        elapsed_ms: elapsed.as_millis() as u64,
        opened: false,
        network,
    };

    if !open_after {
        sink.log(
            Level::Warn,
            parts![
                "No spreadsheet application is set up, so ",
                hl(&result.file_name),
                " wasn’t opened. Choose one in Settings, or use “Save a copy”."
            ],
        );
        return Ok(result);
    }

    sink.progress(Stage::Opening, format!("Opening {}...", result.file_name), counts);
    match crate::open_known_file(app, state, &path) {
        Ok(()) => {
            result.opened = true;
            sink.log(Level::Success, parts!["Opened ", hl(&result.file_name), " using the default spreadsheet application."]);
        }
        Err(error) => sink.log(
            Level::Error,
            parts![
                "Couldn't open the file automatically ",
                hl_as(format!("({})", describe_error(&error)), Tone::Subtle),
                ". It's at: ",
                hl(&result.file_path),
            ],
        ),
    }
    Ok(result)
}
