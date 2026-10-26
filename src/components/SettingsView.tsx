import { useEffect, useState } from 'react';
import {
  Badge,
  Body1Strong,
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Dropdown,
  Link,
  MessageBar,
  MessageBarBody,
  Option,
  SpinButton,
  Switch,
  Tab,
  TabList,
  Title3,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowDownloadRegular,
  ArrowRepeatAllRegular,
  ArrowResetRegular,
  ArrowSyncRegular,
  BranchForkRegular,
  DarkThemeRegular,
  DataTrendingRegular,
  DataUsageRegular,
  DocumentTableRegular,
  DocumentTextRegular,
  FolderOpenRegular,
  OpenRegular,
  PlayCircleRegular,
  SettingsRegular,
  ShieldTaskRegular,
  WrenchRegular,
  type FluentIcon,
} from '@fluentui/react-icons';
import { useSettings } from '../hooks/useSettings';
import type { SystemCheck } from '../hooks/useSystemCheck';
import { APP_VERSION, displayVersion, IS_PRERELEASE } from '../lib/description';
import { describeError } from '../lib/errors';
import { effectiveApp } from '../lib/native';
import {
  DEFAULT_FETCH_RETRIES,
  MAX_FETCH_RETRIES,
  openSettingsFolder,
  type ThemePreference,
  type UpdateChannel,
} from '../lib/settings';
import { ChangelogDialog } from './ReleaseNotes';
import { SettingCard, SettingRow, SettingsGroup } from './SettingRow';
import { CheckList } from './SystemCheck';
import { UpdatePanel } from './UpdateControls';

export type SettingsSection = 'general' | 'fetching' | 'updates' | 'system' | 'advanced';

const SECTIONS: { id: SettingsSection; label: string; icon: FluentIcon }[] = [
  { id: 'general', label: 'General', icon: SettingsRegular },
  { id: 'fetching', label: 'Fetching', icon: DataTrendingRegular },
  { id: 'updates', label: 'Updates', icon: ArrowSyncRegular },
  { id: 'system', label: 'System status', icon: ShieldTaskRegular },
  { id: 'advanced', label: 'Advanced', icon: WrenchRegular },
];

const THEMES: Record<ThemePreference, string> = { system: 'Use system setting', light: 'Light', dark: 'Dark' };
const CHANNELS: Record<UpdateChannel, string> = { stable: 'Stable', beta: 'Beta (preview builds)' };

const useStyles = makeStyles({
  page: { flex: 1, minHeight: 0, display: 'flex', gap: tokens.spacingHorizontalXXL },
  nav: { width: '200px', flexShrink: 0, paddingTop: tokens.spacingVerticalXS },
  navList: { width: '100%' },
  content: { flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', justifyContent: 'center' },
  column: {
    width: '100%',
    maxWidth: '860px',
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    paddingBottom: tokens.spacingVerticalXXL,
    paddingRight: tokens.spacingHorizontalS,
  },
  title: { marginBottom: tokens.spacingVerticalS },
  dropdown: { minWidth: '210px' },
  spin: { width: '96px' },
  muted: { color: tokens.colorNeutralForeground3 },
  app: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM },
  appIcon: { fontSize: '28px', color: tokens.colorPaletteGreenForeground1, flexShrink: 0 },
  appIconMissing: { fontSize: '28px', color: tokens.colorNeutralForeground4, flexShrink: 0 },
  appText: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 },
  path: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    overflowWrap: 'anywhere',
  },
  checkHead: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM, marginBottom: tokens.spacingVerticalM },
  grow: { flex: 1, display: 'flex', flexDirection: 'column' },
});

interface Props {
  system: SystemCheck;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}

