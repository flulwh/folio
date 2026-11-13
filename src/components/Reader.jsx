import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAppActions, useFonts, useProgress, useSettings } from '../store/AppStore.jsx';
import { useVirtualScroll } from '../hooks/useVirtualScroll.js';
import { fontStackFor } from '../hooks/useFontLoader.js';
import {
  AUTO_CHAPTER_REGEX,
  chapterIndexForPara,
  compileRegex,
  isHeading,
  parseBook,
} from '../utils/chapters.js';
import { clamp, estimateRemainingMinutes, formatPercent } from '../utils/format.js';
import TocPanel from './TocPanel.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import {
  IconArrowLeft,
  IconChevron,
  IconList,
  IconMaximize,
  IconPause,
  IconPlay,
  IconType,
} from './Icons.jsx';

const AUTO_SCROLL_SPEEDS = [15, 25, 40, 60]; // px per second
const DEFAULT_AUTO_SPEED = 1; // index into AUTO_SCROLL_SPEEDS
const UI_IDLE_MS = 2500;
// 排版测量每批处理多少段（越大越快、越容易掉帧）
const MEASURE_CHUNK = 600;
// 超过这个段落数才显示「正在排版」提示，小书瞬间就好
const MEASURE_HINT_MIN = 400;
// 段落高度缓存：同一本书 + 同一排版 + 同一栏宽，第二次打开直接命中，不再跑测量
const HEIGHT_CACHE_PREFIX = 'folio:heights:';
const HEIGHT_CACHE_MAX = 40000;

function loadHeights(key, width) {
  try {
    const raw = window.localStorage.getItem(HEIGHT_CACHE_PREFIX + key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || Math.abs(Number(data.w) - width) > 1) return null;
    if (!Array.isArray(data.h) || !data.h.length) return null;
    return Float64Array.from(data.h);
  } catch {
    return null;
  }
}

function saveHeights(key, width, heights) {
  if (!heights || heights.length > HEIGHT_CACHE_MAX) return;
  try {
    window.localStorage.setItem(
      HEIGHT_CACHE_PREFIX + key,
      JSON.stringify({ w: width, h: Array.from(heights, (value) => Math.round(value)) })
    );
  } catch {
    /* localStorage 满了就算了，下次再测 */
  }
}

