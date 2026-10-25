import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Caption1,
  Subtitle2,
  Switch,
  Tab,
  TabList,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
  type BadgeProps,
} from '@fluentui/react-components';
import { ArrowDownRegular, CopyRegular, DeleteRegular, TextBulletListLtrRegular } from '@fluentui/react-icons';
import { entryToText, levelLabel, type LogEntry, type LogLevel, type LogPart, type Tone } from '../lib/log';

const useStyles = makeStyles({
  card: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    flex: 1,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusXLarge,
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM} ${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexWrap: 'wrap',
  },
  title: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  spacer: { flex: 1 },
  scroller: {
    position: 'relative',
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: `${tokens.spacingVerticalXS} 0`,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '92px 76px minmax(0, 1fr)',
    alignItems: 'baseline',
    columnGap: tokens.spacingHorizontalM,
    padding: `3px ${tokens.spacingHorizontalL}`,
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  rowWarn: { backgroundColor: tokens.colorStatusWarningBackground1 },
  rowError: { backgroundColor: tokens.colorStatusDangerBackground1 },
  time: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    whiteSpace: 'nowrap',
  },
  level: { justifySelf: 'start' },
  message: { overflowWrap: 'anywhere', color: tokens.colorNeutralForeground1 },
  accent: { color: tokens.colorBrandForeground1, fontWeight: tokens.fontWeightSemibold },
  success: { color: tokens.colorPaletteGreenForeground1, fontWeight: tokens.fontWeightSemibold },
  info: { color: tokens.colorPaletteBlueForeground2, fontWeight: tokens.fontWeightSemibold },
  danger: { color: tokens.colorPaletteRedForeground1, fontWeight: tokens.fontWeightSemibold },
  subtle: { color: tokens.colorNeutralForeground3 },
  inlineBadge: { verticalAlign: 'baseline', margin: `0 2px` },
  empty: {
    height: '100%',
    display: 'grid',
    placeItems: 'center',
    color: tokens.colorNeutralForeground3,
  },
  jump: {
    position: 'absolute',
    right: tokens.spacingHorizontalL,
    bottom: tokens.spacingVerticalM,
  },
  jumpWrap: { position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
});

const LEVEL_COLOR: Record<LogLevel, BadgeProps['color']> = {
  success: 'success',
  info: 'informative',
  warn: 'warning',
  error: 'danger',
};

const BADGE_COLOR: Record<Tone, BadgeProps['color']> = {
  accent: 'brand',
  success: 'success',
  info: 'informative',
  danger: 'danger',
  subtle: 'informative',
};

function Part({ part }: { part: LogPart }) {
  const styles = useStyles();
  if (typeof part === 'string') return <>{part}</>;
  if (part.badge) {
    return (
      <Badge className={styles.inlineBadge} size="small" appearance={part.tone === 'subtle' ? 'tint' : 'filled'} color={BADGE_COLOR[part.tone]}>
        {part.text}
      </Badge>
    );
  }
  return <span className={styles[part.tone]}>{part.text}</span>;
}

const Row = memo(function Row({ entry }: { entry: LogEntry }) {
  const styles = useStyles();
  return (
    <div
      className={mergeClasses(styles.row, entry.level === 'warn' && styles.rowWarn, entry.level === 'error' && styles.rowError)}
      title={entry.time}
    >
      <span className={styles.time}>{entry.shortTime}</span>
      <Badge className={styles.level} size="small" appearance="tint" color={LEVEL_COLOR[entry.level]}>
        {levelLabel(entry.level)}
      </Badge>
      <span className={styles.message}>
        {entry.parts.map((part, i) => (
          <Part key={i} part={part} />
        ))}
      </span>
    </div>
  );
});

type Filter = 'all' | 'issues';

export function LogView({ logs, onClear }: { logs: LogEntry[]; onClear: () => void }) {
  const styles = useStyles();
  const [filter, setFilter] = useState<Filter>('all');
  const [follow, setFollow] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [copied, setCopied] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const visible = useMemo(
    () => (filter === 'all' ? logs : logs.filter((e) => e.level === 'warn' || e.level === 'error')),
    [logs, filter],
  );
  const issueCount = useMemo(() => logs.filter((e) => e.level === 'warn' || e.level === 'error').length, [logs]);

  // Stick to the bottom while following.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && follow && atBottom) el.scrollTop = el.scrollHeight;
  }, [visible, follow, atBottom]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  };

  const jumpToEnd = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(visible.map(entryToText).join('\n'));
      setCopied(true);
    } catch {
      // clipboard unavailable; nothing useful to do
    }
  };

  return (
    <section className={styles.card} aria-label="Activity log">
      <div className={styles.header}>
        <div className={styles.title}>
          <TextBulletListLtrRegular fontSize={20} />
          <Subtitle2>Activity</Subtitle2>
          <Caption1>{logs.length ? `${logs.length} entries` : ''}</Caption1>
        </div>
        <TabList size="small" selectedValue={filter} onTabSelect={(_, d) => setFilter(d.value as Filter)}>
          <Tab value="all">All</Tab>
          <Tab value="issues">Warnings &amp; errors{issueCount ? ` (${issueCount})` : ''}</Tab>
        </TabList>
        <div className={styles.spacer} />
        <Switch label="Auto-scroll" checked={follow} onChange={(_, d) => setFollow(d.checked)} />
        <Tooltip content={copied ? 'Copied' : 'Copy log'} relationship="label">
          <Button appearance="subtle" icon={<CopyRegular />} onClick={copy} disabled={!visible.length} />
        </Tooltip>
        <Tooltip content="Clear log" relationship="label">
          <Button appearance="subtle" icon={<DeleteRegular />} onClick={onClear} disabled={!logs.length} />
        </Tooltip>
      </div>

      <div className={styles.jumpWrap}>
        <div ref={scroller} className={styles.scroller} onScroll={onScroll} data-allow-context-menu>
          {visible.length ? (
            visible.map((entry) => <Row key={entry.id} entry={entry} />)
          ) : (
            <div className={styles.empty}>{filter === 'all' ? 'Nothing logged yet.' : 'No warnings or errors.'}</div>
          )}
        </div>
        {!atBottom && visible.length > 0 && (
          <Button className={styles.jump} appearance="primary" shape="circular" size="small" icon={<ArrowDownRegular />} onClick={jumpToEnd}>
            Latest
          </Button>
        )}
      </div>
    </section>
  );
}
