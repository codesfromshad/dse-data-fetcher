import { useCallback, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { checkDse } from '../lib/fetch';
import {
  checkOnline,
  checkTempDir,
  effectiveApp,
  getSpreadsheetStatus,
  setSpreadsheetApp,
  type SpreadsheetStatus,
} from '../lib/native';
import {
  appCheckProblem,
  dseProblem,
  missingAppProblem,
  noAppProblem,
  offlineProblem,
  tempProblem,
  type Problem,
} from '../lib/problems';

export type CheckId = 'internet' | 'dse' | 'temp' | 'spreadsheet';
export type CheckState = 'pending' | 'running' | 'ok' | 'warning' | 'error' | 'skipped';

export interface Check {
  id: CheckId;
  label: string;
  state: CheckState;
  /** Short status when it passed ("Reachable · 182 ms", the app name...). */
  detail: string;
  /** What went wrong and what to do, when it didn't pass. */
  problem?: Problem;
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

function spreadsheetCheck(s: SpreadsheetStatus): Partial<Check> {
  if (s.customPath) {
    return s.customApp
      ? { state: 'ok', detail: `${s.customApp.name} (chosen in Settings)`, problem: undefined }
      : problemCheck(missingAppProblem(s.customPath));
  }
  return s.systemDefault
    ? { state: 'ok', detail: s.systemDefault.name, problem: undefined }
    : problemCheck(noAppProblem());
}

const problemCheck = (problem: Problem): Partial<Check> => ({ state: problem.severity, detail: problem.title, problem });

/** The checks that didn't pass, errors first. */
export const problemsOf = (checks: Check[]) =>
  checks
    .filter((c): c is Check & { problem: Problem } => !!c.problem)
    .sort((a, b) => Number(b.problem.severity === 'error') - Number(a.problem.severity === 'error'));

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
    setChecks(INITIAL.map((c) => ({ ...c, state: 'running', detail: 'Checking…', problem: undefined })));

    const internet = checkOnline()
      .catch(() => false)
      .then((ok) => {
        set('internet', ok ? { state: 'ok', detail: 'Connected' } : problemCheck(offlineProblem()));
        return ok;
      });

    const dse = internet.then(async (online) => {
      if (!online) {
        set('dse', { state: 'skipped', detail: 'Skipped: no internet connection.' });
        return false;
      }
      try {
        const ms = await checkDse();
        set('dse', { state: 'ok', detail: `Reachable · ${ms} ms` });
        return true;
      } catch (error) {
        set('dse', problemCheck(dseProblem(error)));
        return false;
      }
    });

    const temp = checkTempDir()
      .then((dir) => {
        set('temp', { state: 'ok', detail: dir });
        return true;
      })
      .catch((error) => {
        set('temp', problemCheck(tempProblem(error)));
        return false;
      });

    const app = getSpreadsheetStatus()
      .then((status) => effectiveApp(applySpreadsheet(status)) !== null)
      .catch((error) => {
        set('spreadsheet', problemCheck(appCheckProblem(error)));
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
