import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * Thin adapter over TanStack Virtual for the reader.
 *
 * 可见区间、行偏移与「已测量高度 → 前缀位置」都交给 `useVirtualizer`；
 * 这里只保留阅读器自己的两件事：
 *
 * 1. 高度表由离屏测量（useReaderMeasure）整份写入，`estimateSize` 直接读它，
 *    所以未渲染的行也有精确高度。
 * 2. Chromium 单个滚动容器的可滚动高度大约只有 2^25 物理像素，CSS px 还要除以
 *    DPR：125% 缩放下只有 2680 万 px，200% 缩放下只剩 1670 万。整本书塞进一个
 *    spacer，长篇（约 2000 万 px）在换大字号或窄栏宽后就会触顶。
 *
 *    所以滚动容器只在书里开一个 800 万 px 的「窗口」：给 virtualizer 换一个
 *    offset 观察器，把「物理 scrollTop + origin」当作逻辑偏移上报，它算出来的
 *    可见区间/行偏移天生就是整本书的坐标；渲染时再把行偏移减去 origin 落到
 *    物理位置。读近窗口边缘时只把 origin 平移（scrollTop 同步反向补偿），
 *    逻辑偏移与段落位置都不变，视觉上完全无感。
 */
const MAX_SPAN = 8000000;
// 距离窗口边缘多远开始换窗。换窗后会以当前阅读位置为中心重新开窗，
// 所以两次换窗之间至少能滚 300 万 px，长篇一辈子也遇不到几次。
const WINDOW_EDGE = 1000000;

