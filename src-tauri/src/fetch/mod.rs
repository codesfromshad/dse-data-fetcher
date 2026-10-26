//! Fetching DSE data, end to end: HTTP, parsing, the workbook, and the run
//! itself. The UI only starts/cancels a run and renders the events it gets
//! back over a channel.

pub mod dse;
pub mod http;
pub mod log;
pub mod metrics;
pub mod parse;
pub mod pause;
pub mod pipeline;
pub mod time;
pub mod workbook;

use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use chrono::Local;
use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tokio_util::sync::CancellationToken;

use crate::AppState;
use dse::DSE_URL;
use http::describe_error;
use log::{hl, hl_as, parts, Level, Part, Tone};
use metrics::{Meter, Metrics, Snapshot, SAMPLE_INTERVAL};
use pause::Pause;
use pipeline::{Counts, Options, RunError, Sink, Stage};

/// The running fetch, if any, so `cancel_fetch` can stop it and
/// `set_fetch_paused` pause it.
#[derive(Default)]
pub struct FetchState {
    run: Mutex<Option<Controls>>,
}

#[derive(Clone)]
struct Controls {
    cancel: CancellationToken,
    pause: Arc<Pause>,
}

/// Clears the running-fetch slot however the run ends.
struct RunSlot<'a>(&'a Mutex<Option<Controls>>);

impl Drop for RunSlot<'_> {
    fn drop(&mut self) {
        *self.0.lock().unwrap() = None;
    }
}

/// One activity-log line, stamped and formatted here (mirrors `LogLine` in
/// src/lib/fetch.ts).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    level: Level,
    parts: Vec<Part>,
    /// YYYY-MM-DDTHH:mm:ss.SSS±HH:MM, for copy/export.
    time: String,
    /// HH:mm:ss.SSS, shown in the list.
    short_time: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum FetchEvent {
    /// Log lines in order, batched: one IPC message per `LOG_FLUSH_INTERVAL`
    /// instead of one per line.
    Logs(Vec<LogLine>),
    Progress { stage: Stage, status: String, counts: Counts },
    /// Network metrics, a few times a second (only with the setting on).
    Metrics(Snapshot),
}

/// How long a log line may wait to be sent with the ones after it. Matches
/// the UI's render throttle, so batching here adds no visible delay.
const LOG_FLUSH_INTERVAL: Duration = Duration::from_millis(50);
/// Send early once this many lines are queued.
const LOG_BATCH_MAX: usize = 256;

/// Where events go: the Tauri channel, or a Vec in tests.
trait Outbox: Sync {
    fn send(&self, event: FetchEvent);
}

impl Outbox for Channel<FetchEvent> {
    fn send(&self, event: FetchEvent) {
        let _ = Channel::send(self, event);
    }
}

#[derive(Default)]
struct Pending {
    lines: Vec<LogLine>,
    /// When the oldest queued line was logged.
    since: Option<Instant>,
}

/// Streams a run to the UI. Log lines are queued and sent in batches (when
/// `LOG_FLUSH_INTERVAL` has passed, `LOG_BATCH_MAX` are waiting, or before
/// any progress event, so order is kept). A burst of 1000 lines is a handful
/// of IPC messages, not 1000 JSON parses and callbacks in the window.
struct ChannelSink<O: Outbox = Channel<FetchEvent>> {
    out: O,
    pending: Mutex<Pending>,
}

impl<O: Outbox> ChannelSink<O> {
    fn new(out: O) -> Self {
        Self { out, pending: Mutex::new(Pending::default()) }
    }

    fn metrics(&self, snapshot: Snapshot) {
        self.out.send(FetchEvent::Metrics(snapshot));
    }

    /// Send whatever is queued. Called on a timer during the run and once at the end.
    fn flush(&self) {
        let mut pending = self.pending.lock().unwrap();
        self.send_pending(&mut pending);
    }

    fn send_pending(&self, pending: &mut Pending) {
        pending.since = None;
        if !pending.lines.is_empty() {
            self.out.send(FetchEvent::Logs(std::mem::take(&mut pending.lines)));
        }
    }
}

impl LogLine {
    /// A line stamped with the current local time.
    pub fn now(level: Level, parts: Vec<Part>) -> Self {
        let (time, short_time) = time::log_stamps(Local::now());
        Self { level, parts, time, short_time }
    }
}

impl<O: Outbox> Sink for ChannelSink<O> {
    fn log(&self, level: Level, parts: Vec<Part>) {
        let line = LogLine::now(level, parts);
        // Sent under the lock so lines from concurrent requests stay in order.
        let mut pending = self.pending.lock().unwrap();
        pending.lines.push(line);
        let since = *pending.since.get_or_insert_with(Instant::now);
        if pending.lines.len() >= LOG_BATCH_MAX || since.elapsed() >= LOG_FLUSH_INTERVAL {
            self.send_pending(&mut pending);
        }
    }