export function SettingsView({ system, section, onSectionChange }: Props) {
  const styles = useStyles();
  const [error, setError] = useState<string | null>(null);

  /** Run an action and show its error at the top of the page. */
  const act = (fn: () => Promise<unknown>) => async () => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  return (
    <div className={styles.page}>
      <nav className={styles.nav} aria-label="Settings sections">
        <TabList
          vertical
          size="large"
          className={styles.navList}
          selectedValue={section}
          onTabSelect={(_, d) => onSectionChange(d.value as SettingsSection)}
        >
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <Tab key={id} value={id} icon={<Icon />}>
              {label}
            </Tab>
          ))}
        </TabList>
      </nav>

      <div className={styles.content}>
        <div className={styles.column}>
          <Title3 className={styles.title}>{current.label}</Title3>
          {error && (
            <MessageBar intent="error">
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          )}
          {section === 'general' && <GeneralSection act={act} />}
          {section === 'fetching' && <FetchingSection system={system} act={act} />}
          {section === 'updates' && <UpdatesSection act={act} />}
          {section === 'system' && <SystemSection system={system} act={act} />}
          {section === 'advanced' && <AdvancedSection act={act} />}
        </div>
      </div>
    </div>
  );
}

type Act = (fn: () => Promise<unknown>) => () => Promise<void>;

// ---------------------------------------------------------------------------

function GeneralSection({ act }: { act: Act }) {
  const styles = useStyles();
  const { settings, update } = useSettings();
  return (
    <SettingsGroup title="Appearance">
      <SettingRow icon={<DarkThemeRegular />} title="App theme" description="Choose light or dark, or follow your Windows setting.">
        <Dropdown
          className={styles.dropdown}
          value={THEMES[settings.theme]}
          selectedOptions={[settings.theme]}
          onOptionSelect={(_, d) => void act(() => update({ theme: d.optionValue as ThemePreference }))()}
        >
          {(Object.keys(THEMES) as ThemePreference[]).map((id) => (
            <Option key={id} value={id}>
              {THEMES[id]}
            </Option>
          ))}
        </Dropdown>
      </SettingRow>
    </SettingsGroup>
  );
}

// ---------------------------------------------------------------------------

function FetchingSection({ system, act }: { system: SystemCheck; act: Act }) {
  const styles = useStyles();
  const { settings, update } = useSettings();
  const s = system.spreadsheet;
  const app = effectiveApp(s);
  const custom = !!s?.customPath;

  return (
    <>
      <SettingsGroup title="When the app opens">
        <SettingRow
          icon={<PlayCircleRegular />}
          title="Start fetching automatically"
          description="Runs the system check and starts fetching when everything passes. Turn off to start fetches yourself."
        >
          <Switch
            checked={settings.autoFetchOnLaunch}
            onChange={(_, d) => void act(() => update({ autoFetchOnLaunch: d.checked }))()}
            label={settings.autoFetchOnLaunch ? 'On' : 'Off'}
            labelPosition="before"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="While fetching">
        <RetriesRow act={act} />
        <SettingRow
          icon={<DataUsageRegular />}
          title="Show network metrics"
          description="Data transferred and processed, transfer speed and request count, on the progress card and in the activity log."
        >
          <Switch
            checked={settings.showNetworkMetrics}
            onChange={(_, d) => void act(() => update({ showNetworkMetrics: d.checked }))()}
            label={settings.showNetworkMetrics ? 'On' : 'Off'}
            labelPosition="before"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="When a fetch finishes">
        <SettingRow
          icon={<OpenRegular />}
          title="Open the workbook"
          description="Opens the spreadsheet in your spreadsheet app as soon as it's ready."
        >
          <Switch
            checked={settings.openAfterFetch}
            onChange={(_, d) => void act(() => update({ openAfterFetch: d.checked }))()}
            label={settings.openAfterFetch ? 'On' : 'Off'}
            labelPosition="before"
          />
        </SettingRow>

        <SettingRow
          icon={<DocumentTableRegular />}
          title="Spreadsheet app"
          description="The app that opens the workbook."
          extra={
            <div className={styles.app}>
              <DocumentTableRegular className={app ? styles.appIcon : styles.appIconMissing} />
              <div className={styles.appText}>
                <Body1Strong>
                  {app ? app.name : custom ? 'Chosen app not found' : 'No spreadsheet app found'}{' '}
                  {s && (
                    <Badge appearance="tint" size="small" color={custom ? 'brand' : 'informative'}>
                      {custom ? 'Custom' : 'System default'}
                    </Badge>
                  )}
                </Body1Strong>
                <span className={styles.path}>
                  {app?.path ??
                    (custom
                      ? `${s?.customPath} doesn’t exist anymore. Choose the app again.`
                      : 'Nothing on this PC is set to open .xlsx files. Choose Excel, LibreOffice Calc or another spreadsheet app.')}
                </span>
              </div>
            </div>
          }
        >
          {custom && (
            <Button icon={<ArrowResetRegular />} onClick={act(system.resetToSystemDefault)}>
              Use default
            </Button>
          )}
          <Button appearance="primary" icon={<FolderOpenRegular />} onClick={act(system.chooseApp)}>
            Choose…
          </Button>
        </SettingRow>
      </SettingsGroup>
    </>
  );
}

