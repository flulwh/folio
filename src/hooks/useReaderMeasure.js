import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  contentFingerprint,
  hasHeights,
  loadHeights,
  measureChunkSize,
  saveHeights,
  MEASURE_HINT_MIN,
} from '../utils/readerHeights.js';

/**
 * 正文排版测量：离屏量一遍每段高度，再把整张高度表交给虚拟滚动。
 *
 * 从 Reader.jsx 抽出来。这里只负责「怎么量、量到哪、缓存怎么读写」；
 * 滚动与偏移表仍归 useVirtualScroll，恢复位置的状态机留在 Reader 里
 * （它还要看跳章、存档与 resume），通过 requestRestore 回调衔接。
 */

/** 测量层用 innerHTML 拼节点，正文必须转义，否则 `<` 会被当成标签。 */
function escapeHtml(value) {
  return String(value).replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'));
}

// 测量层里的空行探针：和正文里完全同构，用来量出 `.vp-gap` 的真实高度
const GAP_PROBE = '<div class="measure-item"><div class="vp-gap"></div></div>';

/**
 * @param {object} options
 * @param {Array<{text: string, blank?: boolean}>} options.paragraphs 解析后的段落
 * @param {Set<number>} options.headingSet 标题段落索引，决定测量时的 class
 * @param {string} options.typographyKey 影响段落高度的全部排版参数
 * @param {object|null} options.activeUserFont 用户字体（异步加载，需等 fonts.ready 重测）
 * @param {React.RefObject<HTMLElement>} options.scrollRef 滚动容器（量栏宽）
 * @param {(heights: Float64Array) => void} options.measureItems 写入完整高度表
 * @param {boolean} options.resume 是否恢复上次位置
 * @param {(index: number) => void} options.requestRestore 只记账、不立即滚动的定位请求
 * @param {React.RefObject<object>} options.restoreRef 恢复位置状态机（读 settledOnce）
 * @param {React.RefObject<number>} options.lastIndexRef 当前段落索引
 */
export function useReaderMeasure({
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
}) {
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

  const measureRef = useRef(null);
  const measureRafRef = useRef(0);
  const measureHeightsRef = useRef(null);
  // 首帧的被动 effect 还没跑，layout effect 里不能重复重置；第一次跳过。
  const firstSettingsRun = useRef(true);

  const [measuring, setMeasuring] = useState(true);
  const [measureFrom, setMeasureFrom] = useState(0);
  // 「正在排版」延迟出现：命中缓存时测量只占一帧，立刻显示反而像是每次都重排了一遍。
  const [measureHint, setMeasureHint] = useState(false);

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

  const resetMeasure = useCallback(() => {
    if (measureRafRef.current) {
      cancelAnimationFrame(measureRafRef.current);
      measureRafRef.current = 0;
    }
    measureHeightsRef.current = null;
    setMeasureFrom(0);
    setMeasuring(true);
  }, []);

  // 卸载时取消排队中的测量帧，避免对已卸载组件 setState。
  useEffect(
    () => () => {
      if (measureRafRef.current) cancelAnimationFrame(measureRafRef.current);
    },
    []
  );

  // 高度缓存键：排版 + 段落数 + 正文指纹（栏宽在读写时会再校验一次）。
  // 书源重新抓取后段落数常常不变、内容却变了，必须让旧高度表失效。
  const cacheKey = useMemo(
    () => `${typographyKey}|${paragraphs.length}|${contentFingerprint(paragraphs)}`,
    [typographyKey, paragraphs]
  );
  // 有没有现成的高度缓存：有的话首批只渲染一小撮做校验，不必把整批塞进 DOM 再丢弃。
  const hasCachedHeights = useMemo(() => hasHeights(cacheKey), [cacheKey]);

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
          // 测量刚结束：只把目标段落记进状态机，真正的落位在 settled 后统一做。
          // resume 关闭时首次打开不恢复位置（与旧行为一致），重测才需要保位。
          if (resume || restoreRef.current.settledOnce) requestRestore(lastIndexRef.current);
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
    // 排版编辑后保持在原段落：同样只记账，落位交给状态机。
    if (resume || restoreRef.current.settledOnce) requestRestore(lastIndexRef.current);
  }, [measuring, measureFrom, measureItems, paragraphs.length, requestRestore, resume, textIndexes.length]);

  const measurePercent = Math.min(99, Math.round((measureFrom / Math.max(1, textIndexes.length)) * 100));

  return { measuring, measureHint, measureRef, measurePercent, resetMeasure };
}
