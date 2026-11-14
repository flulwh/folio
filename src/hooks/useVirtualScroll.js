import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sortedIndexFrom, sortedLastIndex } from '../utils/sortedIndex.js';

/**
 * A dependency-free variable-height virtual scroller.
 *
 * Items are rendered absolutely inside a spacer whose height equals the sum of
 * all item heights. Unmeasured items use `estimate`; measured heights are kept
 * in a map and turned into a prefix-offset table (Float64Array) whenever a
 * measurement changes or the item count changes.
 *
 * Item nodes must carry `data-index={index}` so a single shared ref callback
 * can measure them.
 */
/**
 * Index of the row that occupies `top`. `scrollTop` is fractional (display
 * scaling) and lands a hair below an exact boundary, which would otherwise
 * report the previous row — the off-by-one that made chapter jumps highlight
 * the chapter above the target.
 */
const TOLERANCE = 1;

export function indexAtOffset(offsets, count, top) {
  if (count <= 0) return 0;
  // Vendored lodash upper-bound probe over [0, count): last offset <= probe.
  // The trailing sentinel slot (offsets[count]) is deliberately excluded.
  const upper = sortedLastIndex(offsets, top + TOLERANCE, count);
  return upper > 0 ? upper - 1 : 0;
}

/** Pure range calculation, kept separate so it can be verified exhaustively. */
export function computeVisibleRange(offsets, count, top, viewport, overscan) {
  const first = indexAtOffset(offsets, count, top);
  // TanStack/virtual (MIT) calculateRangeImpl: binary search instead of a
  // forward walk over every visible row. The first offset >= bottom equals
  // the old linear loop's result, capped at count.
  const last = sortedIndexFrom(offsets, top + viewport, first, count);
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(count, last + overscan),
  };
}

