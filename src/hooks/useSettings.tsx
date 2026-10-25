import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { IS_PRERELEASE } from '../lib/description';
import {
  preferencesOf,
  resetSettings,
  setPreferences,
  type Preferences,
  type Settings,
  type UpdateChannel,
} from '../lib/settings';

interface SettingsContextValue {
  settings: Settings;
  /** Optimistic: the UI updates at once and rolls back if saving fails. */
  update: (patch: Partial<Preferences>) => Promise<void>;
  reset: () => Promise<void>;
  /** For commands that return fresh settings (update checks etc.). */
  replace: (settings: Settings) => void;
  /** The channel actually in use (resolves "follow this build"). */
  channel: UpdateChannel;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ initial, children }: { initial: Settings; children: ReactNode }) {
  const [settings, setSettings] = useState(initial);
  const latest = useRef(initial);
  latest.current = settings;

  const update = useCallback(async (patch: Partial<Preferences>) => {
    const before = latest.current;
    const optimistic = { ...before, ...patch };
    setSettings(optimistic);
    try {
      setSettings(await setPreferences(preferencesOf(optimistic)));
    } catch (error) {
      setSettings(before);
      throw error;
    }
  }, []);

  const reset = useCallback(async () => setSettings(await resetSettings()), []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      update,
      reset,
      replace: setSettings,
      channel: settings.updateChannel ?? (IS_PRERELEASE ? 'beta' : 'stable'),
    }),
    [settings, update, reset],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside <SettingsProvider>');
  return value;
}
