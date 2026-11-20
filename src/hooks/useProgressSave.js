import { useCallback, useEffect, useRef, useState } from 'react';
import { chapterIndexForPara } from '../utils/chapters.js';
import { clamp } from '../utils/format.js';

/**
 * 阅读进度存档：滚动停止后延时写一次，关键时刻（关书/切窗口）立即冲掉。
 *
 * 从 Reader.jsx 抽出来。存档门槛（测量中、恢复未落位、段落没变）保持不变：
 * 宁可少写一次，也不能把测量期的假位置写进 progress。
 */
export function useProgressSave({
  bookId,
  chapters,
  cloud,
  paragraphsLength,
  measuring,
  getScrollState,
  restoreRef,
  lastIndexRef,
  saveProgress,
  mountedRef,
}) {
  const [savedFlash, setSavedFlash] = useState(false);
  const saveTimer = useRef(null);

  const flushSave = useCallback(() => {
    // 已经卸载的阅读器不能再写：云端书换窗口会 remount，迟到的存档会把新窗口
    // 刚写的「第 N 章」盖回旧窗口的位置。
    if (!mountedRef.current) return;
    // 测量期只有 600 段挂在 DOM 上、滚动高度被夹小，此时取到的 index 是假的。
    // 恢复位置还没落位（pending/measuring）时同理：scrollTop 只是走到一半的中间值。
    // 宁可不存，也不能把错误位置写进 progress（下次打开会跳到前面）。
    if (measuring || restoreRef.current.phase !== 'settled') return;
    const state = getScrollState();
    // 位置没动就不写：关书 / 切窗口的兜底保存会把手上的时间戳刷成「现在」，
    // 只是「打开又关掉」也能压过另一端真正更新的进度。段落和上次一致就跳过。
    if (state.index === lastIndexRef.current) return;
    const ci = chapterIndexForPara(chapters, state.index);
    lastIndexRef.current = state.index;
    // 云端书按「全书目录」折算百分比：窗口内滚动只用于估算章内位置，
    // 存下来的进度对书架/继续阅读就是全书口径，不会因换窗口跳变。
    let percent = state.percent;
    if (cloud?.chapters?.length) {
      const total = cloud.chapters.length;
      const start = chapters[ci]?.paraIndex ?? state.index;
      const end = ci + 1 < chapters.length ? chapters[ci + 1].paraIndex : paragraphsLength;
      const frac = clamp((state.index - start) / Math.max(1, end - start), 0, 1);
      percent = clamp(((cloud.windowBase + ci + frac) / total) * 100, 0, 100);
    }
    saveProgress(bookId, {
      paraIndex: state.index,
      percent,
      chapterIndex: ci,
      chapterTitle: chapters[ci]?.title || '',
      ...(cloud ? { windowBase: cloud.windowBase, chapter: cloud.windowBase + ci } : {}),
      updatedAt: Date.now(),
    });
  }, [
    bookId,
    chapters,
    cloud,
    getScrollState,
    measuring,
    paragraphsLength,
    restoreRef,
    lastIndexRef,
    saveProgress,
  ]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      flushSave();
      setSavedFlash(true);
      setTimeout(() => {
        if (mountedRef.current) setSavedFlash(false);
      }, 1400);
    }, 800);
  }, [flushSave, mountedRef]);

  useEffect(() => {
    const onHide = () => flushSave();
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
    };
  }, [flushSave]);

  // 卸载时取消排队中的存档，避免对已卸载组件 setState。
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  return { savedFlash, flushSave, scheduleSave };
}
