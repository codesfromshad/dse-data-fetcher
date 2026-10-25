import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError } from '../lib/errors';
import { cancelFetch, isFetchError, startFetch, type FetchEvent, type FetchResult, type Progress } from '../lib/fetch';
import type { LogEntry, LogLevel, LogPart } from '../lib/log';
import { logTimestamp, shortTime } from '../lib/time';

export type Phase = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

const MAX_LOG_ENTRIES = 2000;
// Logs/progress are queued and applied at most this often, so a burst of 50
// log lines costs one React render instead of 50.
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
 * progress and result for the UI. The retry setting is read by Rust before
 * every retry, so changing it mid-run takes effect at once.
 */
export function useFetchRun() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<Progress>(EMPTY_PROGRESS);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [error, setError] = useState<RunError | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);

  const running = useRef(false);
  const pendingLogs = useRef<LogEntry[]>([]);
  const pendingProgress = useRef<Progress | null>(null);
  const nextId = useRef(0);

  const flush = useCallback(() => {
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
  }, []);

  useEffect(() => {
    const timer = setInterval(flush, FLUSH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [flush]);

  const log = useCallback((level: LogLevel, parts: LogPart[], at = new Date()) => {
    pendingLogs.current.push({ id: nextId.current++, time: logTimestamp(at), shortTime: shortTime(at), level, parts });
  }, []);

  const onEvent = useCallback(
    (event: FetchEvent) => {
      if (event.event === 'log') log(event.data.level, event.data.parts, new Date(event.data.time));
      else pendingProgress.current = event.data;
    },
    [log],
  );

  const start = useCallback(({ openAfter = true }: { openAfter?: boolean } = {}) => {
    if (running.current) return;
    running.current = true;

    setPhase('running');
    setResult(null);
    setError(null);
    setStartedAt(Date.now());
    setFinishedAt(null);
    setProgress({ ...EMPTY_PROGRESS, status: 'Starting...' });
    if (nextId.current > 0) log('info', ['──────── New run ────────']);

    startFetch(openAfter, onEvent)
      .then((res) => {
        flush();
        setResult(res);
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
        setFinishedAt(Date.now());
      });
  }, [flush, log, onEvent]);

  const cancel = useCallback(() => {
    if (running.current) void cancelFetch();
  }, []);

  const clearLogs = useCallback(() => {
    pendingLogs.current = [];
    setLogs([]);
  }, []);

  return { phase, progress, logs, result, error, startedAt, finishedAt, start, cancel, clearLogs };
}