export default function Reader({ book, onClose, cloud = null, resume = true }) {
  const settings = useSettings();
  const progress = useProgress();
  const fonts = useFonts();
  const { saveProgress, patchSettings, resetSettings, notify } = useAppActions();

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
    () => parseBook(book.content || '', settings.chapterRegex),
    [book.content, settings.chapterRegex]
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

  const headingSet = useMemo(() => {
    const set = new Set();
    if (book.cloudChapters?.length) {
      chapters.forEach((item) => set.add(item.paraIndex));
      return set;
    }
    let regex = compileRegex(settings.chapterRegex.trim() || AUTO_CHAPTER_REGEX);
    if (regex instanceof Error || (regex && regex.error)) regex = compileRegex(AUTO_CHAPTER_REGEX);
    paragraphs.forEach((p, i) => {
      if (!p.blank && isHeading(p.text, regex)) set.add(i);
    });
    return set;
  }, [book.cloudChapters, chapters, paragraphs, settings.chapterRegex]);

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

  const [measuring, setMeasuring] = useState(true);
  const measureHeightsRef = useRef(null);
  const [measureFrom, setMeasureFrom] = useState(0);

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
    itemRef,
    getOffset,
    getTotal,
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
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const smoothRef = useRef({ raf: 0 });
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

  // Everything that can change a paragraph's height. When this changes the
  // offscreen measurement pass re-runs and the whole offset table becomes exact.
  const typographyKey = `${book.id}|${settings.fontSize}|${settings.lineHeight}|${settings.pageWidth}|${settings.paragraphSpacing}|${settings.fontFamily}|${settings.userFont || ''}|${settings.indent}`;
  // 高度缓存键：排版 + 段落数（栏宽在读写时会再校验一次）
  const cacheKey = `${typographyKey}|${paragraphs.length}`;

  overlaysOpenRef.current = tocOpen || settingsOpen;

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
    if (tocOpen || settingsOpen) {
      setUiVisible(true);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    } else {
      wakeUI();
    }
  }, [tocOpen, settingsOpen, wakeUI]);

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
      if (smoothRef.current.raf) cancelAnimationFrame(smoothRef.current.raf);
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
  // The offset table is exact, so animating `scrollTop` between two known
  // positions can never desynchronise the virtual list.
  const stopSmooth = useCallback(() => {
    if (smoothRef.current.raf) cancelAnimationFrame(smoothRef.current.raf);
    smoothRef.current.raf = 0;
  }, []);

  const animateScroll = useCallback(
    (to, duration) => {
      const el = scrollRef.current;
      if (!el) return;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      const target = clamp(to, 0, max);
      const from = el.scrollTop;
      const distance = target - from;
      stopSmooth();
      if (Math.abs(distance) < 2) {
        el.scrollTop = target;
        return;
      }
      const ms = typeof duration === 'number' ? duration : clamp(Math.abs(distance) * 0.42, 240, 640);
      const started = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - started) / ms);
        const eased = 1 - (1 - t) ** 3;
        el.scrollTop = from + distance * eased;
        if (t < 1) {
          smoothRef.current.raf = requestAnimationFrame(step);
        } else {
          smoothRef.current.raf = 0;
          el.scrollTop = target;
        }
      };
      smoothRef.current.raf = requestAnimationFrame(step);
    },
    [scrollRef, stopSmooth]
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
        const el2 = scrollRef.current;
        if (cloud?.hasMore && !cloud.loading && el2) {
          const max = el2.scrollHeight - el2.clientHeight;
          if (max - el2.scrollTop < el2.clientHeight * 1.5) cloud.onLoadMore();
        }
      });
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [chapters, cloud, getScrollState, measuring, scheduleSave]);

  // 云端书追加章节后文档变长，但 scrollTop 没变、不会触发 scroll 事件，
  // 需要主动重算百分比与章节，否则会停在「已读完」。
  useEffect(() => {
    if (measuring) return;
    const state = getScrollState();
    setScrollPercent(state.percent);
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
      const el = scrollRef.current;
      if (!el) return;
      const target = getOffset(lastIndexRef.current);
      if (Math.abs(el.scrollTop - target) > 4) el.scrollTop = target;
    });
    return () => cancelAnimationFrame(raf);
  }, [measuring, getOffset, scrollRef]);

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
    measureHeightsRef.current = new Float64Array(paragraphs.length);
    setMeasureFrom(0);
    setMeasuring(true);
  }, [paragraphs.length, typographyKey]);

  useEffect(() => {
    let alive = true;
    // Web fonts change line heights; re-measure once they are in.
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!alive) return;
        measureHeightsRef.current = new Float64Array(paragraphs.length);
        setMeasureFrom(0);
        setMeasuring(true);
      });
    }
    return () => {
      alive = false;
    };
  }, [paragraphs.length]);

  useLayoutEffect(() => {
    if (!measuring) return;
    const layer = measureRef.current;
    if (!layer) return;
    let store = measureHeightsRef.current;
    // 首帧时被动 effect 还没跑，这里补建一次，避免游标永远停在第一块
    if (!store || store.length !== paragraphs.length) {
      store = new Float64Array(paragraphs.length);
      measureHeightsRef.current = store;
    }
    const width = Math.round(scrollRef.current?.clientWidth || 0);
    const nodes = layer.children;
    if (!nodes.length) return;
    // 分块测量：一次性把上万段落塞进 DOM 会让主线程卡住 1~2 秒（渲染 + 一次大重排），
    // 所以每批只渲染/测量 MEASURE_CHUNK 段，布局代价被摊到多帧里。
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
    const next = measureFrom + nodes.length;
    if (next < paragraphs.length) {
      // 用 rAF 推进游标：layout effect 里直接 setState 会让 React 在同一帧内同步重渲染，
      // 十批测量全挤进一个长任务里、首屏迟迟不出现；rAF 让浏览器先把这批画出来。
      measureRafRef.current = requestAnimationFrame(() => {
        measureRafRef.current = 0;
        setMeasureFrom(next);
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
  }, [measuring, measureFrom, measureItems, paragraphs.length, scrollToIndex]);

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

  /* --------------------------- auto scroll -------------------------- */

  useEffect(() => {
    autoScrollRef.current = autoScroll;
    if (!autoScroll) return undefined;
    const speed = AUTO_SCROLL_SPEEDS[autoSpeed] / 1000; // px per ms
    let raf = 0;
    let last = performance.now();
    // NOTE: Chromium drops sub-pixel scrollTop increments, so accumulating with
    // `el.scrollTop += speed * dt` never moves the page. Keep a float cursor and
    // assign it absolutely instead — the rounding then happens once per frame
    // against an ever-growing value, so motion survives.
    let cursor = scrollRef.current ? scrollRef.current.scrollTop : 0;
    const step = (now) => {
      if (!autoScrollRef.current) return;
      const el = scrollRef.current;
      if (!el) {
        raf = requestAnimationFrame(step);
        return;
      }
      const dt = Math.max(0, Math.min(96, now - last));
      last = now;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) {
        raf = requestAnimationFrame(step);
        return;
      }
      // the reader scrolled by itself (chapter jump / seek): follow it
      if (Math.abs(el.scrollTop - cursor) > 3) cursor = el.scrollTop;
      cursor = Math.min(max, cursor + speed * dt);
      el.scrollTop = cursor;
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
    },
    back: handleBack,
    prev: () => {
      setAutoScroll(false);
      goToChapter(globalChapter - 1);
    },
    next: () => {
      setAutoScroll(false);
      goToChapter(globalChapter + 1);
    },
    toggleToc: () => setTocOpen((v) => !v),
    toggleSettings: () => setSettingsOpen((v) => !v),
    toggleAuto: () => setAutoScroll((v) => !v),
    slower: () => setAutoSpeed((v) => Math.max(0, v - 1)),
    faster: () => setAutoSpeed((v) => Math.min(AUTO_SCROLL_SPEEDS.length - 1, v + 1)),
    fullscreen: toggleFullscreen,
    wake: wakeUI,
    pageDown: () => {
      setAutoScroll(false);
      const el = scrollRef.current;
      if (el) animateScroll(el.scrollTop + el.clientHeight * 0.88, 320);
    },
    pageUp: () => {
      setAutoScroll(false);
      const el = scrollRef.current;
      if (el) animateScroll(el.scrollTop - el.clientHeight * 0.88, 320);
    },
    lineDown: () => {
      setAutoScroll(false);
      const el = scrollRef.current;
      if (el) animateScroll(el.scrollTop + el.clientHeight * 0.3, 200);
    },
    lineUp: () => {
      setAutoScroll(false);
      const el = scrollRef.current;
      if (el) animateScroll(el.scrollTop - el.clientHeight * 0.3, 200);
    },
    home: () => {
      setAutoScroll(false);
      const el = scrollRef.current;
      if (el) animateScroll(0, 320);
    },
    end: () => {
      setAutoScroll(false);
      const el = scrollRef.current;
      if (el) animateScroll(el.scrollHeight - el.clientHeight, 320);
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
    isPanel: () => tocOpen || settingsOpen,
    isUiVisible: () => uiVisible,
  };

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      const h = handlersRef.current;

      switch (e.key) {
        case 'Escape':
          if (h.isPanel()) h.closePanels();
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
  const windowBase = cloud?.windowBase || 0;
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

  const items = [];
  for (let i = range.start; i < range.end && i < paragraphs.length; i += 1) {
    const para = paragraphs[i];
    if (!para) continue;
    const top = getOffset(i);
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
        {para.blank ? (
          <div className="vp-gap" />
        ) : (
          <p className={`para${headingSet.has(i) ? ' chapter-title' : ''}`}>{para.text}</p>
        )}
      </div>
    );
  }

  const handlePointerDown = () => {
    const el = scrollRef.current;
    if (el) downScrollRef.current = el.scrollTop;
  };

  const handleContentClick = (e) => {
    if (e.target.closest('.edge-nav')) return;
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
    el.scrollTop = ratio * max;
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
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
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
          <button className="icon-btn" onClick={() => setTocOpen(true)} title="目录 (T)">
            <IconList />
          </button>
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} title="阅读设置 (S)">
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
        onWheel={handleWheel}
      >
        <div
          className="reader-inner"
          ref={innerRef}
          data-virtual-inner
          style={measuring ? undefined : { height: total }}
        >
          {measuring ? (
            <div className="measure-list" ref={measureRef}>
              {paragraphs
                .slice(measureFrom, measureFrom + MEASURE_CHUNK)
                .map((para, offset) => {
                  const i = measureFrom + offset;
                  return (
                    <div
                      key={i}
                      className="measure-item"
                      data-index={i}
                      style={{
                        paddingTop: i === 0 ? '14vh' : undefined,
                        paddingBottom: i === paragraphs.length - 1 ? '28vh' : undefined,
                      }}
                    >
                      {para.blank ? (
                        <div className="vp-gap" />
                      ) : (
                        <p className={`para${headingSet.has(i) ? ' chapter-title' : ''}`}>{para.text}</p>
                      )}
                    </div>
                  );
                })}
            </div>
          ) : (
            items
          )}
        </div>
      </div>

      {measuring && paragraphs.length > MEASURE_HINT_MIN && (
        <div className="reader-measuring">
          <span className="reader-measuring-dot" />
          正在排版
          <span className="reader-measuring-pct">
            {Math.min(99, Math.round((measureFrom / Math.max(1, paragraphs.length)) * 100))}%
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
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
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
