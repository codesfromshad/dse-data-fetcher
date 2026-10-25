import {
  Body1,
  Body1Strong,
  Button,
  Caption1,
  Link,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  Subtitle1,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowSyncRegular,
  CheckmarkCircleFilled,
  CircleRegular,
  ErrorCircleFilled,
  FolderOpenRegular,
  PlayRegular,
  ShieldCheckmarkRegular,
  ShieldErrorRegular,
  ShieldTaskRegular,
  WarningFilled,
} from '@fluentui/react-icons';
import { problemsOf, type Check, type CheckState, type SystemCheck } from '../hooks/useSystemCheck';
import type { Problem } from '../lib/problems';

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
  headIcon: { fontSize: '32px', flexShrink: 0 },
  sub: { color: tokens.colorNeutralForeground2 },
  actions: { display: 'flex', gap: tokens.spacingHorizontalS },
  problems: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS },
  problemTitle: { display: 'block', marginBottom: tokens.spacingVerticalXXS },
  technical: {
    display: 'block',
    marginTop: tokens.spacingVerticalXXS,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    overflowWrap: 'anywhere',
  },

  list: {
    display: 'flex',
    flexDirection: 'column',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    overflow: 'hidden',
  },
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    minHeight: '44px',
    boxSizing: 'border-box',
    backgroundColor: tokens.colorNeutralBackground2,
    ':not(:last-child)': { borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  },
  rowText: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, paddingTop: '2px' },
  detail: { color: tokens.colorNeutralForeground3, overflowWrap: 'anywhere' },
  stateIcon: { fontSize: '20px', width: '20px', height: '24px', display: 'grid', placeItems: 'center', flexShrink: 0 },
  ok: { color: tokens.colorPaletteGreenForeground1 },
  warning: { color: tokens.colorPaletteMarigoldForeground1 },
  error: { color: tokens.colorPaletteRedForeground1 },
  muted: { color: tokens.colorNeutralForeground4 },
  brand: { color: tokens.colorBrandForeground1 },

  summary: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `0 ${tokens.spacingHorizontalXS}`,
    minHeight: '24px',
    color: tokens.colorNeutralForeground2,
  },
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

/** Every check with its result, for Settings → System status. */
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
            {check.problem ? (
              <Caption1 className={styles.detail}>
                <strong>{check.problem.title}.</strong> {check.problem.message}
                {check.problem.technical && <span className={styles.technical}>{check.problem.technical}</span>}
              </Caption1>
            ) : (
              <Caption1 className={styles.detail}>{check.detail || 'Not checked yet'}</Caption1>
            )}
          </div>
          {check.problem?.fix === 'chooseApp' && onChooseApp && (
            <Button size="small" icon={<FolderOpenRegular />} onClick={onChooseApp}>
              Choose app…
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

interface ProblemProps {
  problem: Problem;
  onRetry: () => void;
  onChooseApp: () => void;
  /** Hide "Check again" (when the card already has one). */
  noRetry?: boolean;
}

/** One problem as a message bar: what happened, what to do, the raw reason. */
function ProblemBar({ problem, onRetry, onChooseApp, noRetry }: ProblemProps) {
  const styles = useStyles();
  const action =
    problem.fix === 'chooseApp' ? (
      <Button size="small" icon={<FolderOpenRegular />} onClick={onChooseApp}>
        Choose app…
      </Button>
    ) : noRetry ? null : (
      <Button size="small" icon={<ArrowSyncRegular />} onClick={onRetry}>
        Check again
      </Button>
    );
  return (
    <MessageBar intent={problem.severity} layout="multiline">
      <MessageBarBody>
        <MessageBarTitle className={styles.problemTitle}>{problem.title}</MessageBarTitle>
        {problem.message}
        {problem.technical && <span className={styles.technical}>{problem.technical}</span>}
      </MessageBarBody>
      {action && <MessageBarActions>{action}</MessageBarActions>}
    </MessageBar>
  );
}

interface CardProps {
  system: SystemCheck;
  onChooseApp: () => void;
  onStart: () => void;
  onDetails: () => void;
}

/** Startup card on the Fetch page, shown until the first fetch starts. */
export function SystemCheckCard({ system, onChooseApp, onStart, onDetails }: CardProps) {
  const styles = useStyles();
  const { checks, running } = system;
  const problems = problemsOf(checks);
  const blocked = problems.some((c) => c.problem.severity === 'error');
  const retry = () => void system.run();

  const [title, subtitle, icon] = running
    ? ['Checking your system', 'Making sure everything’s ready before fetching…', <ShieldTaskRegular className={styles.brand} />]
    : blocked
      ? [
          problems.length > 1 ? `${problems.length} problems need attention` : 'Something needs attention',
          problems.length > 1 ? 'Fetching won’t work until these are sorted out.' : 'Fetching won’t work until this is sorted out.',
          <ShieldErrorRegular className={styles.error} />,
        ]
      : problems.length
        ? ['Ready to fetch, with one note', 'Fetching will work. Here’s what to know first.', <ShieldCheckmarkRegular className={styles.warning} />]
        : ['System check passed', 'Everything’s ready. Press “Start fetch” to download the latest data.', <ShieldCheckmarkRegular className={styles.ok} />];

  return (
    <section className={styles.card} aria-label="System check">
      <div className={styles.top}>
        <span className={styles.headIcon}>{icon}</span>
        <div className={styles.heading}>
          <Subtitle1>{title}</Subtitle1>
          <Body1 className={styles.sub}>
            {subtitle}{' '}
            {!running && (
              <Link inline onClick={onDetails}>
                Details
              </Link>
            )}
          </Body1>
        </div>
        {!running && problems.length > 0 && (
          <div className={styles.actions}>
            <Button icon={<ArrowSyncRegular />} onClick={retry}>
              Check again
            </Button>
            <Button appearance={blocked ? 'secondary' : 'primary'} icon={<PlayRegular />} onClick={onStart}>
              {blocked ? 'Fetch anyway' : 'Fetch without opening'}
            </Button>
          </div>
        )}
      </div>
      {!running && problems.length > 0 && (
        <div className={styles.problems}>
          {problems.map((c) => (
            <ProblemBar key={c.id} problem={c.problem} onRetry={retry} onChooseApp={onChooseApp} noRetry />
          ))}
        </div>
      )}
    </section>
  );
}

interface SummaryProps {
  system: SystemCheck;
  onChooseApp: () => void;
  onDetails: () => void;
}

/**
 * Above the run card once fetching has started: a single quiet line when the
 * check passed, or the problems themselves when it didn't.
 */
export function CheckSummary({ system, onChooseApp, onDetails }: SummaryProps) {
  const styles = useStyles();
  const problems = problemsOf(system.checks);
  const retry = () => void system.run();

  if (system.running) {
    return (
      <div className={styles.summary} role="status">
        <Spinner size="extra-tiny" />
        <Caption1>Checking your system…</Caption1>
      </div>
    );
  }

  if (!problems.length) {
    return (
      <div className={styles.summary} role="status">
        <CheckmarkCircleFilled fontSize={16} className={styles.ok} />
        <Caption1>System check passed</Caption1>
        <Caption1>·</Caption1>
        <Link as="button" inline onClick={onDetails}>
          <Caption1>Details</Caption1>
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.problems}>
      {problems.map((c) => (
        <ProblemBar key={c.id} problem={c.problem} onRetry={retry} onChooseApp={onChooseApp} />
      ))}
    </div>
  );
}