function RetriesRow({ act }: { act: Act }) {
  const styles = useStyles();
  const { settings, update } = useSettings();
  const unlimited = settings.fetchRetries === null;
  // Remember the number while "Unlimited" is on, so turning it off restores it.
  const [count, setCount] = useState(settings.fetchRetries ?? DEFAULT_FETCH_RETRIES);
  useEffect(() => {
    if (settings.fetchRetries !== null) setCount(settings.fetchRetries);
  }, [settings.fetchRetries]);

  const save = (value: number) => {
    const clamped = Math.min(MAX_FETCH_RETRIES, Math.max(0, Math.round(value)));
    setCount(clamped);
    if (clamped !== settings.fetchRetries) void act(() => update({ fetchRetries: clamped }))();
  };

  return (
    <SettingRow
      icon={<ArrowRepeatAllRegular />}
      title="Retries per company"
      description={
        unlimited
          ? 'Keeps trying a company page until it loads with every value. Cancel the fetch to stop.'
          : 'How many times to try a company page again if it doesn’t load or has missing values. After that, the row is kept with blank cells, or marked as failed.'
      }
    >
      <SpinButton
        className={styles.spin}
        aria-label="Retries per company"
        disabled={unlimited}
        min={0}
        max={MAX_FETCH_RETRIES}
        value={count}
        onChange={(_, d) => {
          const value = d.value ?? (d.displayValue !== undefined ? parseInt(d.displayValue, 10) : NaN);
          if (Number.isFinite(value)) save(value as number);
        }}
      />
      <Switch
        checked={unlimited}
        onChange={(_, d) => void act(() => update({ fetchRetries: d.checked ? null : count }))()}
        label="Unlimited"
        labelPosition="before"
      />
    </SettingRow>
  );
}

// ---------------------------------------------------------------------------

