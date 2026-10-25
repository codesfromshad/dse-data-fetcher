import {
  Body1,
  Body1Strong,
  Button,
  Caption1,
  Spinner,
  Subtitle1,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowSyncRegular,
  CheckmarkCircleFilled,
  CircleRegular,
  ErrorCircleFilled,
  FolderOpenRegular,
  PlayRegular,
  ShieldTaskRegular,
  WarningFilled,
} from '@fluentui/react-icons';
import type { Check, CheckState, SystemCheck } from '../hooks/useSystemCheck';

const useStyles = makeStyles({
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXL}`,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
    boxShadow: tokens.shadow2,
  },
  top: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalL, flexWrap: 'wrap' },
  heading: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: '200px' },
  headIcon: { fontSize: '32px', color: tokens.colorBrandForeground1 },
  sub: { color: tokens.colorNeutralForeground2 },
  actions: { display: 'flex', gap: tokens.spacingHorizontalS },
  list: {
    display: 'flex',
    flexDirection: 'column',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    overflow: 'hidden',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    minHeight: '44px',
    backgroundColor: tokens.colorNeutralBackground2,
    ':not(:last-child)': { borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  },
  rowText: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 },
  detail: { color: tokens.colorNeutralForeground3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  stateIcon: { fontSize: '20px', width: '20px', display: 'grid', placeItems: 'center', flexShrink: 0 },
  ok: { color: tokens.colorPaletteGreenForeground1 },
  warning: { color: tokens.colorPaletteMarigoldForeground1 },
  error: { color: tokens.colorPaletteRedForeground1 },
  muted: { color: tokens.colorNeutralForeground4 },
  strip: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
    flexWrap: 'wrap',
    padding: `0 ${tokens.spacingHorizontalXS}`,
    color: tokens.colorNeutralForeground2,
  },
  chip: { display: 'inline-flex', alignItems: 'center', gap: tokens.spacingHorizontalXS },
  chipIcon: { fontSize: '16px' },
});

export function StateIcon({ state, size = 20 }: { state: CheckState; size?: number }) {
  const styles = useStyles();
  switch (state) {
    case 'running':
      return <Spinner size={size <= 16 ? 'extra-tiny' : 'tiny'} />;
    case 'ok':
      return <CheckmarkCircleFilled fontSize={size} className={styles.ok} />;
    case 'warning':
      return <WarningFilled fontSize={size} className={styles.warning} />;
    case 'error':
      return <ErrorCircleFilled fontSize={size} className={styles.error} />;
    default:
      return <CircleRegular fontSize={size} className={styles.muted} />;
  }
}

interface ListProps {
  checks: Check[];
  onChooseApp?: () => void;
}

/** The four checks as a settings-style list. */
export function CheckList({ checks, onChooseApp }: ListProps) {
  const styles = useStyles();
  return (
    <div className={styles.list} role="list">
      {checks.map((check) => (
        <div key={check.id} className={styles.row} role="listitem">
          <span className={styles.stateIcon}>
            <StateIcon state={check.state} />
          </span>
          <div className={styles.rowText}>
            <Body1Strong>{check.label}</Body1Strong>
            <Tooltip content={check.detail || '—'} relationship="description">
              <Caption1 className={styles.detail}>{check.detail || 'Not checked yet'}</Caption1>
            </Tooltip>
          </div>
          {check.id === 'spreadsheet' && check.state === 'warning' && onChooseApp && (
            <Button size="small" icon={<FolderOpenRegular />} onClick={onChooseApp}>
              Choose app…
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

interface CardProps {
  system: SystemCheck;
  onChooseApp: () => void;
  onStart: () => void;
}

/** Startup card on the Fetch page, shown until the first fetch starts. */
export function SystemCheckCard({ system, onChooseApp, onStart }: CardProps) {
  const styles = useStyles();
  const { checks, running } = system;
  const failed = checks.filter((c) => c.state === 'error').length;
  const warned = checks.filter((c) => c.state === 'warning').length;

  const subtitle = running
    ? 'Making sure everything is ready before fetching…'
    : failed
      ? 'Something is blocking the fetch. Fix it and run the check again.'
      : warned
        ? 'You can fetch now, but the spreadsheet won’t open automatically until you choose an app.'
        : 'Everything is ready.';

  return (
    <section className={styles.card} aria-label="System check">
      <div className={styles.top}>
        <ShieldTaskRegular className={styles.headIcon} />
        <div className={styles.heading}>
          <Subtitle1>{running ? 'Checking your system' : failed || warned ? 'System check found issues' : 'System check passed'}</Subtitle1>
          <Body1 className={styles.sub}>{subtitle}</Body1>
        </div>
        {!running && (
          <div className={styles.actions}>
            <Button icon={<ArrowSyncRegular />} onClick={() => void system.run()}>
              Check again
            </Button>
            {(failed > 0 || warned > 0) && (
              <Button appearance={failed ? 'secondary' : 'primary'} icon={<PlayRegular />} onClick={onStart}>
                {failed ? 'Fetch anyway' : 'Fetch without opening'}
              </Button>
            )}
          </div>
        )}
      </div>
      <CheckList checks={checks} onChooseApp={onChooseApp} />
    </section>
  );
}

/** One-line summary shown above the run card once fetching has started. */
export function CheckStrip({ checks, onDetails }: { checks: Check[]; onDetails: () => void }) {
  const styles = useStyles();
  return (
    <div className={styles.strip} aria-label="System check summary">
      {checks.map((c) => (
        <Tooltip key={c.id} content={c.detail || c.label} relationship="description">
          <span className={mergeClasses(styles.chip)}>
            <StateIcon state={c.state} size={16} />
            <Caption1>{c.id === 'spreadsheet' && c.state === 'ok' ? c.detail.replace(' (chosen in Settings)', '') : c.label}</Caption1>
          </span>
        </Tooltip>
      ))}
      <Button appearance="transparent" size="small" onClick={onDetails}>
        Details
      </Button>
    </div>
  );
}
