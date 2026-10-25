import { useState, type ReactNode } from 'react';
import {
  Body1,
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  ProgressBar,
  Spinner,
  Subtitle2,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowClockwiseRegular,
  ArrowDownloadRegular,
  ArrowSyncRegular,
  CheckmarkCircleFilled,
  DismissRegular,
  DocumentTextRegular,
  WarningFilled,
} from '@fluentui/react-icons';
import { useSettings } from '../hooks/useSettings';
import { useUpdater, type UpdateStatus } from '../hooks/useUpdater';
import { APP_NAME, APP_VERSION, displayVersion } from '../lib/description';
import type { LockedFile } from '../lib/native';
import type { UpdateInfo } from '../lib/settings';
import { formatDate, notesToRelease, ReleaseBlock } from './ReleaseNotes';

const useStyles = makeStyles({
  panel: { display: 'flex', alignItems: 'flex-start', gap: tokens.spacingHorizontalL },
  icon: { width: '40px', height: '40px', display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: '32px' },
  compactIcon: { width: '20px', height: '20px', fontSize: '20px' },
  ok: { color: tokens.colorPaletteGreenForeground1 },
  brand: { color: tokens.colorBrandForeground1 },
  warn: { color: tokens.colorPaletteMarigoldForeground1 },
  text: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' },
  muted: { color: tokens.colorNeutralForeground3 },
  progress: { marginTop: tokens.spacingVerticalS, maxWidth: '420px' },
  actions: { display: 'flex', gap: tokens.spacingHorizontalS, flexWrap: 'wrap', alignItems: 'center' },
  compact: { alignItems: 'center', gap: tokens.spacingHorizontalS },
  surface: { maxWidth: '640px', width: 'calc(100vw - 48px)' },
  scroll: { maxHeight: '55vh', overflowY: 'auto' },
  files: { margin: `${tokens.spacingVerticalS} 0`, paddingLeft: tokens.spacingHorizontalXL },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
});

// ---------------------------------------------------------------------------

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function timeAgo(ms: number) {
  const seconds = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86400), 'day');
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

function describe(status: UpdateStatus, lastChecked: number | null): { title: string; detail: string } {
  const checked = lastChecked ? `Last checked ${timeAgo(lastChecked)}.` : 'Not checked yet.';
  switch (status.kind) {
    case 'idle':
      return { title: 'Check for updates', detail: checked };
    case 'checking':
      return { title: 'Checking for updates…', detail: 'Looking for a newer version on GitHub.' };
    case 'upToDate':
      return { title: 'You’re up to date', detail: `${APP_NAME} ${displayVersion(APP_VERSION)} is the latest version. ${checked}` };
    case 'available':
      return {
        title: `Update available: ${displayVersion(status.update.version)}`,
        detail: status.update.date ? `Released ${formatDate(status.update.date)}.` : 'A newer version is ready to download.',
      };
    case 'downloading':
      return {
        title: `Downloading ${displayVersion(status.update.version)}…`,
        detail: status.total
          ? `${mb(status.downloaded)} MB of ${mb(status.total)} MB`
          : status.downloaded
            ? `${mb(status.downloaded)} MB`
            : 'Starting download…',
      };
    case 'ready':
      return {
        title: `${displayVersion(status.update.version)} is ready to install`,
        detail: 'Restart the app to finish updating. It takes a few seconds.',
      };
    case 'installing':
      return { title: 'Installing update…', detail: 'The app will close and reopen on its own.' };
    case 'error':
      return {
        title: status.update ? 'The update didn’t finish' : 'Couldn’t check for updates',
        detail: status.message,
      };
  }
}

function StatusIcon({ status, compact }: { status: UpdateStatus; compact?: boolean }) {
  const styles = useStyles();
  const cls = mergeClasses(styles.icon, compact && styles.compactIcon);
  switch (status.kind) {
    case 'checking':
    case 'downloading':
    case 'installing':
      return (
        <span className={cls}>
          <Spinner size={compact ? 'extra-tiny' : 'small'} />
        </span>
      );
    case 'upToDate':
      return <CheckmarkCircleFilled className={mergeClasses(cls, styles.ok)} />;
    case 'available':
    case 'ready':
      return <ArrowDownloadRegular className={mergeClasses(cls, styles.brand)} />;
    case 'error':
      return <WarningFilled className={mergeClasses(cls, styles.warn)} />;
    default:
      return <ArrowSyncRegular className={mergeClasses(cls, styles.brand)} />;
  }
}

// ---------------------------------------------------------------------------

/** Install, but first make sure the temp workbooks aren't open in Excel. */
function useInstallFlow() {
  const { install } = useUpdater();
  const [locked, setLocked] = useState<LockedFile[]>([]);
  const start = async (force = false) => {
    setLocked([]);
    setLocked(await install(force));
  };
  const dialog = (
    <Dialog open={locked.length > 0} modalType="alert" onOpenChange={(_, d) => !d.open && setLocked([])}>
      <LockedDialogBody locked={locked} onRetry={() => void start()} onForce={() => void start(true)} onCancel={() => setLocked([])} />
    </Dialog>
  );
  return { start, dialog };
}

function LockedDialogBody(props: { locked: LockedFile[]; onRetry: () => void; onForce: () => void; onCancel: () => void }) {
  const styles = useStyles();
  return (
    <DialogSurface>
      <DialogBody>
        <DialogTitle>Close the spreadsheet first</DialogTitle>
        <DialogContent>
          The update restarts the app, which deletes its temporary workbook. This one is still open in another app:
          <ul className={styles.files}>
            {props.locked.map((f) => (
              <li key={f.path} className={styles.mono}>
                {f.fileName}
              </li>
            ))}
          </ul>
          Close it and choose <b>Try again</b>, or install anyway and leave it in your temp folder.
        </DialogContent>
        <DialogActions>
          <Button appearance="primary" onClick={props.onRetry}>
            Try again
          </Button>
          <Button onClick={props.onForce}>Install anyway</Button>
          <Button appearance="subtle" onClick={props.onCancel}>
            Cancel
          </Button>
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  );
}

