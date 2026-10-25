import { createRoot } from 'react-dom/client';
import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useLayoutEffect, useSyncExternalStore } from 'react';
import App from './App';
import { SettingsProvider, useSettings } from './hooks/useSettings';
import { UpdaterProvider } from './hooks/useUpdater';
import { DEFAULT_SETTINGS, getSettings, type Settings } from './lib/settings';

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const subscribe = (onChange: () => void) => {
  darkQuery.addEventListener('change', onChange);
  return () => darkQuery.removeEventListener('change', onChange);
};

/** Light/dark from Settings, or following Windows live. */
function Themed() {
  const { settings } = useSettings();
  const systemDark = useSyncExternalStore(subscribe, () => darkQuery.matches);
  const dark = settings.theme === 'system' ? systemDark : settings.theme === 'dark';

  // Keep the pre-JS background from index.html in step with the theme.
  useLayoutEffect(() => {
    document.documentElement.style.background = dark ? '#141414' : '#f5f5f5';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }, [dark]);

  return (
    <FluentProvider theme={dark ? webDarkTheme : webLightTheme} style={{ height: '100%' }}>
      <UpdaterProvider>
        <App />
      </UpdaterProvider>
    </FluentProvider>
  );
}

// Block the webview's own context menu and reload shortcuts so it feels like
// a native app (dev builds keep them for debugging).
if (import.meta.env.PROD) {
  window.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('input, textarea, [data-allow-context-menu]')) e.preventDefault();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) e.preventDefault();
  });
}

async function boot() {
  // Settings decide the theme, so load them before the first paint. If that
  // fails for any reason, start with defaults rather than not at all.
  const initial: Settings = await getSettings().catch(() => DEFAULT_SETTINGS);

  createRoot(document.getElementById('root')!).render(
    <SettingsProvider initial={initial}>
      <Themed />
    </SettingsProvider>,
  );

  // The window starts hidden (tauri.conf.json) to avoid a white flash; show
  // it once React has painted.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const window = getCurrentWindow();
      void window.show().then(() => window.setFocus()).catch(() => {});
    }),
  );
}

void boot();
