import { Activity, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  Tab,
  TabList,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowSyncRegular,
  DataTrendingRegular,
  DismissRegular,
  InfoRegular,
  PlayRegular,
  SettingsRegular,
} from '@fluentui/react-icons';
import icon from './assets/icon.png';
import { CloseDialog } from './components/CloseDialog';
import { LogView } from './components/LogView';
import { ResultBar } from './components/ResultBar';
import { RunCard } from './components/RunCard';
import type { SettingsSection } from './components/SettingsView';
import { CheckSummary, SystemCheckCard } from './components/SystemCheck';
import { UpdateBanner } from './components/UpdateControls';
import { WhatsNewDialog } from './components/WhatsNewDialog';
import { useCloseGuard } from './hooks/useCloseGuard';
import { useFetchRun } from './hooks/useFetchRun';
import { useSettings } from './hooks/useSettings';
import { useSystemCheck } from './hooks/useSystemCheck';
import { useUpdater } from './hooks/useUpdater';
import { APP_NAME, APP_VERSION, displayVersion, IS_PRERELEASE } from './lib/description';
import { describeError } from './lib/errors';
import { effectiveApp, openFile } from './lib/native';

// Settings and About aren't needed for the first paint, so they (and the
// Dropdown/SpinButton/legal texts only they use) load as separate chunks,
// fetched once the app is idle so switching tabs is still instant.
const loadSettings = () => import('./components/SettingsView');
const loadAbout = () => import('./components/AboutView');
const SettingsView = lazy(() => loadSettings().then((m) => ({ default: m.SettingsView })));
const AboutView = lazy(() => loadAbout().then((m) => ({ default: m.AboutView })));

function preloadPages() {
  const run = () => void Promise.all([loadSettings(), loadAbout()]).catch(() => {});
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 500);
}

const useStyles = makeStyles({
  shell: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
  },
  appBar: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalXL}`,
    flexShrink: 0,
  },
  brand: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  logo: { width: '24px', height: '24px' },
  appName: { fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400 },
  spacer: { flex: 1 },
  dot: {
    display: 'inline-block',
    width: '6px',
    height: '6px',
    marginLeft: '6px',
    marginBottom: '6px',
    borderRadius: '50%',
    backgroundColor: tokens.colorBrandBackground,
  },
  // Title on its own line, above the message.
  barTitle: { display: 'block', marginBottom: tokens.spacingVerticalXXS },
  content: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalXL} ${tokens.spacingVerticalXL}`,
  },
});

type Page = 'fetch' | 'settings' | 'about';

