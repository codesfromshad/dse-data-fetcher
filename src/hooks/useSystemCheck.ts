import { useCallback, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { DSE_URL } from '../lib/dse';
import { describeError, get } from '../lib/http';
import {
  checkOnline,
  checkTempDir,
  effectiveApp,
  getSpreadsheetStatus,
  setSpreadsheetApp,
  type SpreadsheetStatus,
} from '../lib/native';

export type CheckId = 'internet' | 'dse' | 'temp' | 'spreadsheet';
export type CheckState = 'pending' | 'running' | 'ok' | 'warning' | 'error' | 'skipped';

export interface Check {
  id: CheckId;
  label: string;
  state: CheckState;
  detail: string;
}

export interface CheckSummary {
  /** Internet, DSE and temp folder all fine: a fetch can run. */
  ready: boolean;
  /** A spreadsheet app is available to open the result. */
  hasApp: boolean;
}

const INITIAL: Check[] = [
  { id: 'internet', label: 'Internet connection', state: 'pending', detail: '' },
  { id: 'dse', label: 'DSE website', state: 'pending', detail: '' },
  { id: 'temp', label: 'Temporary folder', state: 'pending', detail: '' },
  { id: 'spreadsheet', label: 'Spreadsheet application', state: 'pending', detail: '' },
];

function spreadsheetCheck(s: SpreadsheetStatus): Pick<Check, 'state' | 'detail'> {
  if (s.customPath) {
    return s.customApp
      ? { state: 'ok', detail: `${s.customApp.name} (chosen in Settings)` }
      : { state: 'warning', detail: `The chosen app is missing: ${s.customPath}` };
  }
  return s.systemDefault
    ? { state: 'ok', detail: s.systemDefault.name }
    : { state: 'warning', detail: 'No app is set up to open .xlsx files.' };
}

export function useSystemCheck() {
  const [checks, setChecks] = useState<Check[]>(INITIAL);
  const [running, setRunning] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [spreadsheet, setSpreadsheet] = useState<SpreadsheetStatus | null>(null);
  const inFlight = useRef<Promise<CheckSummary> | null>(null);

  const set = useCallback(
    (id: CheckId, patch: Partial<Check>) => setChecks((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c))),
    [],
  );

  const applySpreadsheet = useCallback(
    (status: SpreadsheetStatus) => {
      setSpreadsheet(status);
      set('spreadsheet', spreadsheetCheck(status));
      return status;
    },
    [set],
  );

  const run = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    setRunning(true);
    setChecks(INITIAL.map((c) => ({ ...c, state: 'running', detail: 'Checking…' })));

    const internet = checkOnline()
      .catch(() => false)
      .then((ok) => {
        set('internet', ok
          ? { state: 'ok', detail: 'Connected' }
          : { state: 'error', detail: 'Offline: couldn’t resolve www.google.com.' });
        return ok;
      });

    const dse = internet.then(async (online) => {
      if (!online) {
        set('dse', { state: 'skipped', detail: 'Skipped: no internet connection.' });
        return false;
      }
      const startedAt = performance.now();
      try {
        await get(DSE_URL, {}, { retries: 0, timeoutMs: 10_000 });
        set('dse', { state: 'ok', detail: `Reachable · ${Math.round(performance.now() - startedAt)} ms` });
        return true;
      } catch (error) {
        set('dse', { state: 'error', detail: `Not reachable: ${describeError(error)}` });
        return false;
      }
    });

    const temp = checkTempDir()
      .then((dir) => {
        set('temp', { state: 'ok', detail: dir });
        return true;
      })
      .catch((error) => {
        set('temp', { state: 'error', detail: describeError(error) });
        return false;
      });

    const app = getSpreadsheetStatus()
      .then((status) => effectiveApp(applySpreadsheet(status)) !== null)
      .catch((error) => {
        set('spreadsheet', { state: 'warning', detail: `Couldn’t check: ${describeError(error)}` });
        return false;
      });

    const summary = Promise.all([internet, dse, temp, app]).then(([i, d, t, a]) => ({ ready: i && d && t, hasApp: a }));
    inFlight.current = summary.finally(() => {
      inFlight.current = null;
      setRunning(false);
      setCheckedAt(new Date());
    });
    return inFlight.current;
  }, [applySpreadsheet, set]);

  /** Let the user pick an .exe. Resolves to the new status, or null if they cancelled. */
  const chooseApp = useCallback(async () => {
    const picked = await open({
      title: 'Choose your spreadsheet application',
      multiple: false,
      directory: false,
      defaultPath: 'C:\\Program Files',
      filters: [{ name: 'Programs', extensions: ['exe'] }],
    });
    if (typeof picked !== 'string') return null;
    return applySpreadsheet(await setSpreadsheetApp(picked));
  }, [applySpreadsheet]);

  const resetToSystemDefault = useCallback(
    async () => applySpreadsheet(await setSpreadsheetApp(null)),
    [applySpreadsheet],
  );

  return { checks, running, checkedAt, spreadsheet, run, chooseApp, resetToSystemDefault };
}

export type SystemCheck = ReturnType<typeof useSystemCheck>;
