import { useCallback, useEffect, useRef, useState } from 'react';
import { CancelledError, describeError } from '../lib/http';
import type { LogEntry, LogLevel, LogPart } from '../lib/log';
import { OfflineError, runFetch, type FetchResult, type Progress } from '../lib/pipeline';
import { logTimestamp, shortTime } from '../lib/time';
import { useSettings } from './useSettings';

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

export function useFetchRun() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<Progress>(EMPTY_PROGRESS);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [error, setError] = useState<RunError | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const pendingLogs = useRef<LogEntry[]>([]);
  const pendingProgress = useRef<Progress | null>(null);
  const nextId = useRef(0);

  // Read at every retry, so changing the setting mid-run takes effect at once.
  const { settings } = useSettings();
  const retriesRef = useRef(settings.fetchRetries);
  retriesRef.current = settings.fetchRetries;

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

  const log = useCallback((level: LogLevel, ...parts: LogPart[]) => {
    const now = new Date();
    pendingLogs.current.push({ id: nextId.current++, time: logTimestamp(now), shortTime: shortTime(now), level, parts });
  }, []);

  const start = useCallback(({ openAfter = true }: { openAfter?: boolean } = {}) => {
    if (abortRef.current) return; // already running
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('running');
    setResult(null);
    setError(null);
    setStartedAt(Date.now());
    setFinishedAt(null);
    setProgress({ ...EMPTY_PROGRESS, status: 'Starting...' });
    if (nextId.current > 0) log('info', '──────── New run ────────');

    runFetch({ log, progress: (p) => (pendingProgress.current = p), signal: controller.signal, openAfter, maxRetries: () => retriesRef.current })
      .then((res) => {
        flush();
        setResult(res);
        setPhase('done');
        setProgress((p) => ({ ...p, status: `Saved ${res.fileName}` }));
      })
      .catch((err: unknown) => {
        if (err instanceof CancelledError) {
          log('warn', 'Fetch cancelled.');
          flush();
          setPhase('cancelled');
          setProgress((p) => ({ ...p, status: 'Cancelled' }));
          return;
        }
        const offline = err instanceof OfflineError;
        const message = offline ? (err as Error).message : `Fetch failed: ${describeError(err)}`;
        log('error', message);
        flush();
        setError({ message, offline });
        setPhase('failed');
        setProgress((p) => ({ ...p, status: offline ? 'No internet connection' : 'Fetch failed' }));
      })
      .finally(() => {
        abortRef.current = null;
        setFinishedAt(Date.now());
      });
  }, [flush, log]);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const clearLogs = useCallback(() => {
    pendingLogs.current = [];
    setLogs([]);
  }, []);

  return { phase, progress, logs, result, error, startedAt, finishedAt, start, cancel, clearLogs };
}
