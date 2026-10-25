import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { describeError } from '../lib/http';
import { deleteTempFiles, type LockedFile } from '../lib/native';
import { checkForUpdate, downloadUpdate, installUpdate, markUpdateChecked, type UpdateInfo } from '../lib/settings';
import { useSettings } from './useSettings';

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'upToDate' }
  | { kind: 'available'; update: UpdateInfo }
  | { kind: 'downloading'; update: UpdateInfo; downloaded: number; total: number | null }
  | { kind: 'ready'; update: UpdateInfo }
  | { kind: 'installing'; update: UpdateInfo }
  | { kind: 'error'; message: string; update?: UpdateInfo };

interface UpdaterContextValue {
  status: UpdateStatus;
  lastChecked: number | null;
  check: () => Promise<void>;
  download: () => Promise<void>;
  /**
   * Install and restart. Unless `force`, first deletes the temp workbooks and
   * resolves with any that are still open in Excel instead of installing.
   */
  install: (force?: boolean) => Promise<LockedFile[]>;
  /** Hide the banner for this version until the next launch. */
  dismiss: () => void;
  dismissedVersion: string | null;
}

const UpdaterContext = createContext<UpdaterContextValue | null>(null);

const FIRST_CHECK_DELAY_MS = 4_000;
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function UpdaterProvider({ children }: { children: ReactNode }) {
  const { settings, channel, replace } = useSettings();
  const [status, setStatus] = useState<UpdateStatus>({ kind: 'idle' });
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const busy = useRef(false);

  const download = useCallback(async () => {
    const current = statusRef.current;
    const update = 'update' in current ? current.update : undefined;
    if (!update || busy.current) return;
    busy.current = true;
    setStatus({ kind: 'downloading', update, downloaded: 0, total: null });
    try {
      let total: number | null = null;
      await downloadUpdate((e) => {
        if (e.event === 'started') total = e.data.contentLength;
        else if (e.event === 'progress') setStatus({ kind: 'downloading', update, downloaded: e.data.downloaded, total });
      });
      setStatus({ kind: 'ready', update });
    } catch (error) {
      setStatus({ kind: 'error', message: describeError(error), update });
    } finally {
      busy.current = false;
    }
  }, []);

  const autoDownload = useRef(settings.autoDownloadUpdates);
  autoDownload.current = settings.autoDownloadUpdates;

  const check = useCallback(async () => {
    const current = statusRef.current.kind;
    if (busy.current || current === 'downloading' || current === 'installing') return;
    busy.current = true;
    setStatus({ kind: 'checking' });
    let found: UpdateInfo | null = null;
    try {
      found = await checkForUpdate(channel);
      setStatus(found ? { kind: found.downloaded ? 'ready' : 'available', update: found } : { kind: 'upToDate' });
      replace(await markUpdateChecked(Date.now()));
    } catch (error) {
      setStatus({ kind: 'error', message: describeError(error) });
    } finally {
      busy.current = false;
    }
    if (found && !found.downloaded && autoDownload.current) await download();
  }, [channel, replace, download]);

  const install = useCallback(async (force = false) => {
    const current = statusRef.current;
    if (current.kind !== 'ready') return [];
    if (!force) {
      const locked = await deleteTempFiles().catch(() => []);
      if (locked.length) return locked;
    }
    setStatus({ kind: 'installing', update: current.update });
    try {
      await installUpdate(); // exits the app on success
    } catch (error) {
      setStatus({ kind: 'error', message: describeError(error), update: current.update });
    }
    return [];
  }, []);

  // Automatic checks: shortly after launch, then every few hours.
  const checkRef = useRef(check);
  checkRef.current = check;
  useEffect(() => {
    if (!settings.checkForUpdates) return;
    const first = setTimeout(() => void checkRef.current(), FIRST_CHECK_DELAY_MS);
    const every = setInterval(() => void checkRef.current(), RECHECK_INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [settings.checkForUpdates]);

  // Switching channel invalidates what we know; check again if we had checked.
  const lastChannel = useRef(channel);
  useEffect(() => {
    if (lastChannel.current === channel) return;
    lastChannel.current = channel;
    if (statusRef.current.kind !== 'idle') void check();
  }, [channel, check]);

  const dismiss = useCallback(() => {
    const current = statusRef.current;
    if ('update' in current && current.update) setDismissedVersion(current.update.version);
  }, []);

  const value = useMemo<UpdaterContextValue>(
    () => ({ status, lastChecked: settings.lastUpdateCheck, check, download, install, dismiss, dismissedVersion }),
    [status, settings.lastUpdateCheck, check, download, install, dismiss, dismissedVersion],
  );

  return <UpdaterContext.Provider value={value}>{children}</UpdaterContext.Provider>;
}

export function useUpdater() {
  const value = useContext(UpdaterContext);
  if (!value) throw new Error('useUpdater must be used inside <UpdaterProvider>');
  return value;
}
