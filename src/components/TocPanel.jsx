import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMotionKit } from '../motion-kit.js';
import { IconList, IconSearch, IconX } from './Icons.jsx';
import { usePresence } from '../hooks/usePresence.js';

// 长篇的目录可能有几千上万章：整表渲染加 framer 的布局投射会把主线程卡住，
// 所以只渲染视口附近的行，滚动时换窗口。行高先按设计值估，首帧量到真实高度再校准
// （各皮肤 .toc-item 的内边距不同，写死会错位）。
const DESIGN_ROW_H = 44;
const OVERSCAN = 8;

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
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(0);
  const [rowH, setRowH] = useState(DESIGN_ROW_H);
  const listRef = useRef(null);
  // 「打开时定位到当前章」只做一次；换行高 / 关掉再打开时才重新定位。
  const positionedRef = useRef('');
  const prevCursorRef = useRef(0);

  const allIndexes = useMemo(
    () => Array.from({ length: chapters.length }, (_, i) => i),
    [chapters.length]
  );
  // 只存章节下标，不再每章建一个 { ...chapter, index } 副本；不搜索时零额外分配。
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allIndexes;
    const out = [];
    for (let i = 0; i < chapters.length; i += 1) {
      if ((chapters[i].title || '').toLowerCase().includes(q)) out.push(i);
    }
    return out;
  }, [allIndexes, chapters, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setCursor(0);
      setScrollTop(0);
      setViewHeight(0);
    }
  }, [open]);

  useEffect(() => {
    setCursor(0);
    // 搜索结果通常只剩几行，滚动位置按新表头来，不然会停在超出内容的位置。
    if (query && listRef.current) listRef.current.scrollTo({ top: 0, behavior: 'instant' });
  }, [query]);

  // 滚动时只更新窗口，不动整张表。
  useEffect(() => {
    if (!open) return undefined;
    const el = listRef.current;
    if (!el) return undefined;
    let raf = 0;
    const sync = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setScrollTop(el.scrollTop);
        setViewHeight(el.clientHeight);
      });
    };
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', sync);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector('.toc-item');
    if (!node) return;
    const measured = node.getBoundingClientRect().height;
    if (measured > 1 && Math.abs(measured - rowH) > 0.5) setRowH(measured);
  }, [open, rowH]);

  // 打开时把当前章放到中间。目录行是虚拟的，不能靠 scrollIntoView，
  // 直接按行号算出 scrollTop，连旁边几千行都不用进 DOM。
  useEffect(() => {
    if (!open) {
      positionedRef.current = '';
      return undefined;
    }
    const el = listRef.current;
    if (!el) return undefined;
    const stamp = String(rowH);
    if (positionedRef.current === stamp) return undefined;
    positionedRef.current = stamp;
    const id = requestAnimationFrame(() => {
      const position = filtered.indexOf(currentChapter);
      const target =
        position >= 0
          ? Math.max(0, position * rowH - (el.clientHeight - rowH) / 2)
          : 0;
      el.scrollTo({ top: target, behavior: 'instant' });
      setScrollTop(el.scrollTop);
      setViewHeight(el.clientHeight);
    });
    return () => cancelAnimationFrame(id);
  }, [open, rowH, filtered, currentChapter]);

  // 键盘上下移动：只把光标那一行带进视口。
  useEffect(() => {
    if (!open) {
      prevCursorRef.current = cursor;
      return;
    }
    if (prevCursorRef.current === cursor) return;
    prevCursorRef.current = cursor;
    const el = listRef.current;
    if (!el) return;
    const top = cursor * rowH;
    const bottom = top + rowH;
    if (top < el.scrollTop) {
      el.scrollTo({ top, behavior: 'instant' });
    } else if (bottom > el.scrollTop + el.clientHeight) {
      el.scrollTo({ top: bottom - el.clientHeight, behavior: 'instant' });
    }
  }, [cursor, open, rowH]);

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
      onSelect(filtered[cursor] ?? 0);
    }
  };

  const total = filtered.length;
  const start = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN);
  const end = Math.min(total, Math.ceil((scrollTop + Math.max(viewHeight, rowH)) / rowH) + OVERSCAN);
  const rows = [];
  for (let position = start; position < end; position += 1) {
    const index = filtered[position];
    const chapter = chapters[index];
    if (!chapter) continue;
    const active = index === currentChapter;
    const focused = position === cursor;
    rows.push(
      <button
        key={index}
        className={`toc-item${active ? ' active' : ''}${focused ? ' focused' : ''}`}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: position * rowH,
          // 只渲染窗口内的行，关掉 content-visibility，免得量到的行高是占位值
          contentVisibility: 'visible',
        }}
        onClick={() => onSelect(index)}
        onMouseEnter={() => setCursor(position)}
      >
        <span className="toc-index">{String(index + 1).padStart(2, '0')}</span>
        <span className="toc-title">{chapter.title}</span>
        {active && <span className="toc-active-dot" />}
      </button>
    );
  }

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
              {total === 0 && (
                <div className="toc-empty">
                  <p>没有匹配的章节</p>
                  <span>换一个更短的关键词试试，或点下面「回到当前章」。</span>
                </div>
              )}
              {total > 0 && (
                <div style={{ position: 'relative', height: `${total * rowH}px` }}>{rows}</div>
              )}
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
