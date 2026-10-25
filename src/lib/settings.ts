// Typed wrappers for the settings/about/updater commands in src-tauri.
import { Channel, invoke } from '@tauri-apps/api/core';

export type ThemePreference = 'system' | 'light' | 'dark';
export type UpdateChannel = 'stable' | 'beta';

/** What the Settings page edits (mirrors `Preferences` in settings.rs). */
export interface Preferences {
  theme: ThemePreference;
  autoFetchOnLaunch: boolean;
  openAfterFetch: boolean;
  checkForUpdates: boolean;
  autoDownloadUpdates: boolean;
  /** null = follow the installed build (beta builds → beta). */
  updateChannel: UpdateChannel | null;
}

export interface Settings extends Preferences {
  spreadsheetApp: string | null;
  lastUpdateCheck: number | null;
  lastSeenVersion: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  spreadsheetApp: null,
  theme: 'system',
  autoFetchOnLaunch: true,
  openAfterFetch: true,
  checkForUpdates: true,
  autoDownloadUpdates: true,
  updateChannel: null,
  lastUpdateCheck: null,
  lastSeenVersion: null,
};

export const preferencesOf = (s: Settings): Preferences => ({
  theme: s.theme,
  autoFetchOnLaunch: s.autoFetchOnLaunch,
  openAfterFetch: s.openAfterFetch,
  checkForUpdates: s.checkForUpdates,
  autoDownloadUpdates: s.autoDownloadUpdates,
  updateChannel: s.updateChannel,
});

export const getSettings = () => invoke<Settings>('get_settings');
export const setPreferences = (preferences: Preferences) => invoke<Settings>('set_preferences', { preferences });
export const markUpdateChecked = (at: number) => invoke<Settings>('mark_update_checked', { at });
export const setLastSeenVersion = (version: string) => invoke<Settings>('set_last_seen_version', { version });
export const resetSettings = () => invoke<Settings>('reset_settings');
export const openSettingsFolder = () => invoke<void>('open_settings_folder');

// --- About -----------------------------------------------------------------

export interface BuildInfo {
  version: string;
  tauriVersion: string;
  webviewVersion: string | null;
  os: string;
  arch: string;
  debug: boolean;
  settingsPath: string | null;
  installDir: string | null;
}

export const getBuildInfo = () => invoke<BuildInfo>('build_info');

// --- Updates ---------------------------------------------------------------

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
  downloaded: boolean;
}

export type DownloadEvent =
  | { event: 'started'; data: { contentLength: number | null } }
  | { event: 'progress'; data: { downloaded: number } }
  | { event: 'finished' };

export const checkForUpdate = (channel: UpdateChannel) => invoke<UpdateInfo | null>('check_for_update', { channel });

export function downloadUpdate(onEvent: (event: DownloadEvent) => void) {
  const channel = new Channel<DownloadEvent>();
  channel.onmessage = onEvent;
  return invoke<void>('download_update', { onEvent: channel });
}

/** Exits the app and runs the installer (Windows). */
export const installUpdate = () => invoke<void>('install_update');
