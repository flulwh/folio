import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMotionKit } from '../motion-kit.js';
import { IconCommand, IconX } from './Icons.jsx';
import { SHORTCUT_GROUPS } from '../utils/shortcuts.js';

/** 「?」唤出的快捷键速查；也承担新手引导的作用。 */
export default function ShortcutHelp({ open, onClose }) {
  const kit = useMotionKit();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-backdrop shortcuts-backdrop"
          variants={kit.backdrop}
          initial="initial"
          animate="animate"
          exit="exit"
          onClick={onClose}
        >
          <motion.div
            className="shortcuts"
            role="dialog"
            aria-modal="true"
            aria-label="快捷键说明"
            variants={kit.modal}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="shortcuts-head">
              <div>
                <span className="panel-eyebrow">
                  <IconCommand size={14} /> 快捷键
                </span>
                <h3>少点鼠标，多点沉浸</h3>
                <p>在任意页面按 <kbd>?</kbd> 可以再打开这份说明</p>
              </div>
              <button className="icon-btn ghost" onClick={onClose} title="关闭 (Esc)">
                <IconX size={18} />
              </button>
            </header>

            <div className="shortcuts-grid">
              {SHORTCUT_GROUPS.map((group) => (
                <section key={group.title} className="shortcut-group">
                  <h4>{group.title}</h4>
                  <ul>
                    {group.items.map(([keys, label]) => (
                      <li key={`${group.title}-${keys}-${label}`}>
                        <span className="shortcut-label">{label}</span>
                        <span className="shortcut-keys">
                          {String(keys)
                            .split(' / ')
                            .map((key) => (
                              <kbd key={key}>{key}</kbd>
                            ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            <footer className="shortcuts-foot">
              <span>提示：输入框里按 Esc 只会取消输入，不会退出页面</span>
              <button className="btn small ghost" onClick={onClose}>
                知道了
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
