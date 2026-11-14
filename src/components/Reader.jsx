import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { motionKitFor } from '../motion-kit.js';
import { useAppActions, useFonts, useMarks, useProgress, useSettings } from '../store/AppStore.jsx';
import { useVirtualScroll } from '../hooks/useVirtualScroll.js';
import { fontStackFor } from '../hooks/useFontLoader.js';
import {
  chapterIndexForPara,
  parseBookCached,
} from '../utils/chapters.js';
import { clamp, estimateRemainingMinutes, formatPercent } from '../utils/format.js';
import { findMatchRange, searchBook } from '../utils/search.js';
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
// 排版测量每批处理多少段（越大越快、越容易掉帧）。
// 真实批大小由 measureChunkSize() 按书的大小放大，小书的行为保持不变。
const MEASURE_CHUNK = 600;
// 单批上限：再大就是一次几百毫秒的长任务，进度条会「卡住」而不是「走得快」。
const MEASURE_CHUNK_MAX = 24000;
// 目标总帧数：整本测量摊到约 16 帧。44 万段的长篇按每帧 600 段要跑 730 多帧（十几秒），
// 放大批次后同样的书约 16 帧就量完 —— 每帧重一点，但总时长少一个数量级。
const MEASURE_FRAMES = 16;
// 超过这个段落数才显示「正在排版」提示，小书瞬间就好
const MEASURE_HINT_MIN = 400;
/* 段落高度缓存：同一本书 + 同一排版 + 同一栏宽，第二次打开直接命中，不再跑测量。
 *
 * 以前用 JSON 小数数组存，40 万段就要 4MB 左右，既超 localStorage 配额、又被
 * HEIGHT_CACHE_MAX 拦下，于是「超长篇小说永远命中不了缓存，每次打开整本重排」。
 * 现在改成 Uint16 二进制 + base64：40 万段约 880KB（base64 后 1.2MB），
 * 长篇也存得下。第 0 位存栏宽，读取时校验栏宽是否还对得上。
 */
const HEIGHT_CACHE_PREFIX = 'folio:heights:';
const HEIGHT_CACHE_MAX = 1200000;
// 进程内缓存：同一会话里重开书连 localStorage 都不用读。
const heightMemCache = new Map();
const HEIGHT_MEM_MAX = 4;

/** 摘录统一压成单行：段落号才是锚点，字符偏移只用于显示。 */
const compactText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

/** 测量层用 innerHTML 拼节点，正文必须转义，否则 `<` 会被当成标签。 */
function escapeHtml(value) {
  return String(value).replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'));
}

// 测量层里的空行探针：和正文里完全同构，用来量出 `.vp-gap` 的真实高度
const GAP_PROBE = '<div class="measure-item"><div class="vp-gap"></div></div>';

/** 按书的大小决定每批测量多少段：小书 600，大书放大到 ~16 帧量完。 */
function measureChunkSize(count) {
  return Math.max(MEASURE_CHUNK, Math.min(MEASURE_CHUNK_MAX, Math.ceil(count / MEASURE_FRAMES)));
}

function heightStorageKey(key, width) {
  return `${HEIGHT_CACHE_PREFIX}${key}|${width}`;
}

function rememberHeights(storageKey, heights) {
  heightMemCache.set(storageKey, heights);
  if (heightMemCache.size > HEIGHT_MEM_MAX) {
    heightMemCache.delete(heightMemCache.keys().next().value);
  }
}

function encodeHeights(width, heights) {
  // [0] = 栏宽，[1..] = 每段高度。段落高度不可能超过 65535px，Uint16 够用。
  const bin = new Uint16Array(heights.length + 1);
  bin[0] = Math.max(0, Math.min(65535, Math.round(width)));
  for (let i = 0; i < heights.length; i += 1) {
    bin[i + 1] = Math.max(0, Math.min(65535, Math.round(heights[i] || 0)));
  }
  const bytes = new Uint8Array(bin.buffer);
  // 分块转字符：一次 apply 几十万个参数会直接爆调用栈
  const BLOCK = 0x8000;
  let raw = '';
  for (let i = 0; i < bytes.length; i += BLOCK) {
    raw += String.fromCharCode.apply(null, bytes.subarray(i, i + BLOCK));
  }
  return btoa(raw);
}