export function UpdateNotesDialog({ update, open, onClose }: { update: UpdateInfo | null; open: boolean; onClose: () => void }) {
  const styles = useStyles();
  const release = update ? notesToRelease(update.version, update.notes) : null;
  return (
    <Dialog open={open && !!update} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>What’s new in {update ? displayVersion(update.version) : ''}</DialogTitle>
          <DialogContent className={styles.scroll}>
            {release ? <ReleaseBlock release={release} headless /> : <Body1>No release notes were published for this version.</Body1>}
          </DialogContent>
          <DialogActions>
            <Button appearance="primary" onClick={onClose}>
              Close
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** The action buttons for the current status. */
function Actions({ compact }: { compact?: boolean }) {
  const { status, check, download } = useUpdater();
  const { start, dialog } = useInstallFlow();
  const [notesOpen, setNotesOpen] = useState(false);
  const update = 'update' in status ? (status.update ?? null) : null;
  const size = compact ? 'small' : 'medium';

  let primary: ReactNode = null;
  switch (status.kind) {
    case 'idle':
    case 'upToDate':
      primary = (
        <Button size={size} icon={<ArrowSyncRegular />} onClick={() => void check()}>
          Check for updates
        </Button>
      );
      break;
    case 'available':
      primary = (
        <Button size={size} appearance="primary" icon={<ArrowDownloadRegular />} onClick={() => void download()}>
          Download
        </Button>
      );
      break;
    case 'ready':
      primary = (
        <Button size={size} appearance="primary" icon={<ArrowClockwiseRegular />} onClick={() => void start()}>
          Restart to update
        </Button>
      );
      break;
    case 'error':
      primary = (
        <Button size={size} icon={<ArrowSyncRegular />} onClick={() => void (status.update ? download() : check())}>
          Try again
        </Button>
      );
      break;
  }

  return (
    <>
      {primary}
      {update && status.kind !== 'installing' && (
        <Button size={size} appearance="subtle" icon={<DocumentTextRegular />} onClick={() => setNotesOpen(true)}>
          Release notes
        </Button>
      )}
      <UpdateNotesDialog update={update} open={notesOpen} onClose={() => setNotesOpen(false)} />
      {dialog}
    </>
  );
}

/** Update status with actions — Settings → Updates and the About page. */
export function UpdatePanel({ compact }: { compact?: boolean }) {
  const styles = useStyles();
  const { status, lastChecked } = useUpdater();
  const { title, detail } = describe(status, lastChecked);

  if (compact) {
    return (
      <div className={mergeClasses(styles.panel, styles.compact)}>
        <StatusIcon status={status} compact />
        <div className={styles.text}>
          <Body1>{title}</Body1>
          <Caption1 className={styles.muted}>{detail}</Caption1>
        </div>
        <div className={styles.actions}>
          <Actions compact />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <StatusIcon status={status} />
      <div className={styles.text}>
        <Subtitle2>{title}</Subtitle2>
        <Caption1 className={styles.muted}>{detail}</Caption1>
        {status.kind === 'downloading' && (
          <ProgressBar
            className={styles.progress}
            value={status.total ? status.downloaded / status.total : undefined}
            thickness="large"
          />
        )}
      </div>
      <div className={styles.actions}>
        <Actions />
      </div>
    </div>
  );
}

/** Slim bar at the top of the window when an update needs the user. */
export function UpdateBanner() {
  const { status, dismiss, dismissedVersion } = useUpdater();
  const { settings } = useSettings();
  const { start, dialog } = useInstallFlow();
  const { download } = useUpdater();
  const [notesOpen, setNotesOpen] = useState(false);

  const update = 'update' in status ? status.update : undefined;
  if (!update || update.version === dismissedVersion) return null;
  // While auto-downloading, stay quiet until it's ready.
  if (status.kind === 'downloading' && settings.autoDownloadUpdates) return null;
  if (status.kind !== 'available' && status.kind !== 'ready' && status.kind !== 'downloading') return null;

  const version = displayVersion(update.version);
  return (
    <>
      <MessageBar intent="info" icon={<ArrowDownloadRegular />}>
        <MessageBarBody>
          <MessageBarTitle>
            {status.kind === 'ready' ? 'Update ready' : status.kind === 'downloading' ? 'Downloading update' : 'Update available'}
          </MessageBarTitle>
          {status.kind === 'ready'
            ? `Version ${version} has been downloaded. Restart to install it.`
            : status.kind === 'downloading'
              ? `Downloading version ${version}…`
              : `Version ${version} is available.`}
        </MessageBarBody>
        <MessageBarActions
          containerAction={<Button appearance="transparent" aria-label="Dismiss" icon={<DismissRegular />} onClick={dismiss} />}
        >
          <Button appearance="subtle" onClick={() => setNotesOpen(true)}>
            What’s new
          </Button>
          {status.kind === 'ready' && (
            <Button appearance="primary" onClick={() => void start()}>
              Restart now
            </Button>
          )}
          {status.kind === 'available' && (
            <Button appearance="primary" onClick={() => void download()}>
              Download
            </Button>
          )}
        </MessageBarActions>
      </MessageBar>
      <UpdateNotesDialog update={update} open={notesOpen} onClose={() => setNotesOpen(false)} />
      {dialog}
    </>
  );
}
