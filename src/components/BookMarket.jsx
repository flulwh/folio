import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { SPRING } from '../motion.js';
import { cleanSourceName } from '../utils/text.js';
import { useAppActions, useBooks, useSettings, useSources, dataApi } from '../store/AppStore.jsx';
import {
  IconArrowLeft,
  IconBook,
  IconChevron,
  IconCloud,
  IconSearch,
  IconSparkle,
} from './Icons.jsx';

const SEARCH_LIMIT = 24;
const SUGGESTIONS = ['玄幻', '都市', '修仙', '悬疑', '科幻', '系统'];

/* 离开书市去读书再回来时，把上一次的搜索状态接上（不落盘，只存在会话里） */
let marketCache = null;

function hashHue(name) {
  let h = 0;
  const text = String(name || '');
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

function coverStyle(name) {
  const hue = hashHue(name);
  return {
    background: `linear-gradient(150deg, hsl(${hue} 32% 74%), hsl(${(hue + 26) % 360} 34% 58%))`,
  };
}

function MarketCard({ item, added, index, onOpen }) {
  const isComic = Number(item.type) === 2;
  return (
    <motion.div
      className="market-card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING.card, delay: Math.min(index, 16) * 0.016 }}
    >
      <button className="market-cover" onClick={() => onOpen(item)} title={item.name}>
        <span className="market-cover-art" style={coverStyle(item.name)}>
          <span className="market-cover-glyph">{String(item.name || '书').slice(0, 1)}</span>
        </span>
        {item.cover ? (
          <img
            src={item.cover}
            alt=""
            loading="lazy"
            draggable={false}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : null}
        <span className="market-cover-shade" />
        {isComic && <span className="market-badge">漫画</span>}
        {added && <span className="market-badge in-shelf">在书架</span>}
        <span className="market-cover-cta">
          {added ? '继续阅读' : '加入书架并阅读'}
        </span>
      </button>
      <div className="market-card-text">
        <button className="market-card-title" onClick={() => onOpen(item)} title={item.name}>
          {item.name || '未命名'}
        </button>
        <div className="market-card-meta">
          <span>{item.author || '佚名'}</span>
          <span className="dot">·</span>
          <span className="market-source" title={`来自书源：${item.sourceName || ''}`}>
            <IconCloud size={11} />
            {cleanSourceName(item.sourceName) || '书源'}
          </span>
        </div>
        {item.intro && <p className="market-card-intro">{item.intro}</p>}
      </div>
    </motion.div>
  );
}

function SkeletonGrid() {
  return (
    <div className="market-grid" aria-hidden="true">
      {Array.from({ length: 12 }).map((_, i) => (
        <div className="market-card market-skeleton" key={i}>
          <span className="market-cover" />
          <span className="market-skeleton-line" style={{ width: '72%' }} />
          <span className="market-skeleton-line" style={{ width: '46%' }} />
        </div>
      ))}
    </div>
  );
}

export default function BookMarket({ onClose, onOpenBook }) {
  const sources = useSources();
  const books = useBooks();
  const settings = useSettings();
  const { notify, addCloudBook, toggleSource } = useAppActions();
  const cached = marketCache;

  const [kind, setKind] = useState(() => {
    const saved = cached?.kind || localStorage.getItem('folio:market-kind') || 'all';
    return saved === 'comic' || saved === 'novel' ? saved : 'all';
  });
  const kindSources = useMemo(
    () =>
      sources.filter((s) =>
        kind === 'all' ? true : kind === 'comic' ? s.type === 2 : s.type !== 2
      ),
    [sources, kind]
  );
  const enabled = useMemo(() => kindSources.filter((s) => s.enabled !== false), [kindSources]);
  const [picked, setPicked] = useState(
    () => new Set(cached?.picked || sources.filter((s) => s.enabled !== false).map((s) => s.id))
  );
  const [keyword, setKeyword] = useState(cached?.keyword || '');
  const [results, setResults] = useState(cached?.results || null);
  const [errors, setErrors] = useState(cached?.errors || []);
  const [skipped, setSkipped] = useState(cached?.skipped || []);
  const [remaining, setRemaining] = useState(cached?.remaining || 0);
  const [page, setPage] = useState(cached?.page || 1);
  const [busy, setBusy] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const inputRef = useRef(null);
  const bodyRef = useRef(null);
  const shelfKeys = useMemo(() => new Set(books.map((b) => b.id)), [books]);

  // 勾选跨类型保留；切到某一类时，如果这一类一个都没勾就自动全勾上
  useEffect(() => {
    setPicked((prev) => {
      const allow = new Set(sources.map((s) => s.id));
      const next = new Set([...prev].filter((id) => allow.has(id)));
      const pickedInKind = enabled.some((s) => next.has(s.id));
      if (!pickedInKind) for (const s of enabled) next.add(s.id);
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
      return next;
    });
  }, [enabled, sources]);

  useEffect(() => {
    try {
      localStorage.setItem('folio:market-kind', kind);
    } catch {}
  }, [kind]);

  // 切换类型时，上一次搜索的报错/跳过/剩余会串台，先清掉
  useEffect(() => {
    setErrors([]);
    setSkipped([]);
    setRemaining(0);
  }, [kind]);

  // 记住这次的浏览状态，读完书回来还在
  useEffect(() => {
    marketCache = { picked: [...picked], kind, keyword, results, errors, skipped, remaining, page };
  }, [picked, kind, keyword, results, errors, skipped, remaining, page]);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 260);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
      if (event.key === '/' && document.activeElement !== inputRef.current) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const search = useCallback(
    async ({ all = false, append = false } = {}) => {
      const value = keyword.trim();
      if (!value) {
        inputRef.current?.focus();
        return;
      }
      const ids = enabled.filter((s) => picked.has(s.id)).map((s) => s.id);
      if (!ids.length) {
        notify(
          kind === 'all'
            ? '先在左侧勾选至少一个书源'
            : `还没有可用的${kind === 'comic' ? '漫画' : '小说'}书源，切到「全部」或先启用一个`,
          'error'
        );
        return;
      }
      const nextPage = append ? page + 1 : 1;
      if (append) setMoreBusy(true);
      else {
        setBusy(true);
        setResults(null);
        setErrors([]);
        setSkipped([]);
        setRemaining(0);
      }
      try {
        const res = await dataApi.searchCloud({
          keyword: value,
          sourceIds: ids,
          page: nextPage,
          proxy: settings.proxy || '',
          limit: all ? 0 : SEARCH_LIMIT,
        });
        const incoming = (res?.results || []).map((item) => ({
          ...item,
          key: `cloud::${item.sourceId}::${item.bookUrl}`,
        }));
        setErrors(res?.errors || []);
        setSkipped(res?.skipped || []);
        setRemaining(res?.remaining || 0);
        setPage(nextPage);
        setResults((prev) => {
          const base = append && Array.isArray(prev) ? prev : [];
          const seen = new Set(base.map((item) => item.key));
          return [...base, ...incoming.filter((item) => !seen.has(item.key))];
        });
        if (!append) bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        if (!incoming.length && !append) {
          if (!(res?.errors || []).length) notify('没有搜到，换个关键词试试');
        }
      } catch (err) {
        notify(err.message || '搜索失败', 'error');
        if (!append) setResults([]);
      } finally {
        setBusy(false);
        setMoreBusy(false);
      }
    },
    [enabled, keyword, kind, notify, page, picked, settings.proxy]
  );

  const openBook = useCallback(
    (item) => {
      const entry = addCloudBook(item);
      if (entry) onOpenBook?.(entry);
    },
    [addCloudBook, onOpenBook]
  );

  const togglePicked = (id) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const kindPicked = enabled.filter((s) => picked.has(s.id));
  const activeCount = kindPicked.length;
  const kindCounts = useMemo(
    () => ({
      all: sources.length,
      novel: sources.filter((s) => s.type !== 2).length,
      comic: sources.filter((s) => s.type === 2).length,
    }),
    [sources]
  );
  const shownResults = useMemo(() => {
    if (results === null) return null;
    if (kind === 'all') return results;
    return results.filter((item) => (kind === 'comic' ? item.type === 2 : item.type !== 2));
  }, [results, kind]);
  const resultSources = useMemo(() => {
    const map = new Map();
    for (const item of shownResults || []) {
      const key = item.sourceName || item.sourceId;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [shownResults]);

  return (
    <div className="market">
      <header className="market-header">
        <button className="icon-btn ghost market-back" onClick={onClose} title="返回书架 (Esc)">
          <IconArrowLeft size={18} />
        </button>
        <div className="market-title">
          <span className="market-eyebrow">Book Market</span>
          <h1>书籍市场</h1>
          <p>
            在 <b>{activeCount}</b> 个书源里找书，选中即可加入书架并直接阅读。
          </p>
        </div>
        <div className="market-stats">
          <span>
            <b>{sources.length}</b>
            书源
          </span>
          <span>
            <b>{enabled.length}</b>
            已启用
          </span>
        </div>
      </header>

      <div className="market-kind-tabs" role="tablist" aria-label="内容类型">
        {[
          { id: 'all', label: '全部', hint: '小说和漫画一起搜' },
          { id: 'novel', label: '小说', hint: '只搜文字书源' },
          { id: 'comic', label: '漫画', hint: '只搜图片书源' },
        ].map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={kind === tab.id}
            className={`market-kind-tab${kind === tab.id ? ' active' : ''}`}
            title={tab.hint}
            onClick={() => setKind(tab.id)}
          >
            {tab.label}
            <b>{kindCounts[tab.id]}</b>
          </button>
        ))}
        <span className="market-kind-note">
          {kind === 'comic'
            ? '只搜漫画书源，找到的书用图片阅读器打开'
            : kind === 'novel'
              ? '只搜小说书源，找到的书按章节文字显示'
              : '小说和漫画书源一起搜，也可以按类型缩小范围'}
        </span>
      </div>

      <div className="market-search">
        <label className="market-search-box">
          <IconSearch size={19} />
          <input
            ref={inputRef}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') search();
            }}
            placeholder="搜书名、作者，回车搜索"
            spellCheck={false}
          />
          {keyword && (
            <button
              className="market-search-clear"
              onClick={() => {
                setKeyword('');
                inputRef.current?.focus();
              }}
              title="清空"
            >
              清空
            </button>
          )}
        </label>
        <button className="btn primary market-search-btn" onClick={() => search()} disabled={busy}>
          <IconSearch size={16} />
          {busy ? '搜索中…' : '搜索'}
        </button>
      </div>

      <div className="market-suggest">
        <span className="market-suggest-label">试试</span>
        {SUGGESTIONS.map((word) => (
          <button
            key={word}
            className="market-chip"
            onClick={() => {
              setKeyword(word);
              inputRef.current?.focus();
            }}
          >
            {word}
          </button>
        ))}
        {resultSources.size > 0 && (
          <span className="market-hit-sources">
            {[...resultSources.entries()].slice(0, 5).map(([name, count]) => (
              <span key={name} className="market-hit-source">
                {name}
                <b>{count}</b>
              </span>
            ))}
          </span>
        )}
      </div>

      <div className="market-body">
        <aside className="market-rail">
          <div className="market-rail-head">
            <span>书源</span>
            <button
              className="market-rail-link"
              onClick={() =>
                setPicked((prev) => {
                  const next = new Set(prev);
                  const allPicked = enabled.length > 0 && enabled.every((s) => next.has(s.id));
                  for (const s of enabled) {
                    if (allPicked) next.delete(s.id);
                    else next.add(s.id);
                  }
                  return next;
                })
              }
            >
              {enabled.length > 0 && enabled.every((s) => picked.has(s.id)) ? '取消全选' : '全选'}
            </button>
          </div>
          <ul className="market-source-list">
            {kindSources.map((source) => {
              const active = source.enabled !== false;
              const isPicked = active && picked.has(source.id);
              const failed = source.stat && source.stat.ok === false;
              return (
                <li key={source.id}>
                  <label
                    className={`market-source-item${isPicked ? ' picked' : ''}${active ? '' : ' off'}`}
                    title={source.name}
                  >
                    <input
                      type="checkbox"
                      checked={isPicked}
                      onChange={() => {
                        if (!active) {
                          toggleSource?.(source.id, true);
                          setPicked((prev) => new Set(prev).add(source.id));
                          return;
                        }
                        togglePicked(source.id);
                      }}
                    />
                    <span
                      className={`market-dot${active ? (failed ? ' bad' : source.stat?.ok ? ' good' : '') : ''}`}
                      title={source.stat?.message || '还没试搜过'}
                    />
                    <span className="market-source-name">{source.name}</span>
                    {active ? (
                      <button
                        className="market-source-toggle"
                        title="停用这个书源"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleSource?.(source.id, false);
                          setPicked((prev) => {
                            const next = new Set(prev);
                            next.delete(source.id);
                            return next;
                          });
                        }}
                      >
                        停用
                      </button>
                    ) : (
                      <span className="market-source-off">未启用</span>
                    )}
                  </label>
                </li>
              );
            })}
            {!kindSources.length && (
              <li className="market-rail-empty">
                {sources.length
                  ? '这个类型下还没有书源，切换上方「全部」看看。'
                  : '还没有书源，先去书架页「书源」里导入。'}
              </li>
            )}
          </ul>
          <p className="market-rail-note">
            只列{kind === 'all' ? '全部' : kind === 'comic' ? '漫画' : '小说'}书源；勾选的一起搜，源多时按健康度只搜前 {SEARCH_LIMIT} 个。
          </p>
        </aside>

        <div className="market-results" ref={bodyRef}>
          <AnimatePresence mode="wait" initial={false}>
            {busy ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="market-scan">
                  <span className="reader-measuring-dot" />
                  正在向 {activeCount} 个书源请求…
                </div>
                <SkeletonGrid />
              </motion.div>
            ) : results === null ? (
              <motion.div
                key="idle"
                className="market-idle"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <div className="market-idle-mark">
                  <IconBook size={26} />
                </div>
                <h2>想看什么书？</h2>
                <p>
                  输入书名或作者，一次搜索多个书源。找到后点封面就会加入书架，
                  正文直接从源站取，不走任何中转服务器。
                </p>
                <div className="market-idle-tips">
                  <span>
                    <IconSparkle size={13} /> 搜不到就换关键词，或减少左侧勾选的书源
                  </span>
                  <span>
                    <IconCloud size={13} /> 搜索结果里「漫画」标记的书会用图片阅读器打开
                  </span>
                </div>
              </motion.div>
            ) : results.length === 0 ? (
              <motion.div
                key="empty"
                className="market-idle"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <div className="market-idle-mark">
                  <IconSearch size={24} />
                </div>
                <h2>没有搜到「{keyword.trim()}」</h2>
                <p>
                  可能这些站点暂时不可达，或者规则里的选择器失效了。
                  {errors.length ? `（${errors.length} 个书源报了错，见下方说明）` : ''}
                </p>
                <button className="btn ghost" onClick={() => search({ all: true })}>
                  搜全部书源再试一次
                </button>
              </motion.div>
            ) : shownResults.length === 0 ? (
              <motion.div
                key="kind-empty"
                className="market-idle"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <div className="market-idle-mark">
                  <IconBook size={24} />
                </div>
                <h2>这次只搜到了{kind === 'comic' ? '小说' : '漫画'}</h2>
                <p>
                  当前范围是「{kind === 'comic' ? '漫画' : '小说'}」，但匹配的结果都在另一边。
                  切到「全部」就能直接看到这些书。
                </p>
                <button className="btn ghost" onClick={() => setKind('all')}>
                  看全部结果
                </button>
              </motion.div>
            ) : (
              <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="market-result-head">
                  <span>
                    「{keyword.trim()}」找到 <b>{shownResults.length}</b> 本
                  </span>
                  <span className="market-result-sub">
                    来自 {resultSources.size} 个书源
                    {kind === 'all' ? '' : ` · 只看${kind === 'comic' ? '漫画' : '小说'}`}
                    {remaining > 0 ? ` · 还有 ${remaining} 个源没搜` : ''}
                  </span>
                </div>
                <div className="market-grid">
                  {shownResults.map((item, i) => (
                    <MarketCard
                      key={item.key}
                      item={item}
                      index={i}
                      added={shelfKeys.has(item.key)}
                      onOpen={openBook}
                    />
                  ))}
                </div>
                <div className="market-more">
                  <button className="btn ghost" onClick={() => search({ append: true })} disabled={moreBusy}>
                    {moreBusy ? '加载中…' : '再看一批'}
                    <IconChevron size={14} />
                  </button>
                  {remaining > 0 && (
                    <button className="btn ghost" onClick={() => search({ all: true })} disabled={busy}>
                      搜索全部 {remaining + SEARCH_LIMIT} 个书源
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {skipped.length > 0 && (
            <p className="market-skipped">
              已跳过 {skipped.length} 个最近试搜失败的书源（
              {skipped.slice(0, 4).map((item) => item.sourceName).join('、')}
              {skipped.length > 4 ? ' 等' : ''}）。
            </p>
          )}

          {errors.length > 0 && (
            <div className="market-errors">
              <button className="market-errors-head" onClick={() => setShowErrors((v) => !v)}>
                <span>{errors.length} 个书源没有响应</span>
                <IconChevron size={14} className={showErrors ? 'open' : ''} />
              </button>
              {showErrors && (
                <ul>
                  {errors.map((item, i) => (
                    <li key={i}>
                      <strong>{item.sourceName || item.sourceId || '未知书源'}</strong>
                      <span>{item.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      <footer className="market-foot">
        <span>内容来自你导入的第三方站点，本应用不提供服务器，也不代理任何内容。</span>
        <span className="market-foot-keys">
          <kbd>/</kbd> 聚焦搜索 <kbd>Esc</kbd> 返回书架
        </span>
      </footer>
    </div>
  );
}
