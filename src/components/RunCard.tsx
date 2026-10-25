import { useEffect, useState } from 'react';
import {
  Body1,
  Caption1,
  ProgressBar,
  Spinner,
  Subtitle1,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  CheckmarkCircleFilled,
  DismissCircleFilled,
  ErrorCircleFilled,
  PlayCircleRegular,
} from '@fluentui/react-icons';
import type { Phase } from '../hooks/useFetchRun';
import type { Progress } from '../lib/pipeline';
import { formatClock } from '../lib/time';

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
  top: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalL },
  icon: { width: '32px', height: '32px', display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: '32px' },
  ok: { color: tokens.colorPaletteGreenForeground1 },
  bad: { color: tokens.colorPaletteRedForeground1 },
  muted: { color: tokens.colorNeutralForeground3 },
  heading: { display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 },
  status: { color: tokens.colorNeutralForeground2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
    gap: tokens.spacingHorizontalS,
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  statValue: {
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: 'tabular-nums',
  },
  statLabel: { color: tokens.colorNeutralForeground3 },
  green: { color: tokens.colorPaletteGreenForeground1 },
  blue: { color: tokens.colorPaletteBlueForeground2 },
  red: { color: tokens.colorPaletteRedForeground1 },
});

const TITLES: Record<Phase, string> = {
  idle: 'Ready to fetch',
  running: 'Fetching from DSE',
  done: 'Fetch complete',
  failed: 'Fetch failed',
  cancelled: 'Fetch cancelled',
};

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

interface Props {
  phase: Phase;
  progress: Progress;
  startedAt: number | null;
  finishedAt: number | null;
}

export function RunCard({ phase, progress, startedAt, finishedAt }: Props) {
  const styles = useStyles();
  const running = phase === 'running';
  const now = useNow(running);
  const { counts } = progress;
  const processed = counts.fetched + counts.skipped + counts.failed;

  const elapsed = startedAt ? (finishedAt ?? now) - startedAt : 0;

  // Determinate only while company pages are being fetched.
  const value =
    phase === 'done'
      ? 1
      : running && progress.stage === 'companies' && counts.total
        ? processed / counts.total
        : running
          ? undefined
          : processed && counts.total
            ? processed / counts.total
            : 0;

  const icon = {
    idle: <PlayCircleRegular className={styles.muted} />,
    running: <Spinner size="small" />,
    done: <CheckmarkCircleFilled className={styles.ok} />,
    failed: <ErrorCircleFilled className={styles.bad} />,
    cancelled: <DismissCircleFilled className={styles.muted} />,
  }[phase];

  const stats: { label: string; value: string; className?: string }[] = [
    { label: 'Symbols', value: counts.total ? String(counts.total) : '—' },
    { label: 'Fetched', value: String(counts.fetched), className: styles.green },
    { label: 'Skipped', value: String(counts.skipped), className: styles.blue },
    { label: 'Failed', value: String(counts.failed), className: counts.failed ? styles.red : undefined },
    { label: 'Elapsed', value: startedAt ? formatClock(elapsed) : '—' },
  ];

  return (
    <section className={styles.card} aria-label="Fetch progress">
      <div className={styles.top}>
        <div className={styles.icon}>{icon}</div>
        <div className={styles.heading}>
          <Subtitle1>{TITLES[phase]}</Subtitle1>
          <Body1 className={styles.status}>{phase === 'idle' ? 'Press “Start fetch” to download the latest data.' : progress.status}</Body1>
        </div>
      </div>

      <ProgressBar
        value={value}
        thickness="large"
        shape="rounded"
        color={phase === 'failed' ? 'error' : phase === 'done' ? 'success' : 'brand'}
        aria-label="Progress"
      />

      <div className={styles.stats}>
        {stats.map((s) => (
          <div key={s.label} className={styles.stat}>
            <span className={mergeClasses(styles.statValue, s.className)}>{s.value}</span>
            <Caption1 className={styles.statLabel}>{s.label}</Caption1>
          </div>
        ))}
      </div>
    </section>
  );
}
