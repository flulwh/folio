import { useMemo } from 'react';
import { useNotices } from '../hooks/useNotices.js';
import { IconArrowLeft, IconRefresh } from './Icons.jsx';

/**
 * 公告中心：把原来散落在横幅与设置页里的公告收成一页。
 *
 * 已读状态、缓存都复用 `useNotices()`：这一页标已读，返回书架后横幅
 * 会立刻消失，不需要重新启动。
 */
export default function NoticePage({ onClose }) {
  const { notices, seen, loading, reload, markRead, markAllRead } = useNotices();

  // 页面按日期倒序展示；横幅仍按 JSON 原始顺序取「第一条未读」。
  const ordered = useMemo(
    () => [...notices].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
    [notices]
  );
  const unreadCount = notices.filter((item) => !seen.includes(item.id)).length;

  const openNotice = (item) => {
    if (item.url) window.readerAPI?.openExternal?.(item.url);
    markRead(item.id);
  };

  return (
    <div className="settings-page notice-page">
      <header className="settings-page-head">
        <button className="icon-btn ghost" onClick={onClose} title="返回书架 (Esc)" aria-label="返回书架">
          <IconArrowLeft size={19} />
        </button>
        <div className="settings-page-heading">
          <h1>公告</h1>
          <span>{loading ? '正在读取…' : unreadCount ? `${unreadCount} 条未读` : '全部已读'}</span>
        </div>
        <span className="settings-page-version">v{__APP_VERSION__}</span>
      </header>

      <div className="notice-page-body">
        <div className="notice-page-inner">
          <section className="settings-group">
            {loading && ordered.length === 0 ? (
              <p className="settings-hint">正在读取公告…</p>
            ) : ordered.length === 0 ? (
              <p className="settings-hint">暂时没有公告。断网时这里是空的，恢复网络后点「刷新」。</p>
            ) : (
              ordered.map((item) => {
                const unread = !seen.includes(item.id);
                return (
                  <article className="notice-card" key={item.id} data-unread={unread}>
                    <div className="notice-card-head">
                      <strong>{item.title}</strong>
                      {unread && <em className="notice-unread" aria-label="未读" />}
                      {item.date && <span className="notice-card-date">{item.date}</span>}
                    </div>
                    {item.body && <p>{item.body}</p>}
                    <div className="notice-card-actions">
                      {item.url && (
                        <button type="button" className="btn ghost small" onClick={() => openNotice(item)}>
                          查看
                        </button>
                      )}
                      {unread && (
                        <button type="button" className="btn ghost small" onClick={() => markRead(item.id)}>
                          标为已读
                        </button>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </section>

          <div className="notice-page-actions">
            <button
              type="button"
              className="btn ghost small"
              onClick={markAllRead}
              disabled={unreadCount === 0}
            >
              全部已读
            </button>
            <button type="button" className="btn ghost small" onClick={reload} disabled={loading}>
              <IconRefresh size={14} />
              {loading ? '刷新中…' : '刷新'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
