import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  useAppActions,
  useBooks,
  useFonts,
  useSettings,
  useSources,
  useThemeState,
} from '../store/AppStore.jsx';
import { parseThemeJson, themeToJson } from '../themes.js';
import { AUTO_CHAPTER_REGEX, compileRegex } from '../utils/chapters.js';
import { formatCount } from '../utils/format.js';
import { SHORTCUT_GROUPS } from '../utils/shortcuts.js';
import { SPRING } from '../motion.js';
import SourcePanel from './SourcePanel.jsx';
import Segmented from './Segmented.jsx';
import FontManager from './FontManager.jsx';
import { fontStackFor } from '../hooks/useFontLoader.js';
import {
  IconArrowLeft,
  IconBook,
  IconBooks,
  IconCloud,
  IconCommand,
  IconDatabase,
  IconSearch,
  IconSettings,
  IconType,
} from './Icons.jsx';


const FONTS = [
  { key: 'sans', label: '无衬线' },
  { key: 'serif', label: '衬线' },
  { key: 'mono', label: '等宽' },
];

const SECTIONS = [
  { key: 'appearance', label: '外观', Icon: IconType },
  { key: 'reading', label: '阅读', Icon: IconBook },
  { key: 'sources', label: '书源', Icon: IconCloud },
  { key: 'storage', label: '存储', Icon: IconDatabase },
  { key: 'shortcuts', label: '快捷键', Icon: IconCommand },
  { key: 'about', label: '关于', Icon: IconSettings },
];

/** 分区切换的推拉过渡：按导航顺序决定方向，弹簧跟手、可被打断 */
const sectionVariants = (dir) => ({
  initial: { opacity: 0, x: dir * 16 },
  animate: { opacity: 1, x: 0, transition: SPRING.panel },
  exit: { opacity: 0, x: dir * -12, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } },
});

function Slider({ label, hint, value, min, max, step, unit, onChange }) {
  return (
    <div className="setting-row slider-row">
      <div className="setting-label">
        <span>
          {label}
          {hint && <small>{hint}</small>}
        </span>
        <span className="setting-value">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ '--pct': `${((value - min) / (max - min)) * 100}%` }}
      />
    </div>
  );
}

function Row({ title, hint, children }) {
  return (
    <div className="settings-page-row">
      <div className="settings-page-row-text">
        <span>{title}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="settings-page-row-control">{children}</div>
    </div>
  );
}

