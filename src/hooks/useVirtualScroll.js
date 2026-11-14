import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
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

/**
 * Chromium 单个滚动容器的可滚动高度大约只有 2^25 物理像素，CSS px 还要除以 DPR：
 * 125% 缩放下只有 2680 万 px，200% 缩放下只剩 1670 万。
 *
 * 之前整本书塞进一个 spacer，四十多万段、二十多万行正文的长篇（约 2000 万 px）
 * 在换大字号或窄栏宽后就会触顶：超出上限的段落全部挤在同一个 y 上，滚动到底直接错位。
 *
 * 现在滚动容器只在书里开一个 800 万 px 的「窗口」：读近窗口边缘时把 origin 整体
 * 平移（scrollTop 同步反向补偿），逻辑偏移与段落位置都不变，视觉上完全无感。
 */
const MAX_SPAN = 8000000;
// 距离窗口边缘多远开始换窗。换窗后会以当前阅读位置为中心重新开窗，
// 所以两次换窗之间至少能滚 300 万 px，长篇一辈子也遇不到几次。
const WINDOW_EDGE = 1000000;

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
  // 当前滚动窗口的起点（逻辑偏移）。items 的位置 = 逻辑偏移 - origin。
  const originRef = useRef(0);
  const rebuildRaf = useRef(0);
  const scrollRaf = useRef(0);
  const animRaf = useRef(0);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [layoutVersion, setLayoutVersion] = useState(0);
  const prevCount = useRef(count);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  /** 窗口能有多高：书剩下的高度，最多 MAX_SPAN。 */
  const spanAt = (origin) => Math.min(MAX_SPAN, Math.max(0, totalRef.current - origin));

  const clampOrigin = useCallback((value) => {
    const total = totalRef.current;
    return Math.max(0, Math.min(value, Math.max(0, total - MAX_SPAN)));
  }, []);

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
    // 总高变小（重测、换排版）时窗口可能已经越过新的上限：把 origin 收回来，
    // 同时反向补偿 scrollTop，保持逻辑位置不动。
    const limited = Math.max(0, acc - MAX_SPAN);
    if (originRef.current > limited) {
      const delta = originRef.current - limited;
      originRef.current = limited;
      const el = scrollRef.current;
      if (el) el.scrollTop = Math.max(0, el.scrollTop + delta);
    }
    return acc;
  }, [count, estimate]);

  const computeVisible = useCallback(() => {
    const el = scrollRef.current;
    if (!el || count === 0) return;
    const logicalTop = originRef.current + el.scrollTop;
    const next = computeVisibleRange(
      offsetsRef.current,
      count,
      logicalTop,
      el.clientHeight,
      overscan
    );
    setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [count, overscan]);

  /** 换窗必须和 scrollTop 改动落在同一帧：同步提交一次渲染，避免闪一下。 */
  const commitOrigin = useCallback((next) => {
    originRef.current = next;
    flushSync(() => setLayoutVersion((v) => v + 1));
  }, []);

  /** 接近窗口边缘时整体换窗，保持当前逻辑位置对应的画面不动。 */
  const rebaseIfNeeded = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return false;
    const total = totalRef.current;
    if (total <= MAX_SPAN) return false;
    const origin = originRef.current;
    const span = spanAt(origin);
    const scrollTop = el.scrollTop;
    const nearTop = origin > 0 && scrollTop < WINDOW_EDGE;
    const nearBottom = origin + span < total && scrollTop + el.clientHeight > span - WINDOW_EDGE;
    if (!nearTop && !nearBottom) return false;
    const logicalTop = origin + scrollTop;
    const next = clampOrigin(logicalTop - MAX_SPAN / 2);
    if (next === origin) return false;
    commitOrigin(next);
    el.scrollTop = Math.max(0, logicalTop - next);
    // 换窗 + 换可视范围必须在同一帧落地，否则会闪一帧空白
    flushSync(() => computeVisible());
    return true;
  }, [clampOrigin, commitOrigin, computeVisible]);

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
        originRef.current = 0;
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
        rebaseIfNeeded();
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
  }, [computeVisible, measureAll, rebaseIfNeeded, rebuild]);

  const stopAnimation = useCallback(() => {
    if (animRaf.current) cancelAnimationFrame(animRaf.current);
    animRaf.current = 0;
  }, []);

  useEffect(() => stopAnimation, [stopAnimation]);

  /** 滚到某个逻辑偏移（不做动画）。跨越窗口时会先换窗再落位。 */
  const scrollTo = useCallback(
    (value, { behavior = 'auto' } = {}) => {
      const el = scrollRef.current;
      if (!el) return;
      const total = totalRef.current;
      const max = Math.max(0, total - el.clientHeight);
      const target = Math.max(0, Math.min(value, max));
      let origin = originRef.current;
      const span = spanAt(origin);
      const safeTop = origin + WINDOW_EDGE;
      const safeBottom = origin + span - el.clientHeight - WINDOW_EDGE;
      let rebased = false;
      if (target < safeTop || target > safeBottom) {
        const next = clampOrigin(target - MAX_SPAN / 2);
        if (next !== origin) {
          commitOrigin(next);
          origin = next;
          rebased = true;
        }
      }
      el.scrollTo({ top: Math.max(0, target - origin), behavior });
      if (rebased) flushSync(() => computeVisible());
      else computeVisible();
    },
    [clampOrigin, commitOrigin, computeVisible]
  );

  /** 滚到某个逻辑偏移，同窗口内走缓动；跨窗口先换窗再缓动（位置仍然连续）。 */
  const animateTo = useCallback(
    (value, duration) => {
      const el = scrollRef.current;
      if (!el) return;
      const total = totalRef.current;
      const max = Math.max(0, total - el.clientHeight);
      const target = Math.max(0, Math.min(value, max));
      const fromLogical = originRef.current + el.scrollTop;
      let origin = originRef.current;
      const span = spanAt(origin);
      const safeTop = origin + WINDOW_EDGE * 0.2;
      const safeBottom = origin + span - el.clientHeight - WINDOW_EDGE * 0.2;
      let rebased = false;
      if (total > MAX_SPAN && (target < safeTop || target > safeBottom)) {
        const next = clampOrigin(target - MAX_SPAN / 2);
        if (next !== origin) {
          commitOrigin(next);
          origin = next;
          rebased = true;
        }
      }
      const physicalMax = Math.max(0, spanAt(origin) - el.clientHeight);
      const from = Math.max(0, Math.min(fromLogical - origin, physicalMax));
      const to = Math.max(0, Math.min(target - origin, physicalMax));
      stopAnimation();
      if (from !== el.scrollTop) el.scrollTop = from;
      if (rebased) flushSync(() => computeVisible());
      if (Math.abs(to - from) < 2) {
        el.scrollTop = to;
        return;
      }
      const distance = to - from;
      const ms = typeof duration === 'number' ? duration : Math.max(240, Math.min(640, Math.abs(distance) * 0.42));
      const started = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - started) / ms);
        const eased = 1 - (1 - t) ** 3;
        el.scrollTop = from + distance * eased;
        if (t < 1) {
          animRaf.current = requestAnimationFrame(step);
        } else {
          animRaf.current = 0;
          el.scrollTop = to;
        }
      };
      animRaf.current = requestAnimationFrame(step);
    },
    [clampOrigin, commitOrigin, computeVisible, stopAnimation]
  );

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
        scrollTo(Math.max(0, top), { behavior });
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
    [count, estimate, measureAll, rebuild, computeVisible, scrollTo]
  );

  const getScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return { index: 0, percent: 0, top: 0 };
    const offsets = offsetsRef.current;
    const top = originRef.current + el.scrollTop;
    const first = indexAtOffset(offsets, count, top);
    const max = Math.max(1, totalRef.current - el.clientHeight);
    return {
      index: first,
      percent: Math.min(100, Math.max(0, (top / max) * 100)),
      top,
    };
  }, [count]);

  const getLogicalTop = useCallback(() => {
    const el = scrollRef.current;
    return originRef.current + (el ? el.scrollTop : 0);
  }, []);

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

  /** 段落相对当前滚动窗口的位置（items 的 translateY）。 */
  const getItemOffset = useCallback(
    (index) => getOffset(index) - originRef.current,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getOffset, layoutVersion]
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
    span: spanAt(originRef.current),
    layoutVersion,
    itemRef,
    getOffset,
    getItemOffset,
    getTotal,
    getLogicalTop,
    scrollTo,
    animateTo,
    stopAnimation,
    scrollToIndex,
    scrollToOffset: scrollTo,
    getScrollState,
    measureAll,
    measureItems,
    resetMeasurements,
  };
}
