import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMotionKit } from '../motion-kit.js';
import { IconList, IconSearch, IconX } from './Icons.jsx';
import { usePresence } from '../hooks/usePresence.js';

export default function TocPanel({
  open,
  bookName,
  chapters,
  currentChapter,
  hasHeadings,
  onClose,
  onSelect,
  onOpenSettings,
}) {
  const kit = useMotionKit();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef(null);
  const activeRef = useRef(null);
  const cursorRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chapters.map((c, i) => ({ ...c, index: i }));
    return chapters
      .map((c, i) => ({ ...c, index: i }))
      .filter((c) => c.title.toLowerCase().includes(q));
  }, [chapters, query]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setCursor(0);
    }
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    cursorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const currentTitle = useMemo(
    () => (Number.isInteger(currentChapter) ? chapters[currentChapter]?.title : ''),
    [chapters, currentChapter]
  );

  const onKeyDown = (event) => {
    if (!filtered.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((v) => Math.min(filtered.length - 1, v + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((v) => Math.max(0, v - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setCursor(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setCursor(filtered.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onSelect(filtered[cursor]?.index ?? 0);
    }
  };

  const alive = usePresence(open);

  return (
    <AnimatePresence>
      {alive && (
        <>
          <motion.div
            key="toc-backdrop"
            className="panel-backdrop"
            variants={kit.backdrop}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{ pointerEvents: open ? 'auto' : 'none' }}
            onClick={onClose}
          />
          <motion.aside
            key="toc-panel"
            className="panel toc-panel"
            variants={kit.sheet('left')}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <header className="panel-head">
              <div>
                <span className="panel-eyebrow">
                  <IconList size={14} /> 目录
                </span>
                <h2 className="panel-title" title={bookName}>
                  {bookName}
                </h2>
                <span className="panel-sub">
                  {chapters.length} 章
                  {query.trim() ? ` · 匹配 ${filtered.length} 章` : ''}
                  {!hasHeadings && ' · 未识别到章节标题'}
                </span>
              </div>
              <button className="icon-btn ghost" onClick={onClose} title="关闭目录 (Esc)">
                <IconX size={18} />
              </button>
            </header>

            <label className="search panel-search">
              <IconSearch size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索章节"
                spellCheck={false}
              />
              {query && (
                <button className="search-clear" onClick={() => setQuery('')} title="清除">
                  <IconX size={13} />
                </button>
              )}
            </label>

            <div className="toc-list" ref={listRef} onKeyDown={onKeyDown} tabIndex={-1}>
              {filtered.length === 0 && (
                <div className="toc-empty">
                  <p>没有匹配的章节</p>
                  <span>换一个更短的关键词试试，或点下面「回到当前章」。</span>
                </div>
              )}
              {filtered.map((chapter, position) => {
                const active = chapter.index === currentChapter;
                const focused = position === cursor;
                return (
                  <button
                    key={`${chapter.paraIndex}-${chapter.title}`}
                    ref={focused ? cursorRef : active ? activeRef : null}
                    className={`toc-item${active ? ' active' : ''}${focused ? ' focused' : ''}`}
                    onClick={() => onSelect(chapter.index)}
                    onMouseEnter={() => setCursor(position)}
                  >
                    <span className="toc-index">{String(chapter.index + 1).padStart(2, '0')}</span>
                    <span className="toc-title">{chapter.title}</span>
                    {active && (
                      <motion.span
                        className="toc-active-dot"
                        layoutId="toc-active-dot"
                        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <footer className="panel-foot">
              <span className="hint">
                {currentTitle ? `当前：${currentTitle}` : '↑ ↓ 选择 · Enter 跳转'}
              </span>
              <span className="panel-foot-actions">
                {Number.isInteger(currentChapter) && (
                  <button
                    className="btn ghost small"
                    onClick={() => onSelect(currentChapter)}
                    title="滚动到当前阅读的章节"
                  >
                    回到当前章
                  </button>
                )}
                {!hasHeadings ? (
                  <button className="btn ghost small" onClick={onOpenSettings}>
                    调整章节正则
                  </button>
                ) : null}
              </span>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
