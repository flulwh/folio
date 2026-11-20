import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconList, IconSearch, IconX } from './Icons.jsx';
import { VirtualList } from '../ui/VirtualList.jsx';
import { Sheet } from '../ui/Dialog.jsx';

// 长篇的目录可能有几千上万章：整表渲染加 framer 的布局投射会把主线程卡住，
// 所以交给 VirtualList 只渲染视口附近的行。行高先按设计值估，虚拟列表会按
// 真实行高校准（各皮肤 .toc-item 的内边距不同）。
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
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef(null);
  // VirtualList 内部创建的 virtualizer，用来做程序化滚动（定位/键盘）。
  const virtualizerRef = useRef(null);
  // 「打开时定位到当前章」只做一次；关掉再打开时才重新定位。
  const positionedRef = useRef(false);
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
      positionedRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    setCursor(0);
    // 搜索结果通常只剩几行，滚动位置按新表头来，不然会停在超出内容的位置。
    if (query && listRef.current) listRef.current.scrollTo({ top: 0, behavior: 'instant' });
  }, [query]);

  // 打开时把当前章放到中间。目录行是虚拟的，不能靠 scrollIntoView，
  // 交给 virtualizer 按行号定位，旁边几千行都不用进 DOM。
  useEffect(() => {
    if (!open) return undefined;
    if (positionedRef.current) return undefined;
    positionedRef.current = true;
    const id = requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el) return;
      const position = filtered.indexOf(currentChapter);
      const virtualizer = virtualizerRef.current;
      if (position < 0) {
        el.scrollTo({ top: 0, behavior: 'instant' });
        return;
      }
      if (virtualizer) {
        virtualizer.scrollToIndex(position, { align: 'center', behavior: 'instant' });
      } else {
        el.scrollTo({
          top: Math.max(0, position * DESIGN_ROW_H - (el.clientHeight - DESIGN_ROW_H) / 2),
          behavior: 'instant',
        });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [open, filtered, currentChapter]);

  // 键盘上下移动：只把光标那一行带进视口。
  useEffect(() => {
    if (!open) {
      prevCursorRef.current = cursor;
      return;
    }
    if (prevCursorRef.current === cursor) return;
    prevCursorRef.current = cursor;
    const virtualizer = virtualizerRef.current;
    if (virtualizer) {
      virtualizer.scrollToIndex(cursor, { align: 'auto', behavior: 'instant' });
      return;
    }
    const el = listRef.current;
    if (!el) return;
    const top = cursor * DESIGN_ROW_H;
    const bottom = top + DESIGN_ROW_H;
    if (top < el.scrollTop) {
      el.scrollTo({ top, behavior: 'instant' });
    } else if (bottom > el.scrollTop + el.clientHeight) {
      el.scrollTo({ top: bottom - el.clientHeight, behavior: 'instant' });
    }
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
      onSelect(filtered[cursor] ?? 0);
    }
  };

  const total = filtered.length;

  const renderRow = (position) => {
    const index = filtered[position];
    const chapter = chapters[index];
    if (!chapter) return null;
    const active = index === currentChapter;
    const focused = position === cursor;
    return (
      <button
        key={index}
        className={`toc-item${active ? ' active' : ''}${focused ? ' focused' : ''}`}
        // 只渲染窗口内的行，关掉 content-visibility，免得量到的行高是占位值
        style={{ contentVisibility: 'visible' }}
        onClick={() => onSelect(index)}
        onMouseEnter={() => setCursor(position)}
      >
        <span className="toc-index">{String(index + 1).padStart(2, '0')}</span>
        <span className="toc-title">{chapter.title}</span>
        {active && <span className="toc-active-dot" />}
      </button>
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose?.();
      }}
      side="left"
      className="panel toc-panel"
      backdropClassName="panel-backdrop"
      ariaLabel="目录"
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
                <VirtualList
                  scrollRef={listRef}
                  count={total}
                  estimate={DESIGN_ROW_H}
                  overscan={OVERSCAN}
                  virtualizerRef={virtualizerRef}
                  renderRow={renderRow}
                />
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
    </Sheet>
  );
}
