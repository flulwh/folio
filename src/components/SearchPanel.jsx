import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMotionKit } from '../motion-kit.js';
import { usePresence } from '../hooks/usePresence.js';
import { IconSearch, IconX } from './Icons.jsx';

/** 命中摘录：关键词用朱砂薄底标出来，前后文保持墨色。 */
function Excerpt({ hit }) {
  const text = hit.excerpt || '';
  const start = Number(hit.start);
  const end = Number(hit.end);
  if (!(start >= 0 && end > start && end <= text.length)) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, start)}
      <mark className="search-hit-word">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

/**
 * 全书搜索抽屉：等宽输入行 + 命中状态行 + 结果列表。
 *
 * 结果与当前游标由 Reader 持有 —— 跳转后正文也要用同一份命中做高亮，
 * 面板只负责显示和触发。
 */
export default function SearchPanel({
  open,
  bookName,
  query,
  onQueryChange,
  hits = [],
  running = false,
  cursor = -1,
  onJump,
  onStep,
  onClose,
}) {
  const kit = useMotionKit();
  const alive = usePresence(open);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [open]);

  // 游标变化时把当前命中带进视口
  useEffect(() => {
    if (!open || cursor < 0) return;
    const node = listRef.current?.querySelector(`[data-hit="${cursor}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const total = hits.length;

  return (
    <AnimatePresence>
      {alive && (
        <>
          <motion.div
            key="search-backdrop"
            className="panel-backdrop"
            variants={kit.backdrop}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{ pointerEvents: open ? 'auto' : 'none' }}
            onClick={onClose}
          />
          <motion.aside
            key="search-panel"
            className="panel search-panel"
            variants={kit.sheet('right')}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <header className="panel-head">
              <div>
                <span className="panel-eyebrow">
                  <IconSearch size={13} /> 全书搜索
                </span>
                <h2 className="panel-title" title={bookName}>
                  {bookName}
                </h2>
                <span className="panel-sub">
                  命中 {total} 条
                  {cursor >= 0 ? ` · 当前 ${cursor + 1}/${total}` : ''}
                  {running ? ' · 正在搜索…' : ''}
                </span>
              </div>
              <button className="icon-btn ghost" onClick={onClose} title="关闭 (Esc)">
                <IconX size={18} />
              </button>
            </header>

            <label className="search-find">
              <span className="search-find-kicker">FIND</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onStep(event.shiftKey ? -1 : 1);
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    onClose();
                  }
                }}
                placeholder="输入关键词"
                spellCheck={false}
              />
              {query && (
                <button
                  type="button"
                  className="search-find-clear"
                  onClick={() => onQueryChange('')}
                  title="清除"
                >
                  <IconX size={13} />
                </button>
              )}
            </label>

            <div className="search-status">
              <span className="search-status-main">
                {query.trim() ? `「${query.trim()}」` : '整本书'}
              </span>
              <span className="search-status-actions">
                <button
                  type="button"
                  className="search-step"
                  onClick={() => onStep(-1)}
                  disabled={!total}
                >
                  ↑ 上一处
                </button>
                <button
                  type="button"
                  className="search-step"
                  onClick={() => onStep(1)}
                  disabled={!total}
                >
                  ↓ 下一处
                </button>
              </span>
            </div>

            <div className="search-hits" ref={listRef}>
              {!query.trim() ? (
                <div className="search-empty">
                  <span>SEARCH</span>
                  <p>输入关键词，搜当前这本书。</p>
                </div>
              ) : running && !total ? (
                <div className="search-empty">
                  <span>FINDING</span>
                  <p>正在搜索…</p>
                </div>
              ) : !total ? (
                <div className="search-empty">
                  <span>NO HITS</span>
                  <p>没有找到「{query.trim()}」。</p>
                </div>
              ) : (
                hits.map((hit, index) => (
                  <button
                    type="button"
                    key={`${hit.paraIndex}-${hit.start}`}
                    data-hit={index}
                    className={`search-hit${index === cursor ? ' active' : ''}`}
                    onClick={() => onJump(hit, index)}
                  >
                    <span className="search-hit-index">{String(index + 1).padStart(3, '0')}</span>
                    <span className="search-hit-body">
                      <span className="search-hit-chapter">
                        {hit.chapterTitle || `第 ${hit.chapterIndex + 1} 章`}
                      </span>
                      <span className="search-hit-text">
                        <Excerpt hit={hit} />
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>

            <footer className="panel-foot">
              <span className="hint">Enter 下一处 · Shift+Enter 上一处 · Esc 关闭</span>
              <span className="panel-foot-actions" />
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
