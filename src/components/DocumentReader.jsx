import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useAppActions, useProgress, useSettings } from '../store/AppStore.jsx';
import { useMotionKit } from '../design/motion.js';
import { formatPercent } from '../utils/format.js';
import { IconArrowLeft, IconChevron, IconList, IconX } from './Icons.jsx';

/* ------------------------------------------------------------------ */
/*  EPUB / PDF 阅读器                                                   */
/*  ------------------------------------------------------------------ */
/*  EPUB 交给 foliate-js（分页、目录、CFI 定位都是它自己的实现），PDF 交给  */
/*  pdf.js 渲染成 canvas。这里只做外壳：读文件、进度回写、翻页与目录面板。  */
/*  进度沿用 progress.json 的旧字段（paraIndex / percent / chapterTitle …），*/
/*  额外多写 location（EPUB 的 CFI）或 page（PDF 页码），旧端读到会忽略。  */
/* ------------------------------------------------------------------ */

/** 目录拍平一层，缩进表达层级 */
function flattenToc(items, depth = 0, out = []) {
  for (const item of items || []) {
    if (item?.label) out.push({ label: item.label, href: item.href, depth });
    if (item?.subitems?.length) flattenToc(item.subitems, depth + 1, out);
  }
  return out;
}

/** 把当前主题的墨色/字体注入 EPUB 的 iframe（它自己的 CSS 会覆盖背景色） */
function applyEpubStyles(view, host, settings) {
  if (!view?.renderer?.setStyles || !host) return;
  const cs = getComputedStyle(host);
  const text = cs.getPropertyValue('--text').trim() || '#1c1815';
  const accent = cs.getPropertyValue('--accent').trim() || '#b1402c';
  const serif = cs.getPropertyValue('--font-serif').trim() || 'serif';
  const size = Number(settings.fontSize) || 18;
  const lineHeight = Number(settings.lineHeight) || 1.8;
  view.renderer.setStyles(`
    html, body { background: transparent !important; }
    body { color: ${text} !important; font-family: ${serif}; font-size: ${size}px !important; line-height: ${lineHeight}; }
    a { color: ${accent} !important; }
    img, svg, video { max-width: 100% !important; height: auto !important; }
    ::selection { background: ${accent}33; }
  `);
}

/**
 * 把主进程的分段读取伪装成 Blob：foliate 的 zip.js 只用到 `size`、
 * `slice(start, end).arrayBuffer()`（偶尔整份 `arrayBuffer()`）。
 * 这样 EPUB 的中央目录与单章资源是现读的，不用把整本先塞进渲染层内存。
 */
function makeRangeBackedFile({ filePath, name, type, size, readRange }) {
  const clamp = (value, fallback) => {
    const num = Math.floor(Number(value));
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(size, num));
  };
  const readSlice = async (start, end) => {
    const from = clamp(start, 0);
    const to = Math.max(from, clamp(end, size));
    if (to <= from) return new ArrayBuffer(0);
    const res = await readRange(filePath, from, to - from);
    if (res?.error) throw new Error(res.error);
    const data = res.data instanceof Uint8Array ? res.data : new Uint8Array(res.data || []);
    // 主进程截断时宁可报错，也不能把半份 zip 数据交给解包器
    if (data.byteLength !== to - from) throw new Error('读取电子书内容失败，文件可能已被移动或损坏');
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  };
  return {
    name,
    type,
    size,
    slice: (start, end) => ({ arrayBuffer: () => readSlice(start, end) }),
    arrayBuffer: () => readSlice(0, size),
  };
}

