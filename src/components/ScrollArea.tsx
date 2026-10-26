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
// content instead. At rest it's a thin line that stays visible whenever the
// content overflows. Under the cursor it grows into a track with arrows and a
// wider thumb (like Settings), and shrinks back shortly after the cursor leaves.
// Scrolling itself is still the browser's (wheel, keyboard, touch, virtualizer).

/** Space kept at each end of the track for the arrow buttons. */
const ARROW = 14;
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
    scrollbarWidth: 'none',
    '::-webkit-scrollbar': { display: 'none' },
  },
  rail: {
    position: 'absolute',
    top: '1px',
    right: '1px',
    bottom: '1px',
    width: '14px',
    zIndex: 1,
    userSelect: 'none',
    touchAction: 'none',
  },
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
  trackOn: { opacity: 0.96 },
  thumb: {
    position: 'absolute',
    top: 0,
    right: '4px',
    width: '2px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorNeutralForeground4,
    transitionProperty: 'width, right, background-color',
    transitionDuration: tokens.durationFast,
    transitionTimingFunction: tokens.curveEasyEase,
    willChange: 'transform',
    '@media (prefers-reduced-motion: reduce)': { transitionDuration: '0.01ms' },
  },
  thumbOn: {
    right: '4px',
    width: '6px',
    ':hover': { backgroundColor: tokens.colorNeutralForeground3 },
  },
  thumbDragging: { backgroundColor: tokens.colorNeutralForeground2, ':hover': { backgroundColor: tokens.colorNeutralForeground2 } },
  arrow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: `${ARROW}px`,
    display: 'grid',
    placeItems: 'center',
    color: tokens.colorNeutralForeground3,
    opacity: 0,
    transitionProperty: 'opacity',
    transitionDuration: tokens.durationFast,
    '@media (prefers-reduced-motion: reduce)': { transitionDuration: '0.01ms' },
    ':hover': { color: tokens.colorNeutralForeground1 },
    ':active': { color: tokens.colorNeutralForeground2 },
  },
  arrowOn: { opacity: 1 },
  up: { top: 0 },
  down: { bottom: 0 },
});

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  /** Classes for the scrolling element (padding, display, gap…). */
  viewportClassName?: string;
  /** The scrolling element itself, e.g. for a virtualizer. */
  viewportRef?: Ref<HTMLDivElement>;
  /** Classes for the outer box (its size and place in the layout). */
  className?: string;
}

/**
 * A vertical scroll region with a Windows 11 style scrollbar. `className`
 * places and sizes the outer box; everything else (children, handlers, data-
 * and aria- attributes) goes to the scrolling element.
 */
export function ScrollArea({ className, viewportClassName, viewportRef, children, ...viewportProps }: ScrollAreaProps) {
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
    // there's something to scroll. It spans the viewport less 1px each end.
    const track = clientHeight - 2 - ARROW * 2;
    const range = scrollHeight - clientHeight;
    if (range <= 1 || track <= 0 || clientHeight === 0) return null;
    const length = Math.max(MIN_THUMB, Math.min(track, (clientHeight / scrollHeight) * track));
    const travel = track - length;
    return { length, travel, range, offset: ARROW + (travel * scrollTop) / range };
  }, []);

  // Written straight to the DOM on every scroll: no React render per frame.
  const update = useCallback(() => {
    const g = geometry();
    setOverflowing(g !== null);
    const t = thumb.current;
    if (!g || !t) return;
    t.style.height = `${g.length}px`;
    t.style.transform = `translateY(${g.offset}px)`;
  }, [geometry]);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    // Re-measure when the region or anything directly in it changes size
    // (log lines arriving, a section expanding, the window resizing).
    const sizes = new ResizeObserver(update);
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
      update();
    });
    changes.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener('scroll', update);
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
      <div ref={setViewport} className={mergeClasses(styles.viewport, viewportClassName)} {...viewportProps}>
        {children}
      </div>
      <div
        ref={rail}
        className={mergeClasses(styles.rail, !overflowing && styles.hidden)}
        aria-hidden
        data-scrollbar
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        onPointerDown={onTrackDown}
        onPointerUp={stopRepeat}
        onPointerCancel={stopRepeat}
      >
        <div className={mergeClasses(styles.track, expanded && styles.trackOn)} style={{ pointerEvents: 'none' }} />
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
          className={mergeClasses(styles.thumb, expanded && styles.thumbOn, dragging && styles.thumbDragging)}
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
  );
}

/** The small filled triangle Windows draws on scrollbar buttons. */
function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" style={{ transform: up ? undefined : 'rotate(180deg)', pointerEvents: 'none' }}>
      <path d="M4 1.6 7.2 6.2H0.8Z" fill="currentColor" strokeLinejoin="round" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  );
}
