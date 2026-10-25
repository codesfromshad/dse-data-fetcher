// Typed wrappers around the Rust commands in src-tauri/src/lib.rs.
import { invoke } from '@tauri-apps/api/core';

export type HttpErrorKind = 'connect' | 'timeout' | 'status' | 'body' | 'other';

export class HttpError extends Error {
  constructor(
    readonly kind: HttpErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export async function httpGet(url: string, headers: Record<string, string>, timeoutMs: number): Promise<string> {
  try {
    return await invoke<string>('http_get', { url, headers, timeoutMs });
  } catch (error) {
    const e = error as { kind?: HttpErrorKind; message?: string };
    throw new HttpError(e?.kind ?? 'other', e?.message ?? String(error));
  }
}

export const resetHttpSession = () => invoke<void>('reset_http_session');
export const checkOnline = () => invoke<boolean>('check_online');

/** Writes bytes to the OS temp folder; returns the full path. */
export const writeTempFile = (fileName: string, bytes: Uint8Array) =>
  invoke<string>('write_temp_file', bytes, { headers: { 'x-file-name': fileName } });

export interface LockedFile {
  path: string;
  fileName: string;
}
/** Deletes all temp files; returns those still open in another app. */
export const deleteTempFiles = () => invoke<LockedFile[]>('delete_temp_files');

export const openFile = (path: string) => invoke<void>('open_file', { path });
export const revealFile = (path: string) => invoke<void>('reveal_file', { path });
export const saveCopy = (source: string, destination: string) => invoke<void>('save_copy', { source, destination });

// --- System check & settings ----------------------------------------------

export interface AppInfo {
  path: string;
  name: string;
}

export interface SpreadsheetStatus {
  /** The app Windows opens .xlsx files with, if any. */
  systemDefault: AppInfo | null;
  /** User override from Settings, if set... */
  customPath: string | null;
  /** ...and its details, or null when that file no longer exists. */
  customApp: AppInfo | null;
}

/** Throws if the temp folder isn't writable; returns its path. */
export const checkTempDir = () => invoke<string>('check_temp_dir');
export const getSpreadsheetStatus = () => invoke<SpreadsheetStatus>('get_spreadsheet_status');
/** `null` = go back to the system default. */
export const setSpreadsheetApp = (path: string | null) => invoke<SpreadsheetStatus>('set_spreadsheet_app', { path });

/** The app that will actually open the spreadsheet, or null if none. */
export const effectiveApp = (s: SpreadsheetStatus | null) => (s ? (s.customPath ? s.customApp : s.systemDefault) : null);
