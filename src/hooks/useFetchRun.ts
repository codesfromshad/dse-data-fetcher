import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../lib/errors';
import {
  cancelFetch,
  isFetchError,
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
// Logs/progress/metrics are queued and applied at most this often, so a burst
// of 50 log lines costs one React render instead of 50. The timer only runs
// while something is queued, so an idle app doesn't wake up 20×/s.
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
      setLogs((prev) => {
        const next = prev.concat(batch);
        return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
      });
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

  const log = useCallback(
    (level: LogLevel, parts: LogPart[], at = new Date()) => {
      pendingLogs.current.push({ id: nextId.current++, time: logTimestamp(at), shortTime: shortTime(at), level, parts });
      schedule();
    },
    [schedule],
  );

  const onEvent = useCallback(
    (event: FetchEvent) => {
      switch (event.event) {
        case 'log':
          log(event.data.level, event.data.parts, new Date(event.data.time));
          return;
        case 'progress':
          pendingProgress.current = event.data;
          break;
        case 'metrics':
          pendingNetwork.current = event.data;
          break;
      }
      schedule();
    },
    [log, schedule],
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
          setFinishedAt(performance.now());
        });
    },
    [flush, log, onEvent],
  );

  const cancel = useCallback(() => {
    if (running.current) void cancelFetch();
  }, []);

  const clearLogs = useCallback(() => {
    pendingLogs.current = [];
    setLogs([]);
  }, []);

  return { phase, progress, logs, network, result, error, startedAt, finishedAt, start, cancel, clearLogs };
}
