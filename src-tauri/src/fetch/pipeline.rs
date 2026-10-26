//! The fetch run: cookie → symbols → company pages (a few at a time, with
//! retries) → sorted rows. UI-agnostic: reports through a `Sink`.

use std::{sync::Mutex, time::Duration};

use futures_util::{stream, TryStreamExt};
use serde::Serialize;
use tokio_util::sync::CancellationToken;

use super::{
    dse::{is_treasury_bond, Dse},
    http::{describe_error, Cancelled, GetError, HttpError},
    log::{hl, hl_as, parts, pill, symbol as symbol_link, symbol_list, Level, Part, Tone},
    metrics::{format_bytes, format_rate, Metrics, Snapshot},
    pause::Pause,
    parse::{parse_company_page, CompanyRow, ParseResult},
    time::format_duration,
    workbook::incomplete_fields,
};

/// Company pages fetched at once. Gentler on DSE than firing every symbol in
/// parallel, and barely slower.
pub const CONCURRENCY: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    Connecting,
    Symbols,
    Companies,
    Writing,
    Opening,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct Counts {
    pub total: usize,
    pub fetched: usize,
    pub skipped: usize,
    pub failed: usize,
}

/// Where logs and progress go (a Tauri channel in the app, a Vec in tests).
pub trait Sink: Sync {
    fn log(&self, level: Level, parts: Vec<Part>);
    fn progress(&self, stage: Stage, status: String, counts: Counts);
}

pub struct Options<'a> {
    pub base_url: &'a str,
    pub cancel: &'a CancellationToken,
    /// Held before each company page (and retry) while the run is paused.
    pub pause: &'a Pause,
    /// Byte/request counters for every request of the run.
    pub metrics: &'a Metrics,
    pub sink: &'a dyn Sink,
    /// Retries per company page, read before each retry. `None` = unlimited.
    pub max_retries: &'a (dyn Fn() -> Option<u32> + Sync),
    /// Waits between retries of one page: unit, 2×unit, 4×unit... up to `retry_cap`.
    pub retry_unit: Duration,
    pub retry_cap: Duration,
}

pub struct Fetched {
    /// Sorted by symbol.
    pub rows: Vec<CompanyRow>,
    pub counts: Counts,
    pub failed_symbols: Vec<String>,
    /// Kept with blank cells after running out of retries. Sorted.
    pub incomplete_symbols: Vec<String>,
}

#[derive(Debug)]
pub enum RunError {
    Cancelled,
    Failed(String),
}

impl From<Cancelled> for RunError {
    fn from(_: Cancelled) -> Self {
        RunError::Cancelled
    }
}

impl From<GetError> for RunError {
    fn from(error: GetError) -> Self {
        match error {
            GetError::Cancelled => RunError::Cancelled,
            GetError::Http(e) => RunError::Failed(describe_error(&e)),
        }
    }
}

#[derive(Default)]
struct Shared {
    counts: Counts,
    rows: Vec<CompanyRow>,
    failed: Vec<String>,
    incomplete: Vec<String>,
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

fn wait_for(attempt: u32, options: &Options) -> Duration {
    let factor = 1u32 << attempt.saturating_sub(1).min(20);
    options.retry_unit.saturating_mul(factor).min(options.retry_cap)
}

async fn fetch_company(dse: &Dse<'_>, symbol: &str, cancel: &CancellationToken) -> Result<Result<ParseResult, String>, Cancelled> {
    let html = match dse.fetch_company_html(symbol, cancel).await {
        Ok(html) => html,
        Err(GetError::Cancelled) => return Err(Cancelled),
        Err(GetError::Http(e)) => return Ok(Err(e.message)),
    };
    // html5ever can take a while on a big page; keep it off the async workers.
    let symbol = symbol.to_string();
    let parsed = tokio::task::spawn_blocking(move || parse_company_page(&html, &symbol)).await;
    Ok(parsed.unwrap_or_else(|e| Err(format!("Parser crashed: {e}"))))
}

pub async fn fetch_all(options: Options<'_>) -> Result<Fetched, RunError> {
    let Options { base_url, cancel, pause, sink, max_retries, metrics, .. } = options;
    let shared = Mutex::new(Shared::default());
    let report = |stage: Stage, status: String| sink.progress(stage, status, shared.lock().unwrap().counts);
    let retry_logger = |what: &'static str| {
        move |error: &HttpError, attempt: u32, wait: Duration| {
            sink.log(
                Level::Warn,
                parts![
                    format!("{what} failed "),
                    hl_as(format!("({})", describe_error(error)), Tone::Subtle),
                    format!(". Retrying in {}s (attempt {attempt})...", wait.as_secs_f64().round()),
                ],
            )
        }
    };