export default function DocumentReader({ book, onClose }) {
  const { saveProgress, statBookBinary, readBookRange } = useAppActions();
  const progress = useProgress();
  const settings = useSettings();
  const kit = useMotionKit();

  const isEpub = book.format === 'epub';
  // 只在挂载时取一次存档：之后的 progress 变化来自本组件自己的回写
  const savedRef = useRef(progress[book.id]);
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const viewRef = useRef(null);
  const pdfRef = useRef(null);
  const saveTimer = useRef(null);
  const lastPatch = useRef(null);
  const idleTimer = useRef(null);

  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [percent, setPercent] = useState(() => Number(savedRef.current?.percent) || 0);
  const [chapterTitle, setChapterTitle] = useState('');
  const [toc, setToc] = useState([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [pageNum, setPageNum] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [uiVisible, setUiVisible] = useState(true);
  const [resizeTick, setResizeTick] = useState(0);

  /* ------------------------------ 进度回写 ------------------------------ */
  const writeProgress = useCallback(
    (patch) => {
      lastPatch.current = patch;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveProgress(book.id, { ...patch, updatedAt: Date.now() });
      }, 700);
    },
    [book.id, saveProgress]
  );

  // 关书时把还没落盘的进度立即写掉，别等 700ms 的防抖
  const flushProgress = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const patch = lastPatch.current;
    if (patch) saveProgress(book.id, { ...patch, updatedAt: Date.now() });
  }, [book.id, saveProgress]);

  const onEpubRelocate = useCallback(
    (event) => {
      const detail = event.detail || {};
      const raw = typeof detail.fraction === 'number' && Number.isFinite(detail.fraction)
        ? detail.fraction
        : null;
      const section = detail.section;
      const derived = section && Number(section.total) > 0
        ? Number(section.current) / Number(section.total)
        : null;
      // foliate 对固定版式（pre-paginated）上报的 fraction 恒为 0，此时用章节位置兜底，
      // 否则每翻一页都会把进度写成 0
      const fraction = raw == null ? derived : raw === 0 && derived ? derived : raw;
      if (fraction == null) return; // 拿不到位置就保留旧进度，别写一个假的 0
      const title = detail.tocItem?.label || '';
      const value = Math.min(100, Math.max(0, fraction * 100));
      setPercent(value);
      setChapterTitle(title);
      writeProgress({
        paraIndex: 0,
        percent: value,
        chapterIndex: detail.section?.current ?? 0,
        chapterTitle: title,
        location: detail.cfi || '',
      });
    },
    [writeProgress]
  );

  /* ------------------------------ EPUB ------------------------------ */
  useEffect(() => {
    if (!isEpub) return undefined;
    let cancelled = false;
    let view = null;
    setStatus('loading');
    setError('');
    (async () => {
      try {
        const info = await statBookBinary(book.filePath);
        if (info?.error) throw new Error(info.error);
        const size = Number(info?.size) || 0;
        if (!size) throw new Error('这本书是空的');
        if (cancelled || !stageRef.current) return;
        // view.js 负责注册 <foliate-view>，并自带 zip.js 解包
        await import('foliate-js/view.js');
        if (cancelled || !stageRef.current) return;
        // 用分段读取替身代替 File：zip.js 只按需读中央目录与当前章节
        const file = makeRangeBackedFile({
          filePath: book.filePath,
          name: `${book.name || 'book'}.epub`,
          type: 'application/epub+zip',
          size,
          readRange: readBookRange,
        });
        view = document.createElement('foliate-view');
        view.setAttribute('flow', 'paginated');
        view.setAttribute('gap', '6%');
        view.setAttribute('margin', '0');
        view.setAttribute('max-inline-size', '820px');
        view.setAttribute('max-column-count', window.innerWidth > 1080 ? '2' : '1');
        view.className = 'doc-epub';
        view.addEventListener('relocate', onEpubRelocate);
        stageRef.current.replaceChildren(view);
        viewRef.current = view;
        await view.open(file);
        if (cancelled) return;
        setToc(flattenToc(view.book?.toc || []));
        applyEpubStyles(view, rootRef.current, settings);
        const location = savedRef.current?.location;
        await view.init(location ? { lastLocation: location } : {});
        if (cancelled) return;
        // 进度可能来自安卓端：那里只有全书百分比、没有 CFI，按比例落到最接近的位置
        const savedPercent = Number(savedRef.current?.percent) || 0;
        if (!location && savedPercent > 0) {
          try {
            await view.goToFraction(Math.min(100, savedPercent) / 100);
          } catch {
            /* 落位失败就从开头读，不影响打开 */
          }
        }
        if (cancelled) return;
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err.message || '这本 EPUB 打不开');
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      try {
        view?.close();
      } catch {
        /* 元素已被移除 */
      }
      viewRef.current = null;
    };
    // settings 只影响样式，由下面的样式 effect 单独处理，避免换主题时重载整本书
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.filePath, book.name, book.id, isEpub, onEpubRelocate, statBookBinary, readBookRange]);

  /* ------------------------------ PDF ------------------------------ */
  useEffect(() => {
    if (isEpub) return undefined;
    let cancelled = false;
    let doc = null;
    let task = null;
    let transport = null;
    setStatus('loading');
    setError('');
    (async () => {
      try {
        const info = await statBookBinary(book.filePath);
        if (info?.error) throw new Error(info.error);
        const size = Number(info?.size) || 0;
        if (!size) throw new Error('这本书是空的');
        if (cancelled) return;
        const pdfjs = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        // 只把 pdf.js 要的那几段（xref、对象流、当前页资源）现读过来，
        // 整本 PDF 不进主进程堆，也不整份穿过 IPC。
        transport = new pdfjs.PDFDataRangeTransport(size, null);
        transport.requestDataRange = (begin, end) => {
          readBookRange(book.filePath, begin, end - begin)
            .then((res) => {
              if (cancelled) return;
              if (res?.error) {
                transport.abort();
                return;
              }
              const data = res.data instanceof Uint8Array ? res.data : new Uint8Array(res.data || []);
              transport.onDataRange(begin, data);
            })
            .catch(() => {
              if (!cancelled) transport.abort();
            });
        };
        task = pdfjs.getDocument({
          range: transport,
          rangeChunkSize: 256 * 1024,
          disableStream: true,
          disableAutoFetch: true,
        });
        doc = await task.promise;
        if (cancelled) return;
        pdfRef.current = doc;
        setPageCount(doc.numPages);
        const saved = savedRef.current;
        // 百分比是 0 基：第 1 页 0%，最后一页 100%
        const fromPercent = Math.round(
          ((Number(saved?.percent) || 0) / 100) * Math.max(0, doc.numPages - 1)
        ) + 1;
        const start = Number(saved?.page) || fromPercent || 1;
        setPageNum(Math.min(doc.numPages, Math.max(1, start)));
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err.message || '这个 PDF 打不开');
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      try {
        transport?.abort();
        // PDFDocumentProxy 没有 destroy；销毁 worker 走 loadingTask
        task?.destroy?.();
      } catch {
        /* 已销毁 */
      }
      if (pdfRef.current === doc) pdfRef.current = null;
    };
  }, [book.filePath, book.id, isEpub, statBookBinary, readBookRange]);

  /* ------------------------------ PDF 单页渲染 ------------------------------ */
  useEffect(() => {
    if (isEpub || status !== 'ready') return undefined;
    const doc = pdfRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas) return undefined;
    let cancelled = false;
    let task = null;
    (async () => {
      try {
        const page = await doc.getPage(pageNum);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const stage = stageRef.current;
        const availW = Math.max(240, (stage?.clientWidth || 900) - 64);
        const availH = Math.max(240, (stage?.clientHeight || 900) - 32);
        const scale = Math.max(0.15, Math.min(availW / base.width, availH / base.height));
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        const viewport = page.getViewport({ scale: scale * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        const context = canvas.getContext('2d', { alpha: false });
        task = page.render({ canvasContext: context, viewport });
        await task.promise;
      } catch (err) {
        // 翻页太快会取消上一张的渲染，这类异常不用提示
        if (!cancelled && err?.name !== 'RenderingCancelledException') {
          setError(err.message || '这一页渲染失败');
        }
      }
    })();
    return () => {
      cancelled = true;
      try {
        task?.cancel?.();
      } catch {
        /* 渲染已完成 */
      }
    };
  }, [isEpub, status, pageNum, resizeTick]);

  /* ------------------------------ 进度显示 / 回写（PDF） ------------------------------ */
  useEffect(() => {
    if (isEpub || !pageCount) return;
    // 0 基百分比：第 1 页 0%，最后一页 100%，与进度条的阅读直觉一致
    const value = Math.min(100, ((pageNum - 1) / Math.max(1, pageCount - 1)) * 100);
    setPercent(value);
    const title = `第 ${pageNum} / ${pageCount} 页`;
    setChapterTitle(title);
    writeProgress({
      paraIndex: pageNum - 1,
      percent: value,
      chapterIndex: pageNum - 1,
      chapterTitle: title,
      page: pageNum,
    });
  }, [isEpub, pageNum, pageCount, writeProgress]);

  /* ------------------------------ 主题 / 正文字号变化 ------------------------------ */
  useEffect(() => {
    if (!isEpub || status !== 'ready') return;
    applyEpubStyles(viewRef.current, rootRef.current, settings);
  }, [isEpub, status, settings]);

  /* ------------------------------ 窗口尺寸 ------------------------------ */
  useEffect(() => {
    let timer = 0;
    const onResize = () => {
      // 拖拽窗口时每个像素都会触发 resize：150ms 合并一次，避免反复重排/重绘 PDF
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(() => {
        const view = viewRef.current;
        if (view) view.setAttribute('max-column-count', window.innerWidth > 1080 ? '2' : '1');
        setResizeTick((tick) => tick + 1);
      }, 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (timer) clearTimeout(timer);
    };
  }, []);

  /* 直接关窗口时组件来不及 handleClose，把 700ms 防抖里的进度立刻落盘 */
  useEffect(() => {
    const onHide = () => flushProgress();
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
    };
  }, [flushProgress]);

  /* ------------------------------ 交互 ------------------------------ */
  const wake = useCallback(() => {
    setUiVisible(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setUiVisible(false), 2600);
  }, []);

  useEffect(() => {
    wake();
    window.addEventListener('mousemove', wake);
    return () => {
      window.removeEventListener('mousemove', wake);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [wake]);

  const goPrev = useCallback(() => {
    if (isEpub) viewRef.current?.prev();
    else setPageNum((n) => Math.max(1, n - 1));
  }, [isEpub]);

  const goNext = useCallback(() => {
    if (isEpub) viewRef.current?.next();
    else setPageNum((n) => Math.min(pageCount || n, n + 1));
  }, [isEpub, pageCount]);

  const handleClose = useCallback(() => {
    flushProgress();
    onClose();
  }, [flushProgress, onClose]);

  useEffect(() => {
    const onKey = (event) => {
      const tag = (event.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || event.target?.isContentEditable) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (tocOpen) setTocOpen(false);
        else handleClose();
        return;
      }
      if (tocOpen) return;
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        goPrev();
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        goNext();
      } else if ((event.key === 't' || event.key === 'T') && toc.length) {
        setTocOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tocOpen, toc.length, goPrev, goNext, handleClose]);

  return (
    <div className="doc-reader" ref={rootRef} data-format={book.format}>
      <motion.header
        className="reader-header"
        animate={{ y: uiVisible ? 0 : -84, opacity: uiVisible ? 1 : 0 }}
        transition={kit.chrome}
        style={{ pointerEvents: uiVisible ? 'auto' : 'none' }}
      >
        <div className="reader-head-left">
          <button className="icon-btn" onClick={handleClose} title="返回书架 (Esc)">
            <IconArrowLeft />
          </button>
          <div className="reader-head-titles">
            <span className="reader-book" title={book.name}>
              {book.name}
            </span>
            <span className="reader-chapter">
              {chapterTitle || (isEpub ? 'EPUB' : 'PDF')}
            </span>
          </div>
        </div>
        <div className="reader-head-right">
          <span className="reader-percent">{formatPercent(percent)}</span>
          {isEpub && toc.length > 0 && (
            <button
              className={`icon-btn${tocOpen ? ' active' : ''}`}
              onClick={() => setTocOpen((open) => !open)}
              title="目录 (T)"
            >
              <IconList />
            </button>
          )}
        </div>
      </motion.header>

      <div className="reader-hairline active" style={{ width: `${percent}%` }} />

      <div
        className={`doc-stage${isEpub ? ' doc-epub-stage' : ' doc-pdf-stage'}`}
        ref={stageRef}
      >
        {!isEpub && status === 'ready' && <canvas className="doc-pdf-page" ref={canvasRef} />}
      </div>

      {status !== 'ready' && (
        <div className="doc-overlay">
          {status === 'loading' ? (
            <div className="doc-hint">
              <span className="reader-measuring-dot" />
              正在打开 {isEpub ? 'EPUB' : 'PDF'}…
            </div>
          ) : (
            <div className="doc-error">
              <p>{error || '这本电子书打不开'}</p>
              <button className="btn ghost" onClick={handleClose}>
                返回书架
              </button>
            </div>
          )}
        </div>
      )}

      {status === 'ready' && (
        <>
          <button
            className="doc-edge prev"
            onClick={goPrev}
            disabled={!isEpub && pageNum <= 1}
            title="上一页 (←)"
          >
            <IconChevron size={18} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <button
            className="doc-edge next"
            onClick={goNext}
            disabled={!isEpub && pageNum >= pageCount}
            title="下一页 (→)"
          >
            <IconChevron size={18} />
          </button>
        </>
      )}

      {tocOpen && (
        <motion.aside
          className="doc-toc"
          role="dialog"
          aria-label="目录"
          initial={{ x: -28, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={kit.chrome}
        >
          <div className="doc-toc-head">
            <span>目录</span>
            <button className="icon-btn" onClick={() => setTocOpen(false)} title="关闭 (Esc)">
              <IconX size={16} />
            </button>
          </div>
          <ul className="doc-toc-list">
            {toc.map((item, index) => (
              <li key={`${item.href}-${index}`}>
                <button
                  className="doc-toc-item"
                  style={{ paddingLeft: 14 + item.depth * 14 }}
                  onClick={() => {
                    setTocOpen(false);
                    viewRef.current?.goTo(item.href);
                  }}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </motion.aside>
      )}
    </div>
  );
}
