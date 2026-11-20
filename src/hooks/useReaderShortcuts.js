import { useEffect, useRef } from 'react';
import { AUTO_SCROLL_SPEEDS } from './useAutoScroll.js';
import { clamp } from '../utils/format.js';

/**
 * 阅读器快捷键：把键盘事件翻译成 Reader 里的动作。
 *
 * 从 Reader.jsx 抽出来。动作本身（翻章、滚动、开关面板）仍由 Reader 提供，
 * 这里只维护「命令表 + keydown 绑定」，因此命令表每帧刷新、监听只装一次。
 */
export function useReaderShortcuts({
  selection,
  tocOpen,
  settingsOpen,
  marksOpen,
  searchOpen,
  uiVisible,
  fontSize,
  handleBack,
  goToChapter,
  globalChapter,
  toggleBookmark,
  toggleFullscreen,
  wakeUI,
  scrollRef,
  animateScroll,
  getLogicalTop,
  getTotal,
  patchSettings,
  notify,
  setAutoScroll,
  setAutoSpeed,
  setTocOpen,
  setSettingsOpen,
  setMarksOpen,
  setSearchOpen,
  setSelection,
}) {
  const handlersRef = useRef({});
  handlersRef.current = {
    closePanels: () => {
      setTocOpen(false);
      setSettingsOpen(false);
      setMarksOpen(false);
      setSearchOpen(false);
      setSelection(null);
    },
    dismissSelection: () => setSelection(null),
    hasSelection: () => !!selection,
    back: handleBack,
    prev: () => {
      setAutoScroll(false);
      goToChapter(globalChapter - 1);
    },
    next: () => {
      setAutoScroll(false);
      goToChapter(globalChapter + 1);
    },
    toggleToc: () => {
      setTocOpen((v) => !v);
      setSettingsOpen(false);
      setMarksOpen(false);
      setSearchOpen(false);
      setSelection(null);
    },
    toggleSettings: () => {
      setSettingsOpen((v) => !v);
      setTocOpen(false);
      setMarksOpen(false);
      setSearchOpen(false);
      setSelection(null);
    },
    toggleMarks: () => {
      setMarksOpen((v) => !v);
      setTocOpen(false);
      setSettingsOpen(false);
      setSearchOpen(false);
      setSelection(null);
    },
    toggleSearch: () => {
      setSearchOpen((v) => !v);
      setTocOpen(false);
      setSettingsOpen(false);
      setMarksOpen(false);
      setSelection(null);
    },
    toggleBookmark,
    toggleAuto: () => setAutoScroll((v) => !v),
    slower: () => setAutoSpeed((v) => Math.max(0, v - 1)),
    faster: () => setAutoSpeed((v) => Math.min(AUTO_SCROLL_SPEEDS.length - 1, v + 1)),
    fullscreen: toggleFullscreen,
    wake: wakeUI,
    pageDown: () => {
      setAutoScroll(false);
      const el = scrollRef.current;
      if (el) animateScroll(getLogicalTop() + el.clientHeight * 0.88, 320);
    },
    pageUp: () => {
      setAutoScroll(false);
      const el = scrollRef.current;
      if (el) animateScroll(getLogicalTop() - el.clientHeight * 0.88, 320);
    },
    lineDown: () => {
      setAutoScroll(false);
      const el = scrollRef.current;
      if (el) animateScroll(getLogicalTop() + el.clientHeight * 0.3, 200);
    },
    lineUp: () => {
      setAutoScroll(false);
      const el = scrollRef.current;
      if (el) animateScroll(getLogicalTop() - el.clientHeight * 0.3, 200);
    },
    home: () => {
      setAutoScroll(false);
      animateScroll(0, 320);
    },
    end: () => {
      setAutoScroll(false);
      const el = scrollRef.current;
      if (el) animateScroll(Math.max(0, getTotal() - el.clientHeight), 320);
    },
    bigger: () => {
      const next = clamp(fontSize + 1, 14, 30);
      patchSettings({ fontSize: next });
      notify(`字号 ${next}px`);
    },
    smaller: () => {
      const next = clamp(fontSize - 1, 14, 30);
      patchSettings({ fontSize: next });
      notify(`字号 ${next}px`);
    },
    isPanel: () => tocOpen || settingsOpen || marksOpen || searchOpen,
    isUiVisible: () => uiVisible,
  };

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
      const h = handlersRef.current;

      // Esc 优先于「在输入框里」的判断：搜索框里按 Esc 应该先关面板，
      // 而不是被输入框吞掉（否则只能去点关闭按钮）。
      if (e.key === 'Escape' && h.isPanel()) {
        e.preventDefault();
        h.closePanels();
        return;
      }

      if (inField) return;

      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        h.toggleSearch();
        return;
      }

      switch (e.key) {
        case 'Escape':
          if (h.isPanel()) h.closePanels();
          else if (h.hasSelection()) h.dismissSelection();
          else if (!h.isUiVisible()) h.wake();
          else h.back();
          break;
        case 'ArrowLeft':
          if (!e.shiftKey && !h.isPanel()) h.prev();
          break;
        case 'ArrowRight':
          if (!e.shiftKey && !h.isPanel()) h.next();
          break;
        case 'ArrowUp':
          if (!h.isPanel()) {
            e.preventDefault();
            h.lineUp();
          }
          break;
        case 'ArrowDown':
          if (!h.isPanel()) {
            e.preventDefault();
            h.lineDown();
          }
          break;
        case 'Home':
          if (!h.isPanel()) {
            e.preventDefault();
            h.home();
          }
          break;
        case 'End':
          if (!h.isPanel()) {
            e.preventDefault();
            h.end();
          }
          break;
        case ' ':
        case 'PageDown':
          if (!h.isPanel()) {
            e.preventDefault();
            h.pageDown();
          }
          break;
        case 'PageUp':
          if (!h.isPanel()) {
            e.preventDefault();
            h.pageUp();
          }
          break;
        case 't':
        case 'T':
          h.toggleToc();
          break;
        case 's':
        case 'S':
          h.toggleSettings();
          break;
        case 'a':
        case 'A':
          h.toggleAuto();
          break;
        case 'b':
        case 'B':
          h.toggleBookmark();
          break;
        case 'm':
        case 'M':
          h.toggleMarks();
          break;
        case '[':
          h.slower();
          break;
        case ']':
          h.faster();
          break;
        case 'f':
        case 'F':
          h.fullscreen();
          break;
        case '+':
        case '=':
          h.bigger();
          break;
        case '-':
        case '_':
          h.smaller();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return handlersRef;
}