    let dse = Dse::new(base_url, metrics);
    report(Stage::Connecting, format!("Fetching cookie from {base_url}..."));
    pause.wait(cancel).await?;
    dse.fetch_cookie(cancel, retry_logger("Fetching the cookie")).await?;
    sink.log(Level::Success, parts![format!("Cookie fetched from {base_url} successfully!")]);

    report(Stage::Symbols, "Fetching ticker symbols...".into());
    pause.wait(cancel).await?;
    let symbols = dse.fetch_symbols(cancel, retry_logger("Fetching ticker symbols")).await?;
    shared.lock().unwrap().counts.total = symbols.len();
    sink.log(
        Level::Success,
        parts![format!("Ticker symbols retrieved from {base_url} successfully! ("), hl(symbols.len()), " symbols)"],
    );

    let company_progress = || {
        let counts = shared.lock().unwrap().counts;
        let done = counts.fetched + counts.skipped + counts.failed;
        sink.progress(Stage::Companies, format!("Fetching company pages · {done} of {} processed", counts.total), counts);
    };
    company_progress();

    let keep_incomplete = |symbol: &str, row: CompanyRow, missing: &[&str], attempts: Part| {
        let mut s = shared.lock().unwrap();
        s.rows.push(row);
        s.counts.fetched += 1;
        s.incomplete.push(symbol.to_string());
        drop(s);
        sink.log(
            Level::Warn,
            parts!["Kept incomplete data for ", symbol_link(symbol), " after ", attempts, ". Blank: ", hl_as(missing.join(", "), Tone::Subtle)],
        );
    };

