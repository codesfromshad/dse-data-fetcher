import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from 'react';
import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';

// A Windows 11 scrollbar. The native one is hidden; this rail is drawn over the
// content instead, pinned to the visible area from inside the scrolling element
// (position: sticky), so the wheel over it scrolls natively like anywhere else. At rest it's a thin line that stays visible whenever the
// content overflows. Under the cursor it grows into a track with arrows and a
// wider thumb (like Settings), and shrinks back shortly after the cursor leaves.
// Scrolling itself is still the browser's (wheel, keyboard, touch, virtualizer).

/**
 * Space kept at each end of the track for the arrows. Kept in both states,
 * like Windows: the thumb's range never changes, so it doesn't jump when the
 * bar grows or shrinks.
 */
const ARROW = 12;
/** Gap between each arrow and the furthest the thumb goes. */
const ARROW_GAP = 2;
/** Track kept clear at each end: an arrow and its gap. */
const END = ARROW + ARROW_GAP;
/** Shortest the thumb gets on very long content. */
const MIN_THUMB = 24;
/** One arrow click, about three lines. */
const LINE = 48;
/** How long a held arrow / track waits before repeating, then how often. */
const REPEAT_DELAY = 350;
const REPEAT_EVERY = 50;
/** Windows keeps the expanded bar around briefly after the cursor leaves. */
const COLLAPSE_DELAY = 600;

const useStyles = makeStyles({
  root: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    minWidth: 0,
  },
  viewport: {
    flex: '1 1 auto',
    minHeight: 0,
    overflowY: 'auto',
    // Virtual lists correct the scroll position themselves; the browser's own
    // anchoring would correct twice.
    overflowAnchor: 'none',
    scrollbarWidth: 'none',
    '::-webkit-scrollbar': { display: 'none' },
  },
  // What `viewportClassName` styles: the content, at least as tall as the view.
  content: { display: 'flow-root', minHeight: '100%', boxSizing: 'border-box' },
  // Zero-height and stuck to the top of the visible area, so the rail inside
  // stays put while the content scrolls. Being inside the scrolling element is
  // what makes the wheel over the rail scroll it.
  pin: { position: 'sticky', top: 0, height: 0, zIndex: 1 },
  // Top flush with the region, so the track lines up with the first card.
  // Its height is set from the viewport's (see `update`).
  rail: {
    position: 'absolute',
    top: 0,
    right: '1px',
    width: '14px',
    zIndex: 1,
    userSelect: 'none',
    touchAction: 'none',
  },
  // Inside a panel (the activity log): the track fills the panel's full height,
  // square-ended against its header and edge, instead of a floating pill.
  railFlush: { right: 0 },
  hidden: { display: 'none' },
  // Fades in behind the thumb when expanded.
  track: {
    position: 'absolute',
    inset: 0,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    opacity: 0,
    transitionProperty: 'opacity',
    transitionDuration: tokens.durationFast,
    transitionTimingFunction: tokens.curveEasyEase,
    '@media (prefers-reduced-motion: reduce)': { transitionDuration: '0.01ms' },
  },
  trackFlush: {
    borderRadius: 0,
    border: 'none',
    borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  trackOn: { opacity: 0.96 },
  thumb: {
    position: 'absolute',
    top: 0,
    right: '4px',
    width: '2px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralForeground4,
    transitionProperty: 'width, right',
    transitionDuration: tokens.durationFast,
    transitionTimingFunction: tokens.curveEasyEase,
    willChange: 'transform',
    '@media (prefers-reduced-motion: reduce)': { transitionDuration: '0.01ms' },
  },
  // Same colour at rest, under the pointer and while dragged, like Windows.
  thumbOn: { right: '4px', width: '6px' },
  arrow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: `${ARROW}px`,
    display: 'grid',
    placeItems: 'center',
    // Like Windows: grey at rest, brighter under the pointer, and while
    // pressed it stays bright and the glyph shrinks a little.
    color: tokens.colorNeutralForeground4,
    opacity: 0,
    transitionProperty: 'opacity, color',
    transitionDuration: `${tokens.durationFast}, ${tokens.durationFaster}`,
    transitionTimingFunction: tokens.curveEasyEase,
    '@media (prefers-reduced-motion: reduce)': { transitionDuration: '0.01ms' },
    '& svg': {
      transitionProperty: 'transform',
      transitionDuration: tokens.durationFaster,
      transitionTimingFunction: tokens.curveEasyEase,
      '@media (prefers-reduced-motion: reduce)': { transitionDuration: '0.01ms' },
    },
    ':hover': { color: tokens.colorNeutralForeground2 },
    ':active': { color: tokens.colorNeutralForeground2 },
    ':active svg': { transform: 'scale(0.85)' },
  },
  arrowOn: { opacity: 1 },
  up: { top: 0 },
  down: { bottom: 0 },
});

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  /** Classes for the content inside the scrolling element (padding, display, gap…). */
  viewportClassName?: string;
  /** The scrolling element itself, e.g. for a virtualizer. */
  viewportRef?: Ref<HTMLDivElement>;
  /** Classes for the outer box (its size and place in the layout). */
  className?: string;
  /**
   * `floating` (default): a rounded track inset from the edges, for page-level
   * scrolling. `flush`: the track runs the full height, square-ended, for a
   * region inside a panel.
   */
  variant?: 'floating' | 'flush';
}

