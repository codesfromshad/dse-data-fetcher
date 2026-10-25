import { useCallback, useEffect, useRef, useState } from 'react';
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
import { AboutView } from './components/AboutView';
import { CloseDialog } from './components/CloseDialog';
import { LogView } from './components/LogView';
import { ResultBar } from './components/ResultBar';
import { RunCard } from './components/RunCard';
import { SettingsView, type SettingsSection } from './components/SettingsView';
import { CheckStrip, SystemCheckCard } from './components/SystemCheck';
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
        {page === 'fetch' && (
          <>
            {notice && (
              <MessageBar intent="error">
                <MessageBarBody>{notice}</MessageBarBody>
              </MessageBar>
            )}

            {run.phase === 'idle' ? (
              <SystemCheckCard system={system} onChooseApp={chooseApp} onStart={startFetch} />
            ) : (
              <>
                <CheckStrip checks={system.checks} onDetails={() => openSettings('system')} />
                <RunCard phase={run.phase} progress={run.progress} startedAt={run.startedAt} finishedAt={run.finishedAt} />
              </>
            )}

            {run.result && run.phase === 'done' && <ResultBar result={run.result} canOpen={hasApp} onChooseApp={chooseApp} />}

            {run.error && run.phase === 'failed' && (
              <MessageBar intent="error" layout="multiline">
                <MessageBarBody>
                  <MessageBarTitle>{run.error.offline ? 'You’re offline' : 'Something went wrong'}</MessageBarTitle>
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
          </>
        )}
        {page === 'settings' && (
          <SettingsView system={system} section={settingsSection} onSectionChange={setSettingsSection} />
        )}
        {page === 'about' && <AboutView />}
      </main>

      <CloseDialog locked={close.locked} onRetry={close.retry} onCloseAnyway={close.closeAnyway} onStay={close.stay} />
      <WhatsNewDialog />
    </div>
  );
}

/** Small dot on a tab, like an app's "update available" hint. */
function PresenceDot() {
  return (
    <span
      aria-label="Update ready"
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        marginLeft: 6,
        marginBottom: 6,
        borderRadius: '50%',
        backgroundColor: tokens.colorBrandBackground,
      }}
    />
  );
}
