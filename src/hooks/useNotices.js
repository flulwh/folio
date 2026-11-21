import { useCallback, useEffect, useState } from 'react';

/**
 * 公告的读取与已读状态。
 *
 * 数据源是官网 Pages 上的 `notice.json`（主进程代取，避开渲染层跨域），
 * 已读 id 存在 localStorage：公告只是提示，不值得为它写一份用户数据文件。
 * 一次会话里多个入口（横幅、设置页）共用同一份缓存，避免重复请求。
 */
const SEEN_KEY = 'folio.notice.seen';
const CACHE_MS = 5 * 60 * 1000;

let cache = null;
let inflight = null;

function readSeen() {
  try {
    const saved = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeSeen(ids) {
  try {
    // 只留最近 50 条，避免这个键无限长。
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-50)));
  } catch {
    /* 隐私模式下写不进去：本次会话仍然生效 */
  }
}

export function useNotices() {
  const [notices, setNotices] = useState(cache?.notices || []);
  const [seen, setSeen] = useState(readSeen);
  const [loading, setLoading] = useState(!cache);

  const load = useCallback(async (force = false) => {
    const api = window.readerAPI;
    if (!api?.fetchNotices) {
      setLoading(false);
      return;
    }
    if (!force && cache && Date.now() - cache.at < CACHE_MS) {
      setNotices(cache.notices);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      if (!inflight) inflight = api.fetchNotices();
      const res = await inflight;
      if (res?.ok && Array.isArray(res.notices)) {
        cache = { at: Date.now(), notices: res.notices };
        setNotices(res.notices);
      }
    } catch {
      /* 断网就当作没有公告 */
    } finally {
      inflight = null;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const markRead = useCallback((id) => {
    setSeen((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      writeSeen(next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setSeen((prev) => {
      const next = [...new Set([...prev, ...notices.map((item) => item.id)])];
      writeSeen(next);
      return next;
    });
  }, [notices]);

  return {
    notices,
    seen,
    loading,
    reload: () => load(true),
    markRead,
    markAllRead,
  };
}
