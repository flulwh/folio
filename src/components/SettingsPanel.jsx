import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { backdropVariants, sheetVariants } from '../motion.js';
import { AUTO_CHAPTER_REGEX, compileRegex } from '../utils/chapters.js';
import { formatCount } from '../utils/format.js';
import { IconCommand, IconType, IconX } from './Icons.jsx';
import Segmented from './Segmented.jsx';
import FontManager from './FontManager.jsx';
import { SHORTCUT_GROUPS } from '../utils/shortcuts.js';
import { usePresence } from '../hooks/usePresence.js';
import { useThemeState } from '../store/AppStore.jsx';
import { fontStackFor } from '../hooks/useFontLoader.js';

const FONTS = [
  { key: 'sans', label: '无衬线' },
  { key: 'serif', label: '衬线' },
  { key: 'mono', label: '等宽' },
];

function Slider({ label, value, min, max, step, unit, onChange }) {
  return (
    <div className="setting-row slider-row">
      <div className="setting-label">
        <span>{label}</span>
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
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--pct': `${((value - min) / (max - min)) * 100}%` }}
      />
    </div>
  );
}

export default function SettingsPanel({
  open,
  settings,
  onChange,
  onReset,
  onClose,
  chapterStats,
}) {
  const { themes } = useThemeState();
  const [regexDraft, setRegexDraft] = useState(settings.chapterRegex || '');
  const [regexError, setRegexError] = useState('');

  // 排版预览的字体栈：与阅读器保持一致（用户字体优先）
  const previewFontStack = useMemo(
    () =>
      settings.userFont
        ? fontStackFor(settings.userFont, settings.fontFamily)
        : `var(--font-${settings.fontFamily})`,
    [settings.userFont, settings.fontFamily]
  );

  useEffect(() => {
    if (open) {
      setRegexDraft(settings.chapterRegex || '');
      setRegexError('');
    }
  }, [open, settings.chapterRegex]);

  const draftValid = useMemo(() => {
    if (!regexDraft.trim()) return true;
    const compiled = compileRegex(regexDraft.trim());
    return !(compiled instanceof Error || (compiled && compiled.error));
  }, [regexDraft]);

  const applyRegex = () => {
    if (!draftValid) {
      setRegexError('正则表达式无效，请检查括号与转义');
      return;
    }
    setRegexError('');
    onChange({ chapterRegex: regexDraft.trim() });
  };

  const alive = usePresence(open);

  return (
    <AnimatePresence>
      {alive && (
        <>
          <motion.div
            key="settings-backdrop"
            className="panel-backdrop"
            variants={backdropVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            style={{ pointerEvents: open ? 'auto' : 'none' }}
            onClick={onClose}
          />
          <motion.aside
            key="settings-panel"
            className="panel settings-panel"
            variants={sheetVariants('right')}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <header className="panel-head">
              <div>
                <span className="panel-eyebrow">
                  <IconType size={14} /> 阅读设置
                </span>
                <h2 className="panel-title">排版与外观</h2>
                <span className="panel-sub">所有调整即时生效并自动保存</span>
              </div>
              <button className="icon-btn ghost" onClick={onClose} title="关闭设置 (Esc)">
                <IconX size={18} />
              </button>
            </header>

            <div className="settings-body">
              <section className="settings-group">
                <h3 className="settings-group-title">主题</h3>
                <div className="theme-grid">
                  {themes.map((theme) => (
                    <button
                      key={theme.id}
                      className={`theme-swatch${settings.theme === theme.id ? ' active' : ''}`}
                      onClick={() => onChange({ theme: theme.id })}
                      title={theme.owner ? `来自插件 ${theme.owner}` : theme.label}
                    >
                      <span
                        className="theme-preview"
                        style={{ background: theme.tokens.bg, color: theme.tokens.accent }}
                      />
                      <span className="theme-label">{theme.label}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="settings-group">
                <h3 className="settings-group-title">字体</h3>
                <FontManager compact onChange={onChange} />
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
                  onChange={(v) => onChange({ fontSize: v })}
                />
                <Slider
                  label="行距"
                  value={settings.lineHeight}
                  min={1.4}
                  max={2.8}
                  step={0.05}
                  unit=""
                  onChange={(v) => onChange({ lineHeight: v })}
                />
                <Slider
                  label="正文宽度"
                  value={settings.pageWidth}
                  min={520}
                  max={980}
                  step={20}
                  unit="px"
                  onChange={(v) => onChange({ pageWidth: v })}
                />
                <Slider
                  label="段间距"
                  value={settings.paragraphSpacing}
                  min={0}
                  max={2}
                  step={0.1}
                  unit="em"
                  onChange={(v) => onChange({ paragraphSpacing: v })}
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
                  <span>排版预览 · 改动即时生效</span>
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
                    onChange={(e) => onChange({ indent: e.target.checked })}
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
                    onChange={(e) => onChange({ autoHideUI: e.target.checked })}
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
                    onChange={(e) => onChange({ showProgress: e.target.checked })}
                  />
                </label>
                <label className="switch-row">
                  <span>
                    减少动效
                    <small>关闭页间过渡与弹簧动画，更安静</small>
                  </span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={!!settings.reduceMotion}
                    onChange={(e) => onChange({ reduceMotion: e.target.checked })}
                  />
                </label>
              </section>

              <section className="settings-group">
                <h3 className="settings-group-title">
                  <IconCommand size={14} /> 快捷键
                </h3>
                <div className="settings-shortcuts">
                  {SHORTCUT_GROUPS.slice(0, 3).map((group) => (
                    <div key={group.title} className="settings-shortcut-row">
                      <span className="settings-shortcut-group">{group.title}</span>
                      {group.items.slice(0, 4).map(([keys, label]) => (
                        <span key={`${group.title}-${keys}`} className="settings-shortcut">
                          <kbd>{keys}</kbd> {label}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
                <p className="settings-hint">
                  在任意页面按 <kbd>?</kbd> 查看完整列表。
                </p>
              </section>

              <section className="settings-group">
                <h3 className="settings-group-title">
                  章节识别正则
                  <span className="regex-badge">
                    {chapterStats.hasHeadings ? `识别到 ${chapterStats.count} 章` : '未识别章节'}
                  </span>
                </h3>
                <p className="settings-hint">
                  留空则使用内置的中文章节规则（第X章 / Chapter N / 序章 / 楔子 等）。填写后会对每一行做匹配，
                  命中且长度不超过 60 字的行会作为章节标题。
                </p>
                <textarea
                  className={`regex-input${regexError ? ' invalid' : ''}`}
                  value={regexDraft}
                  placeholder={AUTO_CHAPTER_REGEX}
                  spellCheck={false}
                  rows={4}
                  onChange={(e) => {
                    setRegexDraft(e.target.value);
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
                      onChange({ chapterRegex: '' });
                      setRegexError('');
                    }}
                  >
                    恢复默认
                  </button>
                </div>
                {chapterStats.samples?.length > 0 && (
                  <div className="regex-samples">
                    <span className="regex-samples-title">识别示例</span>
                    {chapterStats.samples.map((title) => (
                      <span key={title} className="regex-sample">
                        {title}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              <section className="settings-group">
                <h3 className="settings-group-title">书籍信息</h3>
                <div className="book-stats">
                  <div>
                    <span>字数</span>
                    <strong>{formatCount(chapterStats.wordCount)}</strong>
                  </div>
                  <div>
                    <span>段落</span>
                    <strong>{formatCount(chapterStats.paragraphCount)}</strong>
                  </div>
                  <div>
                    <span>章节</span>
                    <strong>{chapterStats.count}</strong>
                  </div>
                </div>
              </section>

              <button className="btn ghost full-width" onClick={onReset}>
                恢复全部默认设置
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
