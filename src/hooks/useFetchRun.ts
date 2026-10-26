import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { onConnectivity } from '../lib/connectivity';
import { onActivity } from '../lib/native';
import { describeError } from '../lib/errors';
import {
  cancelFetch,
  isFetchError,
  setFetchPaused,
  startFetch,
  type FetchEvent,
  type FetchResult,
  type NetworkMetrics,
  type Progress,
} from '../lib/fetch';
import type { LogEntry, LogLevel, LogPart } from '../lib/log';
import { logTimestamp, shortTime } from '../lib/time';

export type Phase = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

const MAX_LOG_ENTRIES = 2000;
// Rust already sends log lines in batches; progress/metrics/log batches are
// still queued and applied at most this often, so they share one React
// render. The timer only runs while something is queued, so an idle app
// doesn't wake up 20×/s.
const FLUSH_INTERVAL_MS = 50;

const EMPTY_PROGRESS: Progress = {
  stage: 'connecting',
  status: 'Ready',
  counts: { total: 0, fetched: 0, skipped: 0, failed: 0 },
};

export interface RunError {
  message: string;
  offline: boolean;
}

/**
 * Drives a fetch run in Rust (src-tauri/src/fetch/) and keeps its log,
 * progress, network metrics and result for the UI. Retry and metrics settings
 * are read by Rust as it goes, so changing them mid-run takes effect at once.
 *
 * `startedAt`/`finishedAt` are `performance.now()` times: monotonic and
 * sub-millisecond, for the elapsed clock.
 */
export function useFetchRun() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<Progress>(EMPTY_PROGRESS);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [network, setNetwork] = useState<NetworkMetrics | null>(null);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [error, setError] = useState<RunError | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  // Pausing: when the current pause began, and the time spent paused before
  // it, so the elapsed clock stops while paused (Rust leaves it out too).
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [pausedMs, setPausedMs] = useState(0);

  const running = useRef(false);
  const pendingLogs = useRef<LogEntry[]>([]);
  const pendingProgress = useRef<Progress | null>(null);
  const pendingNetwork = useRef<NetworkMetrics | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (pendingLogs.current.length) {
      const batch = pendingLogs.current;
      pendingLogs.current = [];
      // A transition: new log lines never hold up a click (a tab switch, Cancel).
      startTransition(() =>
        setLogs((prev) => {
          const next = prev.concat(batch);
          return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
        }),
      );
    }
    if (pendingProgress.current) {
      setProgress(pendingProgress.current);
      pendingProgress.current = null;
    }
    if (pendingNetwork.current) {
      setNetwork(pendingNetwork.current);
      pendingNetwork.current = null;
    }
  }, []);

  const schedule = useCallback(() => {
    if (timer.current === null) timer.current = setTimeout(flush, FLUSH_INTERVAL_MS);
  }, [flush]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  // "Internet connection lost/restored", "DSE can't be reached"...: written
  // by the connection monitor (Rust), whether or not a fetch is running.
  useEffect(
    () =>
      onConnectivity(({ lines }) => {
        if (!lines.length) return;
        for (const line of lines) pendingLogs.current.push({ id: nextId.current++, ...line });
        schedule();
      }),
    [schedule],
  );

  // Lines Rust writes outside a fetch (deleting the temporary spreadsheet).
  useEffect(
    () =>
      onActivity((lines) => {
        for (const line of lines) pendingLogs.current.push({ id: nextId.current++, ...line });
        schedule();
      }),
    [schedule],
  );

  /** A line from this side (run separators, IPC trouble). Rust's lines arrive formatted. */
  const log = useCallback(
    (level: LogLevel, parts: LogPart[]) => {
      const at = new Date();
      pendingLogs.current.push({ id: nextId.current++, time: logTimestamp(at), shortTime: shortTime(at), level, parts });
      schedule();
    },
    [schedule],
  );

  const onEvent = useCallback(
    (event: FetchEvent) => {
      switch (event.event) {
        case 'logs':
          for (const line of event.data) pendingLogs.current.push({ id: nextId.current++, ...line });
          break;
        case 'progress':
          pendingProgress.current = event.data;
          break;
        case 'metrics':
          pendingNetwork.current = event.data;
          break;
      }
      schedule();
    },
    [schedule],
  );

  const start = useCallback(
    ({ openAfter = true }: { openAfter?: boolean } = {}) => {
      if (running.current) return;
      running.current = true;

      setPhase('running');
      setResult(null);
      setError(null);
      setNetwork(null);
      pendingNetwork.current = null;
      setStartedAt(performance.now());
      setFinishedAt(null);
      setPausedAt(null);
      setPausedMs(0);
      setProgress({ ...EMPTY_PROGRESS, status: 'Starting...' });
      if (nextId.current > 0) log('info', ['──────── New run ────────']);

      startFetch(openAfter, onEvent)
        .then((res) => {
          flush();
          setResult(res);
          setNetwork(res.network);
          setPhase('done');
          setProgress((p) => ({ ...p, status: `Saved ${res.fileName}` }));
        })
        .catch((err: unknown) => {
          // Rust logs its own failures; anything else (IPC trouble) we log here.
          if (!isFetchError(err)) log('error', [`Fetch failed: ${describeError(err)}`]);
          flush();
          if (isFetchError(err) && err.kind === 'cancelled') {
            setPhase('cancelled');
            setProgress((p) => ({ ...p, status: 'Cancelled' }));
            return;
          }
          const offline = isFetchError(err) && err.kind === 'offline';
          setError({ message: isFetchError(err) ? err.message : `Fetch failed: ${describeError(err)}`, offline });
          setPhase('failed');
          setProgress((p) => ({ ...p, status: offline ? 'No internet connection' : 'Fetch failed' }));
        })
        .finally(() => {
          running.current = false;
          const now = performance.now();
          // Stopped while paused: that pause ends here.
          setPausedAt((at) => {
            if (at !== null) setPausedMs((ms) => ms + (now - at));
            return null;
          });
          setFinishedAt(now);
        });
    },
    [flush, log, onEvent],
  );

  const cancel = useCallback(() => {
    if (running.current) void cancelFetch();
  }, []);

  /** Pause or resume. The clock follows what Rust reports back. */
  const setPaused = useCallback(async (paused: boolean) => {
    if (!running.current) return;
    try {
      const now = performance.now();
      const isPaused = await setFetchPaused(paused);
      if (!running.current) return;
      setPausedAt((at) => {
        if (isPaused) return at ?? now;
        if (at !== null) setPausedMs((ms) => ms + (now - at));
        return null;
      });
    } catch (error) {
      log('error', [`Couldn't ${paused ? 'pause' : 'resume'} the fetch: ${describeError(error)}`]);
    }
  }, [log]);
  const pause = useCallback(() => void setPaused(true), [setPaused]);
  const resume = useCallback(() => void setPaused(false), [setPaused]);

  const clearLogs = useCallback(() => {
    pendingLogs.current = [];
    setLogs([]);
  }, []);

  const paused = pausedAt !== null;
  return {
    phase,
    progress,
    logs,
    network,
    result,
    error,
    startedAt,
    finishedAt,
    paused,
    pausedAt,
    pausedMs,
    start,
    cancel,
    pause,
    resume,
    clearLogs,
  };
}
