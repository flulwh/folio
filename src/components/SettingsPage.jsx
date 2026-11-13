import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useMotionKit } from '../motion-kit.js';
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
  IconShare,
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
  { key: 'network', label: '网络', Icon: IconShare },
  { key: 'storage', label: '存储', Icon: IconDatabase },
  { key: 'shortcuts', label: '快捷键', Icon: IconCommand },
  { key: 'about', label: '关于', Icon: IconSettings },
];

// 访问码字符集与主进程 electron/lan.js 保持一致，去掉 0/O/1/I/L 这类易混字符
const LAN_TOKEN_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function makeLanToken(length = 6) {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  let out = '';
  for (let i = 0; i < length; i += 1) out += LAN_TOKEN_CHARS[bytes[i] % LAN_TOKEN_CHARS.length];
  return out;
}

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
  const kit = useMotionKit();
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
    lanStart,
    lanStop,
    lanStatus: getLanStatus,
    lanOpen,
  } = useAppActions();

  // 排版预览的字体栈：与阅读器保持一致（用户字体优先）
  const previewFontStack = useMemo(
    () =>
      settings.userFont
        ? fontStackFor(settings.userFont, settings.fontFamily)
        : `var(--font-${settings.fontFamily})`,
    [settings.userFont, settings.fontFamily]
  );
  /*
   * 分区与方向放在同一个 state 里，点击时一次算准。
   *
   * 原来分两个 state（section + effect 里补 dir），点一下会渲染两次：
   * 第一次用旧方向挂上新分区，第二次才把方向改对 → variants 对象在退场动画
   * 进行中被换掉，AnimatePresence 的 onExitComplete 就再也不会回调，
   * 旧分区停在 opacity:0 永不卸载，mode="wait" 也就永远不挂新内容（表现为空白）。
   */
  const [nav, setNav] = useState({ section: 'appearance', dir: 1 });
  const { section, dir } = nav;
  const goSection = useCallback((key) => {
    setNav((prev) => {
      if (prev.section === key) return prev;
      const order = SECTIONS.map((item) => item.key);
      return { section: key, dir: order.indexOf(key) >= order.indexOf(prev.section) ? 1 : -1 };
    });
  }, []);

  /*
   * 变体必须是稳定引用。
   * kit.section(dir) 每次渲染都会新建对象，而 framer 通过引用判断"动画定义变了没有"；
   * 拖动滑杆、切开关这类无关重渲染都会让引用变化，从而把进行中的退场动画判成被替换，
   * onExitComplete 丢失 → 旧分区留在 opacity:0、新分区永不挂载。
   */
  const sectionVariants = useMemo(() => kit.section(dir), [kit, dir]);
  const [regexDraft, setRegexDraft] = useState(settings.chapterRegex || '');
  const [regexError, setRegexError] = useState('');
  const [proxyDraft, setProxyDraft] = useState(settings.proxy || '');
  const [sourceQuery, setSourceQuery] = useState('');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [info, setInfo] = useState(null);
  const [cache, setCache] = useState({ cloudBooks: 0, chapters: 0 });
  const [cacheBusy, setCacheBusy] = useState(false);
  const [themeDraft, setThemeDraft] = useState(null);

  /* ---------------- 局域网面板 ---------------- */
  // settings.lan 可能是老版本留下的 undefined，统一兜一层
  const lanSettings = settings.lan || {};
  const [lanStatus, setLanStatus] = useState(null);
  const [lanBusy, setLanBusy] = useState(false);
  const [lanPortDraft, setLanPortDraft] = useState(String(lanSettings.port || 7788));

  useEffect(() => setLanPortDraft(String(lanSettings.port || 7788)), [lanSettings.port]);

  const refreshLan = useCallback(async () => {
    const status = await getLanStatus().catch(() => null);
    if (status) setLanStatus(status);
    return status;
  }, [getLanStatus]);

  // 进设置页先问一次状态。老版本设置里没有访问码时主进程会兜底生成一个，
  // 这里把它补写回 settings.json —— 否则下次启动又换一张新码，已连上的设备全被踢。
  useEffect(() => {
    let cancelled = false;
    const current = settings.lan || {};
    (async () => {
      const status = await getLanStatus().catch(() => null);
      if (cancelled || !status) return;
      setLanStatus(status);
      if (status.token && status.token !== current.token) {
        patchSettings({ lan: { ...current, token: status.token } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getLanStatus, patchSettings, settings.lan]);

  useEffect(() => {
    if (section === 'network') refreshLan();
  }, [section, refreshLan]);

  /**
   * 开关 / 改端口 / 换访问码都走这里：先让主进程真的启停服务，拿到结果再落设置。
   * 顺序反过来会让主进程读到旧配置，出现「设置写着开着、端口却没监听」的假象。
   */
  const applyLan = useCallback(
    async (next) => {
      setLanBusy(true);
      try {
        const result = next.enabled ? await lanStart(next) : await lanStop();
        if (result) setLanStatus(result);
        if (result && result.ok === false) {
          notify(result.error || '局域网面板没能启动', 'error');
        }
        patchSettings({ lan: { ...next, token: result?.token || next.token || '' } });
        if (result?.ok) notify(next.enabled ? '局域网面板已开启' : '局域网面板已关闭');
      } catch (err) {
        notify(`操作失败：${err?.message || err}`, 'error');
      } finally {
        setLanBusy(false);
      }
    },
    [lanStart, lanStop, notify, patchSettings]
  );

  const copyToClipboard = useCallback(
    async (text, label) => {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        notify(`${label}已复制`);
      } catch {
        notify('复制失败，请手动选中复制', 'error');
      }
    },
    [notify]
  );

  const commitLanPort = useCallback(() => {
    const port = Number(lanPortDraft);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      notify('端口要填 1024–65535 之间的数字', 'error');
      setLanPortDraft(String(lanSettings.port || 7788));
      return;
    }
    if (port === Number(lanSettings.port || 7788)) return;
    applyLan({ ...lanSettings, port, enabled: lanSettings.enabled === true });
  }, [applyLan, lanPortDraft, lanSettings, notify]);

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
              onClick={() => goSection(key)}
            >
              <Icon size={16} />
              <span>{label}</span>
              {key === 'sources' && <em>{sources.length}</em>}
            </button>
          ))}
        </nav>

        <div className="settings-main">
          <div className="settings-main-inner">
            {/*
              key={settings.skin}：切皮肤会让 MotionConfig 的默认 transition 和整套
              variants 同时换掉。AnimatePresence 内部记录退场状态的那份 presence
              数据会因此失配——之后任何一次分区切换，退场元素都停在 opacity:0 不再卸载，
              mode="wait" 于是永远等不到回调，整块内容空白。
              给它一个跟皮肤绑定的 key，切皮肤时整个 presence 树重建，状态天然干净。
            */}
            <AnimatePresence key={settings.skin} mode="wait" initial={false}>
              <motion.div
                key={section}
                variants={sectionVariants}
                initial="initial"
                animate="animate"
                exit="exit"
              >
            {section === 'appearance' && (
              <>
                <section className="settings-group">
                  <h3 className="settings-group-title">界面风格</h3>
                  <Row
                    title="外观语言"
                    hint="Apple 克制风，或 MIUI Console 风；两套皮肤即时切换。皮肤决定形态与动效，配色跟随上方主题"
                  >
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

            {section === 'network' && (
              <>
                <section className="settings-group">
                  <h3 className="settings-group-title">局域网面板</h3>
                  <label className="switch-row">
                    <span>
                      开启面板
                      <small>同一 Wi-Fi 下的手机、平板用浏览器打开就能看书架和读到哪了</small>
                    </span>
                    <input
                      type="checkbox"
                      className="switch"
                      checked={!!lanSettings.enabled}
                      disabled={lanBusy}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        applyLan({
                          ...lanSettings,
                          enabled,
                          // 第一次开启时顺手生成访问码，用户不用先去点「换一张」
                          token: lanSettings.token || (enabled ? makeLanToken() : ''),
                        });
                      }}
                    />
                  </label>
                  <label className="switch-row">
                    <span>
                      允许写入阅读进度
                      <small>关掉就是纯只读面板：手机上只能看，不能接着往下读</small>
                    </span>
                    <input
                      type="checkbox"
                      className="switch"
                      checked={lanSettings.allowWrite !== false}
                      disabled={lanBusy || !lanSettings.enabled}
                      onChange={(event) =>
                        applyLan({ ...lanSettings, enabled: true, allowWrite: event.target.checked })
                      }
                    />
                  </label>
                  <Row title="端口" hint="默认 7788；被别的程序占用时会自动往后顺延">
                    <div className="proxy-row">
                      <input
                        className="text-input"
                        value={lanPortDraft}
                        inputMode="numeric"
                        aria-label="面板端口"
                        onChange={(event) => setLanPortDraft(event.target.value.replace(/[^\d]/g, '').slice(0, 5))}
                        onBlur={commitLanPort}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitLanPort();
                        }}
                      />
                      <button className="btn ghost small" disabled={lanBusy} onClick={commitLanPort}>
                        应用
                      </button>
                    </div>
                  </Row>
                </section>

                <section className="settings-group">
                  <h3 className="settings-group-title">
                    访问方式
                    <span className="regex-badge">{lanStatus?.clients || 0} 台在线</span>
                  </h3>
                  {lanStatus?.running ? (
                    <>
                      <p className="settings-hint">在手机上打开下面任一地址，输入访问码即可。</p>
                      <div className="lan-url-list">
                        {(lanStatus.urls || []).map((url) => (
                          <div className="lan-url-row" key={url}>
                            <code>{url}</code>
                            <button className="btn ghost small" onClick={() => copyToClipboard(url, '地址')}>
                              复制
                            </button>
                          </div>
                        ))}
                        {!(lanStatus.urls || []).length && (
                          <p className="settings-hint">没找到局域网地址，确认这台电脑连着 Wi-Fi 或网线。</p>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="settings-hint">面板没在运行。打开上面的开关就会生成地址与访问码。</p>
                  )}
                  <Row title="访问码" hint="换一张会让已经连上的设备失效，需要重新输入">
                    <div className="proxy-row">
                      <code className="lan-token">{lanSettings.token || lanStatus?.token || '——'}</code>
                      <button
                        className="btn ghost small"
                        onClick={() => copyToClipboard(lanSettings.token || lanStatus?.token, '访问码')}
                      >
                        复制
                      </button>
                      <button
                        className="btn ghost small"
                        disabled={lanBusy}
                        onClick={() => applyLan({ ...lanSettings, enabled: true, token: makeLanToken() })}
                      >
                        换一张
                      </button>
                    </div>
                  </Row>
                  {lanStatus?.running && lanSettings.token ? (
                    <Row title="在本机浏览器打开" hint="不想复制地址的话，直接开个窗口看效果">
                      <button
                        className="btn ghost small"
                        onClick={() => lanOpen(`http://127.0.0.1:${lanStatus.port}/?t=${lanSettings.token}`)}
                      >
                        打开
                      </button>
                    </Row>
                  ) : null}
                </section>

                <section className="settings-group">
                  <h3 className="settings-group-title">说明</h3>
                  <p className="settings-hint">
                    面板只在局域网内可见，数据不经过任何服务器 —— 手机读的就是本机的 books.json 与 progress.json。
                  </p>
                  <p className="settings-hint">
                    第一次开启时 Windows 可能会弹防火墙提示，要允许「专用网络」，否则手机连不上。
                  </p>
                  <p className="settings-hint">
                    云端书由本机的书源引擎抓取正文，手机上照样能翻目录、读章节；抓不到时会明确提示。
                  </p>
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
