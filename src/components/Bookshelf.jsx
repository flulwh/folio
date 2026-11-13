import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DUR, EASE, SPRING, backdropVariants, modalVariants, riseItem, staggerContainer } from '../motion.js';
import { cleanSourceName } from '../utils/text.js';
import { useAppActions, useBooks, useProgress, useSources, dataApi } from '../store/AppStore.jsx';
import SourcePanel from './SourcePanel.jsx';
import LogPanel from './LogPanel.jsx';
import Segmented from './Segmented.jsx';
import { SAMPLE_BOOK_CONTENT, SAMPLE_BOOK_NAME } from '../data/sampleBook.js';
import { decodeBuffer, formatDate, formatPercent, isProbablyTextFile } from '../utils/format.js';
import { useCachedCover, useCoverReadyTick, usePrimeShelfCovers } from '../hooks/useCachedCover.js';
import {
  IconBook,
  IconCloud,
  IconDatabase,
  IconGrid,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSparkle,
  IconTerminal,
  IconTrash,
  IconX,
} from './Icons.jsx';

const containerVariants = staggerContainer(0.018, 0.05);

const cardVariants = riseItem;

function hashHue(name) {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/**
 * Curated cover palettes instead of raw hue rotation: every book lands on a
 * muted, modern tone that sits calmly next to the other three themes, and the
 * same title always gets the same colour.
 */
const COVER_PALETTES = [
  { a: [231, 36, 80], b: [232, 30, 63], ink: [232, 38, 18] }, // indigo
  { a: [216, 18, 82], b: [217, 15, 65], ink: [217, 22, 17] }, // slate
  { a: [158, 28, 78], b: [160, 24, 59], ink: [160, 32, 17] }, // emerald
  { a: [345, 36, 84], b: [344, 30, 67], ink: [344, 36, 23] }, // rose
  { a: [36, 48, 81], b: [30, 42, 65], ink: [28, 44, 19] }, // amber
  { a: [268, 30, 82], b: [272, 26, 65], ink: [270, 32, 19] }, // violet
];

function coverStyle(book) {
  const seed = book.hue ?? hashHue(book.name || 'book');
  const p = COVER_PALETTES[seed % COVER_PALETTES.length];
  return {
    '--cover-a': `hsl(${p.a[0]} ${p.a[1]}% ${p.a[2]}%)`,
    '--cover-b': `hsl(${p.b[0]} ${p.b[1]}% ${p.b[2]}%)`,
    '--cover-ink': `hsl(${p.ink[0]} ${p.ink[1]}% ${p.ink[2]}%)`,
  };
}

function BookCard({ book, percent, onOpen, onDelete, onCache, index, coverTick }) {
  const percentValue = Math.min(100, Math.max(0, percent || 0));
  const finished = percentValue >= 99.5;
  const coverTickValue = coverTick; // 批量封面就绪后重新求一次地址
  const coverSrc = useCachedCover(book, coverTickValue);

  return (
    <motion.div
      className="book-card"
      variants={cardVariants}
      layout
      custom={index}
      onClick={() => onOpen(book)}
    >
      <button
        className={`book-cover${coverSrc ? ' has-art' : ''}`}
        style={coverStyle(book)}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(book);
        }}
      >
        <span className="cover-spine" />
        {coverSrc && (
          <span className="cover-art">
            <img
              src={coverSrc}
              alt=""
              loading="lazy"
              draggable={false}
              onError={(e) => {
                e.currentTarget.parentElement?.classList.remove('ready');
              }}
            />
          </span>
        )}
        <span className="cover-frame" />
        <span className="cover-title">{book.name}</span>
        <span className="cover-shine" />
        {book.kind === 'cloud' && (
          <span className="cover-cloud" title={`来自书源：${cleanSourceName(book.sourceName)}`}>
            <IconCloud size={12} />
            书源
          </span>
        )}
        {percentValue > 0 && (
          <span className={`cover-badge${finished ? ' finished' : ''}`}>
            {finished ? '已读完' : formatPercent(percentValue)}
          </span>
        )}
      </button>
      <div className="book-meta">
        <div className="book-meta-text">
          <div className="book-name" title={book.name}>
            {book.name}
          </div>
          <div className="book-sub">
            {book.kind === 'cloud' ? (
              cleanSourceName(book.sourceName) || '云端书源'
            ) : (
              <>
                本地
                <span className="dot">·</span>
                {formatDate(book.addedAt)}
              </>
            )}
          </div>
        </div>
        <div className="book-actions">
          {book.kind === 'cloud' && (
            <button
              className="icon-btn ghost book-delete"
              title="缓存管理（已下载的章节）"
              onClick={(e) => {
                e.stopPropagation();
                onCache(book);
              }}
            >
              <IconDatabase size={16} />
            </button>
          )}
          <button
            className="icon-btn ghost danger book-delete"
            title="从书架移除"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(book);
            }}
          >
            <IconTrash size={16} />
          </button>
        </div>
      </div>
      <div className="book-progress">
        <span style={{ width: `${percentValue}%` }} />
      </div>
    </motion.div>
  );
}