function decodeHeights(raw) {
  const text = atob(raw);
  const bin = new Uint16Array(text.length >> 1);
  const bytes = new Uint8Array(bin.buffer);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bin;
}

function loadHeights(key, width) {
  const storageKey = heightStorageKey(key, width);
  const mem = heightMemCache.get(storageKey);
  if (mem) return mem;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const bin = decodeHeights(raw);
    if (bin.length < 2) return null;
    // 栏宽差 1px 以内仍算同一套排版（缩放/滚动条会让宽度抖动 1px）
    if (Math.abs(bin[0] - width) > 1) return null;
    const heights = new Float64Array(bin.length - 1);
    for (let i = 0; i < heights.length; i += 1) heights[i] = bin[i + 1];
    rememberHeights(storageKey, heights);
    return heights;
  } catch {
    return null;
  }
}

/** 这本书 + 这套排版有没有缓存（只查键名，不解码上百万字节）。 */
function hasHeights(key) {
  const prefix = `${HEIGHT_CACHE_PREFIX}${key}|`;
  for (const storageKey of heightMemCache.keys()) {
    if (storageKey.startsWith(prefix)) return true;
  }
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const storageKey = window.localStorage.key(i);
      if (storageKey && storageKey.startsWith(prefix)) return true;
    }
  } catch {
    /* 拿不到 storage 就当作没有 */
  }
  return false;
}

/** 同一本书只留一份缓存：栏宽变了就丢掉旧栏宽那份，避免换几次窗口宽度把配额塞满。 */
function pruneHeights(key, keepStorageKey) {
  const prefix = `${HEIGHT_CACHE_PREFIX}${key}|`;
  try {
    const doomed = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const storageKey = window.localStorage.key(i);
      if (storageKey && storageKey.startsWith(prefix) && storageKey !== keepStorageKey) {
        doomed.push(storageKey);
      }
    }
    doomed.forEach((storageKey) => window.localStorage.removeItem(storageKey));
  } catch {
    /* 拿不到 storage 就算了 */
  }
}

function dropOtherHeights(keepKey) {
  try {
    const doomed = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(HEIGHT_CACHE_PREFIX) && key !== keepKey) {
        doomed.push(key);
      }
    }
    doomed.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    /* 拿不到 storage 就算了 */
  }
}