export function useVirtualScroll({ count, estimate = 96, overscan = 6, onResize = null }) {
  const scrollRef = useRef(null);
  const sizesRef = useRef(new Map());
  // 整本书的实测高度（来自离屏测量）单独存一份 Float64Array：
  // 几十万段全塞进 Map 要几十 MB 内存，每次重建偏移表还要几十万次 Map.get。
  // Map 只留给「滚动中现场量到」的那十几段，rebuild 时 Map 优先。
  const baseRef = useRef(null);
  const offsetsRef = useRef(new Float64Array(1));
  const totalRef = useRef(0);
  const rebuildRaf = useRef(0);
  const scrollRaf = useRef(0);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [layoutVersion, setLayoutVersion] = useState(0);
  const prevCount = useRef(count);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  const rebuild = useCallback(() => {
    const n = count;
    const offsets = new Float64Array(n + 1);
    const base = baseRef.current && baseRef.current.length === n ? baseRef.current : null;
    let acc = 0;
    for (let i = 0; i < n; i += 1) {
      offsets[i] = acc;
      let h = sizesRef.current.get(i);
      if (h === undefined) h = base ? base[i] : undefined;
      acc += h === undefined ? estimate : h;
    }
    offsets[n] = acc;
    offsetsRef.current = offsets;
    totalRef.current = acc;
    return acc;
  }, [count, estimate]);

  const computeVisible = useCallback(() => {
    const el = scrollRef.current;
    if (!el || count === 0) return;
    const next = computeVisibleRange(
      offsetsRef.current,
      count,
      el.scrollTop,
      el.clientHeight,
      overscan
    );
    setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [count, overscan]);

  const measureAll = useCallback(() => {
    const inner = scrollRef.current?.querySelector('[data-virtual-inner]');
    if (!inner) return false;
    let changed = false;
    inner.querySelectorAll('[data-index]').forEach((node) => {
      const index = Number(node.dataset.index);
      const height = node.offsetHeight;
      const previous = sizesRef.current.get(index);
      if (previous === undefined || Math.abs(previous - height) > 0.5) {
        sizesRef.current.set(index, height);
        changed = true;
      }
    });
    return changed;
  }, []);

  const scheduleRebuild = useCallback(
    (remeasure = false) => {
      if (rebuildRaf.current) cancelAnimationFrame(rebuildRaf.current);
      rebuildRaf.current = requestAnimationFrame(() => {
        rebuildRaf.current = 0;
        if (remeasure) measureAll();
        rebuild();
        computeVisible();
        setLayoutVersion((v) => v + 1);
      });
    },
    [rebuild, computeVisible, measureAll]
  );

  const itemRef = useCallback(
    (node) => {
      if (!node) return;
      const index = Number(node.dataset.index);
      if (!Number.isFinite(index) || index < 0) return;
      const height = node.offsetHeight;
      const previous = sizesRef.current.get(index);
      if (previous === undefined || Math.abs(previous - height) > 0.5) {
        sizesRef.current.set(index, height);
        if (!rebuildRaf.current) scheduleRebuild();
      }
    },
    [scheduleRebuild]
  );

  // Item count changes only need a rebuild. Height changes of the container come
  // from our own spacer, so they are not layout changes; only a *width* change
  // rewraps text and invalidates the measured heights.
  useLayoutEffect(() => {
    if (prevCount.current !== count) {
      if (count < prevCount.current * 0.5 || count === 0) {
        sizesRef.current.clear();
        baseRef.current = null;
      }
      prevCount.current = count;
    }
    rebuild();
    computeVisible();
    setLayoutVersion((v) => v + 1);
  }, [count, rebuild, computeVisible]);

  // Scroll & resize listeners
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;

    const onScroll = () => {
      if (scrollRaf.current) return;
      scrollRaf.current = requestAnimationFrame(() => {
        scrollRaf.current = 0;
        computeVisible();
      });
    };

    let resizeTimer = null;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      const widthChanged = Math.abs(el.clientWidth - lastWidth) > 0.5;
      lastWidth = el.clientWidth;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (widthChanged) {
          // Text was rewrapped: ask the owner for a full re-measure. Dropping
          // the table here would leave the spacer on estimates and make the
          // document visibly jump.
          if (onResizeRef.current) {
            onResizeRef.current();
            return;
          }
          sizesRef.current.clear();
          measureAll();
        }
        rebuild();
        computeVisible();
        setLayoutVersion((v) => v + 1);
      }, 120);
    });

    el.addEventListener('scroll', onScroll, { passive: true });
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, [computeVisible, measureAll, rebuild]);

  const scrollToOffset = useCallback((offset) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = Math.max(0, offset);
  }, []);

  /**
   * Scroll so that `index` is at the top of the viewport. Because heights above
   * the target may still be estimates, we correct over a few frames as items
   * mount and report their real heights.
   */
  const scrollToIndex = useCallback(
    (index, { align = 'start', behavior = 'auto', settleFrames = 3 } = {}) => {
      const el = scrollRef.current;
      if (!el || count === 0) return;
      const target = Math.max(0, Math.min(index, count - 1));

      const apply = () => {
        const offsets = offsetsRef.current;
        const itemTop = offsets[target] ?? 0;
        const base = baseRef.current;
        const itemHeight =
          sizesRef.current.get(target) ??
          (base && base.length === count ? base[target] : undefined) ??
          estimate;
        let top = itemTop;
        if (align === 'center') top -= (el.clientHeight - itemHeight) / 2;
        else if (align === 'end') top -= el.clientHeight - itemHeight;
        el.scrollTo({ top: Math.max(0, top), behavior });
      };

      apply();

      let frames = 0;
      const settle = () => {
        frames += 1;
        const changed = measureAll();
        if (changed) {
          rebuild();
          apply();
        }
        if (frames < settleFrames) requestAnimationFrame(settle);
        else {
          computeVisible();
          setLayoutVersion((v) => v + 1);
        }
      };
      requestAnimationFrame(settle);
    },
    [count, estimate, measureAll, rebuild, computeVisible]
  );

  const getScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return { index: 0, percent: 0 };
    const offsets = offsetsRef.current;
    const top = el.scrollTop;
    const first = indexAtOffset(offsets, count, top);
    const max = Math.max(1, totalRef.current - el.clientHeight);
    return { index: first, percent: Math.min(100, Math.max(0, (top / max) * 100)) };
  }, [count]);

  /**
   * Seed every row with an exact height measured elsewhere (for example from an
   * offscreen measurement pass). Keeping the whole table exact means the spacer
   * height never changes while the reader scrolls, so nothing jumps.
   */
  const measureItems = useCallback(
    (heights) => {
      if (!heights || heights.length !== count) return false;
      let changed = false;
      const previous = baseRef.current;
      for (let i = 0; i < count; i += 1) {
        const before = sizesRef.current.get(i) ?? (previous && previous.length === count ? previous[i] : undefined);
        if (before === undefined || Math.abs(before - heights[i]) > 0.5) changed = true;
      }
      // 实测表整份替换，Map 里的现场测量值作废（它们本来就该等于 base 里的值）
      sizesRef.current.clear();
      baseRef.current = new Float64Array(heights);
      rebuild();
      computeVisible();
      setLayoutVersion((v) => v + 1);
      return changed;
    },
    [count, rebuild, computeVisible]
  );

  const resetMeasurements = useCallback(() => {
    sizesRef.current.clear();
    baseRef.current = null;
    scheduleRebuild(true);
  }, [scheduleRebuild]);

  const getOffset = useCallback(
    (index) => {
      if (index < 0) return 0;
      const offsets = offsetsRef.current;
      return offsets[Math.min(index, offsets.length - 1)] ?? 0;
    },
    // layoutVersion keeps offsets fresh for render-time reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutVersion]
  );

  const getTotal = useCallback(
    () => totalRef.current,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutVersion]
  );

  return {
    scrollRef,
    range,
    total: totalRef.current,
    layoutVersion,
    itemRef,
    getOffset,
    getTotal,
    scrollToIndex,
    scrollToOffset,
    getScrollState,
    measureAll,
    measureItems,
    resetMeasurements,
  };
}
