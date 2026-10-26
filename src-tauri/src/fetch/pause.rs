//! Pausing a run. Company pages already downloading finish; no new page (or
//! retry) starts until the run is resumed, or stopped.

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

use super::http::Cancelled;

pub struct Pause {
    paused: watch::Sender<bool>,
    clock: Mutex<Clock>,
}

/// Time spent paused, so the elapsed time and average speed leave it out.
#[derive(Default)]
struct Clock {
    since: Option<Instant>,
    total: Duration,
}

impl Default for Pause {
    fn default() -> Self {
        Self { paused: watch::channel(false).0, clock: Mutex::default() }
    }
}

impl Pause {
    /// Pause or resume. Returns whether that changed anything.
    pub fn set(&self, paused: bool) -> bool {
        let changed = self.paused.send_if_modified(|p| {
            let changed = *p != paused;
            *p = paused;
            changed
        });
        if changed {
            let mut clock = self.clock.lock().unwrap();
            if paused {
                clock.since = Some(Instant::now());
            } else if let Some(since) = clock.since.take() {
                clock.total += since.elapsed();
            }
        }
        changed
    }

    pub fn is_paused(&self) -> bool {
        *self.paused.borrow()
    }

    /// Notified on every pause and resume.
    pub fn subscribe(&self) -> watch::Receiver<bool> {
        self.paused.subscribe()
    }

    /// Time spent paused so far, including a pause still going on.
    pub fn total(&self) -> Duration {
        let clock = self.clock.lock().unwrap();
        clock.total + clock.since.map_or(Duration::ZERO, |since| since.elapsed())
    }

    /// Returns at once when not paused; otherwise waits for resume or cancel.
    pub async fn wait(&self, cancel: &CancellationToken) -> Result<(), Cancelled> {
        let mut paused = self.paused.subscribe();
        loop {
            if cancel.is_cancelled() {
                return Err(Cancelled);
            }
            if !*paused.borrow_and_update() {
                return Ok(());
            }
            tokio::select! {
                _ = cancel.cancelled() => return Err(Cancelled),
                changed = paused.changed() => if changed.is_err() { return Ok(()) },
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn waits_while_paused_until_resumed_or_cancelled() {
        let pause = Pause::default();
        let cancel = CancellationToken::new();
        // Not paused: straight through.
        assert!(pause.wait(&cancel).await.is_ok());

        assert!(pause.set(true));
        assert!(!pause.set(true), "already paused");
        let waiting = pause.wait(&cancel);
        tokio::pin!(waiting);
        // Still waiting after a moment...
        assert!(tokio::time::timeout(Duration::from_millis(20), &mut waiting).await.is_err());
        // ...and through once resumed.
        pause.set(false);
        assert!(waiting.await.is_ok());

        // Cancelling while paused stops the wait.
        pause.set(true);
        cancel.cancel();
        assert!(pause.wait(&cancel).await.is_err());
    }

    #[test]
    fn counts_time_spent_paused() {
        let pause = Pause::default();
        assert_eq!(pause.total(), Duration::ZERO);
        pause.set(true);
        std::thread::sleep(Duration::from_millis(15));
        pause.set(false);
        let total = pause.total();
        assert!(total >= Duration::from_millis(15));
        std::thread::sleep(Duration::from_millis(10));
        assert_eq!(pause.total(), total, "not counting while running");
    }
}