export function useVirtualScroll({ count, estimate = 96, overscan = 6, onResize = null }) {
  const scrollRef = useRef(null);
  // 整本书的实测高度（来自离屏测量）；virtualizer 的前缀偏移表由它生成。
  const heightsRef = useRef(null);
  // 当前滚动窗口的起点（逻辑偏移）。items 的位置 = 逻辑偏移 - origin。
  const originRef = useRef(0);
  const [origin, setOrigin] = useState(0);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const prevCount = useRef(count);
  const prevEstimate = useRef(estimate);
  const scrollRaf = useRef(0);
  const animRaf = useRef(0);
  // scrollToIndex 的落位修正链：上次没跑完就要被新的一次、或卸载打断，
  // 否则它会继续按旧的段落号改 scrollTop，和新的跳转抢位置。
  const settleRaf = useRef(0);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const heights = heightsRef.current;
      const height = heights ? heights[index] : undefined;
      return height > 0 ? height : estimate;
    },
    overscan,
    // 滚动坐标 = 逻辑偏移：物理 scrollTop 只是「逻辑偏移 - 窗口起点」。
    // 行位置仍是逻辑偏移，由 getItemOffset 减去 origin 得到物理位置。
    observeElementOffset: (instance, cb) => {
      const el = instance.scrollElement;
      if (!el) return undefined;
      const win = instance.targetWindow || window;
      const read = () => originRef.current + el.scrollTop;
      let timer = 0;
      const onScroll = () => {
        cb(read(), true);
        if (timer) win.clearTimeout(timer);
        timer = win.setTimeout(() => {
          timer = 0;
          cb(read(), false);
        }, instance.options.isScrollingResetDelay ?? 150);
      };
      const onEnd = () => {
        if (timer) win.clearTimeout(timer);
        timer = 0;
        cb(read(), false);
      };
      el.addEventListener('scroll', onScroll, { passive: true });
      el.addEventListener('scrollend', onEnd, { passive: true });
      // 挂载时先报一次，恢复位置的首帧就能拿到正确的可见区间。
      cb(read(), false);
      return () => {
        el.removeEventListener('scroll', onScroll);
        el.removeEventListener('scrollend', onEnd);
        if (timer) win.clearTimeout(timer);
      };
    },
    // 高度表本来就是整本实测的，行高变化不需要 virtualizer 写 scrollTop；
    // 而它的写入用的是逻辑坐标，换窗后不能直接落到物理滚动容器上。
    shouldAdjustScrollPositionOnItemSizeChange: () => false,
  });

  /** 整本书的逻辑总高（不随窗口变化）。 */
  const getTotal = useCallback(() => {
    if (count === 0) return 0;
    // getTotalSize() 会按需重建测量表。
    return virtualizer.getTotalSize();
  }, [count, virtualizer]);

  /** 逻辑偏移 → 段落索引。 */
  const getOffset = useCallback(
    (index) => {
      if (index < 0 || count === 0) return 0;
      // 先让测量表跟上本帧的高度表，再读行起点。
      virtualizer.getTotalSize();
      const item = virtualizer.measurementsCache[Math.min(index, count - 1)];
      return item ? item.start : 0;
    },
    [count, virtualizer]
  );

  /** 段落相对当前滚动窗口的位置（items 的 translateY）。 */
  const getItemOffset = useCallback((index) => getOffset(index) - originRef.current, [getOffset]);

  /** 任意逻辑偏移 → 段落索引。恢复位置的后置断言要用最终高度表反解落点。 */
  const getIndexAtTop = useCallback(
    (top) => {
      if (count === 0) return 0;
      // +1 是旧实现的 1px 容差，避免边界像素落到上一段。
      const item = virtualizer.getVirtualItemForOffset(Math.max(0, top) + 1);
      return item ? item.index : 0;
    },
    [count, virtualizer]
  );

  const getLogicalTop = useCallback(() => {
    const el = scrollRef.current;
    return originRef.current + (el ? el.scrollTop : 0);
  }, []);

  const getScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return { index: 0, percent: 0, top: 0 };
    const top = originRef.current + el.scrollTop;
    const max = Math.max(1, getTotal() - el.clientHeight);
    return {
      index: getIndexAtTop(top),
      percent: Math.min(100, Math.max(0, (top / max) * 100)),
      top,
    };
  }, [getIndexAtTop, getTotal]);

  const measureAll = useCallback(() => {
    const inner = scrollRef.current?.querySelector('[data-virtual-inner]');
    if (!inner) return false;
    let changed = false;
    inner.querySelectorAll('[data-index]').forEach((node) => {
      const index = Number(node.dataset.index);
      if (!Number.isFinite(index) || index < 0) return;
      const height = node.offsetHeight;
      const heights = heightsRef.current;
      const known = heights ? heights[index] : virtualizer.itemSizeCache.get(index);
      if (known === undefined || Math.abs(known - height) > 0.5) {
        if (heights) heights[index] = height;
        changed = true;
      }
      virtualizer.measureElement(node);
    });
    if (changed) virtualizer.measure();
    return changed;
  }, [virtualizer]);

  /** 换窗必须和 scrollTop 改动落在同一帧：同步提交一次渲染，避免闪一下。 */
  const commitOrigin = useCallback((next) => {
    originRef.current = next;
    flushSync(() => {
      setOrigin(next);
      setLayoutVersion((v) => v + 1);
    });
  }, []);

  /** 接近窗口边缘时整体换窗，保持当前逻辑位置对应的画面不动。 */
  const rebaseIfNeeded = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return false;
    const total = getTotal();
    if (total <= MAX_SPAN) return false;
    const current = originRef.current;
    const span = Math.min(MAX_SPAN, Math.max(0, total - current));
    const nearTop = current > 0 && el.scrollTop < WINDOW_EDGE;
    const nearBottom =
      current + span < total && el.scrollTop + el.clientHeight > span - WINDOW_EDGE;
    if (!nearTop && !nearBottom) return false;
    const logicalTop = current + el.scrollTop;
    const next = Math.max(
      0,
      Math.min(logicalTop - MAX_SPAN / 2, Math.max(0, total - MAX_SPAN))
    );
    if (next === current) return false;
    commitOrigin(next);
    el.scrollTop = Math.max(0, logicalTop - next);
    return true;
  }, [commitOrigin, getTotal]);

  const stopAnimation = useCallback(() => {
    if (animRaf.current) cancelAnimationFrame(animRaf.current);
    animRaf.current = 0;
  }, []);

  const stopSettle = useCallback(() => {
    if (settleRaf.current) cancelAnimationFrame(settleRaf.current);
    settleRaf.current = 0;
  }, []);

  useEffect(() => stopSettle, [stopSettle]);

  useEffect(() => stopAnimation, [stopAnimation]);

  /** 滚到某个逻辑偏移（不做动画）。跨越窗口时会先换窗再落位。 */
  const scrollTo = useCallback(
    (value, { behavior = 'auto' } = {}) => {
      const el = scrollRef.current;
      if (!el) return;
      const total = getTotal();
      const max = Math.max(0, total - el.clientHeight);
      const target = Math.max(0, Math.min(value, max));
      let current = originRef.current;
      const span = Math.min(MAX_SPAN, Math.max(0, total - current));
      const safeTop = current + WINDOW_EDGE;
      const safeBottom = current + span - el.clientHeight - WINDOW_EDGE;
      if (target < safeTop || target > safeBottom) {
        const next = Math.max(
          0,
          Math.min(target - MAX_SPAN / 2, Math.max(0, total - MAX_SPAN))
        );
        if (next !== current) {
          commitOrigin(next);
          current = next;
        }
      }
      // 换窗后 virtualizer 的坐标系已经平移好了，写物理 scrollTop 即可。
      el.scrollTo({ top: Math.max(0, target - current), behavior });
    },
    [commitOrigin, getTotal]
  );

  /** 滚到某个逻辑偏移，同窗口内走缓动；跨窗口先换窗再缓动（位置仍然连续）。 */
  const animateTo = useCallback(
    (value, duration) => {
      const el = scrollRef.current;
      if (!el) return;
      const total = getTotal();
      const max = Math.max(0, total - el.clientHeight);
      const target = Math.max(0, Math.min(value, max));
      const fromLogical = originRef.current + el.scrollTop;
      let current = originRef.current;
      const span = Math.min(MAX_SPAN, Math.max(0, total - current));
      const safeTop = current + WINDOW_EDGE * 0.2;
      const safeBottom = current + span - el.clientHeight - WINDOW_EDGE * 0.2;
      if (target < safeTop || target > safeBottom) {
        const next = Math.max(
          0,
          Math.min(target - MAX_SPAN / 2, Math.max(0, total - MAX_SPAN))
        );
        if (next !== current) {
          commitOrigin(next);
          current = next;
        }
      }
      const physicalMax = Math.max(
        0,
        Math.min(MAX_SPAN, Math.max(0, total - current)) - el.clientHeight
      );
      const from = Math.max(0, Math.min(fromLogical - current, physicalMax));
      const to = Math.max(0, Math.min(target - current, physicalMax));
      stopSettle();
      stopAnimation();
      if (from !== el.scrollTop) el.scrollTop = from;
      if (Math.abs(to - from) < 2) {
        el.scrollTop = to;
        return;
      }
      const distance = to - from;
      const ms =
        typeof duration === 'number'
          ? duration
          : Math.max(240, Math.min(640, Math.abs(distance) * 0.42));
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
    [commitOrigin, getTotal, stopAnimation, stopSettle]
  );

  /**
   * Scroll so that `index` is at the top of the viewport. Heights come from the
   * whole-book table, so the first pass is usually exact; a short settle chain
   * still corrects rows the browser measures slightly differently.
   */
  const scrollToIndex = useCallback(
    (index, { align = 'start', behavior = 'auto', settleFrames = 3 } = {}) => {
      const el = scrollRef.current;
      if (!el || count === 0) return;
      const target = Math.max(0, Math.min(index, count - 1));

      const apply = () => {
        virtualizer.getTotalSize();
        const item = virtualizer.measurementsCache[target];
        const itemTop = item ? item.start : 0;
        const itemHeight = item ? item.size : estimate;
        let top = itemTop;
        if (align === 'center') top -= (el.clientHeight - itemHeight) / 2;
        else if (align === 'end') top -= el.clientHeight - itemHeight;
        scrollTo(Math.max(0, top), { behavior });
      };

      // 新的跳转作废上一次的修正链，避免两条链各按各的段落号改 scrollTop
      stopSettle();
      apply();

      let frames = 0;
      const settle = () => {
        frames += 1;
        if (measureAll()) apply();
        if (frames < settleFrames) settleRaf.current = requestAnimationFrame(settle);
        else {
          settleRaf.current = 0;
          setLayoutVersion((v) => v + 1);
        }
      };
      settleRaf.current = requestAnimationFrame(settle);
    },
    [count, estimate, measureAll, scrollTo, stopSettle, virtualizer]
  );

  /**
   * Seed every row with an exact height measured elsewhere (for example from an
   * offscreen measurement pass). Keeping the whole table exact means the spacer
   * height never changes while the reader scrolls, so nothing jumps.
   */
  const measureItems = useCallback(
    (heights) => {
      if (!heights || heights.length !== count) return false;
      let changed = false;
      const previous = heightsRef.current;
      for (let i = 0; i < count; i += 1) {
        const before = previous && previous.length === count ? previous[i] : undefined;
        if (before === undefined || Math.abs(before - heights[i]) > 0.5) {
          changed = true;
          break;
        }
      }
      // 实测表整份替换，DOM 现场测量值作废（它们本来就该等于这张表）
      heightsRef.current = new Float64Array(heights);
      virtualizer.measure();
      setLayoutVersion((v) => v + 1);
      return changed;
    },
    [count, virtualizer]
  );

  const resetMeasurements = useCallback(() => {
    heightsRef.current = null;
    virtualizer.measure();
    setLayoutVersion((v) => v + 1);
  }, [virtualizer]);

  // 段落数变化：旧高度表不再可信（换书、云端窗口切换）。大幅收缩时连窗口也复位。
  useLayoutEffect(() => {
    if (prevCount.current === count) return;
    if (count === 0 || count < prevCount.current * 0.5) {
      heightsRef.current = null;
      originRef.current = 0;
      setOrigin(0);
    }
    prevCount.current = count;
    virtualizer.measure();
    setLayoutVersion((v) => v + 1);
    // 换到更短的书后，旧 origin 可能已经超出总高（窗口外没有内容可渲染）。
    const maxOrigin = Math.max(0, virtualizer.getTotalSize() - MAX_SPAN);
    if (originRef.current > maxOrigin) {
      originRef.current = maxOrigin;
      setOrigin(maxOrigin);
    }
  }, [count, virtualizer]);

  // estimate 不在 virtualizer 的测量依赖里，字号变化必须显式重建一次。
  useLayoutEffect(() => {
    if (prevEstimate.current === estimate) return;
    prevEstimate.current = estimate;
    virtualizer.measure();
  }, [estimate, virtualizer]);

  // Scroll & resize listeners（visible range 由 virtualizer 自己订阅，这里只管换窗
  // 与「栏宽变化 → 整本重测」）。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;

    const onScroll = () => {
      if (scrollRaf.current) return;
      scrollRaf.current = requestAnimationFrame(() => {
        scrollRaf.current = 0;
        rebaseIfNeeded();
      });
    };

    let resizeTimer = null;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      const widthChanged = Math.abs(el.clientWidth - lastWidth) > 0.5;
      lastWidth = el.clientWidth;
      if (!widthChanged) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        // Text was rewrapped: ask the owner for a full re-measure. Dropping
        // the table here would leave the spacer on estimates and make the
        // document visibly jump.
        if (onResizeRef.current) {
          onResizeRef.current();
          return;
        }
        heightsRef.current = null;
        virtualizer.measure();
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
  }, [rebaseIfNeeded, virtualizer]);

  // 稳定的 ref 回调：virtualizer 每帧都会换一个 measureElement 包装，
  // 直接传会让 React 对每一行做「解绑 + 重新绑定」。
  const itemRef = useCallback((node) => {
    virtualizer.measureElement(node);
  }, [virtualizer]);

  // 可见区间 = virtualizer 的 overscan 区间；行位置由 getItemOffset 提供。
  const virtualItems = virtualizer.getVirtualItems();
  const range = virtualItems.length
    ? {
        start: virtualItems[0].index,
        end: virtualItems[virtualItems.length - 1].index + 1,
      }
    : { start: 0, end: 0 };
  const total = count > 0 ? virtualizer.getTotalSize() : 0;
  const span = Math.min(MAX_SPAN, Math.max(0, total - origin));

  return {
    scrollRef,
    range,
    total,
    span,
    layoutVersion,
    itemRef,
    getOffset,
    getItemOffset,
    getTotal,
    getLogicalTop,
    getIndexAtTop,
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
