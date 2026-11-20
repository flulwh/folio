import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 自动滚动：按固定速度把阅读位置往下推。
 *
 * 从 Reader.jsx 抽出来。滚动本身仍走虚拟滚动的逻辑偏移接口
 * （窗口会自己换），这个 hook 只负责状态、rAF 循环与暂停时机。
 */

export const AUTO_SCROLL_SPEEDS = [15, 25, 40, 60]; // px per second
const DEFAULT_AUTO_SPEED = 1; // index into AUTO_SCROLL_SPEEDS

export function useAutoScroll({ scrollRef, getTotal, getLogicalTop, scrollToOffset, notify }) {
  const [autoScroll, setAutoScroll] = useState(false);
  const [autoSpeed, setAutoSpeed] = useState(DEFAULT_AUTO_SPEED);
  const autoScrollRef = useRef(false);

  // 自动滚动跑在 rAF 里，回调每次都取最新实现（getTotal 会随排版变化换引用，
  // 直接写进 deps 会让自动滚动在测量结束时被重启）。
  const scrollApiRef = useRef(null);
  scrollApiRef.current = { getTotal, getLogicalTop, scrollToOffset };

  useEffect(() => {
    autoScrollRef.current = autoScroll;
    if (!autoScroll) return undefined;
    const api = scrollApiRef.current;
    const speed = AUTO_SCROLL_SPEEDS[autoSpeed] / 1000; // px per ms
    let raf = 0;
    let last = performance.now();
    // NOTE: Chromium drops sub-pixel scrollTop increments, so accumulating with
    // `el.scrollTop += speed * dt` never moves the page. Keep a float cursor and
    // assign it absolutely instead — the rounding then happens once per frame
    // against an ever-growing value, so motion survives.
    // 这里用「逻辑偏移」当游标：滚动容器只是书里的一扇窗，滚到窗底会自动换窗。
    let cursor = api.getLogicalTop();
    const step = (now) => {
      if (!autoScrollRef.current) return;
      const el = scrollRef.current;
      if (!el) {
        raf = requestAnimationFrame(step);
        return;
      }
      const dt = Math.max(0, Math.min(96, now - last));
      last = now;
      const max = api.getTotal() - el.clientHeight;
      if (max <= 0) {
        raf = requestAnimationFrame(step);
        return;
      }
      // the reader scrolled by itself (chapter jump / seek): follow it
      const logicalTop = api.getLogicalTop();
      if (Math.abs(logicalTop - cursor) > 3) cursor = logicalTop;
      cursor = Math.min(max, cursor + speed * dt);
      api.scrollToOffset(cursor);
      if (cursor >= max - 0.5) {
        setAutoScroll(false);
        notify('已经滚动到书末');
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      autoScrollRef.current = false;
    };
  }, [autoScroll, autoSpeed, scrollRef, notify]);

  const toggle = useCallback(() => setAutoScroll((v) => !v), []);
  const slower = useCallback(() => setAutoSpeed((v) => Math.max(0, v - 1)), []);
  const faster = useCallback(
    () => setAutoSpeed((v) => Math.min(AUTO_SCROLL_SPEEDS.length - 1, v + 1)),
    []
  );

  return {
    autoScroll,
    autoSpeed,
    setAutoScroll,
    setAutoSpeed,
    autoScrollRef,
    toggle,
    slower,
    faster,
  };
}
