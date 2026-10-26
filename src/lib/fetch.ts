// Typed wrappers for the fetch commands in src-tauri/src/fetch/. All fetching,
// parsing and the workbook happen in Rust; this side only starts/cancels a run
// and renders the events it streams back.
import { Channel, invoke } from '@tauri-apps/api/core';
import type { LogLevel, LogPart } from './log';

/** Shown as a link in About. */
export const DSE_URL = 'https://old.dsebd.org/';

export type Stage = 'connecting' | 'symbols' | 'companies' | 'writing' | 'opening';

export interface Counts {
  total: number;
  fetched: number;
  skipped: number;
  failed: number;
}

export interface Progress {
  stage: Stage;
  status: string;
  counts: Counts;
}

/** Network metrics (mirrors `Snapshot` in fetch/metrics.rs). Rates in bytes/s. */
export interface NetworkMetrics {
  /** Bytes received from the network (compressed, as sent by DSE). */
  transferred: number;
  /** Bytes after decompression: the HTML/JSON actually parsed. */
  processed: number;
  requests: number;
  /** Over the last second; 0 once the run is over. */
  rate: number;
  peakRate: number;
  averageRate: number;
}

export interface FetchResult {
  fileName: string;
  filePath: string;
  counts: Counts;
  failedSymbols: string[];
  elapsedMs: number;
  opened: boolean;
  network: NetworkMetrics;
}

/** One log line, stamped and formatted in Rust (`LogLine` in fetch/mod.rs). */
export interface LogLine {
  level: LogLevel;
  parts: LogPart[];
  /** YYYY-MM-DDTHH:mm:ss.SSS±HH:MM */
  time: string;
  /** HH:mm:ss.SSS */
  shortTime: string;
}

export type FetchEvent =
  /** Lines in order, batched by Rust (about one message per 50 ms). */
  | { event: 'logs'; data: LogLine[] }
  | { event: 'progress'; data: Progress }
  /** A few times a second, only with "Show network metrics" on. */
  | { event: 'metrics'; data: NetworkMetrics };

export type FetchErrorKind = 'cancelled' | 'offline' | 'busy' | 'failed';

/** What `start_fetch` rejects with. Rust has already logged the message. */
export interface FetchError {
  kind: FetchErrorKind;
  message: string;
}

export const isFetchError = (error: unknown): error is FetchError =>
  typeof error === 'object' && error !== null && 'kind' in error && 'message' in error;

/** Run a whole fetch. Rejects with a `FetchError`. */
export function startFetch(openAfter: boolean, onEvent: (event: FetchEvent) => void) {
  const channel = new Channel<FetchEvent>();
  channel.onmessage = onEvent;
  return invoke<FetchResult>('start_fetch', { openAfter, onEvent: channel });
}

/** Stop the running fetch; `startFetch` then rejects with kind "cancelled". */
export const cancelFetch = () => invoke<void>('cancel_fetch');
