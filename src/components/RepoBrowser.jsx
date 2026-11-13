import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useAppActions, useRules, useSources } from '../store/AppStore.jsx';
import { IconBook, IconCloud, IconSearch, IconSparkle } from './Icons.jsx';

const PAGE_SIZE = 20;

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function agoText(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 0) return '';
  const day = 86400000;
  if (diff < day) return '今天';
  if (diff < day * 2) return '昨天';
  if (diff < day * 30) return `${Math.round(diff / day)} 天前`;
  if (diff < day * 365) return `${Math.round(diff / day / 30)} 个月前`;
  return `${Math.round(diff / day / 365)} 年前`;
}

function viewsText(n) {
  if (!n) return '';
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`;
  return String(n);
}

/**
 * 书源仓库浏览器：列表 / 搜索 / 分页 + 一键导入（单条、本页、整个合集）。
 * 数据由主进程的 repo.js 抓取，导入复用与本地文件、订阅链接相同的合并逻辑。
 */
export default function RepoBrowser({ onImported }) {
  const sources = useSources();
  const rules = useRules();
  const { listRepo, importRepo, notify } = useAppActions();
  const [kind, setKind] = useState('sources');
  const [keyword, setKeyword] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState('');
  const [installed, setInstalled] = useState({});

  const load = useCallback(
    async (nextPage = 1, nextKeyword = '', nextKind = kind) => {
      setLoading(true);
      setError('');
      try {
        const res = await listRepo({ type: nextKind, keyword: nextKeyword, page: nextPage, pageSize: PAGE_SIZE });
        if (res?.ok === false) {
          setError(res.message || '仓库读取失败');
          setData(null);
        } else {
          setData(res);
          setPage(res?.page || nextPage);
        }
      } catch (err) {
        setError(err?.message || '仓库读取失败');
      } finally {
        setLoading(false);
      }
    },
    [kind, listRepo]
  );

  useEffect(() => {
    load(1, '', 'sources');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const haveName = useMemo(() => new Set(sources.map((item) => String(item.name || ''))), [sources]);
  const haveHost = useMemo(() => new Set(sources.map((item) => hostOf(item.baseUrl)).filter(Boolean)), [sources]);
  const isInstalled = (item) => Boolean(installed[item.id]) || haveName.has(item.name) || (item.host && haveHost.has(item.host));

  const switchKind = (next) => {
    if (next === kind) return;
    setKind(next);
    setInstalled({});
    load(1, query, next);
  };

  const submitSearch = () => {
    const text = keyword.trim();
    setQuery(text);
    setInstalled({});
    load(1, text, kind);
  };

  const importOne = async (item) => {
    setBusy(`one:${item.id}`);
    setFlash('');
    try {
      const res = await importRepo({ mode: 'single', id: item.id });
      if (res?.error) notify(res.error, 'error');
      else {
        const bits = [];
        if (res?.added) bits.push(`新增 ${res.added}`);
        if (res?.updated) bits.push(`更新 ${res.updated}`);
        notify(`已导入「${item.name}」${bits.length ? `：${bits.join('，')}` : ''}`);
        setInstalled((prev) => ({ ...prev, [item.id]: '已导入' }));
        onImported?.(res);
      }
    } catch (err) {
      notify(err?.message || '导入失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const importPage = async () => {
    const list = data?.items || [];
    if (!list.length) return;
    const from = (data.page - 1) * (data.pageSize || PAGE_SIZE) + 1;
    const to = from + list.length - 1;
    setBusy('page');
    setFlash('');
    try {
      const res = await importRepo({ mode: 'range', from, to });
      if (res?.error) notify(res.error, 'error');
      else {
        const bits = [`新增 ${res?.added || 0}`, `更新 ${res?.updated || 0}`];
        if (res?.errors?.length) bits.push(`失败 ${res.errors.length}`);
        notify(`本页导入完成：${bits.join('，')}`);
        setFlash(`已导入第 ${from}–${to} 号书源`);
        const marks = {};
        list.forEach((item) => {
          marks[item.id] = '已导入';
        });
        setInstalled((prev) => ({ ...prev, ...marks }));
        onImported?.(res);
      }
    } catch (err) {
      notify(err?.message || '导入失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const importCollection = async (item) => {
    setBusy(`col:${item.id}`);
    try {
      const res = await importRepo({ mode: 'collection', collectionId: item.id });
      if (res?.error) notify(res.error, 'error');
      else {
        const bits = [`新增 ${res?.added || 0}`, `更新 ${res?.updated || 0}`];
        if (res?.errors?.length) bits.push(`失败 ${res.errors.length}`);
        notify(`已导入合集「${item.name}」：${bits.join('，')}`);
        setInstalled((prev) => ({ ...prev, [item.id]: '已导入' }));
        onImported?.(res);
      }
    } catch (err) {
      notify(err?.message || '导入失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const items = data?.items || [];
  const pages = data?.pages || 1;
  const total = data?.total || 0;

  return (
    <div className="repo">
      <div className="repo-top">
        <div className="repo-kinds">
          <button className={`repo-kind${kind === 'sources' ? ' active' : ''}`} onClick={() => switchKind('sources')}>
            书源列表
          </button>
          <button className={`repo-kind${kind === 'collections' ? ' active' : ''}`} onClick={() => switchKind('collections')}>
            书源合集
          </button>
        </div>
        <div className="repo-search">
          <IconSearch size={14} />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitSearch()}
            placeholder={kind === 'sources' ? '搜索书源名称 / 站点' : '搜索合集'}
            spellCheck={false}
          />
          <button className="btn tiny primary" onClick={submitSearch} disabled={loading}>
            {loading ? '读取中' : '搜索'}
          </button>
        </div>
      </div>

      <div className="repo-bar">
        <span className="repo-meta">
          {error
            ? '读取失败'
            : data
              ? `共 ${total} ${kind === 'sources' ? '个书源' : '个合集'} · 第 ${data.page} / ${pages} 页`
              : '正在连接仓库…'}
          {query ? ` · 关键词「${query}」` : ''}
        </span>
        <div className="repo-actions">
          <button
            className="btn tiny ghost"
            onClick={() => load(data.page - 1, query, kind)}
            disabled={loading || !data || data.page <= 1}
            title="上一页"
          >
            上一页
          </button>
          <span className="repo-page">{data ? `${data.page} / ${pages}` : '—'}</span>
          <button
            className="btn tiny ghost"
            onClick={() => load(data.page + 1, query, kind)}
            disabled={loading || !data || data.page >= pages}
            title="下一页"
          >
            下一页
          </button>
          {kind === 'sources' && (
            <button className="btn tiny primary" onClick={importPage} disabled={busy === 'page' || !items.length}>
              {busy === 'page' ? '导入中…' : `导入本页 ${items.length || PAGE_SIZE} 个`}
            </button>
          )}
          <button className="btn tiny ghost" onClick={() => load(data?.page || 1, query, kind)} disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {flash && <div className="repo-flash">{flash}</div>}

      {error ? (
        <div className="source-empty">
          <IconCloud size={20} />
          <h3>仓库暂时连不上</h3>
          <p>{error}</p>
          <p className="source-hint">书源仓库是第三方站点（shuyuan.yiove.com），被墙或站点故障时可以稍后再试，或改用订阅链接导入。</p>
        </div>
      ) : !data && loading ? (
        <div className="source-empty">
          <IconSparkle size={20} />
          <h3>正在读取仓库…</h3>
        </div>
      ) : items.length === 0 ? (
        <div className="source-empty">
          <IconSearch size={20} />
          <h3>没有匹配的{kind === 'sources' ? '书源' : '合集'}</h3>
          <p>换个关键词试试。</p>
        </div>
      ) : (
        <ul className="source-list repo-list">
          {items.map((item) => {
            const done = isInstalled(item);
            return (
              <motion.li key={item.id} className="source-row repo-row" layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <div className="source-main">
                  <div className="source-line">
                    <span className="source-name" title={item.name}>
                      {item.name}
                    </span>
                    {kind === 'collections' && item.count ? (
                      <span className="source-badge group">{item.count} 个书源</span>
                    ) : null}
                    {item.valid === false ? <span className="source-badge js">已失效</span> : null}
                  </div>
                  <div className="source-sub">
                    {kind === 'sources' ? (
                      <>
                        <span>{item.host || item.url || '未知站点'}</span>
                        {item.views ? <span>· {viewsText(item.views)} 次查看</span> : null}
                        {item.createdAt ? <span>· {agoText(item.createdAt)}</span> : null}
                      </>
                    ) : (
                      <>
                        {item.description ? <span className="repo-desc">{item.description}</span> : null}
                        {item.views ? <span>· {viewsText(item.views)} 次查看</span> : null}
                        {item.createdAt ? <span>· {agoText(item.createdAt)}</span> : null}
                      </>
                    )}
                  </div>
                </div>
                <div className="source-actions">
                  {done ? (
                    <span className="repo-installed">
                      <IconBook size={12} /> 已导入
                    </span>
                  ) : (
                    <button
                      className="btn tiny primary"
                      onClick={() => (kind === 'collections' ? importCollection(item) : importOne(item))}
                      disabled={Boolean(busy)}
                    >
                      {busy === `one:${item.id}` || busy === `col:${item.id}` ? '导入中…' : '导入'}
                    </button>
                  )}
                </div>
              </motion.li>
            );
          })}
        </ul>
      )}

      <div className="repo-bottom">
        <span className="repo-meta">
          {data ? `第 ${data.page} / ${pages} 页 · 共 ${total} ${kind === 'sources' ? '个书源' : '个合集'}` : ''}
        </span>
        <div className="repo-pager">
          <button className="btn tiny ghost" onClick={() => load(data.page - 1, query, kind)} disabled={loading || !data || data.page <= 1}>
            上一页
          </button>
          <span>{data ? `${data.page} / ${pages}` : '—'}</span>
          <button
            className="btn tiny ghost"
            onClick={() => load(data.page + 1, query, kind)}
            disabled={loading || !data || data.page >= pages}
          >
            下一页
          </button>
        </div>
      </div>

      <p className="repo-note">
        仓库内容来自第三方站点 shuyuan.yiove.com（{rules.length ? `本机已有 ${sources.length} 个书源、${rules.length} 条规则` : `本机已有 ${sources.length} 个书源`}）。
        导入的书源直接连源站抓取，我们不提供服务器，也不代理任何内容。
      </p>
    </div>
  );
}
