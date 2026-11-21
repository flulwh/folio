import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { dataApi, useAppActions, useProgress, useSettings } from '../store/AppStore.jsx';
import {
  IconArrowLeft,
  IconChevron,
  IconList,
  IconMaximize,
  IconX,
  IconBook,
} from './Icons.jsx';

/**
 * 漫画阅读器（图片书）。
 * 数据：目录来自云端书源；每一章先取图片地址列表，再把图片下载进本地缓存，
 * 通过 folio-cover:// 协议渲染，断网也能看已经打开过的章节。
 */

// 放大层缩放范围沿用旧实现：手势（捏合/双击）最多 4x，键盘与工具按钮最多 3x。
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_PRESET_MAX = 3;
const ZOOM_DOUBLE_CLICK = 2.5;

export default function ComicReader({ book, onClose }) {
  const progress = useProgress();
  const settings = useSettings();
  const { saveProgress, notify, patchSettings } = useAppActions();
  const saved = progress[book.id] || {};
  const savedIndex = Math.max(0, Number(saved.chapter ?? saved.windowBase ?? 0) || 0);
  // 本地 CBZ：单话，页序来自压缩包；云端漫画仍按章节走
  const localComic = book.format === 'cbz';

  const [toc, setToc] = useState([]);
  const [index, setIndex] = useState(savedIndex);
  const [images, setImages] = useState([]);
  const [locals, setLocals] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uiVisible, setUiVisible] = useState(true);
  const [tocOpen, setTocOpen] = useState(false);
  const [zoomed, setZoomed] = useState(null);
  const [page, setPage] = useState(0);
  // 放大层：缩放/平移交给 react-zoom-pan-pinch，这里只留展示用的比例读数
  const [zoomScale, setZoomScale] = useState(1);
  const [showTop, setShowTop] = useState(false);

  const fit = settings.comicFit === 'original' ? 'original' : 'width';
  const scrollRef = useRef(null);
  const aliveRef = useRef(true);
  const zoomApiRef = useRef(null);
  const zoomScaleRef = useRef(1);
  const movedRef = useRef(false);
  // 单击关闭与双击复位共用一次点击：把关闭推迟一帧，等 dblclick 有机会取消它
  const closeTimerRef = useRef(0);
  const idleTimer = useRef(0);
  const listCache = useRef(new Map());
  // 当前章节的图片预取任务 key；warmRef 是下一章预热任务，切章时一起取消
  const jobRef = useRef('');
  const warmRef = useRef(new Set());
  // 本地漫画续读：先记住进度百分比，拿到总页数后再换算成页号
  const resumePercentRef = useRef(Math.max(0, Number(saved.percent) || 0));
  const resumePageRef = useRef(0);
  const restoredRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  /* 主进程边下边推：哪张先好先显示，弱网也不必等整章 */
  useEffect(() => {
    const off = dataApi.onImageProgress?.((payload) => {
      if (!payload?.key || payload.key !== jobRef.current || !payload.url) return;
      setLocals((prev) => (prev[payload.id] ? prev : { ...prev, [payload.id]: payload.url }));
    });
    return () => {
      off?.();
      if (jobRef.current) dataApi.cancelImagePrefetch?.(jobRef.current);
      for (const key of warmRef.current) dataApi.cancelImagePrefetch?.(key);
    };
  }, []);

  /* ------------------------------ 本地漫画 ------------------------------ */
  useEffect(() => {
    if (!localComic) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await dataApi.localComicPages(book.id);
        if (cancelled) return;
        if (!res?.ok || !res.total) throw new Error(res?.error || '这本漫画没有可读的页面');
        const urls = Array.from(
          { length: res.total },
          (_, i) => `folio-comic://page/${encodeURIComponent(book.id)}/${i}`
        );
        const start = resumePercentRef.current
          ? Math.min(res.total - 1, Math.floor((resumePercentRef.current / 100) * res.total))
          : 0;
        resumePageRef.current = Math.max(0, start);
        setToc([{ index: 0, title: book.name || '全一话', url: '' }]);
        setIndex(0);
        setImages(urls);
        setLocals(Object.fromEntries(urls.map((url, i) => [String(i), url])));
        setPage(Math.max(0, start));
      } catch (err) {
        if (!cancelled) setError(err.message || '这本漫画读不出来');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [book.id, book.name, localComic]);

  /* 续读：进度里只有百分比，等页面节点渲染后滚到对应页 */
  useEffect(() => {
    if (!localComic || !images.length || restoredRef.current) return;
    restoredRef.current = true;
    const target = resumePageRef.current;
    if (!target) return;
    requestAnimationFrame(() => {
      const node = scrollRef.current?.querySelectorAll('.comic-page')?.[target];
      node?.scrollIntoView({ block: 'start' });
    });
  }, [localComic, images.length]);

  /* ------------------------------ 加载目录 ------------------------------ */
  useEffect(() => {
    if (localComic) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await dataApi.fetchCloudToc({
          sourceId: book.sourceId,
          bookUrl: book.bookUrl,
          proxy: settings.proxy || '',
          book: { name: book.name, author: book.author, bookUrl: book.bookUrl, raw: book.raw },
        });
        if (cancelled) return;
        if (res?.error) throw new Error(res.error);
        const chapters = res?.chapters || [];
        if (!chapters.length) throw new Error('这本没有目录');
        setToc(chapters);
        setIndex((prev) => Math.min(Math.max(0, prev), chapters.length - 1));
      } catch (err) {
        if (!cancelled) setError(err.message || '目录加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [book.id, book.bookUrl, book.sourceId, book.name, book.author, book.raw, settings.proxy, localComic]);

  /* ------------------------------ 加载图片 ------------------------------ */
  const loadChapter = useCallback(
    async (target) => {
      const chapter = toc[target];
      if (!chapter) return null;
      const key = chapter.url || String(target);
      if (listCache.current.has(key)) return listCache.current.get(key);
      const res = await dataApi.fetchChapterImages({
        sourceId: book.sourceId,
        bookUrl: book.bookUrl,
        index: target,
        url: chapter.url,
        chapter,
        proxy: settings.proxy || '',
      });
      if (res?.error) throw new Error(res.error);
      const payload = { urls: res?.urls || [], referer: res?.referer || chapter.url };
      listCache.current.set(key, payload);
      return payload;
    },
    [book.bookUrl, book.sourceId, settings.proxy, toc]
  );

  useEffect(() => {
    if (localComic || !toc.length) return undefined;
    let cancelled = false;
    const scroll = scrollRef.current;
    const jobKey = `comic-${book.id}-${index}`;
    const previousJob = jobRef.current;
    jobRef.current = jobKey;
    // 上一章/预热的下载任务先掐掉，把带宽让给当前章
    for (const key of warmRef.current) dataApi.cancelImagePrefetch?.(key);
    warmRef.current.clear();
    if (previousJob && previousJob !== jobKey) dataApi.cancelImagePrefetch?.(previousJob);
    setLoading(true);
    setError(null);
    setImages([]);
    setLocals({});
    if (scroll) scroll.scrollTop = 0;

    (async () => {
      try {
        const payload = await loadChapter(index);
        if (cancelled || !payload) return;
        setImages(payload.urls);
        // 清单到手立刻渲染占位页，图片边下边出
        setLoading(false);

        const items = payload.urls.map((url, i) => ({ id: String(i), url, referer: payload.referer }));
        if (dataApi.prefetchImages) {
          dataApi
            .prefetchImages({ key: jobKey, items, referer: payload.referer })
            .then((res) => {
              if (cancelled || !res?.urls) return;
              setLocals((prev) => {
                const merged = { ...res.urls, ...prev };
                for (const [k, v] of Object.entries(res.urls)) if (v) merged[k] = v;
                return merged;
              });
            })
            .catch(() => {});
        } else {
          const res = await dataApi.cacheCovers({ items });
          if (cancelled) return;
          setLocals(res?.covers || {});
        }

        // 下一章：清单 + 前 12 页预热，翻页几乎零等待
        if (index + 1 < toc.length) {
          loadChapter(index + 1)
            .then((next) => {
              if (cancelled || !next?.urls?.length) return;
              const warmKey = `warm-${book.id}-${index + 1}`;
              warmRef.current.add(warmKey);
              dataApi.prefetchImages?.({
                key: warmKey,
                items: next.urls.slice(0, 12).map((url, i) => ({ id: String(i), url, referer: next.referer })),
                referer: next.referer,
              });
            })
            .catch(() => {});
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || '这一章没取到图片');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [book.id, index, toc, loadChapter, localComic]);

  /* ------------------------------ 进度保存 ------------------------------ */
  useEffect(() => {
    if (!toc.length || localComic) return;
    const chapter = toc[index];
    saveProgress(book.id, {
      chapter: index,
      windowBase: index,
      paraIndex: index,
      percent: Math.min(100, ((index + 1) / toc.length) * 100),
      chapterIndex: index,
      chapterTitle: chapter?.title || '',
      updatedAt: Date.now(),
    });
  }, [book.id, index, toc, saveProgress, localComic]);

  /* 本地漫画按「页 / 总页数」记百分比，双端只对齐到话级 */
  useEffect(() => {
    if (!localComic || !images.length) return;
    saveProgress(book.id, {
      chapter: 0,
      windowBase: 0,
      paraIndex: 0,
      percent: Math.min(100, ((page + 1) / images.length) * 100),
      chapterIndex: 0,
      chapterTitle: toc[0]?.title || '',
      updatedAt: Date.now(),
    });
  }, [book.id, localComic, images.length, page, toc, saveProgress]);

  /* ------------------------------ 交互 ------------------------------ */
  const wake = useCallback(() => {
    setUiVisible(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      if (aliveRef.current) setUiVisible(false);
    }, 2600);
  }, []);

  useEffect(() => {
    wake();
    const onMove = () => wake();
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [wake]);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowTop(el.scrollTop > el.clientHeight * 1.1);
    const pages = el.querySelectorAll('.comic-page');
    if (!pages.length) return;
    const top = el.getBoundingClientRect().top + 90;
    let current = 0;
    for (let i = 0; i < pages.length; i += 1) {
      if (pages[i].getBoundingClientRect().top <= top) current = i;
      else break;
    }
    setPage(current);
  }, []);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const toggleFit = useCallback(() => {
    patchSettings({ comicFit: fit === 'width' ? 'original' : 'width' });
    notify(fit === 'width' ? '已切换为原始尺寸，可左右查看细节' : '已切换为适应宽度', 'info', {
      duration: 1800,
    });
  }, [fit, notify, patchSettings]);

  /* ------------------------------ 放大层 ------------------------------ */
  /** 比例读数：只在百分比变化时 setState，平移时不会反复渲染。 */
  const syncZoomScale = useCallback((scale) => {
    zoomScaleRef.current = scale;
    const rounded = Math.round(scale * 100) / 100;
    setZoomScale((prev) => (prev === rounded ? prev : rounded));
  }, []);

  useEffect(() => {
    if (!zoomed) return;
    zoomScaleRef.current = 1;
    setZoomScale(1);
    movedRef.current = false;
  }, [zoomed]);

  /** 工具条 / 键盘用：缩放到指定倍率并居中。 */
  const applyZoom = useCallback((next) => {
    const api = zoomApiRef.current;
    if (!api) return;
    const scale = Math.max(ZOOM_MIN, Math.min(ZOOM_PRESET_MAX, next));
    if (scale <= ZOOM_MIN) {
      api.resetTransform(200);
      return;
    }
    api.centerView(scale, 160);
  }, []);

  const zoomIn = useCallback(() => {
    applyZoom(Math.round((zoomScaleRef.current + 0.25) * 100) / 100);
  }, [applyZoom]);

  const zoomOut = useCallback(() => {
    applyZoom(Math.round((zoomScaleRef.current - 0.25) * 100) / 100);
  }, [applyZoom]);

  const zoomReset = useCallback(() => {
    zoomApiRef.current?.resetTransform(200);
  }, []);

  /** 双击：以点击点为中心放大到 2.5 倍，再点收回（Photos 的定点缩放）。 */
  const onZoomDoubleClick = (event) => {
    event.stopPropagation();
    // 第一次 click 已经排了「关闭」，双击要把它取消
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = 0;
    }
    const api = zoomApiRef.current;
    if (!api) return;
    if (zoomScaleRef.current > 1) {
      api.resetTransform(220);
      return;
    }
    api.zoomToPoint(ZOOM_DOUBLE_CLICK, event.clientX, event.clientY, 220);
  };

  /** 点击背景关闭；拖动/捏合后的那一下 click 不应该关掉放大层。 */
  const onZoomBackdropClick = () => {
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    if (closeTimerRef.current) return;
    // 等一小会儿看是不是双击：双击会取消这次关闭（保留双击复位）。
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = 0;
      setZoomed(null);
    }, 250);
  };

  const goTo = useCallback(
    (target) => {
      setTocOpen(false);
      setIndex((prev) => {
        const next = Math.min(Math.max(0, target), Math.max(0, toc.length - 1));
        return next === prev ? prev : next;
      });
    },
    [toc.length]
  );

  useEffect(() => {
    const onKey = (event) => {
      const tag = (event.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (event.key === 'Escape') {
        if (zoomed) setZoomed(null);
        else if (tocOpen) setTocOpen(false);
        else if (uiVisible) setUiVisible(false);
        else onClose();
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        goTo(index + 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        goTo(index - 1);
      } else if (event.key === 't' || event.key === 'T') {
        setTocOpen((v) => !v);
      } else if (event.key === 'Home') {
        event.preventDefault();
        scrollToTop();
      } else if (event.key === 'End') {
        event.preventDefault();
        const el = scrollRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } else if (zoomed && (event.key === '+' || event.key === '=')) {
        event.preventDefault();
        zoomIn();
      } else if (zoomed && (event.key === '-' || event.key === '_')) {
        event.preventDefault();
        zoomOut();
      } else if (zoomed && event.key === '0') {
        event.preventDefault();
        zoomReset();
      } else if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        toggleFit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, index, onClose, scrollToTop, tocOpen, toggleFit, uiVisible, zoomed, zoomIn, zoomOut, zoomReset]);

  const chapter = toc[index];
  const total = toc.length;
  const progressPercent = localComic
    ? Math.min(100, Math.round(((page + 1) / Math.max(1, images.length)) * 1000) / 10)
    : total
      ? Math.round(((index + 1) / total) * 1000) / 10
      : 0;

  const readyCount = useMemo(
    () => images.filter((_, i) => locals[String(i)]).length,
    [images, locals]
  );

  return (
    <div className={`comic${uiVisible ? '' : ' zen'}`}>      <div
        className="comic-scroll"
        ref={scrollRef}
        onScroll={onScroll}
        onClick={() => setUiVisible((v) => !v)}
      >
        <div className={`comic-stage fit-${fit}`}>
          {(loading || (images.length > 0 && readyCount < images.length)) && (
            <div className="comic-hint">
              <span className="reader-measuring-dot" />
              {loading ? '正在取图' : '加载中'}
              {images.length ? `（${readyCount} / ${images.length}）` : ''}
            </div>
          )}
          {error && (
            <div className="comic-error">
              <p>{error}</p>
              <div className="comic-error-actions">
                <button className="btn primary" onClick={() => setIndex((v) => v)}>
                  重试
                </button>
                <button className="btn ghost" onClick={() => goTo(index + 1)}>
                  下一章
                </button>
                <button className="btn ghost" onClick={onClose}>
                  返回书架
                </button>
              </div>
            </div>
          )}
          {!error &&
            images.map((src, i) => {
              const local = locals[String(i)];
              return (
                <div className="comic-page" key={`${index}-${i}`}>
                  {local ? (
                    <img
                      src={local}
                      alt={`第 ${i + 1} 页`}
                      loading="lazy"
                      draggable={false}
                      onClick={(event) => {
                        event.stopPropagation();
                        setZoomed(local);
                      }}
                    />
                  ) : (
                    <div className="comic-page-placeholder">{`第 ${i + 1} 页`}</div>
                  )}
                </div>
              );
            })}
          {!localComic && !loading && !error && images.length > 0 && (
            <div className="comic-tail">
              <button className="btn ghost" onClick={() => goTo(index + 1)} disabled={index + 1 >= total}>
                下一章
                <IconChevron size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {uiVisible && (
          <motion.header
            className="comic-head"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            <div className="comic-head-left">
              <button className="icon-btn" onClick={onClose} title="返回书架( Esc )">
                <IconArrowLeft size={17} />
              </button>
              <div className="comic-titles">
                <span className="comic-book">{book.name}</span>
                <span className="comic-chapter">{chapter?.title || '加载中…'}</span>
              </div>
            </div>            <div className="comic-head-right">
              {images.length > 0 && (
                <span className="comic-page-count">
                  第 {Math.min(page + 1, images.length)} / {images.length} 页
                </span>
              )}
              <span className="comic-count">
                {localComic ? (images.length ? `共 ${images.length} 页` : '—') : total ? `第 ${index + 1} / ${total} 章` : '—'}
              </span>
              <button
                className={`icon-btn${fit === 'original' ? ' active' : ''}`}
                onClick={toggleFit}
                title={fit === 'width' ? '当前适应宽度，点击看原始尺寸 (F)' : '当前原始尺寸，点击适应宽度 (F)'}
              >
                <IconMaximize size={16} />
              </button>
              {!localComic && (
                <button className="icon-btn" onClick={() => setTocOpen(true)} title="目录( T )">
                  <IconList size={17} />
                </button>
              )}
            </div>
          </motion.header>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showTop && (
          <button className="comic-top-btn" onClick={scrollToTop} title="回到顶部 (Home)">
            回到顶部
          </button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {uiVisible && (
          <motion.footer
            className="comic-foot"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
          >
            {localComic ? (
              <span className="comic-count">
                {images.length ? `第 ${Math.min(page + 1, images.length)} / ${images.length} 页` : '—'}
              </span>
            ) : (
              <button className="btn small ghost" onClick={() => goTo(index - 1)} disabled={index <= 0}>
                上一章
              </button>
            )}
            <div className="comic-bar">
              <span className="comic-bar-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            {localComic ? (
              <span className="comic-count">{Math.round(progressPercent)}%</span>
            ) : (
              <button
                className="btn small ghost"
                onClick={() => goTo(index + 1)}
                disabled={index + 1 >= total}
              >
                下一章
              </button>
            )}
          </motion.footer>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {tocOpen && (
          <motion.div
            className="comic-toc"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          >
            <div className="comic-toc-head">
              <span>目录</span>
              <button className="icon-btn" onClick={() => setTocOpen(false)}>
                <IconX size={16} />
              </button>
            </div>
            <div className="comic-toc-meta">{book.name} · 共 {total} 章</div>
            <ul className="comic-toc-list">
              {toc.map((item, i) => (
                <li key={`${item.url}-${i}`}>
                  <button
                    className={`comic-toc-item${i === index ? ' active' : ''}`}
                    onClick={() => goTo(i)}
                  >
                    <span className="comic-toc-index">{String(i + 1).padStart(3, '0')}</span>
                    <span className="comic-toc-title">{item.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {zoomed && (
          <motion.div
            className="comic-zoom"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onZoomBackdropClick}
          >
            <TransformWrapper
              ref={zoomApiRef}
              minScale={ZOOM_MIN}
              maxScale={ZOOM_MAX}
              limitToBounds
              disablePadding
              doubleClick={{ disabled: true }}
              wheel={{ disabled: true }}
              panning={{ velocityDisabled: true }}
              onInit={() => syncZoomScale(ZOOM_MIN)}
              onTransform={(ref, state) => syncZoomScale(state.scale)}
              onPanningStart={() => {
                movedRef.current = true;
              }}
            >
              {/* 内容盒不锁高度：超高页保持原始比例，靠上下拖动查看（和旧版
                  原生滚动一致）。锁成 100% 再配 object-fit: contain 会把整页
                  压进一屏，细节全糊。minHeight 只负责让矮图在暗底里居中。
                  容器尺寸由 .comic-zoom .comic-zoom-frame 的绝对定位给死，
                  否则 grid 的自动行会被内容撑高，库量到的视口等于整页高度，
                  平移边界就变成 0。 */}
              <TransformComponent
                wrapperClass="comic-zoom-frame"
                contentClass="comic-zoom-content"
                contentStyle={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                  minHeight: '100%',
                }}
                wrapperProps={{ onDoubleClick: onZoomDoubleClick }}
              >
                <img src={zoomed} alt="" draggable={false} />
              </TransformComponent>
            </TransformWrapper>
            <div className="comic-zoom-tools" onClick={(event) => event.stopPropagation()}>
              <button className="icon-btn" onClick={zoomOut} title="缩小 (−)">
                −
              </button>
              <span>{Math.round(zoomScale * 100)}%</span>
              <button className="icon-btn" onClick={zoomIn} title="放大 (+)">
                +
              </button>
              <button className="icon-btn" onClick={zoomReset} title="复位 (0)">
                1:1
              </button>
            </div>
            <button className="icon-btn comic-zoom-close" onClick={() => setZoomed(null)}>
              <IconX size={18} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
