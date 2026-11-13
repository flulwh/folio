import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
export default function ComicReader({ book, onClose }) {
  const progress = useProgress();
  const settings = useSettings();
  const { saveProgress, notify, patchSettings } = useAppActions();
  const saved = progress[book.id] || {};
  const savedIndex = Math.max(0, Number(saved.chapter ?? saved.windowBase ?? 0) || 0);

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
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomOffset, setZoomOffset] = useState({ x: 0, y: 0 });
  const [zooming, setZooming] = useState(false);
  const [showTop, setShowTop] = useState(false);

  const fit = settings.comicFit === 'original' ? 'original' : 'width';
  const scrollRef = useRef(null);
  const aliveRef = useRef(true);
  // 放大层手势状态：指针表、手势基线、是否发生过拖动
  const zoomRef = useRef(null);
  const zoomImgRef = useRef(null);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const movedRef = useRef(false);
  const idleTimer = useRef(0);
  const listCache = useRef(new Map());
  // 当前章节的图片预取任务 key；warmRef 是下一章预热任务，切章时一起取消
  const jobRef = useRef('');
  const warmRef = useRef(new Set());

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (idleTimer.current) clearTimeout(idleTimer.current);
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

  /* ------------------------------ 加载目录 ------------------------------ */
  useEffect(() => {
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
  }, [book.id, book.bookUrl, book.sourceId, book.name, book.author, book.raw, settings.proxy]);

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
    if (!toc.length) return undefined;
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
  }, [book.id, index, toc, loadChapter]);

  /* ------------------------------ 进度保存 ------------------------------ */
  useEffect(() => {
    if (!toc.length) return;
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
  }, [book.id, index, toc, saveProgress]);

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

  /** 放大的那层：+ / − / 0 调整，双击复位 */
  useEffect(() => {
    if (zoomed) {
      setZoomScale(1);
      setZoomOffset({ x: 0, y: 0 });
    }
  }, [zoomed]);

  /* ---------------- 放大层手势：捏合缩放 / 拖动平移 / 橡皮筋边界 ---------------- */
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 4;

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  /** 图片放大后可平移的范围：超出容器的那一半 */
  const zoomLimits = useCallback(() => {
    const box = zoomRef.current?.getBoundingClientRect();
    const img = zoomImgRef.current?.getBoundingClientRect();
    if (!box || !img) return { x: 0, y: 0 };
    return {
      x: Math.max(0, (img.width - box.width) / 2),
      y: Math.max(0, (img.height - box.height) / 2),
    };
  }, []);

  /** 越界阻尼：越拖越沉，但不完全不让动（iOS 橡皮筋） */
  const rubber = useCallback((value, limit) => {
    if (value > limit) return limit + (value - limit) * 0.42;
    if (value < -limit) return -limit + (value + limit) * 0.42;
    return value;
  }, []);

  const onZoomPointerDown = (event) => {
    const points = pointersRef.current;
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* 某些环境不支持指针捕获，忽略 */
    }
    if (points.size === 2) {
      const [a, b] = [...points.values()];
      gestureRef.current = {
        mode: 'pinch',
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: zoomScale,
      };
      movedRef.current = true;
      setZooming(true);
    } else if (points.size === 1) {
      gestureRef.current = {
        mode: 'pan',
        x: event.clientX,
        y: event.clientY,
        baseX: zoomOffset.x,
        baseY: zoomOffset.y,
      };
    }
  };

  const onZoomPointerMove = (event) => {
    const points = pointersRef.current;
    if (!points.has(event.pointerId)) return;
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = gestureRef.current;
    if (!gesture) return;

    if (gesture.mode === 'pinch' && points.size >= 2) {
      const [a, b] = [...points.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.dist > 0) {
        movedRef.current = true;
        setZoomScale(clamp(gesture.scale * (dist / gesture.dist), ZOOM_MIN, ZOOM_MAX));
      }
      return;
    }

    if (gesture.mode === 'pan' && zoomScale > 1) {
      const limits = zoomLimits();
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) movedRef.current = true;
      setZooming(true);
      setZoomOffset({
        x: rubber(gesture.baseX + dx, limits.x),
        y: rubber(gesture.baseY + dy, limits.y),
      });
    }
  };

  const endZoomGesture = (event) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 0) {
      gestureRef.current = null;
      setZooming(false);
      // 松手回弹：越界的部分弹回边界
      const limits = zoomLimits();
      setZoomOffset((prev) => ({
        x: clamp(prev.x, -limits.x, limits.x),
        y: clamp(prev.y, -limits.y, limits.y),
      }));
    } else if (pointersRef.current.size === 1) {
      const [only] = [...pointersRef.current.values()];
      gestureRef.current = {
        mode: 'pan',
        x: only.x,
        y: only.y,
        baseX: zoomOffset.x,
        baseY: zoomOffset.y,
      };
    }
  };

  /** 双击：以点击点为中心放大到 2.5 倍，再点收回（Photos 的定点缩放） */
  const onZoomDoubleClick = (event) => {
    event.stopPropagation();
    const img = zoomImgRef.current?.getBoundingClientRect();
    if (!img) {
      setZoomScale((v) => (v > 1 ? 1 : 2));
      return;
    }
    if (zoomScale > 1) {
      setZoomScale(1);
      setZoomOffset({ x: 0, y: 0 });
      return;
    }
    const next = 2.5;
    const cx = event.clientX - (img.left + img.width / 2);
    const cy = event.clientY - (img.top + img.height / 2);
    setZoomScale(next);
    setZoomOffset({ x: -cx * (next - 1), y: -cy * (next - 1) });
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
        setZoomScale((v) => Math.min(3, Math.round((v + 0.25) * 100) / 100));
        setZoomOffset({ x: 0, y: 0 });
      } else if (zoomed && (event.key === '-' || event.key === '_')) {
        event.preventDefault();
        setZoomScale((v) => Math.max(1, Math.round((v - 0.25) * 100) / 100));
        setZoomOffset({ x: 0, y: 0 });
      } else if (zoomed && event.key === '0') {
        event.preventDefault();
        setZoomScale(1);
        setZoomOffset({ x: 0, y: 0 });
      } else if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        toggleFit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, index, onClose, scrollToTop, tocOpen, toggleFit, uiVisible, zoomed]);

  const chapter = toc[index];
  const total = toc.length;
  const progressPercent = total ? Math.round(((index + 1) / total) * 1000) / 10 : 0;

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
          {!loading && !error && images.length > 0 && (
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
                {total ? `第 ${index + 1} / ${total} 章` : '—'}
              </span>
              <button
                className={`icon-btn${fit === 'original' ? ' active' : ''}`}
                onClick={toggleFit}
                title={fit === 'width' ? '当前适应宽度，点击看原始尺寸 (F)' : '当前原始尺寸，点击适应宽度 (F)'}
              >
                <IconMaximize size={16} />
              </button>
              <button className="icon-btn" onClick={() => setTocOpen(true)} title="目录( T )">
                <IconList size={17} />
              </button>
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
            <button className="btn small ghost" onClick={() => goTo(index - 1)} disabled={index <= 0}>
              上一章
            </button>
            <div className="comic-bar">
              <span className="comic-bar-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <button
              className="btn small ghost"
              onClick={() => goTo(index + 1)}
              disabled={index + 1 >= total}
            >
              下一章
            </button>
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
            ref={zoomRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              // 捏合/拖动之后的那一下 click 不该关掉放大层
              if (movedRef.current) {
                movedRef.current = false;
                return;
              }
              setZoomed(null);
            }}
          >
            <img
              ref={zoomImgRef}
              src={zoomed}
              alt=""
              draggable={false}
              style={{
                transform: `translate(${zoomOffset.x}px, ${zoomOffset.y}px) scale(${zoomScale})`,
                transition: zooming ? 'none' : 'transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)',
                cursor: zoomScale > 1 ? 'grab' : 'zoom-out',
                touchAction: 'none',
              }}
              onPointerDown={onZoomPointerDown}
              onPointerMove={onZoomPointerMove}
              onPointerUp={endZoomGesture}
              onPointerCancel={endZoomGesture}
              onDoubleClick={onZoomDoubleClick}
            />
            <div className="comic-zoom-tools" onClick={(event) => event.stopPropagation()}>
              <button
                className="icon-btn"
                onClick={() => {
                  setZoomScale((v) => Math.max(1, Math.round((v - 0.25) * 100) / 100));
                  setZoomOffset({ x: 0, y: 0 });
                }}
                title="缩小 (−)"
              >
                −
              </button>
              <span>{Math.round(zoomScale * 100)}%</span>
              <button
                className="icon-btn"
                onClick={() => {
                  setZoomScale((v) => Math.min(3, Math.round((v + 0.25) * 100) / 100));
                  setZoomOffset({ x: 0, y: 0 });
                }}
                title="放大 (+)"
              >
                +
              </button>
              <button
                className="icon-btn"
                onClick={() => {
                  setZoomScale(1);
                  setZoomOffset({ x: 0, y: 0 });
                }}
                title="复位 (0)"
              >
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
