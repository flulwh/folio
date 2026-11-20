import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { motionKitFor } from '../motion-kit.js';
import { useAppActions, useFonts, useMarks, useProgress, useSettings } from '../store/AppStore.jsx';
import { useVirtualScroll } from '../hooks/useVirtualScroll.js';
import { useReaderMeasure } from '../hooks/useReaderMeasure.js';
import { fontStackFor } from '../hooks/useFontLoader.js';
import {
  chapterIndexForPara,
  parseBookCached,
} from '../utils/chapters.js';
import { clamp, estimateRemainingMinutes, formatPercent } from '../utils/format.js';
import { findMatchRange, searchBook } from '../utils/search.js';
import { clampIndex } from '../utils/virtual.js';
import TocPanel from './TocPanel.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import MarksPanel from './MarksPanel.jsx';
import SearchPanel from './SearchPanel.jsx';
import NoteDialog from './NoteDialog.jsx';
import {
  IconArrowLeft,
  IconBookmark,
  IconChevron,
  IconHighlight,
  IconList,
  IconMaximize,
  IconNote,
  IconPause,
  IconPlay,
  IconSearch,
  IconType,
} from './Icons.jsx';

const AUTO_SCROLL_SPEEDS = [15, 25, 40, 60]; // px per second
const DEFAULT_AUTO_SPEED = 1; // index into AUTO_SCROLL_SPEEDS
const UI_IDLE_MS = 2500;

/** 摘录统一压成单行：段落号才是锚点，字符偏移只用于显示。 */
const compactText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

