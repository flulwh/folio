import { useState } from 'react';
import { IconSparkle, IconX } from './Icons.jsx';
import { useNotices } from '../hooks/useNotices.js';

/**
 * 启动公告横幅：只显示第一条未读公告。
 *
 * 关掉即记为已读，下次启动不再打扰；设置 → 关于里仍能回看全部公告。
 */
export default function NoticeBanner() {
  const { notices, seen, loading, markRead } = useNotices();
  const [closed, setClosed] = useState([]);

  const notice = notices.find((item) => !seen.includes(item.id) && !closed.includes(item.id));
  if (loading || !notice) return null;

  const close = () => {
    setClosed((prev) => [...prev, notice.id]);
    markRead(notice.id);
  };

  const open = () => {
    if (notice.url) window.readerAPI?.openExternal?.(notice.url);
    close();
  };

  return (
    <aside className="notice-banner" data-level={notice.level} role="status" aria-live="polite">
      <span className="notice-banner-mark" aria-hidden="true">
        <IconSparkle size={16} />
      </span>
      <div className="notice-banner-body">
        <strong>{notice.title}</strong>
        {notice.body && <p>{notice.body}</p>}
      </div>
      {notice.url && (
        <button type="button" className="btn ghost small" onClick={open}>
          查看
        </button>
      )}
      <button type="button" className="notice-banner-close" onClick={close} aria-label="关闭公告">
        <IconX size={14} />
      </button>
    </aside>
  );
}
