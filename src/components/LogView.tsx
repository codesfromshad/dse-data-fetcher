import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Button,
  Caption1,
  Subtitle2,
  Switch,
  Tab,
  TabList,
  Tooltip,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { ArrowDownRegular, CopyRegular, DeleteRegular, TextBulletListLtrRegular } from '@fluentui/react-icons';
import { OpensInBrowser } from './OpensInBrowser';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ScrollArea } from './ScrollArea';
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
  scrollArea: { flex: 1 },
  scroller: {
    position: 'relative',
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
  message: { overflowWrap: 'anywhere', color: tokens.colorNeutralForeground1 },
  accent: { color: tokens.colorBrandForeground1, fontWeight: tokens.fontWeightSemibold },
  success: { color: tokens.colorPaletteGreenForeground1, fontWeight: tokens.fontWeightSemibold },
  info: { color: tokens.colorPaletteBlueForeground2, fontWeight: tokens.fontWeightSemibold },
  danger: { color: tokens.colorPaletteRedForeground1, fontWeight: tokens.fontWeightSemibold },
  subtle: { color: tokens.colorNeutralForeground3 },
  // A symbol: its company page on the DSE website. Same colour as the other
  // highlights; underlined under the pointer, like a link.
  link: {
    textDecorationLine: 'none',
    cursor: 'pointer',
    ':hover': { textDecorationLine: 'underline' },
    ':focus-visible': { textDecorationLine: 'underline', outline: `2px solid ${tokens.colorStrokeFocus2}`, borderRadius: tokens.borderRadiusSmall },
  },

  // Pills are plain spans styled like Fluent's Badge: hundreds of rows of
  // full Badge components cost a lot more to mount than they look.
  pill: {
    display: 'inline-block',
    boxSizing: 'border-box',
    borderRadius: tokens.borderRadiusCircular,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorTransparentStroke}`,
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  // INFO / WARNING... beside each line (Badge size="small").
  levelPill: {
    justifySelf: 'start',
    minWidth: '16px',
    padding: '0 4px',
    fontSize: tokens.fontSizeBase100,
    lineHeight: '14px',
  },
  // COMPLETE, the elapsed time... inside a message: same size as the text.
  inlinePill: {
    margin: '0 2px',
    padding: `0 ${tokens.spacingHorizontalS}`,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
  },
  'tint-success': {
    backgroundColor: tokens.colorPaletteGreenBackground1,
    color: tokens.colorPaletteGreenForeground1,
    ...shorthands.borderColor(tokens.colorPaletteGreenBorder1),
  },
  'tint-informative': {
    backgroundColor: tokens.colorNeutralBackground4,
    color: tokens.colorNeutralForeground3,
    ...shorthands.borderColor(tokens.colorNeutralStroke2),
  },
  'tint-warning': {
    backgroundColor: tokens.colorPaletteYellowBackground1,
    color: tokens.colorPaletteYellowForeground1,
    ...shorthands.borderColor(tokens.colorPaletteYellowBorder1),
  },
  'tint-danger': {
    backgroundColor: tokens.colorPaletteRedBackground1,
    color: tokens.colorPaletteRedForeground1,
    ...shorthands.borderColor(tokens.colorPaletteRedBorder1),
  },
  'filled-brand': { backgroundColor: tokens.colorBrandBackground, color: tokens.colorNeutralForegroundOnBrand },
  'filled-success': { backgroundColor: tokens.colorPaletteGreenBackground3, color: tokens.colorNeutralForegroundOnBrand },
  'filled-informative': { backgroundColor: tokens.colorNeutralBackground5, color: tokens.colorNeutralForeground3 },
  'filled-danger': { backgroundColor: tokens.colorPaletteRedBackground3, color: tokens.colorNeutralForegroundOnBrand },
  // Fills the list's area (the content box is at least the view's height).
  empty: {
    position: 'absolute',
    inset: 0,
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

type Styles = ReturnType<typeof useStyles>;

const LEVEL_PILL: Record<LogLevel, keyof Styles> = {
  success: 'tint-success',
  info: 'tint-informative',
  warn: 'tint-warning',
  error: 'tint-danger',
};

const INLINE_PILL: Record<Tone, keyof Styles> = {
  accent: 'filled-brand',
  success: 'filled-success',
  info: 'filled-informative',
  danger: 'filled-danger',
  subtle: 'tint-informative',
};

function renderPart(part: LogPart, i: number, styles: Styles) {
  if (typeof part === 'string') return part;
  if (part.badge) {
    return (
      <span key={i} className={mergeClasses(styles.pill, styles.inlinePill, styles[INLINE_PILL[part.tone]])}>
        {part.text}
      </span>
    );
  }
  if (part.href) {
    const href = part.href;
    return (
      <a
        key={i}
        href={href}
        title={href}
        className={mergeClasses(styles[part.tone], styles.link)}
        onClick={(e) => {
          e.preventDefault();
          void openUrl(href).catch(() => {});
        }}
      >
        {part.text}
        <OpensInBrowser />
      </a>
    );
  }
  return (
    <span key={i} className={styles[part.tone]}>
      {part.text}
    </span>
  );
}

// A one-line row as rendered (20px line + 3px padding top and bottom, plus
// the pills' borders). Rows that wrap are measured once they're on screen.
const ROW_ESTIMATE = 28;
/** Spacing above the first row and below the last (was the scroller's padding). */
const LIST_PADDING = 4;
/** Rows rendered beyond each edge of the viewport, so fast scrolling doesn't flash blank. */
const OVERSCAN = 12;

interface RowProps {
  entry: LogEntry;
  index: number;
  styles: Styles;
  measure: (el: HTMLElement | null) => void;
}

// Only the rows in view (plus a few) exist, whatever the log's length.
// `styles` comes from the list: one style lookup per render, not per row.
const Row = memo(function Row({ entry, index, styles, measure }: RowProps) {
  return (
    <div
      ref={measure}
      data-index={index}
      className={mergeClasses(styles.row, entry.level === 'warn' && styles.rowWarn, entry.level === 'error' && styles.rowError)}
      title={entry.time}
    >
      <span className={styles.time}>{entry.shortTime}</span>
      <span className={mergeClasses(styles.pill, styles.levelPill, styles[LEVEL_PILL[entry.level]])}>{levelLabel(entry.level)}</span>
      <span className={styles.message}>{entry.parts.map((part, i) => renderPart(part, i, styles))}</span>
    </div>
  );
});

type Filter = 'all' | 'issues';

export function LogView({ logs, onClear }: { logs: LogEntry[]; onClear: () => void }) {
  const styles = useStyles();
  const [filter, setFilter] = useState<Filter>('all');
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);

  const issues = useMemo(() => logs.filter((e) => e.level === 'warn' || e.level === 'error'), [logs]);
  const visible = filter === 'all' ? logs : issues;
  const issueCount = issues.length;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

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

      <LogList
        entries={visible}
        follow={follow}
        empty={filter === 'all' ? 'Nothing logged yet.' : 'No warnings or errors.'}
        styles={styles}
      />
    </section>
  );
}

interface LogListProps {
  entries: LogEntry[];
  follow: boolean;
  empty: string;
  styles: Styles;
}

// The scrolling list on its own: scrolling re-renders only this (the rows in
// view), never the header's tabs, switch and buttons above it.
const LogList = memo(function LogList({ entries, follow, empty, styles }: LogListProps) {
  const [atBottom, setAtBottom] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_ESTIMATE,
    getItemKey: (index) => entries[index].id,
    overscan: OVERSCAN,
    paddingStart: LIST_PADDING,
    paddingEnd: LIST_PADDING,
    // Don't force a synchronous React render on every scroll event (the
    // default): with lines arriving mid-fetch, that kept interrupting and
    // redoing the background render of new lines, and scrolling stuttered.
    // The overscan rows cover the frame until the render lands.
    useFlushSync: false,
  });
  const totalSize = virtualizer.getTotalSize();
  const items = virtualizer.getVirtualItems();

  // Stick to the bottom while following (also once wrapped rows are measured).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && follow && atBottom) el.scrollTop = el.scrollHeight;
  }, [entries.length, totalSize, follow, atBottom]);

  // The Fetch page is hidden (display: none) on other tabs, which resets
  // scroll positions. Coming back, put the reader where they were.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && !(follow && atBottom)) el.scrollTop = lastScrollTop.current;
    // Only on show: the effect above handles following.
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el || !el.clientHeight) return; // hidden
    lastScrollTop.current = el.scrollTop;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  };

  const jumpToEnd = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
  };

  return (
    <div className={styles.jumpWrap}>
      <ScrollArea
        className={styles.scrollArea}
        variant="flush"
        viewportClassName={styles.scroller}
        viewportRef={scroller}
        onScroll={onScroll}
        data-allow-context-menu
      >
        {entries.length ? (
          // The rendered rows sit in normal flow between two spacers that
          // stand in for the rows above and below. Rows are never placed at
          // an estimated offset, so a new line can't be drawn overlapping
          // its neighbours for a frame before it's measured (the flicker in
          // beta 5); estimates only ever size the off-screen spacers.
          <div style={{ paddingTop: items[0]?.start ?? 0, paddingBottom: totalSize - (items.at(-1)?.end ?? 0) }}>
            {items.map((item) => (
              <Row
                key={item.key}
                entry={entries[item.index]}
                index={item.index}
                styles={styles}
                measure={virtualizer.measureElement}
              />
            ))}
          </div>
        ) : (
          <div className={styles.empty}>{empty}</div>
        )}
      </ScrollArea>
      {!atBottom && entries.length > 0 && (
        <Button className={styles.jump} appearance="primary" shape="circular" size="small" icon={<ArrowDownRegular />} onClick={jumpToEnd}>
          Latest
        </Button>
      )}
    </div>
  );
});
