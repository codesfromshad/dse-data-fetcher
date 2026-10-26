import { useLayoutEffect, useRef } from 'react';
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
import type { NetworkMetrics, Progress } from '../lib/fetch';
import { formatBytes, formatRate } from '../lib/format';
import { formatElapsed } from '../lib/time';

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
    minWidth: 0,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  statValue: {
    fontSize: tokens.fontSizeBase500,
    lineHeight: tokens.lineHeightBase500,
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  // The network row is secondary: a step smaller, outlined instead of filled.
  netStat: {
    backgroundColor: 'transparent',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    padding: `calc(${tokens.spacingVerticalS} - 1px) calc(${tokens.spacingHorizontalM} - 1px)`,
  },
  // Repainted every frame while running: size containment makes it a layout
  // boundary, so a new digit doesn't relayout the whole page.
  clock: { display: 'block', contain: 'strict', height: tokens.lineHeightBase500 },
  netValue: { fontSize: tokens.fontSizeBase400, lineHeight: tokens.lineHeightBase500 },
  statLabel: { color: tokens.colorNeutralForeground3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  green: { color: tokens.colorPaletteGreenForeground1 },
  blue: { color: tokens.colorPaletteBlueForeground2 },
  red: { color: tokens.colorPaletteRedForeground1 },
  brand: { color: tokens.colorBrandForeground1 },
});

const TITLES: Record<Phase, string> = {
  idle: 'Ready to fetch',
  running: 'Fetching from DSE',
  done: 'Fetch complete',
  failed: 'Fetch failed',
  cancelled: 'Fetch cancelled',
};

/**
 * Stopwatch text, to the millisecond. While running it repaints every frame
 * by writing its own text node, so the rest of the card doesn't re-render
 * 60×/s. React never renders children here, so the two never fight over the
 * DOM. While the Fetch page is hidden the effect is torn down (see App's
 * <Activity>), so the clock costs nothing on other pages.
 */
function ElapsedClock({ startedAt, finishedAt, className }: { startedAt: number | null; finishedAt: number | null; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (startedAt === null) {
      el.textContent = '—';
      return;
    }
    if (finishedAt !== null) {
      el.textContent = formatElapsed(finishedAt - startedAt);
      return;
    }
    let frame = 0;
    const tick = () => {
      const text = formatElapsed(performance.now() - startedAt);
      if (el.textContent !== text) el.textContent = text;
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [startedAt, finishedAt]);
  return <span ref={ref} className={className} role="timer" aria-live="off" />;
}

interface Props {
  phase: Phase;
  progress: Progress;
  startedAt: number | null;
  finishedAt: number | null;
  /** null until the first sample arrives. */
  network: NetworkMetrics | null;
  showNetwork: boolean;
}

interface Stat {
  label: string;
  value: string;
  className?: string;
  title?: string;
}

export function RunCard({ phase, progress, startedAt, finishedAt, network, showNetwork }: Props) {
  const styles = useStyles();
  const running = phase === 'running';
  const { counts } = progress;
  const processed = counts.fetched + counts.skipped + counts.failed;

  // Determinate only while company pages are being fetched.
  const value =
    phase === 'done'
      ? 1
      : running && progress.stage === 'companies' && counts.total
        ? Math.min(1, processed / counts.total)
        : running
          ? undefined
          : processed && counts.total
            ? Math.min(1, processed / counts.total)
            : 0;

  const icon = {
    idle: <PlayCircleRegular className={styles.muted} />,
    running: <Spinner size="small" />,
    done: <CheckmarkCircleFilled className={styles.ok} />,
    failed: <ErrorCircleFilled className={styles.bad} />,
    cancelled: <DismissCircleFilled className={styles.muted} />,
  }[phase];

  const stats: Stat[] = [
    { label: 'Symbols', value: counts.total ? String(counts.total) : '—' },
    { label: 'Fetched', value: String(counts.fetched), className: styles.green },
    { label: 'Skipped', value: String(counts.skipped), className: styles.blue },
    { label: 'Failed', value: String(counts.failed), className: counts.failed ? styles.red : undefined },
  ];

  const n = network;
  const ratio = n && n.transferred ? n.processed / n.transferred : 0;
  const netStats: Stat[] = [
    {
      label: 'Transferred',
      value: n ? formatBytes(n.transferred) : '—',
      title: 'Downloaded from DSE, as sent over the network (compressed)',
    },
    {
      label: ratio >= 1.05 ? `Processed · ${ratio.toFixed(1)}× larger` : 'Processed',
      value: n ? formatBytes(n.processed) : '—',
      title: 'Decompressed HTML and data actually parsed',
    },
    running
      ? { label: 'Speed', value: n ? formatRate(n.rate) : '—', className: styles.brand, title: 'Transfer rate over the last second' }
      : { label: 'Average speed', value: n ? formatRate(n.averageRate) : '—', title: 'Transferred ÷ fetching time' },
    { label: 'Peak speed', value: n ? formatRate(n.peakRate) : '—' },
    { label: 'Requests', value: n ? n.requests.toLocaleString() : '—', title: 'HTTP responses received, retries included' },
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
        <div className={styles.stat} title={finishedAt !== null ? 'Total time, to the millisecond' : undefined}>
          <ElapsedClock startedAt={startedAt} finishedAt={finishedAt} className={mergeClasses(styles.statValue, styles.clock)} />
          <Caption1 className={styles.statLabel}>Elapsed</Caption1>
        </div>
      </div>

      {showNetwork && phase !== 'idle' && (
        <div className={styles.stats} aria-label="Network">
          {netStats.map((s) => (
            <div key={s.title ?? s.label} className={mergeClasses(styles.stat, styles.netStat)} title={s.title}>
              <span className={mergeClasses(styles.statValue, styles.netValue, s.className)}>{s.value}</span>
              <Caption1 className={styles.statLabel}>{s.label}</Caption1>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