function saveHeights(key, width, heights) {
  if (!heights || heights.length > HEIGHT_CACHE_MAX) return;
  const storageKey = heightStorageKey(key, width);
  rememberHeights(storageKey, heights);
  const payload = encodeHeights(width, heights);
  try {
    pruneHeights(key, storageKey);
    window.localStorage.setItem(storageKey, payload);
  } catch {
    // 写不进去多半是配额满了：先把别本书的旧记录清掉再试一次，
    // 否则这本书永远命中不了缓存，每次打开都要重新排版。
    dropOtherHeights(storageKey);
    try {
      window.localStorage.setItem(storageKey, payload);
    } catch {
      /* 还是不行就算了，下次再测 */
    }
  }
}

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

  // 空行段落是固定高度（`.vp-gap`，随字号缩放），不必逐段进 DOM 实测；
  // 超长篇里空行常常占一半（44 万段的书里 22 万段是空行），跳过它们直接让测量量减半。
  // 固定高度取自测量层里那一个真实的空行探针，避免把 CSS 里的系数抄到 JS 里。
  const gapHeightRef = useRef(0);
  const textIndexes = useMemo(() => {
    const list = [];
    for (let i = 0; i < paragraphs.length; i += 1) {
      if (!paragraphs[i].blank) list.push(i);
    }
    return list;
  }, [paragraphs]);
  const measureChunk = useMemo(() => measureChunkSize(textIndexes.length), [textIndexes.length]);
  // 新建高度表时先把空行的固定高度填好，剩下的才靠 DOM 实测。
  const createHeightStore = () => {
    const store = new Float64Array(paragraphs.length);
    const gap = gapHeightRef.current;
    if (gap > 0) {
      for (let i = 0; i < paragraphs.length; i += 1) {
        if (paragraphs[i].blank) store[i] = gap;
      }
    }
    return store;
  };

  const [measuring, setMeasuring] = useState(true);
  const measureHeightsRef = useRef(null);
  const [measureFrom, setMeasureFrom] = useState(0);
  // 「正在排版」延迟出现：命中缓存时测量只占一帧，立刻显示反而像是每次都重排了一遍。
  const [measureHint, setMeasureHint] = useState(false);

  const resetMeasure = useCallback(() => {
    if (measureRafRef.current) {
      cancelAnimationFrame(measureRafRef.current);
      measureRafRef.current = 0;
    }
    measureHeightsRef.current = null;
    setMeasureFrom(0);
    setMeasuring(true);
  }, []);

  const virtual = useVirtualScroll({
    count: paragraphs.length,
    estimate,
    overscan: 6,
    // A width change rewraps every paragraph, so ask for a fresh full measure
    // instead of letting the scroller fall back to estimated heights.
    onResize: resetMeasure,
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
  const autoScrollRef = useRef(false);
  const overlaysOpenRef = useRef(false);
  const lastIndexRef = useRef(progress[book.id]?.paraIndex ?? 0);
  const mountedRef = useRef(true);
  const downScrollRef = useRef(0);
  const restoredRef = useRef(false);
  const firstSettingsRun = useRef(true);
  const measureRef = useRef(null);
  const measureRafRef = useRef(0);
  const searchTimer = useRef(null);

  // Everything that can change a paragraph's height. When this changes the
  // offscreen measurement pass re-runs and the whole offset table becomes exact.
  const typographyKey = `${book.id}|${settings.fontSize}|${settings.lineHeight}|${settings.pageWidth}|${settings.paragraphSpacing}|${settings.fontFamily}|${settings.userFont || ''}|${settings.indent}`;
  // 高度缓存键：排版 + 段落数（栏宽在读写时会再校验一次）
  const cacheKey = `${typographyKey}|${paragraphs.length}`;
  // 有没有现成的高度缓存：有的话首批只渲染一小撮做校验，不必把整批塞进 DOM 再丢弃。
  const hasCachedHeights = useMemo(() => hasHeights(cacheKey), [cacheKey]);

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
    // 宁可不存，也不能把错误位置写进 progress（下次打开会跳到前面）。
    if (measuring) return;
    const state = getScrollState();
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
        lastIndexRef.current = state.index;
        setScrollPercent(state.percent);
        setCurrentPara((prev) => (prev === state.index ? prev : state.index));
        setSelection(null);
        const ci = chapterIndexForPara(chapters, state.index);
        setChapterIndex((prev) => (prev === ci ? prev : ci));
        scheduleSave();
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

  // 重新测量（窗口宽度、字体加载完、换字号）会把整本书的段落高度换一套，
  // 文档总高随之变化；此时 scrollTop 不动就会「漂」到别的段落。
  // 做法：测量结束的那一帧，把当前段落重新对到视口顶部。
  const wasMeasuringRef = useRef(true);
  useEffect(() => {
    const wasMeasuring = wasMeasuringRef.current;
    wasMeasuringRef.current = measuring;
    if (measuring || !wasMeasuring) return undefined;
    const raf = requestAnimationFrame(() => {
      // 高度表换了一套，逻辑偏移也变了；按当前段落重新对位（内部会顺带换窗）。
      scrollToOffset(getOffset(lastIndexRef.current));
    });
    return () => cancelAnimationFrame(raf);
  }, [measuring, getOffset, scrollToOffset]);

  useEffect(() => {
    if (!resume || restoredRef.current || measuring) return undefined;
    const saved = progress[book.id];
    if (!saved || typeof saved.paraIndex !== 'number') {
      restoredRef.current = true;
      return undefined;
    }

    let outer = 0;
    let inner = 0;
    // The offset table is already exact (offscreen measurement pass), but the
    // scroll container still needs a frame before it accepts a scroll position.
    outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        restoredRef.current = true;
        animateScroll(getOffset(saved.paraIndex), 520);
        setCurrentPara(saved.paraIndex);
        setChapterIndex(chapterIndexForPara(chapters, saved.paraIndex));
        setScrollPercent(saved.percent ?? 0);
        setResumeChip({ key: Date.now(), percent: saved.percent ?? 0 });
        if (resumeTimer.current) clearTimeout(resumeTimer.current);
        resumeTimer.current = setTimeout(() => {
          if (mountedRef.current) setResumeChip(null);
        }, 2800);
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [animateScroll, book.id, chapters, getOffset, measuring, progress, resume]);

  /* --------------- exact heights via an offscreen pass -------------- */

  // Re-run the measurement pass whenever the typography (or the book) changes.
  useEffect(() => {
    if (firstSettingsRun.current) {
      firstSettingsRun.current = false;
      return;
    }
    measureHeightsRef.current = createHeightStore();
    setMeasureFrom(0);
    setMeasuring(true);
  }, [paragraphs.length, typographyKey]);

  useEffect(() => {
    let alive = true;
    // 只有用户装了自己字体（@font-face 异步加载）时才需要等字体回来重测；
    // 系统字体是同步可用的，再测一遍只会让「正在排版」多闪一次。
    if (!activeUserFont) return undefined;
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!alive) return;
        measureHeightsRef.current = createHeightStore();
        setMeasureFrom(0);
        setMeasuring(true);
      });
    }
    return () => {
      alive = false;
    };
  }, [activeUserFont, paragraphs.length]);

  useEffect(() => {
    if (!measuring || paragraphs.length <= MEASURE_HINT_MIN) {
      setMeasureHint(false);
      return undefined;
    }
    const timer = setTimeout(() => setMeasureHint(true), 240);
    return () => clearTimeout(timer);
  }, [measuring, paragraphs.length]);

  useLayoutEffect(() => {
    if (!measuring) return;
    const layer = measureRef.current;
    if (!layer) return;
    let store = measureHeightsRef.current;
    // 首帧时被动 effect 还没跑，这里补建一次，避免游标永远停在第一块
    if (!store || store.length !== paragraphs.length) {
      store = createHeightStore();
      measureHeightsRef.current = store;
    }
    const width = Math.round(scrollRef.current?.clientWidth || 0);
    const total = textIndexes.length;
    if (!total) {
      measureItems(new Float64Array(paragraphs.length));
      setMeasuring(false);
      return;
    }
    const from = Math.min(measureFrom, total);
    // 有缓存时第一批只渲染一小撮做校验，别为了验证把上千段塞进 DOM
    const batch = from === 0 && hasCachedHeights ? Math.min(measureChunk, 96) : measureChunk;
    const to = Math.min(total, from + batch);
    // 测量层直接拼 DOM，不走 React：上万段的 reconciliation 比布局本身还贵，
    // 而测量只关心「这个 p 有多高」，不需要事件、划线标记和动画。
    const parts = [];
    for (let k = from; k < to; k += 1) {
      const index = textIndexes[k];
      const top = index === 0 ? 'padding-top:14vh;' : '';
      const bottom = index === paragraphs.length - 1 ? 'padding-bottom:28vh;' : '';
      const style = top || bottom ? ` style="${top}${bottom}"` : '';
      const cls = headingSet.has(index) ? 'para chapter-title' : 'para';
      parts.push(
        `<div class="measure-item" data-index="${index}"${style}><p class="${cls}">${escapeHtml(
          paragraphs[index].text || ''
        )}</p></div>`
      );
    }
    layer.innerHTML = `${GAP_PROBE}${parts.join('')}`;
    // 空行探针：量一次 `.vp-gap` 的真实高度，按这个值填满所有空行段落
    const gapNode = layer.firstElementChild;
    const gapHeight = gapNode ? gapNode.offsetHeight : 0;
    if (gapHeight > 0 && gapHeight !== gapHeightRef.current) {
      gapHeightRef.current = gapHeight;
      for (let i = 0; i < store.length; i += 1) {
        if (paragraphs[i].blank) store[i] = gapHeight;
      }
    }
    const nodes = layer.children;
    // 分块测量：一次把上万段塞进 DOM 会卡住主线程，所以每批只测量 measureChunk 段。
    // 批大小随书的大小放大（见 measureChunkSize），空行段落不渲染、直接用固定高度填。
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const index = Number(node.dataset.index);
      if (Number.isFinite(index) && index >= 0 && index < store.length) {
        store[index] = node.offsetHeight;
      }
    }
    // 缓存只用来省时间，不能盲信：先量一批跟缓存比对，对不上（字体/宽度变了）就整本重测
    if (measureFrom === 0) {
      const cached = loadHeights(cacheKey, width);
      if (cached && cached.length === paragraphs.length) {
        let diff = 0;
        let counted = 0;
        for (let i = 0; i < nodes.length; i += 1) {
          const index = Number(nodes[i].dataset.index);
          if (Number.isFinite(index) && index >= 0 && cached[index] > 0) {
            diff += Math.abs(cached[index] - store[index]) / cached[index];
            counted += 1;
          }
        }
        if (counted === 0 || diff / counted <= 0.02) {
          const merged = Float64Array.from(cached);
          // 空行是固定高度，直接用这次探针量到的值，免得旧缓存里的空行高度过期
          const gap = gapHeightRef.current;
          if (gap > 0) {
            for (let i = 0; i < merged.length; i += 1) {
              if (paragraphs[i].blank) merged[i] = gap;
            }
          }
          for (let i = 0; i < nodes.length; i += 1) {
            const index = Number(nodes[i].dataset.index);
            if (Number.isFinite(index) && index >= 0 && index < merged.length) merged[index] = store[index];
          }
          measureItems(merged);
          measureHeightsRef.current = merged;
          setMeasuring(false);
          if (restoredRef.current) {
            requestAnimationFrame(() => scrollToIndex(lastIndexRef.current, { align: 'start' }));
          }
          return;
        }
      }
    }
    if (to < total) {
      // 用 rAF 推进游标：layout effect 里直接 setState 会让 React 在同一帧内同步重渲染，
      // 所有批次全挤进一个长任务里、首屏迟迟不出现；rAF 让浏览器先把这批画出来。
      measureRafRef.current = requestAnimationFrame(() => {
        measureRafRef.current = 0;
        setMeasureFrom(to);
      });
      return;
    }
    measureItems(store);
    saveHeights(cacheKey, width, store);
    setMeasuring(false);
    // Typography edits keep the reader on the same paragraph.
    if (restoredRef.current) {
      requestAnimationFrame(() => scrollToIndex(lastIndexRef.current, { align: 'start' }));
    }
  }, [measuring, measureFrom, measureItems, paragraphs.length, textIndexes.length, scrollToIndex]);

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
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      const h = handlersRef.current;

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
  const remainingText = useMemo(() => {
    // 云端书只装了当前窗口：窗口内剩余 + 按窗口均章长估算的后续章节
    if (cloud?.chapters?.length) {
      const inWindow = charCount * (1 - clamp(scrollPercent, 0, 100) / 100);
      const chaptersLeft = Math.max(0, cloud.chapters.length - windowBase - cloud.windowCount);
      const avgPerChapter = cloud.windowCount ? charCount / cloud.windowCount : 0;
      return estimateRemainingMinutes(inWindow + chaptersLeft * avgPerChapter);
    }
    const left = charCount * (1 - clamp(scrollPercent, 0, 100) / 100);
    return estimateRemainingMinutes(left);
  }, [charCount, cloud, scrollPercent, windowBase]);

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
  };

  // 云端书读完全书（没有更多章且当前窗口滚到底）才算读完
  const finished = cloud ? !cloud.hasMore && scrollPercent >= 99.6 : scrollPercent >= 99.6;
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
          <span className="reader-percent">{formatPercent(scrollPercent)}</span>
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

      <div className={`reader-hairline${hairline ? ' active' : ''}`} style={{ width: `${scrollPercent}%` }} />

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
          <span className="reader-measuring-pct">
            {Math.min(99, Math.round((measureFrom / Math.max(1, textIndexes.length)) * 100))}%
          </span>
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
              style={{ width: `${scrub ?? scrollPercent}%` }}
            />
            <i className="reader-progress-knob" style={{ left: `${scrub ?? scrollPercent}%` }} />
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