export default function Reader({ book, onClose, cloud = null, resume = true }) {
  const settings = useSettings();
  // 阅读器已经订阅了 settings，直接按皮肤取套件，不再多挂一个 hook
  const kit = motionKitFor(settings.skin);
  const progress = useProgress();
  const marksMap = useMarks();
  const fonts = useFonts();
  const { saveProgress, saveBookMarks, patchSettings, resetSettings, notify } = useAppActions();

  // 正文用的字体栈：优先用户安装的字体，回退到基础字体族。
  // 选中的字体必须确实加载成功，否则正文会悄悄掉回默认字体 —— 这里做一次校验。
  const activeUserFont = useMemo(
    () => (settings.userFont ? fonts.find((f) => f.id === settings.userFont) : null) || null,
    [settings.userFont, fonts]
  );
  const readerFontStack = useMemo(
    () => (activeUserFont ? fontStackFor(activeUserFont.id, settings.fontFamily) : `var(--font-${settings.fontFamily})`),
    [activeUserFont, settings.fontFamily]
  );
  // 用户字体多半是中文衬线体，字距给一点点更耐读；等宽字体不要字距。
  const readerTracking = activeUserFont
    ? '0.008em'
    : settings.fontFamily === 'serif'
      ? '0.014em'
      : settings.fontFamily === 'mono'
        ? '0'
        : '0.006em';

  const parsed = useMemo(
    () => parseBookCached(book.content || '', settings.chapterRegex, book.id),
    [book.content, book.id, settings.chapterRegex]
  );
  const {
    paragraphs,
    chapters: parsedChapters,
    hasHeadings: parsedHasHeadings,
    charCount,
    wordCount,
  } = parsed;

  // 云端书的章节由书源目录决定：CloudBook 把「标题 + 正文」拼进 content，
  // 这里按顺序找到每个标题所在的段落，得到 paraIndex 映射。
  const chapters = useMemo(() => {
    if (!book.cloudChapters?.length) return parsedChapters;
    const norm = (value) => String(value || '').replace(/\s+/g, '');
    const out = [];
    let cursor = 0;
    book.cloudChapters.forEach((item, k) => {
      const target = norm(item.title);
      for (let i = cursor; i < paragraphs.length; i += 1) {
        if (!paragraphs[i].blank && norm(paragraphs[i].text) === target) {
          out.push({ title: item.title, paraIndex: i, cloudIndex: k });
          cursor = i + 1;
          return;
        }
      }
    });
    if (out.length) return out;
    return [{ title: '正文', paraIndex: 0, cloudIndex: 0 }];
  }, [book.cloudChapters, paragraphs, parsedChapters]);

  const hasHeadings = book.cloudChapters?.length ? true : parsedHasHeadings;

  // 云端书只装了一个章节窗口：窗口内的章号要加上 windowBase 才是全书章号。
  const windowBase = cloud?.windowBase || 0;
  const bookMarks = useMemo(
    () => (Array.isArray(marksMap[book.id]) ? marksMap[book.id] : []),
    [marksMap, book.id]
  );

  const headingSet = useMemo(() => {
    if (book.cloudChapters?.length) {
      const set = new Set();
      chapters.forEach((item) => set.add(item.paraIndex));
      return set;
    }
    // parseBook 已经把标题段落挑出来了，这里不再对全书跑一遍正则。
    return new Set(parsed.headingIndexes);
  }, [book.cloudChapters, chapters, parsed]);

  const estimate = useMemo(() => {
    const usable = Math.max(240, settings.pageWidth - 48);
    const charsPerLine = Math.max(8, Math.floor(usable / settings.fontSize));
    const lines = Math.max(1, Math.ceil(120 / charsPerLine));
    return (
      lines * settings.fontSize * settings.lineHeight +
      settings.fontSize * settings.paragraphSpacing +
      10
    );
  }, [settings.fontSize, settings.lineHeight, settings.pageWidth, settings.paragraphSpacing]);

  // 排版测量整块在 useReaderMeasure 里；这里只留一个稳定的转接器给虚拟滚动，
  // 因为 onResize 要在 hook 调用前就绪，而 hook 又要用 virtual 暴露的 measureItems。
  const resetMeasureRef = useRef(null);
  const handleResizeMeasure = useCallback(() => {
    if (resetMeasureRef.current) resetMeasureRef.current();
  }, []);

  const virtual = useVirtualScroll({
    count: paragraphs.length,
    estimate,
    overscan: 6,
    // A width change rewraps every paragraph, so ask for a fresh full measure
    // instead of letting the scroller fall back to estimated heights.
    onResize: handleResizeMeasure,
  });
  const {
    scrollRef,
    range,
    total,
    span,
    itemRef,
    getOffset,
    getItemOffset,
    getTotal,
    getLogicalTop,
    getIndexAtTop,
    scrollTo: scrollToOffset,
    animateTo,
    stopAnimation,
    scrollToIndex,
    getScrollState,
    measureItems,
  } = virtual;

  const [chapterIndex, setChapterIndex] = useState(() => {
    const saved = progress[book.id];
    if (saved && typeof saved.paraIndex === 'number') {
      return chapterIndexForPara(chapters, saved.paraIndex);
    }
    return 0;
  });
  const [scrollPercent, setScrollPercent] = useState(() => {
    const saved = progress[book.id];
    return saved && Number.isFinite(saved.percent) ? saved.percent : 0;
  });
  const [currentPara, setCurrentPara] = useState(() => {
    const saved = progress[book.id];
    return saved && Number.isFinite(saved.paraIndex) ? saved.paraIndex : 0;
  });
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [marksOpen, setMarksOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState([]);
  const [searchCursor, setSearchCursor] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [activeHit, setActiveHit] = useState(null);
  const [selection, setSelection] = useState(null);
  const [noteTarget, setNoteTarget] = useState(null);
  const [uiVisible, setUiVisible] = useState(true);
  const [autoScroll, setAutoScroll] = useState(false);
  const [autoSpeed, setAutoSpeed] = useState(DEFAULT_AUTO_SPEED);
  const [jump, setJump] = useState(null);
  const [resumeChip, setResumeChip] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [scrub, setScrub] = useState(null);
  const [hairline, setHairline] = useState(false);

  const idleTimer = useRef(null);
  const jumpTimer = useRef(null);
  const saveTimer = useRef(null);
  const resumeTimer = useRef(null);
  const hairTimer = useRef(null);
  const trackRef = useRef(null);
  const innerRef = useRef(null);
  const rootRef = useRef(null);
  const bottomRef = useRef(null);
  const scrubRef = useRef(false);
  const seekRatioRef = useRef(0);
  const autoScrollRef = useRef(false);
  const overlaysOpenRef = useRef(false);
  const lastIndexRef = useRef(progress[book.id]?.paraIndex ?? 0);
  const mountedRef = useRef(true);
  const downScrollRef = useRef(0);
  // 恢复位置状态机：pending → measuring → settled。
  // 高度表是分帧写回的，测量期间前缀偏移一直在变；这时定位只能拿到「估计高度」，
  // 长篇（paraIndex 3000）会被算到 7.6% 之类完全错误的位置。所以测量期只记录
  // 目标段落，settled 后再按最终高度表落位一次，落位后还要做后置断言。
  const restoreRef = useRef({
    phase: 'pending',
    target: resume ? progress[book.id]?.paraIndex ?? null : null,
    settledOnce: false,
    applied: false,
    asserted: false,
    chipShown: false,
    raf: 0,
  });
  // 落位逻辑随排版/高度表更新，但测量 layout effect 不能被它的新引用触发重跑，
  // 所以只通过 ref 调用最新版本。
  const locateRestoreRef = useRef(null);
  const searchTimer = useRef(null);

  // 恢复定位请求：测量未结束只记录目标段落，绝不立即滚动。
  // 引用保持稳定，避免测量用的 layout effect 被新引用反复触发。
  const requestRestore = useCallback((index) => {
    const r = restoreRef.current;
    if (!Number.isFinite(index) || index < 0) return;
    r.target = index;
    r.applied = false;
    r.asserted = false;
    if (r.phase === 'settled' && locateRestoreRef.current) locateRestoreRef.current();
  }, []);

  // Everything that can change a paragraph's height. When this changes the
  // offscreen measurement pass re-runs and the whole offset table becomes exact.
  const typographyKey = `${book.id}|${settings.fontSize}|${settings.lineHeight}|${settings.pageWidth}|${settings.paragraphSpacing}|${settings.fontFamily}|${settings.userFont || ''}|${settings.indent}`;
  const { measuring, measureHint, measureRef, measurePercent, resetMeasure } = useReaderMeasure({
    paragraphs,
    headingSet,
    typographyKey,
    activeUserFont,
    scrollRef,
    measureItems,
    resume,
    requestRestore,
    restoreRef,
    lastIndexRef,
  });
  resetMeasureRef.current = resetMeasure;

  overlaysOpenRef.current = tocOpen || settingsOpen || marksOpen || searchOpen;

  /* ------------------------- UI visibility ------------------------- */

  const wakeUI = useCallback(() => {
    setUiVisible(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (settings.autoHideUI) {
      idleTimer.current = setTimeout(() => {
        if (!overlaysOpenRef.current) setUiVisible(false);
      }, UI_IDLE_MS);
    }
  }, [settings.autoHideUI]);

  useEffect(() => {
    wakeUI();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [wakeUI]);

  /* 底栏是浮在正文之上的（absolute），正文必须自己让出它的高度，
     否则最后一章的末行会被压掉半截。底栏高度随字号/窄屏断点变化，
     所以实测而不是写死：ResizeObserver 量到多少就补多少。 */
  useEffect(() => {
    const root = rootRef.current;
    const bar = bottomRef.current;
    if (!root || !bar) return undefined;
    const apply = () => {
      const h = Math.round(bar.getBoundingClientRect().height);
      root.style.setProperty('--reader-bottom-h', `${h}px`);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(apply);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let last = 0;
    const onMove = () => {
      const now = Date.now();
      if (now - last < 120) return;
      last = now;
      wakeUI();
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [wakeUI]);

  useEffect(() => {
    if (tocOpen || settingsOpen || marksOpen || searchOpen) {
      setUiVisible(true);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    } else {
      wakeUI();
    }
  }, [tocOpen, settingsOpen, marksOpen, searchOpen, wakeUI]);

  /* ------------------------- progress saving ------------------------ */

  const flushSave = useCallback(() => {
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
      const end = ci + 1 < chapters.length ? chapters[ci + 1].paraIndex : paragraphs.length;
      const frac = clamp((state.index - start) / Math.max(1, end - start), 0, 1);
      percent = clamp(((cloud.windowBase + ci + frac) / total) * 100, 0, 100);
    }
    saveProgress(book.id, {
      paraIndex: state.index,
      percent,
      chapterIndex: ci,
      chapterTitle: chapters[ci]?.title || '',
      ...(cloud ? { windowBase: cloud.windowBase, chapter: cloud.windowBase + ci } : {}),
      updatedAt: Date.now(),
    });
  }, [book.id, chapters, cloud, getScrollState, measuring, paragraphs.length, saveProgress]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      flushSave();
      setSavedFlash(true);
      setTimeout(() => {
        if (mountedRef.current) setSavedFlash(false);
      }, 1400);
    }, 800);
  }, [flushSave]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      if (hairTimer.current) clearTimeout(hairTimer.current);
      if (measureRafRef.current) cancelAnimationFrame(measureRafRef.current);
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  useEffect(() => {
    const onHide = () => flushSave();
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
    };
  }, [flushSave]);

  /* --------------------------- motion engine ------------------------ */

  // Reading feels much calmer when long jumps glide instead of teleporting.
  // 逻辑偏移 → 物理 scrollTop 的换算（含超长篇的换窗）交给虚拟滚动。
  const stopSmooth = stopAnimation;

  const animateScroll = useCallback(
    (to, duration) => {
      animateTo(to, duration);
    },
    [animateTo]
  );

  // A one-shot fade-in on the text block; used after a jump so the page feels
  // like it settled instead of snapping.
  const playSettle = useCallback(() => {
    const node = innerRef.current;
    if (!node || typeof node.animate !== 'function') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    node.animate(
      [
        { opacity: 0.5, transform: 'translateY(9px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    );
  }, []);

  /* ------------------------- scroll tracking ------------------------ */

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
  }, [chapters, cloud, getLogicalTop, getScrollState, getTotal, measuring, scheduleSave]);

  // 云端书追加章节后文档变长，但 scrollTop 没变、不会触发 scroll 事件，
  // 需要主动重算百分比与章节，否则会停在「已读完」。
  useEffect(() => {
    if (measuring) return;
    const state = getScrollState();
    setScrollPercent(state.percent);
    setCurrentPara((prev) => (prev === state.index ? prev : state.index));
    const ci = chapterIndexForPara(chapters, state.index);
    setChapterIndex((prev) => (prev === ci ? prev : ci));
  }, [total, chapters, getScrollState, measuring]);

  /* --------------------- restore reading position ------------------- */

  // 落位后的后置断言：用最终高度表把 scrollTop 反解成「实际停在哪一段」。
  // 若与目标相差超过 2 段，说明位置在测量/换窗中被算歪了，直接按高度表修正，
  // 不再靠「再等几帧看浏览器会不会自愈」。
  const assertRestoreLanding = useCallback(() => {
    const r = restoreRef.current;
    if (r.phase !== 'settled' || r.asserted) return;
    const count = paragraphs.length;
    if (!count || r.target == null) {
      r.asserted = true;
      return;
    }
    r.asserted = true;
    const target = clampIndex(r.target, count);
    const el = scrollRef.current;
    const viewport = el ? el.clientHeight : 0;
    // 目标贴底时段落顶不到视口顶部，按「最大可滚动位置」折算期望索引，
    // 否则末尾段落永远会被误判成「落歪了」。
    const wantedTop = Math.min(getOffset(target), Math.max(0, getTotal() - viewport));
    const expected = getIndexAtTop(wantedTop);
    const landed = getIndexAtTop(getLogicalTop());
    if (Math.abs(landed - expected) <= 2) return;
    scrollToOffset(wantedTop);
    // 修正后的位置就是存档位置：先把 lastIndexRef 对齐，
    // 避免紧接着的滚动事件把中间值当成新位置写进进度。
    lastIndexRef.current = expected;
    setCurrentPara(expected);
    const ci = chapterIndexForPara(chapters, expected);
    setChapterIndex((prev) => (prev === ci ? prev : ci));
    setScrollPercent(getScrollState().percent);
    // 只记数字，不带正文：日志用于排查「长篇恢复偏移」，不是内容采样。
    console.warn('[folio] 恢复位置修正', { target, landed });
  }, [chapters, getIndexAtTop, getLogicalTop, getOffset, getScrollState, getTotal, paragraphs, scrollRef, scrollToOffset]);

  // settled 后按最终高度表落位一次。
  const locateRestore = useCallback(() => {
    const r = restoreRef.current;
    if (r.phase !== 'settled' || r.applied) return;
    const count = paragraphs.length;
    if (!count || r.target == null) return;
    r.applied = true;
    const target = clampIndex(r.target, count);
    scrollToOffset(getOffset(target));
    lastIndexRef.current = target;
    setCurrentPara(target);
    const ci = chapterIndexForPara(chapters, target);
    setChapterIndex((prev) => (prev === ci ? prev : ci));
    const state = getScrollState();
    setScrollPercent(state.percent);
    if (!r.chipShown) {
      r.chipShown = true;
      const savedPercent = progress[book.id]?.percent ?? state.percent;
      setResumeChip({ key: Date.now(), percent: savedPercent });
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      resumeTimer.current = setTimeout(() => {
        if (mountedRef.current) setResumeChip(null);
      }, 2800);
    }
    // 下一帧再断言：浏览器可能把 scrollTop 夹到合法范围或触发换窗。
    if (r.raf) cancelAnimationFrame(r.raf);
    r.raf = requestAnimationFrame(() => {
      r.raf = 0;
      assertRestoreLanding();
    });
  }, [assertRestoreLanding, chapters, getOffset, getScrollState, paragraphs, progress, book.id, scrollToOffset]);
  locateRestoreRef.current = locateRestore;

  // 测量状态 → 恢复状态机。measuring 期间任何定位都只记账；
  // settled 的下一帧再落位（此时 offsets / spacer 已经在同一帧同步）。
  useEffect(() => {
    const r = restoreRef.current;
    if (measuring) {
      r.phase = 'measuring';
      r.applied = false;
      r.asserted = false;
      if (r.raf) {
        cancelAnimationFrame(r.raf);
        r.raf = 0;
      }
      // 换字号/换栏宽触发重测时，把「当前阅读位置」当作新的恢复目标。
      if (r.settledOnce) r.target = lastIndexRef.current;
      return undefined;
    }
    r.phase = 'settled';
    r.settledOnce = true;
    const raf = requestAnimationFrame(() => {
      if (locateRestoreRef.current) locateRestoreRef.current();
    });
    return () => cancelAnimationFrame(raf);
  }, [measuring]);

  /* --------------------------- navigation --------------------------- */

  const jumpToChapter = useCallback(
    (index) => {
      const target = clamp(index, 0, chapters.length - 1);
      const chapter = chapters[target];
      if (!chapter) return;
      const displayIndex = (cloud?.windowBase || 0) + target;
      setChapterIndex(target);
      setJump({ key: `${displayIndex}-${Date.now()}`, index: displayIndex, title: chapter.title });
      playSettle();
      animateScroll(getOffset(chapter.paraIndex), 560);
      if (jumpTimer.current) clearTimeout(jumpTimer.current);
      jumpTimer.current = setTimeout(() => {
        if (mountedRef.current) setJump(null);
      }, 1000);
    },
    [animateScroll, chapters, cloud, getOffset, playSettle]
  );

  // 云端书只持有一个章节窗口：窗口内直接跳，窗口外交给外层换窗口重载。
  const goToChapter = useCallback(
    (index) => {
      if (!cloud) {
        jumpToChapter(index);
        return;
      }
      const local = index - cloud.windowBase;
      if (local >= 0 && local < chapters.length) jumpToChapter(local);
      else cloud.onJump?.(index);
    },
    [chapters.length, cloud, jumpToChapter]
  );

  const handleBack = useCallback(() => {
    flushSave();
    onClose();
  }, [flushSave, onClose]);

  /* ------------------- bookmarks / highlights / notes --------------- */

  // 痕迹锚定在「段落号」上，而不是字符偏移：换字号 / 换栏宽后正文重排，
  // 段落号仍然稳定，划线不会错位。
  const absoluteParaForMark = useCallback(
    (mark) => {
      const local = Number(mark?.paraIndex);
      if (!Number.isFinite(local)) return null;
      if (Number(mark.chapterNo) >= 0) {
        const chapter = chapters[Number(mark.chapterNo) - windowBase];
        if (!chapter) return null;
        return chapter.paraIndex + local;
      }
      return local;
    },
    [chapters, windowBase]
  );

  const buildMark = useCallback(
    (paraIndex, kind, excerpt, note = '') => {
      const ci = chapterIndexForPara(chapters, paraIndex);
      const chapter = chapters[ci];
      const isWindow = !!cloud;
      return {
        id:
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `mark-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        paraIndex: isWindow ? paraIndex - (chapter?.paraIndex || 0) : paraIndex,
        chapter: chapter?.title || '',
        chapterIndex: ci,
        chapterNo: isWindow ? windowBase + ci : -1,
        excerpt: compactText(excerpt || paragraphs[paraIndex]?.text || '').slice(0, 120),
        note: String(note || '').trim(),
        kind,
        createdAt: Date.now(),
        // 双端同步按 updatedAt 判谁更新；新建时与 createdAt 相同
        updatedAt: Date.now(),
      };
    },
    [chapters, cloud, paragraphs, windowBase]
  );

  // 书签落在「当前位置最近的非空段落」上，空行不会成为一张空白书签。
  const bookmarkTarget = useMemo(() => {
    if (!paragraphs.length) return -1;
    const start = clamp(currentPara, 0, paragraphs.length - 1);
    for (let i = start; i >= 0; i -= 1) {
      if (!paragraphs[i]?.blank) return i;
    }
    for (let i = start + 1; i < paragraphs.length; i += 1) {
      if (!paragraphs[i]?.blank) return i;
    }
    return -1;
  }, [currentPara, paragraphs]);

  const marksByPara = useMemo(() => {
    const map = new Map();
    bookMarks.forEach((mark) => {
      const index = absoluteParaForMark(mark);
      if (index == null || index < 0 || index >= paragraphs.length) return;
      const entry = map.get(index) || { bookmark: false, highlights: [] };
      if (mark.kind === 'bookmark') entry.bookmark = true;
      else entry.highlights.push(mark);
      map.set(index, entry);
    });
    return map;
  }, [absoluteParaForMark, bookMarks, paragraphs.length]);

  const isBookmarked = !!marksByPara.get(bookmarkTarget)?.bookmark;

  const toggleBookmark = useCallback(() => {
    const index = bookmarkTarget;
    if (index < 0) return;
    const existing = bookMarks.find(
      (mark) => mark.kind === 'bookmark' && absoluteParaForMark(mark) === index
    );
    if (existing) {
      saveBookMarks(book.id, bookMarks.filter((mark) => mark.id !== existing.id));
      notify('已取消书签');
    } else {
      saveBookMarks(book.id, [...bookMarks, buildMark(index, 'bookmark')]);
      notify('已加书签');
    }
    wakeUI();
  }, [
    absoluteParaForMark,
    book.id,
    bookMarks,
    bookmarkTarget,
    buildMark,
    notify,
    saveBookMarks,
    wakeUI,
  ]);

  const toggleHighlight = useCallback(
    (paraIndex, excerpt) => {
      const existing = bookMarks.find(
        (mark) => mark.kind === 'highlight' && absoluteParaForMark(mark) === paraIndex
      );
      if (existing) {
        // 带笔记的划线不直接删：先打开笔记框，避免误删用户写过的东西
        if (existing.note) {
          setNoteTarget({ markId: existing.id, paraIndex, excerpt: existing.excerpt });
          return;
        }
        saveBookMarks(book.id, bookMarks.filter((mark) => mark.id !== existing.id));
        notify('已取消划线');
        return;
      }
      saveBookMarks(book.id, [...bookMarks, buildMark(paraIndex, 'highlight', excerpt)]);
      notify('已划线');
      setSelection(null);
    },
    [absoluteParaForMark, book.id, bookMarks, buildMark, notify, saveBookMarks]
  );

  const openNoteFor = useCallback(
    (paraIndex, excerpt) => {
      const existing = bookMarks.find(
        (mark) => mark.kind === 'highlight' && absoluteParaForMark(mark) === paraIndex
      );
      setNoteTarget({
        markId: existing?.id || null,
        paraIndex,
        excerpt: existing?.excerpt || excerpt,
      });
      setSelection(null);
    },
    [absoluteParaForMark, bookMarks]
  );

  const saveNote = useCallback(
    (text) => {
      const target = noteTarget;
      if (!target) return;
      const note = String(text || '').trim();
      if (target.markId) {
        saveBookMarks(
          book.id,
          bookMarks.map((mark) =>
            mark.id === target.markId ? { ...mark, note, updatedAt: Date.now() } : mark
          )
        );
      } else if (note) {
        saveBookMarks(book.id, [
          ...bookMarks,
          buildMark(target.paraIndex, 'highlight', target.excerpt, note),
        ]);
      }
      setNoteTarget(null);
      notify(note ? '笔记已保存' : '笔记已清空');
    },
    [book.id, bookMarks, buildMark, noteTarget, notify, saveBookMarks]
  );

  const updateNote = useCallback(
    (id, text) => {
      saveBookMarks(
        book.id,
        bookMarks.map((mark) =>
          mark.id === id ? { ...mark, note: String(text || '').trim(), updatedAt: Date.now() } : mark
        )
      );
      notify('笔记已保存');
    },
    [book.id, bookMarks, notify, saveBookMarks]
  );

  const removeMark = useCallback(
    (id) => {
      saveBookMarks(book.id, bookMarks.filter((mark) => mark.id !== id));
      notify('已删除痕迹');
    },
    [book.id, bookMarks, notify, saveBookMarks]
  );

  const jumpToMark = useCallback(
    (mark) => {
      setActiveHit(null);
      const index = absoluteParaForMark(mark);
      if (index == null) {
        if (Number(mark.chapterNo) >= 0) cloud?.onJump?.(Number(mark.chapterNo));
        notify('这一章不在当前窗口，正在跳转');
        return;
      }
      setAutoScroll(false);
      playSettle();
      animateScroll(getOffset(index), 480);
      setCurrentPara(index);
    },
    [absoluteParaForMark, animateScroll, cloud, getOffset, notify, playSettle]
  );

  /* ------------------------ selection bubble ------------------------ */

  const handleReaderMouseUp = useCallback((event) => {
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
  }, []);

  /* --------------------------- full-text search --------------------- */

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!searchOpen || !searchQuery.trim()) {
      setSearchHits([]);
      setSearchCursor(-1);
      setSearching(false);
      setActiveHit(null);
      return undefined;
    }
    setSearching(true);
    setActiveHit(null);
    const keyword = searchQuery.trim();
    searchTimer.current = setTimeout(() => {
      const hits = searchBook(paragraphs, chapters, keyword);
      setSearchHits(hits);
      setSearchCursor(hits.length ? 0 : -1);
      setSearching(false);
    }, 260);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchOpen, searchQuery, paragraphs, chapters]);

  const jumpToHit = useCallback(
    (hit, index) => {
      if (!hit) return;
      const text = paragraphs[hit.paraIndex]?.text || '';
      const range = findMatchRange(text, searchQuery) || {
        start: Math.max(0, hit.start),
        end: Math.max(1, hit.end),
      };
      setActiveHit({ paraIndex: hit.paraIndex, start: range.start, end: range.end });
      setSearchCursor(index);
      setAutoScroll(false);
      playSettle();
      animateScroll(getOffset(hit.paraIndex), 420);
      setCurrentPara(hit.paraIndex);
    },
    [animateScroll, getOffset, paragraphs, playSettle, searchQuery]
  );

  const stepHit = useCallback(
    (direction) => {
      if (!searchHits.length) return;
      const base = searchCursor < 0 ? (direction > 0 ? -1 : 0) : searchCursor;
      const next = (base + direction + searchHits.length) % searchHits.length;
      jumpToHit(searchHits[next], next);
    },
    [jumpToHit, searchCursor, searchHits]
  );

  /* --------------------------- auto scroll -------------------------- */

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

  const handleWheel = useCallback(() => {
    if (autoScrollRef.current) {
      setAutoScroll(false);
      notify('自动滚动已暂停');
    }
    // A wheel gesture always wins over an in-flight glide.
    stopSmooth();
  }, [notify, stopSmooth]);

  /* --------------------------- fullscreen --------------------------- */

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  /* --------------------------- shortcuts ---------------------------- */

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
      const next = clamp(settings.fontSize + 1, 14, 30);
      patchSettings({ fontSize: next });
      notify(`字号 ${next}px`);
    },
    smaller: () => {
      const next = clamp(settings.fontSize - 1, 14, 30);
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

  /* ----------------------------- render ----------------------------- */

  const currentChapter = chapters[chapterIndex] || chapters[0];
  const totalChapters = cloud?.chapters?.length || chapters.length;
  const globalChapter = windowBase + chapterIndex;

  // 顶部百分比、进度条、剩余时间、「读完」判定都只看这一个值。
  // 本地书滚动百分比本来就是全书口径；云端书只装了一个章节窗口，
  // 必须按「窗口起点 + 章内位置」折算，否则第 200 章也显示 0%。
  const globalPercent = useMemo(() => {
    if (!cloud?.chapters?.length) return scrollPercent;
    const total = cloud.chapters.length;
    const ci = chapterIndexForPara(chapters, currentPara);
    const start = chapters[ci]?.paraIndex ?? currentPara;
    const end = ci + 1 < chapters.length ? chapters[ci + 1].paraIndex : paragraphs.length;
    const frac = clamp((currentPara - start) / Math.max(1, end - start), 0, 1);
    return clamp(((cloud.windowBase + ci + frac) / total) * 100, 0, 100);
  }, [chapters, cloud, currentPara, paragraphs.length, scrollPercent]);

  const remainingText = useMemo(() => {
    // 云端书只装了当前窗口：窗口内剩余 + 按窗口均章长估算的后续章节
    if (cloud?.chapters?.length) {
      const inWindow = charCount * (1 - clamp(globalPercent, 0, 100) / 100);
      const chaptersLeft = Math.max(0, cloud.chapters.length - windowBase - cloud.windowCount);
      const avgPerChapter = cloud.windowCount ? charCount / cloud.windowCount : 0;
      return estimateRemainingMinutes(inWindow + chaptersLeft * avgPerChapter);
    }
    const left = charCount * (1 - clamp(globalPercent, 0, 100) / 100);
    return estimateRemainingMinutes(left);
  }, [charCount, cloud, globalPercent, windowBase]);

  /* 正文装饰只改变「墨色/背景」和绝对定位的伪元素，绝不动行高：
     段落高度表是精确测量出来的，任何影响布局的装饰都会让虚拟滚动错位。 */
  const renderParagraph = (para, index) => {
    const text = para.text || '';
    const entry = marksByPara.get(index);
    let className = `para${headingSet.has(index) ? ' chapter-title' : ''}${
      entry?.bookmark ? ' bookmarked' : ''
    }`;

    if (activeHit && activeHit.paraIndex === index) {
      const { start, end } = activeHit;
      if (start >= 0 && end > start && end <= text.length) {
        return (
          <p className={className}>
            {text.slice(0, start)}
            <mark className="para-find">{text.slice(start, end)}</mark>
            {text.slice(end)}
          </p>
        );
      }
    }

    const highlight = entry?.highlights?.[0];
    if (highlight?.excerpt) {
      const at = text.indexOf(highlight.excerpt);
      if (at >= 0) {
        return (
          <p className={className}>
            {text.slice(0, at)}
            <mark className="para-mark">{text.slice(at, at + highlight.excerpt.length)}</mark>
            {text.slice(at + highlight.excerpt.length)}
          </p>
        );
      }
    }
    if (entry?.highlights?.length) className += ' para-highlighted';
    return <p className={className}>{text}</p>;
  };

  const items = [];
  for (let i = range.start; i < range.end && i < paragraphs.length; i += 1) {
    const para = paragraphs[i];
    if (!para) continue;
    const top = getItemOffset(i);
    const isFirst = i === 0;
    const isLast = i === paragraphs.length - 1;
    items.push(
      <div
        key={i}
        className="vp-item"
        data-index={i}
        ref={itemRef}
        style={{
          transform: `translate3d(0, ${top}px, 0)`,
          paddingTop: isFirst ? '14vh' : undefined,
          paddingBottom: isLast ? '28vh' : undefined,
        }}
      >
        {para.blank ? <div className="vp-gap" /> : renderParagraph(para, i)}
      </div>
    );
  }

  const handlePointerDown = () => {
    const el = scrollRef.current;
    if (el) downScrollRef.current = el.scrollTop;
  };

  const handleContentClick = (e) => {
    if (e.target.closest('.edge-nav') || e.target.closest('.selection-bubble')) return;
    const selection = window.getSelection();
    if (selection && selection.toString()) return;
    // 滚动/拖动后的点击不切换工具栏（防止松手时误触）
    const el = scrollRef.current;
    if (el && Math.abs(el.scrollTop - downScrollRef.current) > 4) return;
    if (uiVisible) setUiVisible(false);
    else wakeUI();
  };

  const seekTo = (clientX) => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    seekRatioRef.current = ratio;
    if (cloud?.chapters?.length) {
      // 云端书：轨道是全书口径，先换算到「当前窗口内的章内位置」做即时预览；
      // 落在窗口外的部分要等松手再交给 onJump 换窗口（拖动过程中不反复拉章节）。
      const localPos = ratio * cloud.chapters.length - windowBase;
      if (localPos >= 0 && localPos < chapters.length) {
        const target = Math.min(chapters.length - 1, Math.floor(localPos));
        const start = chapters[target]?.paraIndex ?? 0;
        const next = chapters[target + 1]?.paraIndex ?? paragraphs.length;
        scrollToIndex(start + Math.round((next - start) * (localPos - target)));
      }
      return ratio * 100;
    }
    const max = Math.max(0, getTotal() - el.clientHeight);
    scrollToOffset(ratio * max);
    return ratio * 100;
  };

  const onTrackDown = (e) => {
    e.preventDefault();
    stopSmooth();
    setAutoScroll(false);
    scrubRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setScrub(seekTo(e.clientX));
    wakeUI();
  };

  const onTrackMove = (e) => {
    if (!scrubRef.current) return;
    setScrub(seekTo(e.clientX));
  };

  const onTrackUp = (e) => {
    if (!scrubRef.current) return;
    scrubRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setScrub(null);
    playSettle();
    if (cloud?.chapters?.length) {
      const target = Math.min(
        cloud.chapters.length - 1,
        Math.max(0, Math.floor(seekRatioRef.current * cloud.chapters.length))
      );
      const local = target - windowBase;
      if (local < 0 || local >= chapters.length) cloud.onJump?.(target);
    }
  };

  // 云端书读完全书（没有更多章且当前窗口滚到底）才算读完
  const finished = cloud ? !cloud.hasMore && globalPercent >= 99.6 : globalPercent >= 99.6;
  const noteInitial = noteTarget?.markId
    ? bookMarks.find((mark) => mark.id === noteTarget.markId)?.note || ''
    : '';

  return (
    <div
      ref={rootRef}
      className={`reader${uiVisible ? '' : ' zen'}${autoScroll ? ' auto-scrolling' : ''}${
        settings.indent ? '' : ' no-indent'
      }`}
      style={{
        '--reader-font-size': `${settings.fontSize}px`,
        '--reader-line-height': settings.lineHeight,
        '--reader-width': `${settings.pageWidth}px`,
        '--reader-space': `${settings.paragraphSpacing}em`,
        '--reader-font': readerFontStack,
        '--reader-tracking': readerTracking,
      }}
    >
      <motion.header
        className="reader-header"
        animate={{ y: uiVisible ? 0 : -84, opacity: uiVisible ? 1 : 0 }}
        transition={kit.chrome}
        style={{ pointerEvents: uiVisible ? 'auto' : 'none' }}
      >
        <div className="reader-head-left">
          <button className="icon-btn" onClick={handleBack} title="返回书架 (Esc)">
            <IconArrowLeft />
          </button>
          <div className="reader-head-titles">
            <span className="reader-book" title={book.name}>
              {book.name}
            </span>
            <span className="reader-chapter">
              <motion.span
                key={currentChapter ? currentChapter.title : 'body'}
                initial={{ opacity: 0.35 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                {currentChapter ? currentChapter.title : '正文'}
              </motion.span>
            </span>
          </div>
        </div>

        <div className="reader-head-right">
          <span className="reader-percent">{formatPercent(globalPercent)}</span>
          <button
            className={`icon-btn${autoScroll ? ' active' : ''}`}
            onClick={() => setAutoScroll((v) => !v)}
            title={autoScroll ? '暂停自动滚动 (A)' : '自动滚动 (A)'}
          >
            {autoScroll ? <IconPause size={17} /> : <IconPlay size={17} />}
          </button>
          <button
            className={`icon-btn${searchOpen ? ' active' : ''}`}
            onClick={() => handlersRef.current.toggleSearch()}
            title="全书搜索 (Ctrl/Cmd + F)"
          >
            <IconSearch size={17} />
          </button>
          <button
            className={`icon-btn${marksOpen ? ' active' : ''}`}
            onClick={() => handlersRef.current.toggleMarks()}
            title="书签与笔记 (M)"
          >
            <IconBookmark size={17} />
          </button>
          <button className="icon-btn" onClick={() => handlersRef.current.toggleToc()} title="目录 (T)">
            <IconList />
          </button>
          <button
            className="icon-btn"
            onClick={() => handlersRef.current.toggleSettings()}
            title="阅读设置 (S)"
          >
            <IconType />
          </button>
          <button className="icon-btn" onClick={toggleFullscreen} title="全屏 (F)">
            <IconMaximize size={17} />
          </button>
        </div>
      </motion.header>

      <div className={`reader-hairline${hairline ? ' active' : ''}`} style={{ width: `${globalPercent}%` }} />

      <div
        className="reader-scroll"
        ref={scrollRef}
        onClick={handleContentClick}
        onPointerDown={handlePointerDown}
        onMouseUp={handleReaderMouseUp}
        onWheel={handleWheel}
      >
        <div
          className="reader-inner"
          ref={innerRef}
          data-virtual-inner
          style={measuring ? undefined : { height: span }}
        >
          {measuring ? (
            // 子节点由排版测量的 layout effect 直接拼（不走 React），这里只留挂载点
            <div className="measure-list" ref={measureRef} />
          ) : (
            items
          )}
        </div>
      </div>

      {measureHint && (
        <div className="reader-measuring">
          <span className="reader-measuring-dot" />
          正在排版
          <span className="reader-measuring-pct">{measurePercent}%</span>
        </div>
      )}

      {totalChapters > 1 && (
        <>
          <button
            className="edge-nav prev"
            onClick={(e) => {
              e.stopPropagation();
              goToChapter(globalChapter - 1);
            }}
            disabled={globalChapter <= 0}
            title="上一章 (←)"
          >
            <IconChevron size={18} />
          </button>
          <button
            className="edge-nav next"
            onClick={(e) => {
              e.stopPropagation();
              goToChapter(globalChapter + 1);
            }}
            disabled={globalChapter >= totalChapters - 1}
            title="下一章 (→)"
          >
            <IconChevron size={18} />
          </button>
        </>
      )}

      {settings.showProgress && (
        <motion.footer
          ref={bottomRef}
          className="reader-bottom"
          animate={{ y: uiVisible ? 0 : 90, opacity: uiVisible ? 1 : 0 }}
          transition={kit.chrome}
          style={{ pointerEvents: uiVisible ? 'auto' : 'none' }}
        >
          <div
            className={`reader-progress-track${scrub !== null ? ' scrubbing' : ''}`}
            ref={trackRef}
            onPointerDown={onTrackDown}
            onPointerMove={onTrackMove}
            onPointerUp={onTrackUp}
            onPointerCancel={onTrackUp}
            title="拖动跳转"
          >
            <span
              className={`reader-progress-fill${finished ? ' finished' : ''}`}
              style={{ width: `${scrub ?? globalPercent}%` }}
            />
            <i className="reader-progress-knob" style={{ left: `${scrub ?? globalPercent}%` }} />
            <AnimatePresence>
              {scrub !== null && (
                <motion.span
                  className="reader-scrub-tip"
                  style={{ left: `${scrub}%` }}
                  initial={{ opacity: 0, y: 6, x: '-50%' }}
                  animate={{ opacity: 1, y: 0, x: '-50%' }}
                  exit={{ opacity: 0, x: '-50%' }}
                  transition={{ duration: 0.16 }}
                >
                  {formatPercent(scrub)}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <div className="reader-bottom-row">
            <span className="reader-chapter-position">
              第 {globalChapter + 1} / {totalChapters} 章
              {cloud && cloud.loading ? ' · 取章中' : ''}
            </span>
            <AnimatePresence>
              {savedFlash && (
                <motion.span
                  className="reader-saved"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  进度已保存
                </motion.span>
              )}
            </AnimatePresence>
            <span className="reader-remaining">
              {finished ? '已读完' : `剩余 ${remainingText}`}
            </span>
          </div>
        </motion.footer>
      )}

      <AnimatePresence>
        {autoScroll && (
          <motion.div
            className="auto-pill"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <span className="auto-dot" />
            自动滚动中
            <span className="auto-speed">
              <button
                type="button"
                aria-label="减速"
                onClick={() => setAutoSpeed((v) => Math.max(0, v - 1))}
                disabled={autoSpeed === 0}
              >
                −
              </button>
              <span className="auto-speed-value">{AUTO_SCROLL_SPEEDS[autoSpeed]}</span>
              <button
                type="button"
                aria-label="加速"
                onClick={() => setAutoSpeed((v) => Math.min(AUTO_SCROLL_SPEEDS.length - 1, v + 1))}
                disabled={autoSpeed === AUTO_SCROLL_SPEEDS.length - 1}
              >
                +
              </button>
              <span className="auto-speed-unit">px/s</span>
            </span>
            <button onClick={() => setAutoScroll(false)}>暂停</button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {resumeChip && (
          <motion.div
            className="resume-chip"
            key={resumeChip.key}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            已回到上次阅读位置 · {formatPercent(resumeChip.percent)}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {jump && (
          <motion.div
            className="chapter-flash"
            key={jump.key}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="chapter-flash-index">第 {jump.index + 1} 章</span>
            <h2 className="chapter-flash-title">{jump.title}</h2>
          </motion.div>
        )}
      </AnimatePresence>

      {selection && (
        <div
          className="selection-bubble"
          style={{ left: selection.x, top: selection.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => toggleHighlight(selection.paraIndex, selection.excerpt)}>
            <IconHighlight size={13} /> 划线
          </button>
          <span className="selection-bubble-divider" />
          <button type="button" onClick={() => openNoteFor(selection.paraIndex, selection.excerpt)}>
            <IconNote size={13} /> 笔记
          </button>
        </div>
      )}

      <NoteDialog
        open={!!noteTarget}
        excerpt={noteTarget?.excerpt || ''}
        initial={noteInitial}
        onSave={saveNote}
        onClose={() => setNoteTarget(null)}
      />

      <MarksPanel
        open={marksOpen}
        bookName={book.name}
        marks={bookMarks}
        currentPara={bookmarkTarget}
        canBookmark={bookmarkTarget >= 0}
        isBookmarked={isBookmarked}
        onToggleBookmark={toggleBookmark}
        onJump={jumpToMark}
        onRemove={removeMark}
        onUpdateNote={updateNote}
        onClose={() => setMarksOpen(false)}
      />

      <SearchPanel
        open={searchOpen}
        bookName={book.name}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        hits={searchHits}
        running={searching}
        cursor={searchCursor}
        onJump={jumpToHit}
        onStep={stepHit}
        onClose={() => setSearchOpen(false)}
      />

      <TocPanel
        open={tocOpen}
        bookName={book.name}
        chapters={cloud?.chapters?.length ? cloud.chapters : chapters}
        currentChapter={globalChapter}
        hasHeadings={hasHeadings}
        onClose={() => setTocOpen(false)}
        onSelect={(index) => {
          setTocOpen(false);
          goToChapter(index);
        }}
        onOpenSettings={() => {
          setTocOpen(false);
          setSettingsOpen(true);
        }}
      />

      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        onChange={patchSettings}
        onReset={resetSettings}
        onClose={() => setSettingsOpen(false)}
        chapterStats={{
          count: totalChapters,
          hasHeadings,
          wordCount,
          paragraphCount: paragraphs.length,
          samples: (cloud?.chapters?.length ? cloud.chapters : chapters)
            .slice(0, 4)
            .map((c) => c.title),
        }}
      />
    </div>
  );
}
