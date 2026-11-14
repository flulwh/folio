import React, { useCallback, useEffect, useState } from 'react';
import { useAppActions, useFonts } from '../store/AppStore.jsx';
import { fontFamilyName } from '../hooks/useFontLoader.js';

/**
 * 字体商店。
 *
 * 目录来自 flulwh/folio-fonts 的 catalog.json，字体本体是那个仓库 Release 的
 * assets。主进程负责下载与校验，这里只做三件事：列卡片、显示进度、发安装/移除指令。
 *
 * 已安装的卡片用真字体渲染预览段落 —— 字体已经通过 useFontLoader 注册进文档，
 * 这里只需要把 font-family 指到 `FolioUser_<id>` 就能看见真实字形。
 */

function formatSize(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1048576) return `${(value / 1048576).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function formatDate(ts) {
  if (!Number(ts)) return '';
  try {
    return new Date(ts).toLocaleDateString('zh-CN');
  } catch {
    return '';
  }
}

export default function FontStoreTab() {
  const installed = useFonts();
  const { refreshFontCatalog, installStoreFont, onFontStoreProgress, removeFont } = useAppActions();
  const [catalog, setCatalog] = useState({ loading: true, fonts: [], source: '', fetchedAt: 0, error: '' });
  const [progress, setProgress] = useState({});
  const [busyId, setBusyId] = useState('');
  const [pendingRemove, setPendingRemove] = useState('');

  const load = useCallback(
    async (force) => {
      setCatalog((prev) => ({ ...prev, loading: true }));
      const res = await refreshFontCatalog(force);
      const ok = Boolean(res?.ok);
      setCatalog({
        loading: false,
        fonts: Array.isArray(res?.fonts) ? res.fonts : [],
        source: res?.source || '',
        fetchedAt: res?.fetchedAt || 0,
        error: ok ? res?.error || '' : res?.error || '字体目录获取失败',
      });
    },
    [refreshFontCatalog]
  );

  useEffect(() => {
    load(false);
    // 只在面板第一次出现时拉一次，之后由「刷新」按钮决定是否强制走网络
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const off = onFontStoreProgress((payload) => {
      if (!payload?.id) return;
      setProgress((prev) => ({
        ...prev,
        [payload.id]: { received: Number(payload.received) || 0, total: Number(payload.total) || 0 },
      }));
    });
    return () => off?.();
  }, [onFontStoreProgress]);

  const handleInstall = async (id) => {
    setBusyId(id);
    try {
      const res = await installStoreFont(id);
      if (res?.ok) await load(false);
    } finally {
      setBusyId('');
      setProgress((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleRemove = async (id) => {
    if (pendingRemove !== id) {
      setPendingRemove(id);
      return;
    }
    setPendingRemove('');
    await removeFont(id);
    await load(false);
  };

  if (catalog.loading && !catalog.fonts.length) {
    return <p className="font-store-hint">正在获取字体目录…</p>;
  }

  if (!catalog.fonts.length) {
    return (
      <div className="font-store-empty">
        <p className="font-store-hint">{catalog.error || '目录里暂时没有字体'}</p>
        <button className="btn ghost small" type="button" onClick={() => load(true)}>
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="font-store">
      <div className="font-store-head">
        <span className="font-store-hint">
          {catalog.source === 'network' ? '在线目录' : '本地缓存'}
          {catalog.fetchedAt ? ` · ${formatDate(catalog.fetchedAt)}` : ''}
          {catalog.error ? ` · ${catalog.error}` : ''}
        </span>
        <button className="btn ghost small" type="button" onClick={() => load(true)} disabled={catalog.loading}>
          {catalog.loading ? '刷新中…' : '刷新目录'}
        </button>
      </div>

      <div className="font-store-list">
        {catalog.fonts.map((font) => {
          const local = installed.find((item) => item.catalogId === font.id || item.id === font.id);
          const installing = busyId === font.id;
          const tick = progress[font.id];
          const pct = tick?.total ? Math.min(100, Math.round((tick.received / tick.total) * 100)) : 0;
          const confirming = pendingRemove === local?.id;
          return (
            <div key={font.id} className="font-store-card">
              <div className="font-store-card-head">
                <div className="font-store-name">
                  {font.name}
                  <span className="font-store-sub">{font.family}</span>
                </div>
                <div className="font-store-meta">
                  {font.file.format.toUpperCase()} · {formatSize(font.file.size)}
                  {font.license?.spdx ? ` · ${font.license.spdx}` : ''}
                </div>
              </div>

              {font.description && <p className="font-store-desc">{font.description}</p>}

              <p
                className="font-store-preview"
                style={
                  local ? { fontFamily: `"${fontFamilyName(local.id)}", var(--font-sans)` } : undefined
                }
              >
                {font.preview || `${font.name} 0123`}
              </p>

              <div className="font-store-actions">
                {installing ? (
                  <div className="font-store-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <span className="font-store-progress-bar" style={{ width: `${pct}%` }} />
                    <span className="font-store-progress-text">
                      {tick?.total ? `下载中 ${pct}%` : '准备下载…'}
                    </span>
                  </div>
                ) : local ? (
                  <button
                    className={`btn ghost small${confirming ? ' danger' : ''}`}
                    type="button"
                    onClick={() => handleRemove(local.id)}
                  >
                    {confirming ? '再点一次确认移除' : '移除'}
                  </button>
                ) : (
                  <button className="btn ghost small" type="button" onClick={() => handleInstall(font.id)}>
                    安装
                  </button>
                )}
                {font.homepage && (
                  <a className="font-store-link" href={font.homepage} target="_blank" rel="noreferrer">
                    来源
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="font-store-hint">
        字体来自各上游开源项目（OFL-1.1），装在本地，不上传任何数据。
      </p>
    </div>
  );
}