export default function App() {
  const styles = useStyles();
  const run = useFetchRun();
  const close = useCloseGuard();
  const system = useSystemCheck();
  const { settings } = useSettings();
  const updater = useUpdater();
  const [page, setPage] = useState<Page>('fetch');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [notice, setNotice] = useState<string | null>(null);
  // Pages stay mounted once opened and are hidden instead (see <Activity>
  // below), so coming back to one doesn't rebuild it.
  const [opened, setOpened] = useState<ReadonlySet<Page>>(() => new Set(['fetch']));
  if (!opened.has(page)) setOpened(new Set([...opened, page]));

  const hasApp = effectiveApp(system.spreadsheet) !== null;
  const ready = system.checks.filter((c) => c.id !== 'spreadsheet').every((c) => c.state === 'ok');
  const openAfter = hasApp && settings.openAfterFetch;

  const startFetch = useCallback(() => {
    setPage('fetch');
    setNotice(null);
    run.start({ openAfter });
  }, [run, openAfter]);

  const openSettings = useCallback((section: SettingsSection) => {
    setSettingsSection(section);
    setPage('settings');
  }, []);

  // On launch: run the system check, then start fetching (like the CLI did)
  // only if everything passed and auto-fetch is on. Otherwise the check card
  // says what's wrong (or waits for Start fetch).
  useEffect(preloadPages, []);

  const booted = useRef(false);
  const { start } = run;
  const { run: runCheck } = system;
  const launch = useRef({ auto: settings.autoFetchOnLaunch, open: settings.openAfterFetch });
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void runCheck().then((summary) => {
      const { auto, open } = launch.current;
      if (auto && summary.ready && (summary.hasApp || !open)) start({ openAfter: open && summary.hasApp });
    });
  }, [runCheck, start]);

  // The fetch and the system check each look at the connection; keep them in
  // step. A fetch that found no connection marks the check offline, and one
  // that got past connecting clears an offline or DSE problem by re-checking.
  const { reportOffline } = system;
  const offlineRun = run.phase === 'failed' && run.error?.offline === true;
  useEffect(() => {
    if (offlineRun) reportOffline();
  }, [offlineRun, reportOffline]);
  const connected = run.phase === 'running' && run.progress.stage !== 'connecting';
  const networkProblem = useRef(false);
  networkProblem.current = system.checks.some((c) => (c.id === 'internet' || c.id === 'dse') && c.state === 'error');
  useEffect(() => {
    // Once per run, when it gets past connecting (not on every check result).
    if (connected && networkProblem.current) void runCheck();
  }, [connected, runCheck]);

  /** Pick a spreadsheet app, then carry on with whatever was waiting on it. */
  const chooseApp = useCallback(async () => {
    setNotice(null);
    try {
      const status = await system.chooseApp();
      if (!status || !effectiveApp(status)) return;
      if (run.phase === 'done' && run.result) await openFile(run.result.filePath);
      else if (run.phase === 'idle' && ready && settings.autoFetchOnLaunch) run.start({ openAfter: settings.openAfterFetch });
    } catch (error) {
      setNotice(describeError(error));
    }
  }, [system, run, ready, settings.autoFetchOnLaunch, settings.openAfterFetch]);

  const running = run.phase === 'running';
  const updateReady = updater.status.kind === 'ready';

  return (
    <div className={styles.shell}>
      <header className={styles.appBar}>
        <div className={styles.brand}>
          <img src={icon} alt="" className={styles.logo} />
          <Text className={styles.appName}>{APP_NAME}</Text>
          <Badge appearance="tint" color={IS_PRERELEASE ? 'informative' : 'subtle'} size="small" title={APP_VERSION}>
            {displayVersion(APP_VERSION)}
          </Badge>
        </div>

        <TabList selectedValue={page} onTabSelect={(_, d) => setPage(d.value as Page)}>
          <Tab value="fetch" icon={<DataTrendingRegular />}>
            Fetch
          </Tab>
          <Tab value="settings" icon={<SettingsRegular />}>
            Settings
          </Tab>
          <Tab value="about" icon={<InfoRegular />}>
            About
            {updateReady && <PresenceDot />}
          </Tab>
        </TabList>

        <div className={styles.spacer} />

        {running ? (
          <Button icon={<DismissRegular />} onClick={run.cancel}>
            Cancel
          </Button>
        ) : (
          <Button
            appearance="primary"
            icon={run.phase === 'idle' ? <PlayRegular /> : <ArrowSyncRegular />}
            disabled={system.running && run.phase === 'idle'}
            onClick={startFetch}
          >
            {run.phase === 'idle' ? 'Start fetch' : 'Fetch again'}
          </Button>
        )}
      </header>

      <main className={styles.content}>
        {/* About and Settings → Updates show the full update panel instead. */}
        {page !== 'about' && !(page === 'settings' && settingsSection === 'updates') && <UpdateBanner />}
        {/*
          Fetch is hidden, not unmounted, on other tabs: remounting it meant
          rebuilding the activity log, which is what made switching back slow
          with 1000+ lines. While hidden, its effects (the elapsed clock's
          animation frame, log auto-scroll) are paused and its updates render
          at idle priority.
        */}
        <Activity mode={page === 'fetch' ? 'visible' : 'hidden'} name="Fetch">
            {notice && (
              <MessageBar intent="error">
                <MessageBarBody>{notice}</MessageBarBody>
              </MessageBar>
            )}

            {run.phase === 'idle' ? (
              <SystemCheckCard
                system={system}
                onChooseApp={chooseApp}
                onStart={startFetch}
                onDetails={() => openSettings('system')}
              />
            ) : (
              <>
                <CheckSummary system={system} onChooseApp={chooseApp} onDetails={() => openSettings('system')} />
                <RunCard
                  phase={run.phase}
                  progress={run.progress}
                  startedAt={run.startedAt}
                  finishedAt={run.finishedAt}
                  network={run.network}
                  showNetwork={settings.showNetworkMetrics}
                />
              </>
            )}

            {run.result && run.phase === 'done' && <ResultBar result={run.result} canOpen={hasApp} onChooseApp={chooseApp} />}

            {/* Offline is already shown (once) by the system check above. */}
            {run.error && run.phase === 'failed' && !run.error.offline && (
              <MessageBar intent="error" layout="multiline">
                <MessageBarBody>
                  <MessageBarTitle className={styles.barTitle}>Something went wrong</MessageBarTitle>
                  {run.error.message}
                </MessageBarBody>
                <MessageBarActions>
                  <Button icon={<ArrowSyncRegular />} onClick={startFetch}>
                    Try again
                  </Button>
                </MessageBarActions>
              </MessageBar>
            )}

            <LogView logs={run.logs} onClear={run.clearLogs} />
        </Activity>
        <Suspense fallback={null}>
          {opened.has('settings') && (
            <Activity mode={page === 'settings' ? 'visible' : 'hidden'} name="Settings">
              <SettingsView system={system} section={settingsSection} onSectionChange={setSettingsSection} />
            </Activity>
          )}
          {opened.has('about') && (
            <Activity mode={page === 'about' ? 'visible' : 'hidden'} name="About">
              <AboutView />
            </Activity>
          )}
        </Suspense>
      </main>

      <CloseDialog locked={close.locked} onRetry={close.retry} onCloseAnyway={close.closeAnyway} onStay={close.stay} />
      <WhatsNewDialog />
    </div>
  );
}

/** Small dot on a tab, like an app's "update available" hint. */
function PresenceDot() {
  return <span aria-label="Update ready" className={useStyles().dot} />;
}
