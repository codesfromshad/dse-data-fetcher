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

export interface FetchResult {
  fileName: string;
  filePath: string;
  counts: Counts;
  failedSymbols: string[];
  elapsedMs: number;
  opened: boolean;
}

export type FetchEvent =
  /** `time`: Unix ms, stamped in Rust. */
  | { event: 'log'; data: { level: LogLevel; parts: LogPart[]; time: number } }
  | { event: 'progress'; data: Progress };

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

/** Startup check: resolves to the round trip in ms, rejects if DSE is unreachable. */
export const checkDse = () => invoke<number>('check_dse');
