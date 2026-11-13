import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { modalVariants } from '../motion.js';
import { useAppActions } from '../store/AppStore.jsx';
import { usePresence } from '../hooks/usePresence.js';
import { IconX, IconTrash, IconShare, IconSearch } from './Icons.jsx';

const LEVELS = [
  { id: 'error', label: '只看错误' },
  { id: 'warn', label: '警告以上' },
  { id: 'info', label: '常规' },
  { id: 'debug', label: '全部' },
];

const LEVEL_RE = / (ERROR|WARN|INFO|DEBUG) /;

function levelOf(line) {
  const matched = LEVEL_RE.exec(line);
  return matched ? matched[1].toLowerCase() : 'info';
}

function timeOf(line) {
  // 2026-10-24T09:45:43.759Z → 09:45:43
  const matched = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(line);
  return matched ? `${matched[4]}:${matched[5]}:${matched[6]}` : '';
}

function bodyOf(line) {
  const matched = /^\S+ (ERROR|WARN|INFO|DEBUG)\s+(\[[^\]]*\]) ([\s\S]*)$/.exec(line);
  return matched ? { tag: matched[2], message: matched[3] } : { tag: '', message: line };
}

/**
 * 日志面板：读主进程的环形缓冲，支持级别/关键词过滤，可复制、导出、打开目录。
 * 排查书源问题时，用户把这里的东西发过来就够了。
 */
export default function LogPanel({ open, onClose }) {
  const { logTail, logInfo, logLevel, logClear, logOpen, logExport, notify } = useAppActions();
  const alive = usePresence(open);
  const [lines, setLines] = useState([]);
  const [info, setInfo] = useState({ dir: '', level: 'info', files: [], size: 0 });
  const [level, setLevel] = useState('info');
  const [keyword, setKeyword] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  const stickRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [tail, meta] = await Promise.all([logTail({ limit: 800, level }), logInfo()]);
      setLines(Array.isArray(tail) ? tail : []);
      if (meta) setInfo(meta);
    } catch {
      /* 忽略刷新失败 */
    }
  }, [logTail, level, logInfo]);

  useEffect(() => {
    if (!open) return undefined;
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => clearInterval(timer);
  }, [open, refresh]);

  // 打开时默认滚到底部；用户往上翻就不要抢滚动
  useEffect(() => {
    const el = listRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return lines;
    return lines.filter((line) => line.toLowerCase().includes(needle));
  }, [lines, keyword]);

  const copyAll = async () => {
    const text = filtered.join('\n');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      notify(`已复制 ${filtered.length} 行日志`);
    } catch {
      notify('复制失败，可以改用「导出」', 'error');
    }
  };

  const doExport = async () => {
    setBusy(true);
    try {
      const res = await logExport();
      if (res?.ok) notify(`已导出到 ${res.filePath}`);
      else if (!res?.canceled) notify(res?.error || '导出失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const doClear = async () => {
    const res = await logClear();
    if (res?.ok) {
      setLines([]);
      notify('日志已清空');
    } else {
      notify(res?.error || '清空失败', 'error');
    }
  };

  const changeLevel = async (id) => {
    setLevel(id);
    await logLevel(id);
    refresh();
  };

  if (!alive) return null;

  return (
    <div className="modal-backdrop" data-open={open ? 'true' : 'false'} style={{ pointerEvents: open ? 'auto' : 'none' }} onClick={onClose}>
      <motion.div
        className="modal log-modal"
        onClick={(event) => event.stopPropagation()}
        variants={modalVariants}
        initial="initial"
        animate="animate"
        exit="exit"
      >
        <header className="log-head">
          <div>
            <p className="log-eyebrow">调试</p>
            <h3 className="log-title">运行日志</h3>
            <p className="log-sub">
              出问题时点「导出」，把文件发我就能定位。日志只写在本机，不上传。
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <IconX size={16} />
          </button>
        </header>

        <div className="log-bar">
          <div className="log-levels">
            {LEVELS.map((item) => (
              <button
                key={item.id}
                className={`log-level${level === item.id ? ' active' : ''}`}
                onClick={() => changeLevel(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="log-search">
            <IconSearch size={14} />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="过滤关键词（URL、书源名、错误）"
              spellCheck={false}
            />
          </label>
        </div>

        <div
          className="log-body"
          ref={listRef}
          onScroll={(event) => {
            const el = event.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
          }}
        >
          {filtered.length === 0 ? (
            <p className="log-empty">还没有日志。做点操作（导入、搜书、开一章）再回来看看。</p>
          ) : (
            filtered.map((line, index) => {
              const { tag, message } = bodyOf(line);
              return (
                <div className={`log-line ${levelOf(line)}`} key={`${index}-${line.slice(0, 24)}`}>
                  <span className="log-time">{timeOf(line)}</span>
                  <span className={`log-tag ${levelOf(line)}`}>{tag.replace(/[[\]]/g, '') || 'log'}</span>
                  <span className="log-text">{message}</span>
                </div>
              );
            })
          )}
        </div>

        <footer className="log-foot">
          <div className="log-path" title={info.dir || ''}>
            {info.dir ? `${info.dir}` : '（浏览器模式无本地日志）'}
            {info.files?.length ? ` · ${info.files.length} 个文件` : ''}
          </div>
          <div className="log-actions">
            <button className="btn small ghost" onClick={copyAll} disabled={!filtered.length}>
              复制
            </button>
            <button className="btn small ghost" onClick={() => logOpen()} disabled={!info.dir}>
              打开目录
            </button>
            <button className="btn small ghost" onClick={doClear}>
              <IconTrash size={13} />
              清空
            </button>
            <button className="btn small primary" onClick={doExport} disabled={busy || !info.dir}>
              <IconShare size={13} />
              {busy ? '导出中…' : '导出日志'}
            </button>
          </div>
        </footer>
      </motion.div>
    </div>
  );
}