export default function Bookshelf({ onOpenBook, onOpenMarket, onOpenSettings }) {
  const books = useBooks();
  const progress = useProgress();
  const sources = useSources();
  const { addBookFromText, addBookFromPicker, removeBook, restoreBook, notify } = useAppActions();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(() => {
    try {
      const saved = localStorage.getItem('folio:shelf-sort');
      return saved === 'added' || saved === 'name' ? saved : 'recent';
    } catch {
      return 'recent';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('folio:shelf-sort', sort);
    } catch {
      /* 隐私模式下写不了，忽略 */
    }
  }, [sort]);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [cacheBook, setCacheBook] = useState(null);
  const [cacheStats, setCacheStats] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const dragDepth = useRef(0);
  const searchRef = useRef(null);

  // 云端书封面：先批量把整架封面缓存到本地，再由每张卡各自取地址
  const coverTick = useCoverReadyTick();
  usePrimeShelfCovers(books);
  // 云端书缓存统计：打开弹窗时取一次，清理后再取一次
  useEffect(() => {
    if (!cacheBook) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const stats = await dataApi.cloudCacheStats({
          sourceId: cacheBook.sourceId,
          bookUrl: cacheBook.bookUrl,
        });
        if (!cancelled) setCacheStats(stats);
      } catch {
        if (!cancelled) setCacheStats({ cached: 0, tocChapters: 0, tocFetchedAt: 0 });
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [cacheBook]);

  const percentOf = useCallback(
    (book) => {
      const p = progress[book.id];
      if (!p) return 0;
      if (typeof p.percent === 'number') return p.percent;
      return 0;
    },
    [progress]
  );

  const lastReading = useMemo(() => {
    let best = null;
    for (const book of books) {
      const p = progress[book.id];
      if (!p || !p.updatedAt) continue;
      if (!best || p.updatedAt > progress[best.id]?.updatedAt) best = book;
    }
    return best;
  }, [books, progress]);

  // 「继续阅读」大卡也需要封面：放在顶层调用，避免在 JSX 条件分支里用 hook
  const continueCoverSrc = useCachedCover(lastReading, coverTick);

  const visibleBooks = useMemo(() => {
    const list = books.filter((b) => b.name.toLowerCase().includes(query.trim().toLowerCase()));
    const byRecent = (book) => progress[book.id]?.updatedAt || book.addedAt;
    if (sort === 'recent') return [...list].sort((a, b) => byRecent(b) - byRecent(a));
    if (sort === 'added') return [...list].sort((a, b) => b.addedAt - a.addedAt);
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }, [books, query, sort, progress]);

  const importBooks = useCallback(
    async (files) => {
      const list = Array.from(files).filter((f) => isProbablyTextFile(f.name) || f.type.startsWith('text/'));
      if (!list.length) {
        notify('请拖入 TXT 或 Markdown 文本文件', 'error');
        return;
      }      let ok = 0;
      let failed = 0;
      for (let i = 0; i < list.length; i += 1) {
        const file = list[i];
        if (list.length > 1) {
          notify(`正在导入 ${i + 1} / ${list.length}：《${file.name}》`, 'info', { duration: 1600 });
        }
        try {
          const buffer = await file.arrayBuffer();
          const content = decodeBuffer(buffer);
          const added = await addBookFromText({
            id: `${file.name}::${file.size}::${file.lastModified || 0}`,
            name: file.name.replace(/\.(txt|md|markdown|text)$/i, ''),
            content,
          });
          if (added) ok += 1;
          else failed += 1;
        } catch (err) {
          failed += 1;
          notify(`读取《${file.name}》失败：${err.message}`, 'error');
        }
      }
      if (list.length > 1) {
        notify(
          failed ? `导入完成：成功 ${ok} 本，失败 ${failed} 本` : `已导入 ${ok} 本，开始读吧`,
          failed ? 'error' : 'info',
          { duration: 3600 }
        );
      }
    },
    [addBookFromText, notify]
  );

  const handleImport = useCallback(async () => {
    const book = await addBookFromPicker();
    if (book) onOpenBook?.(book);
  }, [addBookFromPicker, onOpenBook]);

  const handleSample = useCallback(async () => {
    const book = await addBookFromText({
      id: 'sample::山居手记',
      name: SAMPLE_BOOK_NAME,
      content: SAMPLE_BOOK_CONTENT,
    });
    if (book) onOpenBook?.(book);
  }, [addBookFromText, onOpenBook]);
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        handleImport();
        return;
      }
      if (tag === 'input' || tag === 'textarea') {
        if (e.key === 'Escape') searchRef.current?.blur();
        return;
      }
      if (e.key === '/' && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleImport]);

  // Drag & drop import
  useEffect(() => {
    const onDragEnter = (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragOver = (e) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    };
    const onDragLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (e.dataTransfer?.files?.length) importBooks(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [importBooks]);

  const lastPercent = lastReading ? percentOf(lastReading) : 0;
  const lastChapter = (lastReading && progress[lastReading.id]?.chapterTitle) || '';
  const finishedCount = books.filter((b) => percentOf(b) >= 99.5).length;
  const averagePercent = books.length
    ? Math.round(books.reduce((sum, b) => sum + percentOf(b), 0) / books.length)
    : 0;

  return (
    <div className="shelf">
      <motion.header
        className="shelf-header"
        initial={{ opacity: 0, y: -18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="brand">
          <span className="brand-mark">
            <IconBook size={20} />
          </span>
          <div className="brand-text">
            <span className="brand-name">Folio</span>
          </div>
        </div>

        <div className="shelf-tools">
          <label className="search">
            <IconSearch size={17} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索书名"
              spellCheck={false}
            />
            {query && (
              <button className="search-clear" onClick={() => setQuery('')} title="清除">
                <IconX size={14} />
              </button>
            )}
          </label>

          <Segmented
            ariaLabel="排序方式"
            options={[
              { value: 'recent', label: '最近阅读' },
              { value: 'added', label: '添加时间' },
              { value: 'name', label: '书名' },
            ]}
            value={sort}
            onChange={setSort}
          />

          <button className="btn ghost shelf-source-btn" onClick={() => setSourceOpen(true)}>
            <IconCloud size={16} />
            书源
            {sources.length > 0 && <span className="tool-count">{sources.length}</span>}
          </button>

          <button
            className="btn ghost shelf-cloud-btn"
            onClick={() => onOpenMarket?.()}
            title="打开书籍市场，在所有书源里搜书"
          >
            <IconGrid size={16} />
            书籍市场
          </button>

          <button className="btn primary" onClick={handleImport}>
            <IconPlus size={17} />
            导入
          </button>

          <button
            className="btn ghost shelf-log-btn"
            onClick={() => setLogOpen(true)}
            title="运行日志（排错用）"
            aria-label="运行日志"
          >
            <IconTerminal size={16} />
          </button>

          <button
            className="btn ghost shelf-settings-btn"
            onClick={() => onOpenSettings?.()}
            title="打开设置"
            aria-label="设置"
          >
            <IconSettings size={16} />
          </button>
        </div>
      </motion.header>

      <div className="shelf-body">
        <AnimatePresence>
          {lastReading && (
            <motion.section
              className="continue-card"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0, transition: { ...SPRING.card, delay: 0.04 } }}
              exit={{ opacity: 0, y: -8, transition: { duration: DUR.fast, ease: EASE } }}
              onClick={() => onOpenBook?.(lastReading)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onOpenBook?.(lastReading)}
              style={{
                ...coverStyle(lastReading),
                ...(continueCoverSrc ? { '--hero-cover': `url("${continueCoverSrc}")` } : {}),
              }}
            >
              <span className="continue-watermark" aria-hidden="true">
                {lastReading.name.slice(0, 1)}
              </span>
              <div className={`continue-cover${continueCoverSrc ? ' has-art' : ''}`}>
                {continueCoverSrc && (
                  <span className="cover-art">
                    <img src={continueCoverSrc} alt="" draggable={false} />
                  </span>
                )}
                <span className="continue-cover-glow" />
                <span className="continue-cover-title">{lastReading.name}</span>
              </div>
              <div className="continue-info">
                <span className="continue-eyebrow">继续阅读</span>
                <h2 className="continue-title">{lastReading.name}</h2>
                <div className="continue-progress">
                  <div className="continue-bar">
                    <motion.span
                      initial={{ width: 0 }}
                      animate={{ width: `${lastPercent}%` }}
                      transition={{ duration: 0.72, delay: 0.18, ease: EASE }}
                    />
                  </div>
                  <span className="continue-percent">{formatPercent(lastPercent)}</span>
                </div>
                <span className="continue-hint">
                  {lastChapter ? (
                    <>
                      <span className="continue-chapter" title={lastChapter}>
                        读到 {lastChapter}
                      </span>
                      <span className="dot">·</span>
                    </>
                  ) : null}
                  上次阅读 {formatDate(progress[lastReading.id]?.updatedAt)}
                  <span className="continue-cta">接着读 →</span>
                </span>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        <div className="shelf-section-head">
          <h1 className="shelf-title">
            我的书架
            <span className="shelf-count">{books.length}</span>
          </h1>
          {finishedCount > 0 ? (
            <span className="shelf-stat">已读完 {finishedCount} 本</span>
          ) : null}
        </div>

        {books.length === 0 ? (
          <motion.div
            className="empty-shelf"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <div className="empty-illustration">
              <span className="empty-book b1" />
              <span className="empty-book b2" />
              <span className="empty-book b3" />
              <span className="empty-glow" />
              <span className="mascot" role="img" aria-label="鲸鱼娘">🐳</span>
              <span className="mascot-bubble">来读点有趣的东西吧～</span>
            </div>
            <h2>书架空着，正好放一本新书</h2>
            <p>导入 TXT / Markdown，或把文件直接拖进窗口。也可以先读一篇内置的示例，看看沉浸阅读是什么感觉。</p>
            <div className="empty-actions">
              <button className="btn primary" onClick={handleImport}>
                <IconPlus size={17} />
                导入第一本书
              </button>
              <button className="btn ghost" onClick={handleSample}>
                <IconSparkle size={16} />
                读示例《山居手记》
              </button>
              <button className="btn ghost" onClick={() => onOpenMarket?.()}>
                <IconGrid size={16} />
                去书籍市场找书
              </button>
            </div>
          </motion.div>
        ) : visibleBooks.length === 0 ? (
          <div className="empty-search">
            <IconGrid size={22} />
            <p>没有匹配「{query}」的书</p>
            <button className="btn ghost" onClick={() => setQuery('')}>
              清除搜索
            </button>
          </div>
        ) : (
          <motion.div
            className="book-grid"
            variants={containerVariants}
            initial="hidden"
            animate="show"
          >
            <AnimatePresence mode="popLayout">
              {visibleBooks.map((book, i) => (
                <BookCard
                  key={book.id}
                  book={book}
                  index={i}
                  coverTick={coverTick}
                  percent={percentOf(book)}
                  onOpen={onOpenBook}
                  onDelete={setPendingDelete}
                  onCache={(b) => {
                    setCacheStats(null);
                    setCacheBook(b);
                  }}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      <footer className="shelf-footer">
        <span>
          藏书 {books.length} 本 · 平均进度 {formatPercent(averagePercent)}
        </span>        <span className="shelf-footer-keys">
          <kbd>/</kbd> 搜索 <kbd>拖拽</kbd> 导入 <kbd>?</kbd> 快捷键
        </span>
      </footer>

      <AnimatePresence>
        {dragging && (
          <motion.div
            className="drop-overlay"
            variants={backdropVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <motion.div
              className="drop-box"
              initial={{ scale: 0.94, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
            >
              <IconPlus size={26} />
              <p>松开即可导入到书架</p>
              <span>支持 TXT / Markdown</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <SourcePanel open={sourceOpen} onClose={() => setSourceOpen(false)} />

      <LogPanel open={logOpen} onClose={() => setLogOpen(false)} />

      <AnimatePresence>
        {cacheBook && (
          <motion.div
            className="modal-backdrop"
            variants={backdropVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={() => setCacheBook(null)}
          >
            <motion.div
              className="modal"
              variants={modalVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              onClick={(e) => e.stopPropagation()}
            >
              <h3>
                <IconDatabase size={17} /> 缓存管理
              </h3>
              <p>《{cacheBook.name}》· {cacheBook.sourceName || '书源'}</p>
              <div className="cache-stats">
                {!cacheStats ? (
                  <span className="cache-stats-row">正在统计…</span>
                ) : (
                  <>
                    <span className="cache-stats-row">
                      已缓存章节
                      <b>
                        {cacheStats.cached}
                        {cacheStats.tocChapters ? ` / 共 ${cacheStats.tocChapters} 章` : ''}
                      </b>
                    </span>
                    <span className="cache-stats-row">
                      目录抓取于
                      <b>{cacheStats.tocFetchedAt ? formatDate(cacheStats.tocFetchedAt) : '未缓存'}</b>
                    </span>
                    <span className="cache-stats-note">
                      缓存让重读秒开、离线可读；清理后阅读会重新向源站取章。
                    </span>
                  </>
                )}
              </div>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setCacheBook(null)}>
                  关闭
                </button>
                <button
                  className="btn danger"
                  disabled={!cacheStats || !cacheStats.cached}
                  onClick={async () => {
                    await dataApi.clearCloudCache({
                      sourceId: cacheBook.sourceId,
                      bookUrl: cacheBook.bookUrl,
                    });
                    notify(`已清理《${cacheBook.name}》的章节缓存`);
                    const stats = await dataApi.cloudCacheStats({
                      sourceId: cacheBook.sourceId,
                      bookUrl: cacheBook.bookUrl,
                    });
                    setCacheStats(stats);
                  }}
                >
                  <IconTrash size={16} />
                  清理缓存
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingDelete && (
          <motion.div
            className="modal-backdrop"
            variants={backdropVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={() => setPendingDelete(null)}
          >
            <motion.div
              className="modal"
              variants={modalVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              onClick={(e) => e.stopPropagation()}
            >
              <h3>移出书架？</h3>
              <p>
                《{pendingDelete.name}》会从书架移除，阅读进度一起清掉；云端章节缓存保留在本地。
                移除后可以在提示条里点「撤销」找回。
              </p>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setPendingDelete(null)}>
                  取消
                </button>
                <button
                  className="btn danger"                  onClick={() => {
                    const target = pendingDelete;
                    const savedProgress = progress[target.id] || null;
                    removeBook(target.id);
                    setPendingDelete(null);
                    notify(`已移除《${target.name}》`, 'info', {
                      duration: 6000,
                      action: {
                        label: '撤销',
                        onClick: () => {
                          restoreBook(target, savedProgress);
                          notify(`已把《${target.name}》放回书架`);
                        },
                      },
                    });
                  }}
                >
                  <IconTrash size={16} />
                  移除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
