import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMotionKit } from '../motion-kit.js';
import { usePresence } from '../hooks/usePresence.js';
import NoteDialog from './NoteDialog.jsx';
import { IconBookmark, IconHighlight, IconNote, IconX } from './Icons.jsx';

function when(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

/**
 * 书签与笔记抽屉。
 *
 * 三条统计 + 整宽主操作 + 按章节/段落升序的痕迹列表。
 * 点整行跳转；行内「笔记 / 删除」是无底色的文字按钮，不抢整行点击。
 */
export default function MarksPanel({
  open,
  bookName,
  marks = [],
  currentPara = 0,
  canBookmark = false,
  isBookmarked = false,
  onToggleBookmark,
  onJump,
  onRemove,
  onUpdateNote,
  onClose,
}) {
  const kit = useMotionKit();
  const alive = usePresence(open);
  const [editing, setEditing] = useState(null);

  const sorted = useMemo(
    () =>
      [...marks].sort(
        (a, b) =>
          (Number(a.chapterNo) || 0) - (Number(b.chapterNo) || 0) ||
          (Number(a.paraIndex) || 0) - (Number(b.paraIndex) || 0) ||
          (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0)
      ),
    [marks]
  );

  const bookmarks = sorted.filter((item) => item.kind === 'bookmark').length;
  const highlights = sorted.length - bookmarks;

  return (
    <>
      <AnimatePresence>
        {alive && (
          <>
            <motion.div
              key="marks-backdrop"
              className="panel-backdrop"
              variants={kit.backdrop}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ pointerEvents: open ? 'auto' : 'none' }}
              onClick={onClose}
            />
            <motion.aside
              key="marks-panel"
              className="panel marks-panel"
              variants={kit.sheet('right')}
              initial="initial"
              animate="animate"
              exit="exit"
            >
              <header className="panel-head">
                <div>
                  <span className="panel-eyebrow">
                    <IconBookmark size={13} /> 书签与笔记
                  </span>
                  <h2 className="panel-title" title={bookName}>
                    {bookName}
                  </h2>
                  <span className="panel-sub">
                    {sorted.length} 条痕迹
                    {sorted.length ? ` · 书签 ${bookmarks} / 划线 ${highlights}` : ''}
                  </span>
                </div>
                <button className="icon-btn ghost" onClick={onClose} title="关闭 (Esc)">
                  <IconX size={18} />
                </button>
              </header>

              <div className="marks-stats">
                <div className="marks-stat">
                  <strong>{bookmarks}</strong>
                  <span>书签</span>
                </div>
                <div className="marks-stat">
                  <strong>{highlights}</strong>
                  <span>划线</span>
                </div>
                <div className="marks-stat">
                  <strong>{isBookmarked ? '有' : '无'}</strong>
                  <span>P.{currentPara + 1}</span>
                </div>
              </div>

              <div className="marks-action">
                <button
                  className="btn primary full-width"
                  onClick={onToggleBookmark}
                  disabled={!canBookmark}
                >
                  <IconBookmark size={15} />
                  {isBookmarked ? '取消本段书签' : '给当前位置加书签'}
                </button>
              </div>

              <div className="marks-list">
                {sorted.length === 0 ? (
                  <div className="marks-empty">
                    <span>NO MARKS</span>
                    <p>点顶栏书签图标，或在段落上划一行字。</p>
                  </div>
                ) : (
                  sorted.map((mark) => (
                    <div
                      key={mark.id}
                      className="mark-row"
                      role="button"
                      tabIndex={0}
                      onClick={() => onJump(mark)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onJump(mark);
                        }
                      }}
                    >
                      <span className="mark-page">
                        {mark.kind === 'bookmark' ? (
                          <IconBookmark size={12} />
                        ) : (
                          <IconHighlight size={12} />
                        )}
                        P.{Number(mark.paraIndex) + 1}
                      </span>
                      <div className="mark-body">
                        <p className="mark-excerpt">{mark.excerpt || '（无摘录）'}</p>
                        {mark.note && <blockquote className="mark-note">{mark.note}</blockquote>}
                        <div className="mark-meta">
                          <span className="mark-source">
                            {mark.chapter || `第 ${Number(mark.chapterIndex) + 1} 章`}
                            {' · '}
                            {when(mark.createdAt)}
                          </span>
                          <span className="mark-tools">
                            <button
                              type="button"
                              className="mark-tool"
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditing(mark);
                              }}
                            >
                              <IconNote size={12} /> 笔记
                            </button>
                            <button
                              type="button"
                              className="mark-tool danger"
                              onClick={(event) => {
                                event.stopPropagation();
                                onRemove(mark.id);
                              }}
                            >
                              删除
                            </button>
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <footer className="panel-foot">
                <span className="hint">点整行跳转 · B 加书签 · Esc 关闭</span>
                <span className="panel-foot-actions" />
              </footer>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <NoteDialog
        open={!!editing}
        excerpt={editing?.excerpt || ''}
        initial={editing?.note || ''}
        onClose={() => setEditing(null)}
        onSave={(text) => {
          if (editing) onUpdateNote(editing.id, text.trim());
          setEditing(null);
        }}
      />
    </>
  );
}