/**
 * A vertical scroll region with a Windows 11 style scrollbar. `className`
 * places and sizes the outer box; `viewportClassName` styles the content
 * (padding, display, gap…); handlers, data- and aria- attributes go to the
 * scrolling element.
 */
export function ScrollArea({
  className,
  viewportClassName,
  viewportRef,
  variant = 'floating',
  children,
  ...viewportProps
}: ScrollAreaProps) {
  const styles = useStyles();
  const viewport = useRef<HTMLDivElement | null>(null);
  const rail = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const repeat = useRef<{ delay?: ReturnType<typeof setTimeout>; every?: ReturnType<typeof setInterval> }>({});
  const expanded = hovered || dragging;
  const flush = variant === 'flush';

  const setViewport = useCallback(
    (el: HTMLDivElement | null) => {
      viewport.current = el;
      if (typeof viewportRef === 'function') viewportRef(el);
      else if (viewportRef) (viewportRef as { current: HTMLDivElement | null }).current = el;
    },
    [viewportRef],
  );

  /** Thumb length and travel for the current sizes. */
  const geometry = useCallback(() => {
    const el = viewport.current;
    if (!el) return null;
    const { scrollHeight, clientHeight, scrollTop } = el;
    // From the viewport, not the rail: the rail is display: none (0px) until
    // there's something to scroll. A floating rail is inset 1px at the bottom.
    const track = clientHeight - (flush ? 0 : 1) - END * 2;
    const range = scrollHeight - clientHeight;
    if (range <= 1 || track <= 0 || clientHeight === 0) return null;
    const length = Math.max(MIN_THUMB, Math.min(track, (clientHeight / scrollHeight) * track));
    const travel = track - length;
    return { length, travel, range, offset: END + (travel * scrollTop) / range };
  }, [flush]);

  // Written straight to the DOM on every scroll: no React render per frame.
  const update = useCallback(() => {
    const g = geometry();
    setOverflowing(g !== null);
    const t = thumb.current;
    const r = rail.current;
    if (r && viewport.current) r.style.height = `${viewport.current.clientHeight - (flush ? 0 : 1)}px`;
    if (!g || !t) return;
    t.style.height = `${g.length}px`;
    t.style.transform = `translateY(${g.offset}px)`;
  }, [geometry, flush]);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    // Size and content changes come in bursts (a batch of log lines is many
    // DOM changes): measure once per frame, not once per change.
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), update()));
    };
    // Re-measure when the region or anything directly in it changes size
    // (log lines arriving, a section expanding, the window resizing).
    const sizes = new ResizeObserver(schedule);
    const observeAll = () => {
      sizes.disconnect();
      sizes.observe(el);
      for (const child of Array.from(el.children)) sizes.observe(child);
    };
    observeAll();
    // Content can also outgrow a child whose own box stays put (a stretched
    // flex item), so any change inside re-measures too.
    const changes = new MutationObserver((records) => {
      if (records.some((r) => r.target === el)) observeAll();
      schedule();
    });
    changes.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener('scroll', update);
      cancelAnimationFrame(frame);
      sizes.disconnect();
      changes.disconnect();
    };
  }, [update]);

  // The thumb has just been shown: give it its size before it's painted.
  useLayoutEffect(update, [overflowing, update]);

  const stopRepeat = useCallback(() => {
    clearTimeout(repeat.current.delay);
    clearInterval(repeat.current.every);
    repeat.current = {};
  }, []);

  useEffect(
    () => () => {
      stopRepeat();
      clearTimeout(collapseTimer.current);
    },
    [stopRepeat],
  );

  /** Run `step` now and, while the button stays down, again and again. */
  const pressAndHold = (e: ReactPointerEvent, step: () => boolean | void) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stopRepeat();
    if (step() === false) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    repeat.current.delay = setTimeout(() => {
      repeat.current.every = setInterval(() => {
        if (step() === false) stopRepeat();
      }, REPEAT_EVERY);
    }, REPEAT_DELAY);
  };

  const scrollByLine = (direction: 1 | -1) => (e: ReactPointerEvent) =>
    pressAndHold(e, () => viewport.current?.scrollBy({ top: direction * LINE, behavior: 'instant' }));

  // A press on the track pages toward the pointer until the thumb reaches it.
  const onTrackDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const r = rail.current!.getBoundingClientRect();
    const y = e.clientY - r.top;
    pressAndHold(e, () => {
      const el = viewport.current;
      const g = geometry();
      if (!el || !g) return false;
      if (y >= g.offset && y <= g.offset + g.length) return false;
      const direction = y < g.offset ? -1 : 1;
      el.scrollBy({ top: direction * el.clientHeight * 0.875, behavior: 'instant' });
    });
  };

  const onThumbDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = viewport.current;
    const g = geometry();
    if (!el || !g) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    setDragging(true);
    const startY = e.clientY;
    const startTop = el.scrollTop;
    const perPixel = g.travel > 0 ? g.range / g.travel : 0;
    const move = (ev: PointerEvent) => {
      el.scrollTop = startTop + (ev.clientY - startY) * perPixel;
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      setDragging(false);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };

  const onEnter = () => {
    clearTimeout(collapseTimer.current);
    setHovered(true);
  };
  const onLeave = () => {
    clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => setHovered(false), COLLAPSE_DELAY);
  };

  return (
    <div className={mergeClasses(styles.root, className)}>
      <div ref={setViewport} className={styles.viewport} {...viewportProps}>
        <div className={styles.pin}>
          <div
            ref={rail}
            className={mergeClasses(styles.rail, flush && styles.railFlush, !overflowing && styles.hidden)}
            aria-hidden
            data-scrollbar
            onPointerEnter={onEnter}
            onPointerLeave={onLeave}
            onPointerDown={onTrackDown}
            onPointerUp={stopRepeat}
            onPointerCancel={stopRepeat}
          >
            <div className={mergeClasses(styles.track, flush && styles.trackFlush, expanded && styles.trackOn)} style={{ pointerEvents: 'none' }} />
            <div
              className={mergeClasses(styles.arrow, styles.up, expanded && styles.arrowOn)}
              onPointerDown={scrollByLine(-1)}
              onPointerUp={stopRepeat}
              onPointerCancel={stopRepeat}
            >
              <Chevron up />
            </div>
            <div
              ref={thumb}
              className={mergeClasses(styles.thumb, expanded && styles.thumbOn)}
              onPointerDown={onThumbDown}
            />
            <div
              className={mergeClasses(styles.arrow, styles.down, expanded && styles.arrowOn)}
              onPointerDown={scrollByLine(1)}
              onPointerUp={stopRepeat}
              onPointerCancel={stopRepeat}
            >
              <Chevron />
            </div>
          </div>
        </div>
        <div className={mergeClasses(styles.content, viewportClassName)}>{children}</div>
      </div>
    </div>
  );
}

/** The small filled triangle Windows draws on scrollbar buttons. */
function Chevron({ up = false }: { up?: boolean }) {
  return (
    // About 9px wide, a little wider than the 6px thumb (as in Windows).
    <svg width="10" height="10" viewBox="0 0 10 10" style={{ pointerEvents: 'none' }}>
      {/* Drawn pointing each way (not rotated), so the press can scale it. */}
      <path d={up ? 'M5 2.2 9.2 8H0.8Z' : 'M5 7.8 9.2 2H0.8Z'} fill="currentColor" strokeLinejoin="round" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  );
}
