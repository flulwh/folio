import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { modalVariants } from '../motion.js';
import {
  useAppActions,
  useRules,
  useSettings,
  useSources,
} from '../store/AppStore.jsx';
import { IconCloud, IconPlus, IconSearch, IconSparkle, IconTrash, IconX } from './Icons.jsx';
import RepoBrowser from './RepoBrowser.jsx';
import { usePresence } from '../hooks/usePresence.js';

const EXAMPLE_FEEDS = [
  ['大灰狼源合集', 'https://raw.githubusercontent.com/shidahuilang/shuyuan/shuyuan/good.json'],
  ['大灰狼净化规则', 'https://raw.githubusercontent.com/shidahuilang/shuyuan/shuyuan/jinghua.json'],
];

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url || '';
  }
}

const PAGE_STEP = 60;

function SourceRow({ source, onToggle, onTest, onRemove, testing, checked, onCheck }) {
  const [result, setResult] = useState(null);
  const unsupported = source.unsupported || [];
  const stat = source.stat || null;

  const test = async () => {
    setResult({ pending: true });
    const res = await onTest(source);
    setResult(res);
  };

  return (
    <motion.li className={`source-row${checked ? ' picked' : ''}`} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <input
        type="checkbox"
        className="source-check"
        checked={Boolean(checked)}
        onChange={(e) => onCheck?.(source.id, e.target.checked)}
        title="选中以批量操作"
      />
      <div className="source-main">
        <div className="source-line">
          <span className="source-name" title={source.name}>
            {source.name}
          </span>
          <span className={`source-badge ${source.dialect}`}>
            {source.dialect === 'legado' ? '阅读' : 'Folio'}
          </span>
          {source.type ? <span className="source-badge group">{source.typeLabel}</span> : null}
          {source.hasSearch === false ? (
            <span className="source-badge warn" title="没有 searchUrl / ruleSearch，无法在「网上搜书」里使用">
              无搜索
            </span>
          ) : null}
          {stat ? (
            <span
              className={`source-stat${stat.ok ? (stat.count > 0 ? ' good' : ' idle') : ' bad'}`}
              title={`${stat.message || ''}${stat.at ? ` · ${new Date(stat.at).toLocaleString()}` : ''}`}
            >
              {stat.ok ? (stat.count > 0 ? `命中 ${stat.count}` : '无结果') : '失败'}
            </span>
          ) : null}
          {unsupported.length > 0 && (
            <span className="source-warn" title={unsupported.join('\n')}>
              {unsupported.length} 项规则不支持
            </span>
          )}
        </div>
        <div className="source-sub">
          <span>{hostOf(source.baseUrl)}</span>
          {source.group ? (
            <>
              <span className="dot">·</span>
              <span>{source.group}</span>
            </>
          ) : null}
        </div>
        <AnimatePresence>
          {result && (
            <motion.p
              className={`source-test${result.pending ? '' : result.ok ? ' ok' : ' fail'}`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              {result.pending ? '正在试搜「的」…' : result.message}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="source-actions">
        <button className="btn tiny ghost" onClick={test} disabled={testing === source.id || !source.enabled}>
          {testing === source.id ? '测试中' : '试搜'}
        </button>
        <input
          type="checkbox"
          className="switch"
          checked={source.enabled !== false}
          onChange={(e) => onToggle(source.id, e.target.checked)}
          title={source.enabled ? '已启用' : '已停用'}
        />
        <button className="icon-btn ghost danger" title="删除书源" onClick={() => onRemove(source)}>
          <IconTrash size={15} />
        </button>
      </div>
    </motion.li>
  );
}

function RuleRow({ rule, onToggle, onRemove }) {
  const badge = rule.isRegex ? '正则' : '文本';
  const label = String(rule.name || '').replace(/\s*#\s*(JS|REGEX)\s*$/i, '');
  const jsHint = typeof rule.replacement === 'string' && rule.replacement.startsWith('@js:');
  return (
    <motion.li className="source-row rule-row" layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="source-main">
        <div className="source-line">
          <span className="source-name" title={rule.name}>
            {label}
          </span>
          {rule.group ? <span className="source-badge group">{rule.group}</span> : null}
          <span className="source-badge">{badge}</span>
          {jsHint && <span className="source-badge js">JS</span>}
        </div>
        <code className="rule-pattern" title={rule.pattern}>
          {rule.pattern}
          {rule.replacement && !jsHint ? ` → ${rule.replacement}` : jsHint ? ' → @js:' : ''}
        </code>
      </div>

      <div className="source-actions">
        <input
          type="checkbox"
          className="switch"
          checked={rule.enabled !== false}
          onChange={(e) => onToggle(rule.id, e.target.checked)}
          title={rule.enabled !== false ? '已启用' : '已停用'}
        />
        <button className="icon-btn ghost danger" title="删除规则" onClick={() => onRemove(rule)}>
          <IconTrash size={15} />
        </button>
      </div>
    </motion.li>
  );
}

export default function SourcePanel({ open, onClose }) {
  const sources = useSources();
  const rules = useRules();
  const settings = useSettings();
  const {
    importSources,
    importSourcesFromFile,
    importSourcesFromUrl,
    toggleSource,
    removeSource,
    importRulesText,
    importRulesFromFile,
    toggleRule,
    removeRule,
    testSource,
    testAllSources,
    setSourcesEnabled,
    removeSources,
    notify,
    patchSettings,
  } = useAppActions();
  const [tab, setTab] = useState('sources');
  const [url, setUrl] = useState('');
  const [pasted, setPasted] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [busy, setBusy] = useState('');
  const [testing, setTesting] = useState('');
  const [report, setReport] = useState(null);
  const [onlyUsable, setOnlyUsable] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [picked, setPicked] = useState([]);

  const enabledCount = useMemo(() => sources.filter((s) => s.enabled !== false).length, [sources]);
  const enabledRuleCount = useMemo(() => rules.filter((r) => r.enabled !== false).length, [rules]);

  /** 排序：有命中的在前（按命中数），其次没测过的，最后失败的；停用的沉底。 */
  const sortedSources = useMemo(() => {
    const rank = (source) => {
      if (source.enabled === false) return 5;
      const stat = source.stat;
      if (!stat) return 3;
      if (stat.ok && stat.count > 0) return 0;
      if (stat.ok) return 2;
      return 4;
    };
    return [...sources].sort((a, b) => {
      const diff = rank(a) - rank(b);
      if (diff !== 0) return diff;
      const ac = a.stat?.count || 0;
      const bc = b.stat?.count || 0;
      if (ac !== bc) return bc - ac;
      return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
    });
  }, [sources]);

  /** 「只显示能用的」：隐藏停用与最近试搜失败的书源。 */
  const usableSources = useMemo(
    () => sortedSources.filter((source) => source.enabled !== false && source.stat?.ok !== false),
    [sortedSources]
  );
  const visibleSources = onlyUsable ? usableSources : sortedSources;

  /** 分组下拉的选项。 */
  const groupOptions = useMemo(() => {
    const set = new Set();
    sources.forEach((source) => {
      if (source.group) set.add(String(source.group));
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  }, [sources]);

  /** 名称/域名搜索 + 分组筛选。 */
  const listedSources = useMemo(() => {
    const text = filterText.trim().toLowerCase();
    return visibleSources.filter((source) => {
      if (groupFilter && String(source.group || '') !== groupFilter) return false;
      if (!text) return true;
      const hay = `${source.name || ''} ${hostOf(source.baseUrl)} ${source.group || ''}`.toLowerCase();
      return hay.includes(text);
    });
  }, [visibleSources, filterText, groupFilter]);

  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const allPicked = listedSources.length > 0 && listedSources.every((source) => pickedSet.has(source.id));

  /**
   * 1000+ 书源时不要一次渲染：先给 60 行，剩下的按需展开。
   * 换了筛选条件就回到第一屏，避免"翻到一半条件变了"。
   */
  const [shown, setShown] = useState(PAGE_STEP);
  useEffect(() => {
    setShown(PAGE_STEP);
  }, [filterText, groupFilter, onlyUsable]);
  const shownSources = useMemo(() => listedSources.slice(0, shown), [listedSources, shown]);

  const togglePick = useCallback((id, on) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return [...next];
    });
  }, []);

  const togglePickAll = () => {
    if (allPicked) {
      setPicked([]);
      return;
    }
    setPicked(listedSources.map((source) => source.id));
  };

  const batchEnable = async (enabled) => {
    if (!picked.length) return;
    setBusy('batch');
    try {
      await setSourcesEnabled(picked, enabled);
      notify(`已${enabled ? '启用' : '停用'} ${picked.length} 个书源`);
      setPicked([]);
    } catch (err) {
      notify(err?.message || '批量操作失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const batchRemove = async () => {
    if (!picked.length) return;
    setBusy('batch');
    try {
      await removeSources(picked);
      notify(`已删除 ${picked.length} 个书源`);
      setPicked([]);
    } catch (err) {
      notify(err?.message || '批量删除失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const handleResult = useCallback(
    (res, label) => {
      if (!res) return;
      if (res.error) {
        notify(res.error, 'error');
        return;
      }
      const bits = [];
      if (res.added) bits.push(`新增 ${res.added} ${res.asRules ? '条规则' : '个书源'}`);
      if (res.updated) bits.push(`更新 ${res.updated} ${res.asRules ? '条规则' : '个书源'}`);
      if (!res.added && !res.updated) bits.push(res.asRules ? '没有新规则' : '没有新书源');
      notify(`${label}：${bits.join('，')}`);
      if (res.asRules) setTab('rules');
      if (res.asFeeds) {
        const lines = (res.feeds || []).map((feed) => ({
          name: feed.title,
          message: feed.error
            ? feed.error
            : feed.rules
              ? `替换规则 ${feed.rules} 条（新增 ${feed.added || 0}）`
              : `书源 新增 ${feed.added || 0} / 更新 ${feed.updated || 0}${feed.failed ? ` / 失败 ${feed.failed}` : ''}`,
        }));
        setReport(lines.length ? lines : null);
        return;
      }
      if (res.errors?.length) setReport(res.errors);
      else setReport(null);
    },
    [notify]
  );

  const importUrl = async () => {
    const value = url.trim();
    if (!value) return;
    setBusy('url');
    try {
      handleResult(await importSourcesFromUrl(value), '从链接导入');
      setUrl('');
    } catch (err) {
      notify(err.message || '导入失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const importFile = async () => {
    setBusy('file');
    try {
      handleResult(await importSourcesFromFile(), '导入文件');
    } catch (err) {
      notify(err.message || '导入失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const importPaste = async () => {
    if (!pasted.trim()) return;
    setBusy('paste');
    try {
      handleResult(await importSources(pasted), '导入粘贴内容');
      setPasted('');
      setShowPaste(false);
    } catch (err) {
      notify(err.message || '导入失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const handleTest = async (source) => {
    setTesting(source.id);
    try {
      const res = await testSource(source.id, '的');
      return res || { ok: false, message: '没有返回结果' };
    } catch (err) {
      return { ok: false, message: err.message || '测试失败' };
    } finally {
      setTesting('');
    }
  };

  const handleTestAll = async () => {
    setBusy('test-all');
    try {
      const res = await testAllSources('的', 12);
      const okCount = (res?.results || []).filter((item) => item.ok && item.count > 0).length;
      notify(`试搜完成：${okCount} / ${(res?.results || []).length} 个书源有结果`);
    } catch (err) {
      notify(err.message || '批量试搜失败', 'error');
    } finally {
      setBusy('');
    }
  };

  const handleRemove = (source) => {
    removeSource(source.id);
    notify(`已删除书源「${source.name}」`);
  };

  const handleRemoveRule = (rule) => {
    removeRule(rule.id);
    notify(`已删除规则「${rule.name}」`);
  };

  const alive = usePresence(open);

  return (
    <>
      {alive && (
        <div
          className="modal-backdrop"
          data-open={open ? 'true' : 'false'}
          // 退出动画期间（或万一 AnimatePresence 没能卸载）这层铺满全屏的元素
          // 不能再吃点击，否则整个界面会「看得见但点不动」。
          style={{ pointerEvents: open ? 'auto' : 'none' }}
          onClick={onClose}
        >
          <AnimatePresence>
            {open && (
              <motion.div
                key="source-modal"
            className="modal source-modal"
            variants={modalVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="source-head">
              <div>
                <span className="panel-eyebrow">书源</span>
                <h2>
                  {tab === 'sources' ? '外部书源' : tab === 'repo' ? '书源仓库' : '净化规则'}
                  {tab !== 'repo' && (
                    <span className="source-count"> {tab === 'sources' ? sources.length : rules.length}</span>
                  )}
                </h2>
                <p className="source-note">
                  {tab === 'sources'
                    ? `书源是第三方网站提供的搜索/目录/正文规则（兼容「阅读」Legado 格式）。我们不提供任何服务器，内容直连你导入的站点，${enabledCount} 个已启用。`
                    : tab === 'repo'
                      ? '从第三方书源仓库（shuyuan.yiove.com）挑现成的书源：可以单个导入、整页导入，也可以直接导入别人整理的合集。'
                      : `净化规则会在正文与章节标题显示前做一次替换（Legado 的替换规则）。${enabledRuleCount} 条已启用。`}
                </p>
              </div>
              <button className="icon-btn ghost" onClick={onClose} title="关闭 (Esc)">
                <IconX size={16} />
              </button>
            </header>

            <div className="source-tabs">
              <button className={`source-tab${tab === 'sources' ? ' active' : ''}`} onClick={() => setTab('sources')}>
                书源
              </button>
              <button className={`source-tab${tab === 'repo' ? ' active' : ''}`} onClick={() => setTab('repo')}>
                <IconCloud size={13} /> 书源仓库
              </button>
              <button className={`source-tab${tab === 'rules' ? ' active' : ''}`} onClick={() => setTab('rules')}>
                净化规则
              </button>
            </div>

            {tab !== 'repo' && (
              <>
                <div className="source-import">
                  <label className="source-field">
                    <span>订阅链接</span>
                    <input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && importUrl()}
                      placeholder="https://…/good.json"
                      spellCheck={false}
                    />
                  </label>
                  <button className="btn primary" onClick={importUrl} disabled={busy === 'url' || !url.trim()}>
                    {busy === 'url' ? '下载中' : '从链接导入'}
                  </button>
                </div>

                <div className="source-import-extra">
                  <button className="btn tiny ghost" onClick={importFile} disabled={busy === 'file'}>
                    {busy === 'file' ? '读取中' : '选择本地 JSON 文件'}
                  </button>
                  <button className="btn tiny ghost" onClick={() => setShowPaste((v) => !v)}>
                    {showPaste ? '收起粘贴框' : '粘贴 JSON'}
                  </button>
                  <span className="source-hint">支持数组、对象或 `{'{'} books: [...] {'}'}` 包裹</span>
                </div>
              </>
            )}

            <div className="source-proxy">
              <label htmlFor="source-proxy-input">网络代理</label>
              <input
                id="source-proxy-input"
                value={settings.proxy || ''}
                onChange={(e) => patchSettings({ proxy: e.target.value.trim() })}
                placeholder="http://127.0.0.1:7890（留空表示直连）"
                spellCheck={false}
              />
              <span className="source-hint">抓取被墙的站点（如 pixiv）时填写本机代理地址</span>
            </div>

            <AnimatePresence>
              {showPaste && (
                <motion.div
                  className="source-paste"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder='[{"bookSourceName":"示例","bookSourceUrl":"https://example.com", …}]'
                    spellCheck={false}
                  />
                  <button className="btn tiny primary" onClick={importPaste} disabled={busy === 'paste'}>
                    {busy === 'paste' ? '解析中' : '导入'}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {report?.length > 0 && (
              <div className="source-report">
                <strong>{report.length} 个书源未能导入</strong>
                <ul>
                  {report.slice(0, 6).map((item, i) => (
                    <li key={i}>
                      <span>{item.name}</span>
                      {item.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="source-list-wrap">
              {tab === 'repo' ? (
                <RepoBrowser onImported={() => setReport(null)} />
              ) : tab === 'rules' ? (
                rules.length === 0 ? (
                  <div className="source-empty">
                    <IconSparkle size={20} />
                    <h3>还没有净化规则</h3>
                    <p>
                      贴一个替换规则链接（例如 <code>https://legado.aoaostar.com/sources/3f067eb2.json</code>
                      ），或选择本地 JSON 文件。规则会让正文更干净：删掉「本章未完」这类尾巴、统一标点。
                    </p>
                  </div>
                ) : (
                  <ul className="source-list">
                    {rules.map((rule) => (
                      <RuleRow key={rule.id} rule={rule} onToggle={toggleRule} onRemove={handleRemoveRule} />
                    ))}
                  </ul>
                )
              ) : sources.length === 0 ? (
                <div className="source-empty">
                  <IconSparkle size={20} />
                  <h3>还没有书源</h3>
                  <p>贴一个订阅链接，或选择一个本地 JSON 文件。导进来后就能在书架里「网上搜书」。</p>
                  <div className="source-examples">
                    {EXAMPLE_FEEDS.map(([label, link]) => (
                      <button key={link} className="source-example" onClick={() => setUrl(link)}>
                        <span>{label}</span>
                        <code>{link}</code>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="source-toolbar">
                    <label className="source-search">
                      <IconSearch size={13} />
                      <input
                        value={filterText}
                        onChange={(e) => setFilterText(e.target.value)}
                        placeholder="按名称 / 域名筛选"
                        spellCheck={false}
                      />
                      {filterText ? (
                        <button className="source-search-clear" onClick={() => setFilterText('')} title="清除">
                          <IconX size={12} />
                        </button>
                      ) : null}
                    </label>
                    {groupOptions.length > 0 && (
                      <select
                        className="source-group"
                        value={groupFilter}
                        onChange={(e) => setGroupFilter(e.target.value)}
                        title="按分组筛选"
                      >
                        <option value="">全部分组</option>
                        {groupOptions.map((group) => (
                          <option key={group} value={group}>
                            {group}
                          </option>
                        ))}
                      </select>
                    )}
                    <label className="source-pickall">
                      <input type="checkbox" className="source-check" checked={allPicked} onChange={togglePickAll} />
                      全选
                    </label>
                  </div>

                  {picked.length > 0 && (
                    <div className="source-batch">
                      <span className="source-batch-count">已选 {picked.length} 个</span>
                      <button className="btn tiny ghost" onClick={() => batchEnable(true)} disabled={busy === 'batch'}>
                        启用
                      </button>
                      <button className="btn tiny ghost" onClick={() => batchEnable(false)} disabled={busy === 'batch'}>
                        停用
                      </button>
                      <button className="btn tiny ghost danger" onClick={batchRemove} disabled={busy === 'batch'}>
                        <IconTrash size={13} /> 删除
                      </button>
                      <button className="btn tiny ghost" onClick={() => setPicked([])}>
                        取消选择
                      </button>
                    </div>
                  )}

                  <div className="source-listbar">
                    <button
                      className={`source-filter${onlyUsable ? ' active' : ''}`}
                      onClick={() => setOnlyUsable((prev) => !prev)}
                      title="隐藏停用与最近试搜失败的书源"
                    >
                      只显示能用的
                      <span className="source-filter-count">{usableSources.length}</span>
                    </button>
                    <span className="source-listbar-hint">
                      共 {sources.length} 个 · 启用 {enabledCount} 个{filterText || groupFilter ? ` · 筛出 ${listedSources.length} 个` : ''}
                    </span>
                    <button
                      className="btn tiny ghost"
                      onClick={handleTestAll}
                      disabled={busy === 'test-all' || !enabledCount}
                    >
                      {busy === 'test-all' ? '试搜中…' : '全部试搜'}
                    </button>
                  </div>

                  {onlyUsable && listedSources.length === 0 ? (
                    <div className="source-empty">
                      <IconSparkle size={20} />
                      <h3>没有可用书源</h3>
                      <p>先点右上角「全部试搜」跑一遍，或关掉筛选看看哪些源失败了。</p>
                    </div>
                  ) : listedSources.length === 0 ? (
                    <div className="source-empty">
                      <IconSearch size={20} />
                      <h3>没有匹配的书源</h3>
                      <p>换个关键词，或把分组筛选切回「全部分组」。</p>
                    </div>
                  ) : (
                    <>
                      <ul className="source-list">
                        {shownSources.map((source) => (
                          <SourceRow
                            key={source.id}
                            source={source}
                            testing={testing}
                            onToggle={toggleSource}
                            onTest={handleTest}
                            onRemove={handleRemove}
                            checked={pickedSet.has(source.id)}
                            onCheck={togglePick}
                          />
                        ))}
                      </ul>
                      {listedSources.length > shownSources.length && (
                        <button
                          className="btn small ghost source-more"
                          onClick={() => setShown((n) => n + PAGE_STEP)}
                        >
                          显示更多（还有 {listedSources.length - shownSources.length} 个）
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            <footer className="source-foot">
              <span>
                <IconPlus size={13} /> 支持 <code>@js:</code> / <code>@json:</code> 规则；<code>@xpath:</code> 暂不支持。
              </span>
              <button className="btn tiny ghost" onClick={onClose}>
                完成
              </button>
            </footer>
          </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}
