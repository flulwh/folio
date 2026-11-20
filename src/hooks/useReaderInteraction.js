import { useCallback, useRef } from 'react';
import { clamp, compactText } from '../utils/format.js';

/**
 * 正文上的鼠标交互：拖选文字后定位气泡，以及「点一下切换工具栏」。
 *
 * 从 Reader.jsx 抽出来。选区只负责把锚点段落与坐标交给 Reader 的
 * selection 状态；是否显示、显示什么由 Reader 决定。
 */
export function useReaderInteraction({ scrollRef, setSelection, uiVisible, setUiVisible, wakeUI }) {
  // 记录按下时的滚动位置：滚动/拖动后松手的点击不算「切换工具栏」。
  const downScrollRef = useRef(0);

  const handleReaderMouseUp = useCallback(
    (event) => {
      if (event.target.closest?.('.selection-bubble')) return;
      const selection = window.getSelection();
      const text = selection && !selection.isCollapsed ? compactText(selection.toString()) : '';
      if (!text) {
        setSelection(null);
        return;
      }
      const anchor = selection.anchorNode;
      const element = anchor?.nodeType === 3 ? anchor.parentElement : anchor;
      const node = element?.closest?.('.vp-item');
      const paraIndex = Number(node?.dataset.index);
      if (!node || !Number.isFinite(paraIndex)) {
        setSelection(null);
        return;
      }
      const range = selection.rangeCount ? selection.getRangeAt(0) : null;
      const rect = range?.getBoundingClientRect();
      if (!rect) {
        setSelection(null);
        return;
      }
      setSelection({
        x: clamp(rect.left + rect.width / 2, 96, window.innerWidth - 96),
        y: clamp(rect.top - 10, 64, window.innerHeight - 72),
        paraIndex,
        excerpt: text.slice(0, 120),
      });
    },
    [setSelection]
  );

  const handlePointerDown = useCallback(() => {
    const el = scrollRef.current;
    if (el) downScrollRef.current = el.scrollTop;
  }, [scrollRef]);

  const handleContentClick = useCallback(
    (e) => {
      if (e.target.closest('.edge-nav') || e.target.closest('.selection-bubble')) return;
      const sel = window.getSelection();
      if (sel && sel.toString()) return;
      // 滚动/拖动后的点击不切换工具栏（防止松手时误触）
      const el = scrollRef.current;
      if (el && Math.abs(el.scrollTop - downScrollRef.current) > 4) return;
      if (uiVisible) setUiVisible(false);
      else wakeUI();
    },
    [scrollRef, uiVisible, setUiVisible, wakeUI]
  );

  return { handleReaderMouseUp, handlePointerDown, handleContentClick };
}