    fn progress(&self, stage: Stage, status: String, counts: Counts) {
        let mut pending = self.pending.lock().unwrap();
        self.send_pending(&mut pending);
        self.out.send(FetchEvent::Progress { stage, status, counts });
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
    let Controls { cancel, pause } = {
        let mut slot = fetch.run.lock().unwrap();
        if slot.is_some() {
            return Err(FetchError::new("busy", "A fetch is already running."));
        }
        let controls = Controls { cancel: CancellationToken::new(), pause: Arc::default() };
        *slot = Some(controls.clone());
        controls
    };
    let _slot = RunSlot(&fetch.run);
    let sink = ChannelSink::new(on_event);

    let outcome = match run(&app, &state, &sink, &cancel, &pause, open_after).await {
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
    };
    // The last lines go out before the command resolves.
    sink.flush();
    outcome
}

/// Stop the running fetch (no-op when none is running). Works while paused.
#[tauri::command]
pub fn cancel_fetch(fetch: State<'_, FetchState>) {
    if let Some(run) = fetch.run.lock().unwrap().as_ref() {
        run.cancel.cancel();
    }
}

/// Pause or resume the running fetch. Pages already downloading finish; no
/// new ones start while paused. Returns whether the run is now paused (false
/// when none is running).
#[tauri::command]
pub fn set_fetch_paused(fetch: State<'_, FetchState>, paused: bool) -> bool {
    match fetch.run.lock().unwrap().as_ref() {
        Some(run) => {
            run.pause.set(paused);
            run.pause.is_paused()
        }
        None => false,
    }
}

async fn run(
    app: &AppHandle,
    state: &AppState,
    sink: &ChannelSink<impl Outbox>,
    cancel: &CancellationToken,
    pause: &Pause,
    open_after: bool,
) -> Result<FetchResult, Failure> {
    let started = Instant::now();
    sink.progress(Stage::Connecting, "Checking internet connection...".into(), Counts::default());
    // The same check the connection monitor runs, so a run that finds no
    // connection also updates the status everywhere else (and vice versa).
    let connectivity = app.state::<crate::connectivity::Connectivity>();
    if connectivity.probe(app, false).await.internet != Some(true) {
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
        pause,
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
    // ...and send queued log lines that nothing else has pushed out.
    let mut log_ticker = tokio::time::interval(LOG_FLUSH_INTERVAL);
    log_ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut paused = pause.subscribe();
    let fetched = loop {
        tokio::select! {
            result = &mut fetch_all => break result,
            Ok(()) = paused.changed() => {
                if *paused.borrow_and_update() {
                    sink.log(
                        Level::Warn,
                        parts!["Fetch paused. Pages already downloading will finish; no new ones start until you resume."],
                    );
                } else {
                    sink.log(Level::Info, parts!["Fetch resumed."]);
                }
                sink.flush();
            }
            _ = ticker.tick() => {
                let snapshot = meter.sample(&metrics);
                if show_metrics() {
                    sink.metrics(snapshot);
                }
            }
            _ = log_ticker.tick() => sink.flush(),
        }
    };
    // Time spent paused doesn't count, for the elapsed time or average speed.
    let elapsed = started.elapsed().saturating_sub(pause.total());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct VecOutbox(Mutex<Vec<FetchEvent>>);

    impl Outbox for VecOutbox {
        fn send(&self, event: FetchEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    fn sent(sink: &ChannelSink<VecOutbox>) -> Vec<FetchEvent> {
        std::mem::take(&mut *sink.out.0.lock().unwrap())
    }

    fn batch_sizes(events: &[FetchEvent]) -> Vec<usize> {
        events
            .iter()
            .filter_map(|e| match e {
                FetchEvent::Logs(lines) => Some(lines.len()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn a_burst_of_lines_is_a_few_messages() {
        let sink = ChannelSink::new(VecOutbox::default());
        for i in 0..1000 {
            sink.log(Level::Info, parts![format!("line {i}")]);
        }
        sink.flush();
        let events = sent(&sink);
        let sizes = batch_sizes(&events);
        assert_eq!(sizes.iter().sum::<usize>(), 1000);
        assert!(events.len() <= 1000 / LOG_BATCH_MAX + 1, "{} messages", events.len());
        // In order.
        let texts: Vec<String> = events
            .iter()
            .flat_map(|e| match e {
                FetchEvent::Logs(lines) => lines.iter().map(|l| log::plain(&l.parts)).collect::<Vec<_>>(),
                _ => vec![],
            })
            .collect();
        assert_eq!(texts[0], "line 0");
        assert_eq!(texts[999], "line 999");
    }

    #[test]
    fn progress_sends_queued_lines_first() {
        let sink = ChannelSink::new(VecOutbox::default());
        sink.log(Level::Info, parts!["before"]);
        sink.progress(Stage::Writing, "Writing".into(), Counts::default());
        sink.log(Level::Info, parts!["after"]);
        sink.flush();
        let events = sent(&sink);
        assert!(matches!(&events[0], FetchEvent::Logs(l) if l.len() == 1));
        assert!(matches!(&events[1], FetchEvent::Progress { .. }));
        assert!(matches!(&events[2], FetchEvent::Logs(l) if l.len() == 1));
        sink.flush();
        assert!(sent(&sink).is_empty(), "flushing an empty queue sends nothing");
    }

    #[test]
    fn old_lines_go_out_without_waiting_for_a_flush() {
        let sink = ChannelSink::new(VecOutbox::default());
        sink.log(Level::Info, parts!["first"]);
        std::thread::sleep(LOG_FLUSH_INTERVAL + Duration::from_millis(5));
        sink.log(Level::Info, parts!["second"]);
        assert_eq!(batch_sizes(&sent(&sink)), vec![2]);
    }

    #[test]
    fn serializes_for_the_ui() {
        let sink = ChannelSink::new(VecOutbox::default());
        sink.log(Level::Warn, parts!["x"]);
        sink.flush();
        let json = serde_json::to_value(&sent(&sink)[0]).unwrap();
        assert_eq!(json["event"], "logs");
        let line = &json["data"][0];
        assert_eq!(line["level"], "warn");
        assert_eq!(line["parts"][0], "x");
        assert_eq!(line["shortTime"].as_str().unwrap().len(), "00:00:00.000".len());
        assert!(line["time"].as_str().unwrap().contains('T'));
    }
}
