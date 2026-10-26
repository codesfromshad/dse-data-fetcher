// Typed wrappers around the Rust commands in src-tauri/src/lib.rs.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { LogLine } from './fetch';

// (The fetch commands have their own wrappers in fetch.ts, the connection
// monitor in connectivity.ts.)

export interface LockedFile {
  path: string;
  fileName: string;
}
export interface DeleteReport {
  /** Deleted just now. */
  deleted: number;
  /** Still open in another app. */
  locked: LockedFile[];
}

/** Deletes this session's temp files (each one logged). */
export const deleteTempFiles = () => invoke<DeleteReport>('delete_temp_files');

/** A temp spreadsheet found in the temp folder (`TempSpreadsheet` in lib.rs). */
export interface TempSpreadsheet {
  path: string;
  fileName: string;
  size: number;
  /** ms since the Unix epoch; 0 if unknown. */
  modifiedMs: number;
  /** Written by this run of the app: the result on the Fetch page. */
  thisSession: boolean;
}

/** Every temp spreadsheet in the temp folder, from this session or earlier ones. Newest first. */
export const findTempSpreadsheets = () => invoke<TempSpreadsheet[]>('find_temp_spreadsheets');

export interface CleanupReport {
  deleted: number;
  /** Bytes freed. */
  freed: number;
  locked: LockedFile[];
  failed: number;
}

/** Delete every temp spreadsheet in the temp folder (each one logged). */
export const cleanTempSpreadsheets = () => invoke<CleanupReport>('clean_temp_spreadsheets');

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

/**
 * Activity-log lines Rust writes outside a fetch (deleting the temporary
 * spreadsheet). Returns an unsubscribe function.
 */
export function onActivity(handler: (lines: LogLine[]) => void) {
  const unlisten = listen<LogLine[]>('activity', (e) => handler(e.payload));
  return () => void unlisten.then((stop) => stop());
}