function UpdatesSection({ act }: { act: Act }) {
  const styles = useStyles();
  const { settings, update, channel } = useSettings();
  const leavingBeta = IS_PRERELEASE && channel === 'stable';

  return (
    <>
      <SettingCard>
        <UpdatePanel />
      </SettingCard>

      <SettingsGroup title="Preferences">
        <SettingRow
          icon={<ArrowSyncRegular />}
          title="Check for updates automatically"
          description="Checks GitHub when the app starts and every few hours while it's open."
        >
          <Switch
            checked={settings.checkForUpdates}
            onChange={(_, d) => void act(() => update({ checkForUpdates: d.checked }))()}
            label={settings.checkForUpdates ? 'On' : 'Off'}
            labelPosition="before"
          />
        </SettingRow>
        <SettingRow
          icon={<ArrowDownloadRegular />}
          title="Download updates automatically"
          description="Updates download in the background. You still choose when to restart and install."
          disabled={!settings.checkForUpdates}
        >
          <Switch
            disabled={!settings.checkForUpdates}
            checked={settings.autoDownloadUpdates}
            onChange={(_, d) => void act(() => update({ autoDownloadUpdates: d.checked }))()}
            label={settings.autoDownloadUpdates ? 'On' : 'Off'}
            labelPosition="before"
          />
        </SettingRow>
        <SettingRow
          icon={<BranchForkRegular />}
          title="Update channel"
          description={
            leavingBeta
              ? `You're on a beta (${displayVersion(APP_VERSION)}). You'll move to the next stable release once it's out.`
              : channel === 'beta'
                ? 'Get new features early. Beta builds can have rough edges.'
                : 'Only fully tested releases.'
          }
        >
          <Dropdown
            className={styles.dropdown}
            value={CHANNELS[channel]}
            selectedOptions={[channel]}
            onOptionSelect={(_, d) => void act(() => update({ updateChannel: d.optionValue as UpdateChannel }))()}
          >
            {(Object.keys(CHANNELS) as UpdateChannel[]).map((id) => (
              <Option key={id} value={id}>
                {CHANNELS[id]}
              </Option>
            ))}
          </Dropdown>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Related">
        <SettingRow icon={<DocumentTextRegular />} title="Release notes" description="See what changed in each version.">
          <ChangelogDialog trigger={<Button>View</Button>} />
        </SettingRow>
      </SettingsGroup>
    </>
  );
}

// ---------------------------------------------------------------------------

function SystemSection({ system, act }: { system: SystemCheck; act: Act }) {
  const styles = useStyles();
  return (
    <SettingCard>
      <div className={styles.checkHead}>
        <div className={styles.grow}>
          <Body1Strong>Startup system check</Body1Strong>
          <Caption1 className={styles.muted}>
            {system.running
              ? 'Checking…'
              : system.checkedAt
                ? `Last checked at ${system.checkedAt.toLocaleTimeString()}. Runs every time the app starts.`
                : 'Not checked yet'}
          </Caption1>
        </div>
        <Button icon={<ArrowSyncRegular />} disabled={system.running} onClick={() => void system.run()}>
          Check again
        </Button>
      </div>
      <CheckList checks={system.checks} onChooseApp={act(system.chooseApp)} />
    </SettingCard>
  );
}

// ---------------------------------------------------------------------------

function AdvancedSection({ act }: { act: Act }) {
  const { reset } = useSettings();
  const [confirm, setConfirm] = useState(false);
  return (
    <SettingsGroup title="Data">
      <SettingRow
        icon={<FolderOpenRegular />}
        title="Settings folder"
        description={
          <>
            Where your settings are stored (<Link inline onClick={act(openSettingsFolder)}>settings.json</Link>).
          </>
        }
      >
        <Button onClick={act(openSettingsFolder)}>Open folder</Button>
      </SettingRow>
      <SettingRow
        icon={<ArrowResetRegular />}
        title="Reset settings"
        description="Restore every setting, including the spreadsheet app, to its default."
      >
        <Dialog open={confirm} onOpenChange={(_, d) => setConfirm(d.open)}>
          <DialogTrigger disableButtonEnhancement>
            <Button>Reset…</Button>
          </DialogTrigger>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Reset all settings?</DialogTitle>
              <DialogContent>
                Theme, fetching and update preferences go back to their defaults, and the app will use the system’s default
                spreadsheet app again.
              </DialogContent>
              <DialogActions>
                <Button
                  appearance="primary"
                  onClick={() => {
                    setConfirm(false);
                    void act(reset)();
                  }}
                >
                  Reset
                </Button>
                <DialogTrigger disableButtonEnhancement>
                  <Button>Cancel</Button>
                </DialogTrigger>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      </SettingRow>
    </SettingsGroup>
  );
}
