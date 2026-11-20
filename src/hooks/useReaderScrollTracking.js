import { useEffect } from 'react';
import { chapterIndexForPara } from '../utils/chapters.js';

/**
 * 滚动跟踪：把滚动容器的当前位置同步到「百分比 / 当前段 / 当前章」，
 * 顺带处理发丝进度线与云端书的续取。
 *
 * 从 Reader.jsx 抽出来。滚动位置本身由 useVirtualScroll 解释（逻辑偏移），
 * 这里不碰滚动动作，只读 getScrollState / getLogicalTop / getTotal；
 * 存档节奏由 Reader 的 scheduleSave 决定，恢复位置状态机也留在 Reader。
 */
export function useReaderScrollTracking({
  scrollRef,
  measuring,
  chapters,
  cloud,
  total,
  getScrollState,
  getLogicalTop,
  getTotal,
  scheduleSave,
  restoreRef,
  lastIndexRef,
  hairTimer,
  mountedRef,
  setScrollPercent,
  setCurrentPara,
  setSelection,
  setChapterIndex,
  setHairline,
}) {
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    let raf = 0;
    let lastStamp = 0;

    const onScroll = () => {
      // 测量期的高度表还没建好：此时 scrollTop 被夹在很小的范围里，
      // 一旦把 state.index 写进 lastIndexRef，测完就会跳回书首（审计 blocker）。
      if (measuring) return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const now = performance.now();
        if (now - lastStamp < 70) return;
        lastStamp = now;

        const state = getScrollState();
        setScrollPercent(state.percent);
        setCurrentPara((prev) => (prev === state.index ? prev : state.index));
        setSelection(null);
        const ci = chapterIndexForPara(chapters, state.index);
        setChapterIndex((prev) => (prev === ci ? prev : ci));
        // 恢复位置还没 settled 时，滚动事件可能来自「落位」本身（中间值）；
        // 只更新画面，不把 lastIndexRef 和进度写成这个位置。
        if (restoreRef.current.phase === 'settled') {
          lastIndexRef.current = state.index;
          scheduleSave();
        }
        // 滚动/方向键/自动滚动不呼出工具栏：只亮发丝进度线，保持沉浸
        setHairline(true);
        if (hairTimer.current) clearTimeout(hairTimer.current);
        hairTimer.current = setTimeout(() => {
          if (mountedRef.current) setHairline(false);
        }, 900);

        // 云端书：快到底时续取下一批章节，追加到窗口末尾。
        // 用逻辑偏移判断（滚动容器只是书里的一扇窗，scrollHeight 不是全书高度）。
        const el2 = scrollRef.current;
        if (cloud?.hasMore && !cloud.loading && el2) {
          const remaining = getTotal() - getLogicalTop();
          if (remaining < el2.clientHeight * 1.5) cloud.onLoadMore();
        }
      });
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [
    chapters,
    cloud,
    getLogicalTop,
    getScrollState,
    getTotal,
    measuring,
    scheduleSave,
    scrollRef,
    restoreRef,
    lastIndexRef,
    hairTimer,
    mountedRef,
    setScrollPercent,
    setCurrentPara,
    setSelection,
    setChapterIndex,
    setHairline,
  ]);

  // 云端书追加章节后文档变长，但 scrollTop 没变、不会触发 scroll 事件，
  // 需要主动重算百分比与章节，否则会停在「已读完」。
  useEffect(() => {
    if (measuring) return;
    const state = getScrollState();
    setScrollPercent(state.percent);
    setCurrentPara((prev) => (prev === state.index ? prev : state.index));
    const ci = chapterIndexForPara(chapters, state.index);
    setChapterIndex((prev) => (prev === ci ? prev : ci));
  }, [total, chapters, getScrollState, measuring, setScrollPercent, setCurrentPara, setChapterIndex]);
}