export default function SettingsPage({ onClose }) {
  const settings = useSettings();
  const sources = useSources();
  const books = useBooks();
  const fonts = useFonts();
  const { themes } = useThemeState();
  const {
    patchSettings,
    resetSettings,
    toggleSource,
    notify,
    saveCustomTheme,
    removeCustomTheme,
  } = useAppActions();
  const [section, setSection] = useState('appearance');

  // 排版预览的字体栈：与阅读器保持一致（用户字体优先）
  const previewFontStack = useMemo(
    () =>
      settings.userFont
        ? fontStackFor(settings.userFont, settings.fontFamily)
        : `var(--font-${settings.fontFamily})`,
    [settings.userFont, settings.fontFamily]
  );
  // 分区切换方向：按导航顺序决定内容是推入还是推出
  const [dir, setDir] = useState(1);
  const prevSection = useRef(section);
  useEffect(() => {
    const order = SECTIONS.map((item) => item.key);
    const from = order.indexOf(prevSection.current);
    const to = order.indexOf(section);
    setDir(to >= from ? 1 : -1);
    prevSection.current = section;
  }, [section]);
  const [regexDraft, setRegexDraft] = useState(settings.chapterRegex || '');
  const [regexError, setRegexError] = useState('');
  const [proxyDraft, setProxyDraft] = useState(settings.proxy || '');
  const [sourceQuery, setSourceQuery] = useState('');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [info, setInfo] = useState(null);
  const [cache, setCache] = useState({ cloudBooks: 0, chapters: 0 });
  const [cacheBusy, setCacheBusy] = useState(false);
  const [themeDraft, setThemeDraft] = useState(null);

  useEffect(() => {
    window.readerAPI?.appInfo?.().then(setInfo).catch(() => {});
  }, []);

  useEffect(() => setRegexDraft(settings.chapterRegex || ''), [settings.chapterRegex]);
  useEffect(() => setProxyDraft(settings.proxy || ''), [settings.proxy]);

  const enabledCount = useMemo(() => sources.filter((s) => s.enabled !== false).length, [sources]);

  const loadCache = useCallback(async () => {
    const cloud = books.filter((book) => book.kind === 'cloud');
    let chapters = 0;
    for (const book of cloud) {
      try {
        const stats = await window.readerAPI?.cloudCacheStats?.({
          sourceId: book.sourceId,
          bookUrl: book.bookUrl,
        });
        chapters += stats?.cached || 0;
      } catch {
        /* 单本缓存统计失败不影响整体 */
      }
    }
    setCache({ cloudBooks: cloud.length, chapters });
  }, [books]);

  useEffect(() => {
    if (section === 'storage') loadCache();
  }, [section, loadCache]);

  const regexValid = useMemo(() => {
    if (!regexDraft.trim()) return true;
    const compiled = compileRegex(regexDraft.trim());
    return !(compiled instanceof Error || (compiled && compiled.error));
  }, [regexDraft]);

  const applyRegex = () => {
    if (!regexValid) {
      setRegexError('正则表达式无效，请检查括号与转义');
      return;
    }
    setRegexError('');
    patchSettings({ chapterRegex: regexDraft.trim() });
    notify('章节识别规则已保存');
  };

  const saveProxy = () => {
    const value = proxyDraft.trim();
    patchSettings({ proxy: value });
    notify(value ? '代理已保存，下次请求生效' : '已关闭代理', 'info', { duration: 2200 });
  };

  const clearCloudCache = async () => {
    setCacheBusy(true);
    try {
      const cloud = books.filter((book) => book.kind === 'cloud');
      for (const book of cloud) {
        await window.readerAPI?.clearCloudCache?.({
          sourceId: book.sourceId,
          bookUrl: book.bookUrl,
        });
      }
      await loadCache();
      notify(`已清理 ${cloud.length} 本云端书的章节缓存`);
    } finally {
      setCacheBusy(false);
    }
  };

  const clearCoverCache = async () => {
    setCacheBusy(true);
    try {
      await window.readerAPI?.clearCoverCache?.();
      notify('封面缓存已清理，下次打开会重新下载');
    } finally {
      setCacheBusy(false);
    }
  };

  const copyDataDir = async () => {
    const text = info?.dataDir;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      notify('数据目录路径已复制');
    } catch {
      notify('复制失败，请手动选择路径', 'error');
    }
  };

  const filteredSources = useMemo(() => {
    const q = sourceQuery.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter((source) => String(source.name || '').toLowerCase().includes(q));
  }, [sources, sourceQuery]);

  const cloudCount = books.filter((book) => book.kind === 'cloud').length;
  const localCount = books.length - cloudCount;

  return (
    <div className="settings-page">
      <header className="settings-page-head">
        <button className="icon-btn ghost" onClick={onClose} title="返回书架 (Esc)">
          <IconArrowLeft size={19} />
        </button>
        <div className="settings-page-heading">
          <h1>设置</h1>
          <span>所有更改即时生效并自动保存</span>
        </div>
        <span className="settings-page-version">v{info?.version || __APP_VERSION__}</span>
      </header>

      <div className="settings-page-body">
        <nav className="settings-nav" aria-label="设置分类">
          {SECTIONS.map(({ key, label, Icon }) => (
            <button
              key={key}
              className={`settings-nav-item${section === key ? ' active' : ''}`}
              onClick={() => setSection(key)}
            >
              <Icon size={16} />
              <span>{label}</span>
              {key === 'sources' && <em>{sources.length}</em>}
            </button>
          ))}
        </nav>

        <div className="settings-main">
          <div className="settings-main-inner">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={section}
                variants={sectionVariants(dir)}
                initial="initial"
                animate="animate"
                exit="exit"
              >
            {section === 'appearance' && (
              <>
                <section className="settings-group">
                  <h3 className="settings-group-title">界面风格</h3>
                  <Row title="外观语言" hint="Apple 克制风，或 MIUI Console 风；两套皮肤即时切换">
                    <Segmented
                      options={[
                        { value: 'apple', label: 'Apple' },
                        { value: 'miui', label: 'MIUI' },
                      ]}
                      value={settings.skin || 'apple'}
                      onChange={(skin) => patchSettings({ skin })}
                    />
                  </Row>
                  <label className="switch-row">
                    <span>
                      macOS 风格边框
                      <small>
                        去掉窗口标题栏，左上角用红黄绿三个圆点代替（最小化 / 最大化 / 关闭）。
                        macOS 上始终使用系统原生交通灯。
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      className="switch"
                      checked={settings.macosFrame !== false}
                      onChange={(event) => patchSettings({ macosFrame: event.target.checked })}
                    />
                  </label>
                </section>

                <section className="settings-group">
                  <div className="theme-head">
                    <h3 className="settings-group-title">主题</h3>
                    <div className="theme-actions">
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() =>
                          setThemeDraft({
                            mode: 'edit',
                            theme: {
                              label: '我的主题',
                              tone: 'light',
                              tokens: { bg: '#f5f5f7', bgElevated: '#ffffff', text: '#1c1c1e', accent: '#0a84ff' },
                            },
                          })
                        }
                      >
                        新建主题
                      </button>
                      <button
                        className="btn ghost small"
                        type="button"
                        onClick={() => setThemeDraft({ mode: 'import', text: '', error: '' })}
                      >
                        导入
                      </button>
                    </div>
                  </div>
                  <div className="theme-grid">
                    {themes.map((theme) => (
                      <div key={theme.id} className="theme-slot">
                        <button
                          className={`theme-swatch${settings.theme === theme.id ? ' active' : ''}`}
                          onClick={() => patchSettings({ theme: theme.id })}
                          title={theme.owner ? `来自插件 ${theme.owner}` : theme.label}
                        >
                          <span
                            className="theme-preview"
                            style={{ background: theme.tokens.bg, color: theme.tokens.accent }}
                          />
                          <span className="theme-label">{theme.label}</span>
                          {theme.owner ? <span className="theme-badge">插件</span> : null}
                        </button>
                        {!theme.builtin && !theme.owner ? (
                          <button
                            className="theme-remove"
                            type="button"
                            title="删除这个主题"
                            onClick={() => removeCustomTheme(theme.id)}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {themeDraft ? (
                    <div className="theme-editor">
                      {themeDraft.mode === 'import' ? (
                        <>
                          <label className="theme-editor-row">
                            <span>主题 JSON</span>
                            <textarea
                              className="theme-json"
                              value={themeDraft.text}
                              placeholder={'{\n  "id": "my-theme",\n  "label": "我的主题",\n  "tone": "light",\n  "tokens": { "bg": "#f5f5f7", "text": "#1c1c1e" }\n}'}
                              onChange={(event) => setThemeDraft({ ...themeDraft, text: event.target.value, error: '' })}
                            />
                          </label>
                          {themeDraft.error ? <p className="store-error">{themeDraft.error}</p> : null}
                          <div className="theme-editor-actions">
                            <button
                              className="btn primary small"
                              type="button"
                              onClick={() => {
                                const parsed = parseThemeJson(themeDraft.text);
                                if (!parsed) {
                                  setThemeDraft({ ...themeDraft, error: 'JSON 不合法，或缺少 id / tokens.bg / tokens.text' });
                                  return;
                                }
                                saveCustomTheme(parsed);
                                setThemeDraft(null);
                                notify(`已导入主题「${parsed.label}」`, 'info');
                              }}
                            >
                              导入
                            </button>
                            <button className="btn ghost small" type="button" onClick={() => setThemeDraft(null)}>
                              取消
                            </button>
                            <button
                              className="btn ghost small"
                              type="button"
                              onClick={() =>
                                setThemeDraft({
                                  ...themeDraft,
                                  mode: 'edit',
                                  theme: {
                                    label: '我的主题',
                                    tone: 'light',
                                    tokens: { bg: '#f5f5f7', bgElevated: '#ffffff', text: '#1c1c1e', accent: '#0a84ff' },
                                  },
                                })
                              }
                            >
                              手动编辑
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="theme-editor-row">
                            <span>名称</span>
                            <input
                              className="text-input"
                              value={themeDraft.theme.label}
                              onChange={(event) =>
                                setThemeDraft({ ...themeDraft, theme: { ...themeDraft.theme, label: event.target.value } })
                              }
                            />
                          </div>
                          <div className="theme-editor-row">
                            <span>明暗</span>
                            <Segmented
                              options={[
                                { value: 'light', label: '浅色底' },
                                { value: 'dark', label: '深色底' },
                              ]}
                              value={themeDraft.theme.tone}
                              onChange={(tone) =>
                                setThemeDraft({ ...themeDraft, theme: { ...themeDraft.theme, tone } })
                              }
                            />
                          </div>
                          {[
                            ['bg', '背景'],
                            ['bgElevated', '卡片'],
                            ['text', '正文'],
                            ['accent', '强调色'],
                          ].map(([key, label]) => (
                            <div className="theme-editor-row" key={key}>
                              <span>{label}</span>
                              <div className="theme-color">
                                <input
                                  type="color"
                                  value={
                                    /^#[0-9a-f]{6}$/i.test(themeDraft.theme.tokens[key] || '')
                                      ? themeDraft.theme.tokens[key]
                                      : '#888888'
                                  }
                                  onChange={(event) =>
                                    setThemeDraft({
                                      ...themeDraft,
                                      theme: {
                                        ...themeDraft.theme,
                                        tokens: { ...themeDraft.theme.tokens, [key]: event.target.value },
                                      },
                                    })
                                  }
                                />
                                <input
                                  className="text-input theme-color-text"
                                  value={themeDraft.theme.tokens[key] || ''}
                                  onChange={(event) =>
                                    setThemeDraft({
                                      ...themeDraft,
                                      theme: {
                                        ...themeDraft.theme,
                                        tokens: { ...themeDraft.theme.tokens, [key]: event.target.value },
                                      },
                                    })
                                  }
                                />
                              </div>
                            </div>
                          ))}
                          <div className="theme-editor-actions">
                            <button
                              className="btn primary small"
                              type="button"
                              onClick={() => {
                                const id = themeDraft.theme.id || `my-${Math.random().toString(36).slice(2, 7)}`;
                                const saved = saveCustomTheme({ ...themeDraft.theme, id });
                                if (!saved) {
                                  notify('主题保存失败：请检查颜色值', 'error');
                                  return;
                                }
                                setThemeDraft(null);
                                notify(`已应用主题「${saved.label}」`, 'info');
                              }}
                            >
                              保存并应用
                            </button>
                            <button className="btn ghost small" type="button" onClick={() => setThemeDraft(null)}>
                              取消
                            </button>
                            <button
                              className="btn ghost small"
                              type="button"
                              onClick={() =>
                                setThemeDraft({ ...themeDraft, mode: 'import', text: themeToJson(themeDraft.theme), error: '' })
                              }
                            >
                              用 JSON 编辑
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}
                </section>

                <section className="settings-group">
                  <h3 className="settings-group-title">字体</h3>
                  <p className="settings-hint">
                    基础字体族来自系统；安装自己的字体后，可在这里切换正文字体。
                  </p>
                  <FontManager />
                </section>

                <section className="settings-group">
                  <h3 className="settings-group-title">排版</h3>
                  <Slider
                    label="字号"
                    value={settings.fontSize}
                    min={14}
                    max={30}
                    step={1}
                    unit="px"
                    onChange={(value) => patchSettings({ fontSize: value })}
                  />
                  <Slider
                    label="行距"
                    value={settings.lineHeight}
                    min={1.4}
                    max={2.8}
                    step={0.05}
                    unit=""
                    onChange={(value) => patchSettings({ lineHeight: value })}
                  />
                  <Slider
                    label="正文宽度"
                    value={settings.pageWidth}
                    min={520}
                    max={980}
                    step={20}
                    unit="px"
                    onChange={(value) => patchSettings({ pageWidth: value })}
                  />
                  <Slider
                    label="段间距"
                    value={settings.paragraphSpacing}
                    min={0}
                    max={2}
                    step={0.1}
                    unit="em"
                    onChange={(value) => patchSettings({ paragraphSpacing: value })}
                  />
                  <div className="typography-preview" aria-hidden="true">
                    <p
                      style={{
                        fontSize: `${settings.fontSize}px`,
                        lineHeight: settings.lineHeight,
                        fontFamily: previewFontStack,
                        marginBottom: `${settings.paragraphSpacing}em`,
                        textIndent: settings.indent ? '2em' : 0,
                      }}
                    >
                      夜色像一张摊开的纸，风从窗缝里翻页。
                    </p>
                    <span>排版预览 · 拖动即为最终效果</span>
                  </div>
                </section>

                <section className="settings-group">
                  <h3 className="settings-group-title">阅读习惯</h3>
                  <label className="switch-row">
                    <span>
                      首行缩进
                      <small>每段首行空两格</small>
                    </span>
                    <input
                      type="checkbox"
                      className="switch"
                      checked={settings.indent}
                      onChange={(event) => patchSettings({ indent: event.target.checked })}
                    />
                  </label>
                  <label className="switch-row">
                    <span>
                      沉浸模式自动隐藏工具栏
                      <small>鼠标静止 2.5 秒后隐藏</small>
                    </span>
                    <input
                      type="checkbox"
                      className="switch"
                      checked={settings.autoHideUI}
                      onChange={(event) => patchSettings({ autoHideUI: event.target.checked })}
                    />
                  </label>
                  <label className="switch-row">
                    <span>
                      显示底部进度
                      <small>阅读进度与剩余时间</small>
                    </span>
                    <input
                      type="checkbox"
                      className="switch"
                      checked={settings.showProgress}
                      onChange={(event) => patchSettings({ showProgress: event.target.checked })}
                    />
                  </label>
                  <label className="switch-row">
                    <span>
                      减少动效
                      <small>关闭页间过渡与弹簧动画</small>
                    </span>
                    <input
                      type="checkbox"
                      className="switch"
                      checked={!!settings.reduceMotion}
                      onChange={(event) => patchSettings({ reduceMotion: event.target.checked })}
                    />
                  </label>
                </section>

                <section className="settings-group">
                  <h3 className="settings-group-title">恢复</h3>
                  <Row title="恢复默认外观" hint="主题、字体与排版回到初始值">
                    <button
                      className="btn ghost small"
                      onClick={() => {
                        resetSettings();
                        notify('已恢复默认设置');
                      }}
                    >
                      恢复默认
                    </button>
                  </Row>
                </section>
              </>
            )}

            {section === 'reading' && (
              <>
                <section className="settings-group">
                  <h3 className="settings-group-title">漫画</h3>
                  <Row title="默认显示方式" hint="随时可以在阅读器里按 F 切换">
                    <Segmented
                      options={[
                        { value: 'width', label: '适应宽度' },
                        { value: 'original', label: '原始尺寸' },
                      ]}
                      value={settings.comicFit || 'width'}
                      onChange={(comicFit) => patchSettings({ comicFit })}
                    />
                  </Row>
                </section>

                <section className="settings-group">
                  <h3 className="settings-group-title">章节识别</h3>
                  <p className="settings-hint">
                    留空则使用内置的中文章节规则（第X章 / Chapter N / 序章 / 楔子 等）。
                    填写后会对每一行做匹配，命中且长度不超过 60 字的行会作为章节标题。
                  </p>
                  <textarea
                    className={`regex-input${regexError ? ' invalid' : ''}`}
                    value={regexDraft}
                    placeholder={AUTO_CHAPTER_REGEX}
                    spellCheck={false}
                    rows={4}
                    onChange={(event) => {
                      setRegexDraft(event.target.value);
                      setRegexError('');
                    }}
                  />
                  {regexError && <span className="regex-error">{regexError}</span>}
                  <div className="regex-actions">
                    <button className="btn primary small" onClick={applyRegex}>
                      应用正则
                    </button>
                    <button
                      className="btn ghost small"
                      onClick={() => {
                        setRegexDraft('');
                        patchSettings({ chapterRegex: '' });
                        setRegexError('');
                        notify('已恢复内置章节规则');
                      }}
                    >
                      恢复默认
                    </button>
                  </div>
                  <p className="settings-hint">
                    正则只在打开书本时生效，改动后重新打开该书即可看到新目录。
                  </p>
                </section>

                <section className="settings-group">
                  <h3 className="settings-group-title">加载</h3>
                  <p className="settings-hint">
                    云端书会自动预取后 3 章、前 1 章，图片并发取图；弱网时自动降到 3 并发。
                    这部分无需设置。
                  </p>
                </section>
              </>
            )}

            {section === 'sources' && (
              <>
                <section className="settings-group">
                  <h3 className="settings-group-title">概览</h3>
                  <div className="book-stats">
                    <div>
                      <span>全部书源</span>
                      <strong>{sources.length}</strong>
                    </div>
                    <div>
                      <span>已启用</span>
                      <strong>{enabledCount}</strong>
                    </div>
                    <div>
                      <span>已停用</span>
                      <strong>{sources.length - enabledCount}</strong>
                    </div>
                  </div>
                  <Row title="书源管理" hint="导入、试搜、编辑规则、批量启停">
                    <button className="btn ghost small" onClick={() => setSourceOpen(true)}>
                      打开书源面板
                    </button>
                  </Row>
                </section>

                <section className="settings-group">
                  <h3 className="settings-group-title">网络</h3>
                  <Row title="HTTP 代理" hint="只影响书源抓取，留空为直连">
                    <div className="proxy-row">
                      <input
                        className="text-input"
                        value={proxyDraft}
                        placeholder="http://127.0.0.1:7890"
                        spellCheck={false}
                        onChange={(event) => setProxyDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') saveProxy();
                        }}
                      />
                      <button className="btn primary small" onClick={saveProxy}>
                        保存
                      </button>
                    </div>
                  </Row>
                </section>

                <section className="settings-group">
                  <h3 className="settings-group-title">
                    书源列表
                    <span className="regex-badge">{filteredSources.length}</span>
                  </h3>
                  <label className="search settings-inline-search">
                    <IconSearch size={15} />
                    <input
                      value={sourceQuery}
                      onChange={(event) => setSourceQuery(event.target.value)}
                      placeholder="按名称筛选"
                      spellCheck={false}
                    />
                  </label>
                  <div className="source-toggle-list">
                    {filteredSources.map((source) => (
                      <label key={source.id} className="source-toggle-row">
                        <span className="source-toggle-name">
                          {source.name}
                          <small>
                            {(source.type === 2 ? '漫画' : '小说') +
                              (source.baseUrl ? ` · ${source.baseUrl.replace(/^https?:\/\//, '')}` : '')}
                          </small>
                        </span>
                        <input
                          type="checkbox"
                          className="switch"
                          checked={source.enabled !== false}
                          onChange={(event) => toggleSource(source.id, event.target.checked)}
                        />
                      </label>
                    ))}
                  </div>
                  {filteredSources.length === 0 && (
                    <p className="settings-hint">没有匹配的书源。</p>
                  )}
                </section>
              </>
            )}

            {section === 'storage' && (
              <>
                <section className="settings-group">
                  <h3 className="settings-group-title">书架</h3>
                  <div className="book-stats">
                    <div>
                      <span>全部书籍</span>
                      <strong>{books.length}</strong>
                    </div>
                    <div>
                      <span>本地</span>
                      <strong>{localCount}</strong>
                    </div>
                    <div>
                      <span>云端</span>
                      <strong>{cloudCount}</strong>
                    </div>
                  </div>
                </section>

                <section className="settings-group">
                  <h3 className="settings-group-title">缓存</h3>
                  <Row
                    title="云端章节缓存"
                    hint={`${cache.cloudBooks} 本云端书 · ${formatCount(cache.chapters)} 章`}
                  >
                    <button
                      className="btn ghost small"
                      disabled={cacheBusy || cache.chapters === 0}
                      onClick={clearCloudCache}
                    >
                      清理
                    </button>
                  </Row>
                  <Row title="封面缓存" hint="清理后再次打开书架会重新下载封面">
                    <button className="btn ghost small" disabled={cacheBusy} onClick={clearCoverCache}>
                      清理
                    </button>
                  </Row>
                </section>

                <section className="settings-group">
                  <h3 className="settings-group-title">数据</h3>
                  <Row title="数据目录" hint={info?.dataDir || '读取中…'}>
                    <button className="btn ghost small" onClick={copyDataDir}>
                      复制路径
                    </button>
                  </Row>
                  <Row title="重置全部设置" hint="主题、排版、代理等回到初始值，书籍不受影响">
                    <button
                      className="btn ghost small danger"
                      onClick={() => {
                        resetSettings();
                        notify('已重置全部设置');
                      }}
                    >
                      重置
                    </button>
                  </Row>
                </section>
              </>
            )}

            {section === 'shortcuts' && (
              <section className="settings-group">
                <h3 className="settings-group-title">全部快捷键</h3>
                <div className="shortcut-groups">
                  {SHORTCUT_GROUPS.map((group) => (
                    <div key={group.title} className="shortcut-group">
                      <h4>{group.title}</h4>
                      <ul>
                        {group.items.map(([keys, label]) => (
                          <li key={`${group.title}-${label}`}>
                            <span>{label}</span>
                            <span className="shortcut-keys">
                              {keys.split(' / ').map((key) => (
                                <kbd key={key}>{key}</kbd>
                              ))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {section === 'about' && (
              <>
                <section className="settings-group about-card">
                  <div className="about-mark">
                    <IconBooks size={26} />
                  </div>
                  <div className="about-text">
                    <h2>Folio</h2>
                    <p>沉浸式阅读器 · 本地 TXT 与云端书源，一个安静的地方读完一本书。</p>
                    <span>
                      v{info?.version || __APP_VERSION__} · {info?.platform || 'win32'}
                    </span>
                  </div>
                </section>

                <section className="settings-group">
                  <h3 className="settings-group-title">信息</h3>
                  <Row title="数据目录" hint={info?.dataDir || '读取中…'}>
                    <button className="btn ghost small" onClick={copyDataDir}>
                      复制
                    </button>
                  </Row>
                  <Row title="书源脚本" hint="Legado 规则兼容层，支持 JavaScript 与 Java 子集">
                    <span className="settings-page-muted">{sources.length} 个书源</span>
                  </Row>
                  <Row title="快捷键" hint="在任意页面按 ? 打开完整列表">
                    <kbd>?</kbd>
                  </Row>
                </section>

                <section className="settings-group">
                  <h3 className="settings-group-title">致谢</h3>
                  <p className="settings-hint">
                    Electron · React · Framer Motion · jsoup 兼容层 · Legado 书源规则生态。
                  </p>
                </section>
              </>
            )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <SourcePanel open={sourceOpen} onClose={() => setSourceOpen(false)} />
    </div>
  );
}