    let process = |symbol: String| {
        let dse = &dse;
        let shared = &shared;
        let company_progress = &company_progress;
        let keep_incomplete = &keep_incomplete;
        let options = &options;
        async move {
            if is_treasury_bond(&symbol) {
                shared.lock().unwrap().counts.skipped += 1;
                sink.log(Level::Info, parts!["Skipping treasury bond ", symbol_link(&symbol), "..."]);
                company_progress();
                return Ok::<(), Cancelled>(());
            }

            // The best incomplete copy so far, kept if we run out of retries.
            let mut partial: Option<(CompanyRow, Vec<&'static str>)> = None;

            for attempt in 1u32.. {
                // Paused: in-flight pages finish, but this one waits.
                pause.wait(cancel).await?;
                if cancel.is_cancelled() {
                    return Err(Cancelled);
                }
                let limit = max_retries();
                let can_retry = limit.is_none_or(|l| attempt <= l);
                let retry_label = match limit {
                    None => format!("retry {attempt}"),
                    Some(l) => format!("retry {attempt}/{l}"),
                };
                let attempts = hl(plural(attempt as usize, "attempt", "attempts"));

                let result = match fetch_company(dse, &symbol, cancel).await? {
                    Ok(result) => result,
                    Err(error) => {
                        if can_retry {
                            sink.log(
                                Level::Warn,
                                parts![
                                    "Failed to fetch stock data for ",
                                    symbol_link(&symbol),
                                    " ",
                                    hl_as(format!("({})", describe_error(&error)), Tone::Subtle),
                                    format!(". Retrying ({retry_label})..."),
                                ],
                            );
                            super::http::sleep(wait_for(attempt, options), cancel).await?;
                            continue;
                        }
                        if let Some((row, missing)) = partial.take() {
                            keep_incomplete(&symbol, row, &missing, attempts);
                        } else {
                            let mut s = shared.lock().unwrap();
                            s.counts.failed += 1;
                            s.failed.push(symbol.clone());
                            drop(s);
                            sink.log(
                                Level::Error,
                                parts![
                                    "Failed to fetch stock data for ",
                                    symbol_link(&symbol),
                                    " after ",
                                    attempts,
                                    ": ",
                                    hl_as(describe_error(&error), Tone::Subtle),
                                ],
                            );
                        }
                        break;
                    }
                };

                let row = match result {
                    ParseResult::Skip(reason) => {
                        shared.lock().unwrap().counts.skipped += 1;
                        sink.log(Level::Info, parts![format!("Skipping {reason} "), symbol_link(&symbol), "..."]);
                        break;
                    }
                    ParseResult::Row(row) => *row,
                };

                let missing = incomplete_fields(&row);
                if missing.is_empty() {
                    let mut s = shared.lock().unwrap();
                    s.rows.push(row);
                    s.counts.fetched += 1;
                    drop(s);
                    let after = if attempt > 1 { format!(" (after {attempt} attempts)") } else { String::new() };
                    sink.log(Level::Success, parts!["Fetched stock data for ", symbol_link(&symbol), after]);
                    break;
                }

                let missing_text = missing.join(", ");
                if partial.as_ref().is_none_or(|(_, best)| missing.len() <= best.len()) {
                    partial = Some((row, missing));
                }
                if !can_retry {
                    let (row, missing) = partial.take().expect("just set");
                    keep_incomplete(&symbol, row, &missing, attempts);
                    break;
                }
                sink.log(
                    Level::Warn,
                    parts![
                        "Incomplete data for ",
                        symbol_link(&symbol),
                        " ",
                        hl_as(format!("(NaN/missing: {missing_text})"), Tone::Subtle),
                        format!(". Fetching again ({retry_label})..."),
                    ],
                );
                super::http::sleep(wait_for(attempt, options), cancel).await?;
            }
            company_progress();
            Ok(())
        }
    };

    stream::iter(symbols.into_iter().map(Ok)).try_for_each_concurrent(CONCURRENCY, process).await?;

    let Shared { counts, mut rows, failed, mut incomplete } = shared.into_inner().unwrap();
    rows.sort_by(|a, b| a.symbol.cmp(&b.symbol));
    incomplete.sort();
    Ok(Fetched { rows, counts, failed_symbols: failed, incomplete_symbols: incomplete })
}

/// The "Fetching COMPLETE" line plus failed/incomplete symbol lists, and the
/// network summary when metrics are on.
pub fn log_complete(sink: &dyn Sink, fetched: &Fetched, elapsed: Duration, network: Option<&Snapshot>) {
    let incomplete = &fetched.incomplete_symbols;
    let c = fetched.counts;
    let failed_part = if c.failed > 0 { hl_as(format!("{} failed", c.failed), Tone::Danger) } else { "0 failed".into() };
    sink.log(
        Level::Success,
        parts![
            "Fetching ",
            pill("COMPLETE", Tone::Success),
            " for all ",
            hl(plural(c.total, "symbol", "symbols")),
            " (",
            hl_as(format!("{} fetched", c.fetched), Tone::Success),
            ", ",
            hl_as(format!("{} skipped", c.skipped), Tone::Info),
            ", ",
            failed_part,
            "). Elapsed time: ",
            pill(format_duration(elapsed), Tone::Subtle),
        ],
    );
    if let Some(n) = network {
        sink.log(
            Level::Info,
            parts![
                "Network: ",
                hl(format_bytes(n.transferred)),
                " transferred, ",
                hl(format_bytes(n.processed)),
                " processed in ",
                hl(n.requests),
                " requests. Average ",
                hl(format_rate(n.average_rate)),
                ", peak ",
                hl(format_rate(n.peak_rate)),
                ".",
            ],
        );
    }
    if !fetched.failed_symbols.is_empty() {
        let mut line = parts!["Failed symbols: "];
        line.extend(symbol_list(&fetched.failed_symbols));
        sink.log(Level::Warn, line);
    }
    if !incomplete.is_empty() {
        let mut line = parts!["Symbols with blank (NaN/missing) values: "];
        line.extend(symbol_list(incomplete));
        sink.log(Level::Warn, line);
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
    };

    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    use super::*;
    use crate::fetch::{log::plain, parse::fixture_page};

    #[derive(Default)]
    struct VecSink(Mutex<Vec<(Level, String)>>);

    impl Sink for VecSink {
        fn log(&self, level: Level, parts: Vec<Part>) {
            self.0.lock().unwrap().push((level, plain(&parts)));
        }
        fn progress(&self, _: Stage, _: String, _: Counts) {}
    }

    const MAINTENANCE: &str = "<html><body>Under maintenance</body></html>";

    /// A fake old.dsebd.org. Returns its base URL.
    async fn serve() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}/", listener.local_addr().unwrap());
        let hits: Arc<Mutex<HashMap<String, usize>>> = Arc::default();
        tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let hits = hits.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0; 8192];
                    let mut len = 0;
                    while !buf[..len].windows(4).any(|w| w == b"\r\n\r\n") {
                        let n = socket.read(&mut buf[len..]).await.unwrap();
                        if n == 0 {
                            return;
                        }
                        len += n;
                    }
                    let request = String::from_utf8_lossy(&buf[..len]);
                    let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let hit = {
                        let mut hits = hits.lock().unwrap();
                        let n = hits.entry(path.clone()).or_default();
                        *n += 1;
                        *n
                    };
                    let body = match path.as_str() {
                        "/" => "home".to_string(),
                        "/ajax/suggestList.php?suggestType=tc" => {
                            r#"["GOOD","FLAKY","BLANKY","DEBT","TB10Y0131","BROKEN"]"#.to_string()
                        }
                        p => match p.strip_prefix("/displayCompany.php?name=").unwrap_or("") {
                            "GOOD" => fixture_page("Bank", "10.5", true),
                            "FLAKY" if hit == 1 => MAINTENANCE.to_string(),
                            "FLAKY" => fixture_page("Bank", "20", true),
                            "BLANKY" => fixture_page("Bank", "-", true),
                            "DEBT" => fixture_page("Debenture", "100", false),
                            _ => MAINTENANCE.to_string(),
                        },
                    };
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                });
            }
        });
        base
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn pausing_holds_new_pages_until_resumed_or_stopped() {
        let base = serve().await;
        let max_retries = || Some(2);

        // Paused from the start: nothing is requested until it's resumed.
        {
            let (cancel, pause, metrics, sink) = (CancellationToken::new(), Pause::default(), Metrics::default(), VecSink::default());
            pause.set(true);
            let run = fetch_all(Options {
                base_url: &base,
                cancel: &cancel,
                pause: &pause,
                metrics: &metrics,
                sink: &sink,
                max_retries: &max_retries,
                retry_unit: Duration::from_millis(1),
                retry_cap: Duration::from_millis(5),
            });
            tokio::pin!(run);
            assert!(tokio::time::timeout(Duration::from_millis(150), &mut run).await.is_err(), "held while paused");
            assert_eq!(metrics.requests(), 0);
            pause.set(false);
            let fetched = run.await.unwrap_or_else(|e| panic!("{e:?}"));
            assert_eq!(fetched.counts, Counts { total: 6, fetched: 3, skipped: 2, failed: 1 });
        }

        // Stopping while paused ends the run.
        {
            let (cancel, pause, metrics, sink) = (CancellationToken::new(), Pause::default(), Metrics::default(), VecSink::default());
            pause.set(true);
            let run = fetch_all(Options {
                base_url: &base,
                cancel: &cancel,
                pause: &pause,
                metrics: &metrics,
                sink: &sink,
                max_retries: &max_retries,
                retry_unit: Duration::from_millis(1),
                retry_cap: Duration::from_millis(5),
            });
            tokio::pin!(run);
            assert!(tokio::time::timeout(Duration::from_millis(50), &mut run).await.is_err());
            cancel.cancel();
            assert!(matches!(run.await, Err(RunError::Cancelled)));
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn full_run_against_a_fake_dse() {
        let base = serve().await;
        let sink = VecSink::default();
        let cancel = CancellationToken::new();
        let reads = AtomicUsize::new(0);
        let metrics = Metrics::default();
        let max_retries = || {
            reads.fetch_add(1, Ordering::Relaxed);
            Some(2)
        };
        let fetched = fetch_all(Options {
            base_url: &base,
            cancel: &cancel,
            pause: &Pause::default(),
            metrics: &metrics,
            sink: &sink,
            max_retries: &max_retries,
            retry_unit: Duration::from_millis(1),
            retry_cap: Duration::from_millis(5),
        })
        .await
        .unwrap_or_else(|e| panic!("{e:?}"));

        assert_eq!(fetched.counts, Counts { total: 6, fetched: 3, skipped: 2, failed: 1 });
        let symbols: Vec<_> = fetched.rows.iter().map(|r| r.symbol.as_str()).collect();
        assert_eq!(symbols, ["BLANKY", "FLAKY", "GOOD"]);
        assert_eq!(fetched.failed_symbols, ["BROKEN"]);
        assert_eq!(fetched.incomplete_symbols, ["BLANKY"]);
        assert_eq!(fetched.rows[1].yesterdays_closing_price, Some(20.0));
        assert_eq!(fetched.rows[0].yesterdays_closing_price, None);
        assert!(reads.load(Ordering::Relaxed) > 0, "max_retries is read live");
        // Every response is counted; the fake server doesn't compress, so
        // processed == transferred.
        assert!(metrics.requests() >= 8, "requests: {}", metrics.requests());
        assert!(metrics.transferred() > 0);
        assert_eq!(metrics.processed(), metrics.transferred());

        let logs = sink.0.into_inner().unwrap();
        let has = |level: Level, needle: &str| logs.iter().any(|(l, t)| *l == level && t.contains(needle));
        assert!(has(Level::Info, "Skipping treasury bond TB10Y0131"));
        assert!(has(Level::Info, "Skipping debenture DEBT"));
        assert!(has(Level::Success, "Fetched stock data for FLAKY (after 2 attempts)"));
        assert!(has(Level::Warn, "Incomplete data for BLANKY (NaN/missing: Yesterday's Closing Price). Fetching again (retry 1/2)"));
        assert!(has(Level::Warn, "Kept incomplete data for BLANKY after 3 attempts"));
        assert!(has(Level::Error, "Failed to fetch stock data for BROKEN after 3 attempts: company name not found on page"));

        let mut complete = VecSink::default();
        let network = Snapshot { transferred: 2048, processed: 8192, requests: 9, rate: 0.0, peak_rate: 4096.0, average_rate: 1024.0 };
        log_complete(&complete, &fetched, Duration::from_millis(1500), Some(&network));
        let lines = std::mem::take(complete.0.get_mut().unwrap());
        assert_eq!(
            lines[0].1,
            "Fetching COMPLETE for all 6 symbols (3 fetched, 2 skipped, 1 failed). Elapsed time: 00:00:01.500"
        );
        assert_eq!(
            lines[1].1,
            "Network: 2.00 KB transferred, 8.00 KB processed in 9 requests. Average 1.00 KB/s, peak 4.00 KB/s."
        );
        assert_eq!(lines[2].1, "Failed symbols: BROKEN");
        assert_eq!(lines[3].1, "Symbols with blank (NaN/missing) values: BLANKY");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn cancelling_stops_the_run() {
        let base = serve().await;
        let sink = VecSink::default();
        let cancel = CancellationToken::new();
        cancel.cancel();
        let result = fetch_all(Options {
            base_url: &base,
            cancel: &cancel,
            pause: &Pause::default(),
            metrics: &Metrics::default(),
            sink: &sink,
            max_retries: &|| None,
            retry_unit: Duration::from_millis(1),
            retry_cap: Duration::from_millis(5),
        })
        .await;
        assert!(matches!(result, Err(RunError::Cancelled)));
    }
}
