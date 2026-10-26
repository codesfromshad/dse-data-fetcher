// The connection monitor in src-tauri/src/connectivity.rs: internet and DSE,
// checked for as long as the app runs. Changes arrive as `connectivity`
// events with ready-made activity-log lines.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { LogLine } from './fetch';

/** The `{ kind, message }` Rust's `HttpError` serializes to. */
export interface HttpError {
  kind: 'connect' | 'timeout' | 'status' | 'body' | 'other';
  message: string;
}

export interface ConnectivityStatus {
  /** null until the first check. */
  internet: boolean | null;
  /** null when not known (offline, or not checked yet). */
  dse: boolean | null;
  dseMs: number | null;
  dseError: HttpError | null;
}

export interface ConnectivityEvent extends ConnectivityStatus {
  /** What changed, for the activity log ("Internet connection lost."). */
  lines: LogLine[];
}

/** Check now; resolves with the fresh status (changes also arrive as events). */
export const probeConnectivity = () => invoke<ConnectivityStatus>('probe_connectivity');

/** Subscribe to changes. Returns an unsubscribe function. */
export function onConnectivity(handler: (event: ConnectivityEvent) => void) {
  const unlisten = listen<ConnectivityEvent>('connectivity', (e) => handler(e.payload));
  return () => void unlisten.then((stop) => stop());
}
