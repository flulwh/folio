import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { IconX } from './Icons.jsx';

/**
 * 笔记编辑框：一段摘录 + 一块留白。
 *
 * 保存空文本 = 退回书签（与 Android `updateNote` 的语义一致），
 * 所以这里不阻止用户清空，只把决定权留给调用方。
 */
export default function NoteDialog({ open, title = '笔记', excerpt = '', initial = '', onSave, onClose }) {
  const [text, setText] = useState(initial);
  const areaRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setText(initial);
    const timer = setTimeout(() => areaRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [open, initial]);

  // 对话框打开时，Esc 只关它，不再让 Reader 顺手关掉后面的面板
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="note-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            className="note-dialog"
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="note-head">
              <span className="note-eyebrow">NOTE</span>
              <h3>{title}</h3>
              <button className="icon-btn ghost" onClick={onClose} title="关闭 (Esc)">
                <IconX size={16} />
              </button>
            </header>
            {excerpt && (
              <blockquote className="note-excerpt">
                {excerpt.length > 90 ? `${excerpt.slice(0, 90)}…` : excerpt}
              </blockquote>
            )}
            <textarea
              ref={areaRef}
              className="note-input"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  onSave(text);
                }
              }}
              placeholder="写点什么。留空保存即变回纯书签。"
              rows={4}
              spellCheck={false}
            />
            <footer className="note-foot">
              <span className="note-hint">⌘ / Ctrl + Enter 保存</span>
              <span className="note-actions">
                <button className="btn ghost small" onClick={onClose}>
                  取消
                </button>
                <button className="btn primary small" onClick={() => onSave(text)}>
                  保存
                </button>
              </span>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
