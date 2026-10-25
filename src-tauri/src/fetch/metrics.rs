//! Network metrics for a fetch run: bytes on the wire (as received, usually
//! compressed), bytes decoded (the HTML/JSON actually processed), requests,
//! and the transfer rate.
//!
//! Counting is a couple of relaxed atomic adds per network chunk, so it's
//! always on; whether the numbers are shown is a setting.

use std::{
    collections::VecDeque,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};

use serde::Serialize;

/// How often the UI gets a fresh sample while a run is going.
pub const SAMPLE_INTERVAL: Duration = Duration::from_millis(250);
/// The live rate is averaged over this much recent history, so it doesn't
/// jump around with every chunk.
const RATE_WINDOW: Duration = Duration::from_secs(1);

#[derive(Debug, Default)]
pub struct Metrics {
    transferred: AtomicU64,
    processed: AtomicU64,
    requests: AtomicU64,
}

impl Metrics {
    /// A chunk arrived from the network.
    pub fn add_transferred(&self, bytes: usize) {
        self.transferred.fetch_add(bytes as u64, Ordering::Relaxed);
    }

    /// A response body was decoded (decompressed) for parsing.
    pub fn add_processed(&self, bytes: usize) {
        self.processed.fetch_add(bytes as u64, Ordering::Relaxed);
    }

    /// A request got a response (any status).
    pub fn add_request(&self) {
        self.requests.fetch_add(1, Ordering::Relaxed);
    }

    pub fn transferred(&self) -> u64 {
        self.transferred.load(Ordering::Relaxed)
    }

    pub fn processed(&self) -> u64 {
        self.processed.load(Ordering::Relaxed)
    }

    pub fn requests(&self) -> u64 {
        self.requests.load(Ordering::Relaxed)
    }
}

/// What the UI shows. Rates are bytes per second.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub transferred: u64,
    pub processed: u64,
    pub requests: u64,
    /// Over the last second (live); 0 once the run is over.
    pub rate: f64,
    pub peak_rate: f64,
    /// Transferred ÷ time since the run started.
    pub average_rate: f64,
}

/// Turns the counters into rates. Call `sample` on a timer.
pub struct Meter {
    started: Instant,
    history: VecDeque<(Instant, u64)>,
    peak: f64,
}

impl Meter {
    pub fn new(started: Instant) -> Self {
        Self { started, history: VecDeque::from([(started, 0)]), peak: 0.0 }
    }

    pub fn sample(&mut self, metrics: &Metrics) -> Snapshot {
        self.sample_at(metrics, Instant::now())
    }

    fn sample_at(&mut self, metrics: &Metrics, now: Instant) -> Snapshot {
        let transferred = metrics.transferred();
        self.history.push_back((now, transferred));
        // Keep the newest sample older than the window as the baseline.
        while self.history.len() > 2 && now.duration_since(self.history[1].0) >= RATE_WINDOW {
            self.history.pop_front();
        }
        let (since, base) = self.history[0];
        let span = now.duration_since(since).as_secs_f64();
        let rate = if span > 0.0 { transferred.saturating_sub(base) as f64 / span } else { 0.0 };
        // Ignore the first instants of a run: a single chunk over a few ms
        // would read as an absurd peak.
        if now.duration_since(self.started) >= SAMPLE_INTERVAL {
            self.peak = self.peak.max(rate);
        }
        Snapshot {
            transferred,
            processed: metrics.processed(),
            requests: metrics.requests(),
            rate,
            peak_rate: self.peak,
            average_rate: average(transferred, now.duration_since(self.started)),
        }
    }

    /// The final numbers: no live rate, average over the whole `elapsed`.
    pub fn finish(&mut self, metrics: &Metrics, elapsed: Duration) -> Snapshot {
        let mut snapshot = self.sample(metrics);
        snapshot.rate = 0.0;
        snapshot.average_rate = average(snapshot.transferred, elapsed);
        snapshot
    }
}

fn average(bytes: u64, elapsed: Duration) -> f64 {
    let secs = elapsed.as_secs_f64();
    if secs > 0.0 { bytes as f64 / secs } else { 0.0 }
}

/// 1536 → "1.50 KB" (binary units, like Windows Explorer).
pub fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    let decimals = if value >= 100.0 { 0 } else if value >= 10.0 { 1 } else { 2 };
    format!("{value:.decimals$} {}", UNITS[unit])
}

pub fn format_rate(bytes_per_sec: f64) -> String {
    format!("{}/s", format_bytes(bytes_per_sec.round() as u64))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(1023), "1023 B");
        assert_eq!(format_bytes(1536), "1.50 KB");
        assert_eq!(format_bytes(15 * 1024 * 1024 + 300 * 1024), "15.3 MB");
        assert_eq!(format_bytes(250 * 1024 * 1024), "250 MB");
        assert_eq!(format_rate(2048.4), "2.00 KB/s");
    }

    #[test]
    fn rate_over_a_sliding_window() {
        let start = Instant::now();
        let metrics = Metrics::default();
        let mut meter = Meter::new(start);
        let ms = |n| start + Duration::from_millis(n);

        // 100 KB/s for two seconds, sampled every 250 ms.
        for step in 1..=8u64 {
            metrics.add_transferred(25 * 1024);
            let s = meter.sample_at(&metrics, ms(step * 250));
            assert!((s.rate - 100.0 * 1024.0).abs() < 1.0, "step {step}: {}", s.rate);
        }
        // Then it stalls: the rate falls to zero once the window has passed.
        let s = meter.sample_at(&metrics, ms(2500));
        assert!(s.rate < 100.0 * 1024.0);
        let s = meter.sample_at(&metrics, ms(3250));
        assert_eq!(s.rate, 0.0);
        assert!((s.peak_rate - 100.0 * 1024.0).abs() < 1.0);
        assert_eq!(s.transferred, 200 * 1024);

        let done = meter.finish(&metrics, Duration::from_secs(4));
        assert_eq!(done.rate, 0.0);
        assert!((done.average_rate - 50.0 * 1024.0).abs() < 1.0);
    }

    #[test]
    fn counters() {
        let m = Metrics::default();
        m.add_transferred(10);
        m.add_transferred(5);
        m.add_processed(40);
        m.add_request();
        assert_eq!((m.transferred(), m.processed(), m.requests()), (15, 40, 1));
    }
}
