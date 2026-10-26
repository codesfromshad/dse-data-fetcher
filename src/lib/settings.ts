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
  /** Retries per company page (failed request or NaN/missing values). null = unlimited. */
  fetchRetries: number | null;
  /** Data transferred/processed and transfer rate while fetching. */
  showNetworkMetrics: boolean;
  /** Delete this session's temporary spreadsheets when the app closes (and before an update installs). */
  deleteTempOnClose: boolean;
}

export const DEFAULT_FETCH_RETRIES = 5;
export const MAX_FETCH_RETRIES = 1000;

export interface Settings extends Preferences {
  spreadsheetApp: string | null;
  lastUpdateCheck: number | null;
  lastSeenVersion: string | null;
  /** "Don't show this again" on the switch-to-Stable prompt. */
  hideStablePrompt: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  spreadsheetApp: null,
  theme: 'system',
  autoFetchOnLaunch: true,
  openAfterFetch: true,
  checkForUpdates: true,
  autoDownloadUpdates: true,
  updateChannel: null,
  fetchRetries: DEFAULT_FETCH_RETRIES,
  showNetworkMetrics: true,
  deleteTempOnClose: true,
  lastUpdateCheck: null,
  lastSeenVersion: null,
  hideStablePrompt: false,
};

export const preferencesOf = (s: Settings): Preferences => ({
  theme: s.theme,
  autoFetchOnLaunch: s.autoFetchOnLaunch,
  openAfterFetch: s.openAfterFetch,
  checkForUpdates: s.checkForUpdates,
  autoDownloadUpdates: s.autoDownloadUpdates,
  updateChannel: s.updateChannel,
  fetchRetries: s.fetchRetries,
  showNetworkMetrics: s.showNetworkMetrics,
  deleteTempOnClose: s.deleteTempOnClose,
});

export const getSettings = () => invoke<Settings>('get_settings');
export const setPreferences = (preferences: Preferences) => invoke<Settings>('set_preferences', { preferences });
export const markUpdateChecked = (at: number) => invoke<Settings>('mark_update_checked', { at });
export const setLastSeenVersion = (version: string) => invoke<Settings>('set_last_seen_version', { version });
export const setHideStablePrompt = (hide: boolean) => invoke<Settings>('set_hide_stable_prompt', { hide });
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
