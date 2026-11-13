import React, { useMemo, useState } from 'react';
import { useAppActions, useFontStatus, useFonts, useSettings } from '../store/AppStore.jsx';
import { fontFamilyName } from '../hooks/useFontLoader.js';
import { IconPlus, IconTrash } from './Icons.jsx';

/**
 * 字体管理面板。
 *
 * 三层结构：
 * 1. 基础字体族（无衬线 / 衬线 / 等宽）—— 系统自带，永远可用
 * 2. 用户安装的字体 —— 可选中、可删除
 * 3. 安装按钮 —— 从系统里挑字体文件
 *
 * 两种接入方式：
 * - 默认走 store（设置页用）：直接 patchSettings / selectFont
 * - 传 onChange（阅读面板用）：把改动交给调用方，调用方决定怎么落盘
 *
 * 关键细节：列表里的预览文字必须用字体自己的族名渲染，
 * 否则每个条目看起来都长得一样（都在用系统默认字体），用户没法辨认。
 */
export default function FontManager({ compact = false, onChange = null }) {
  const fonts = useFonts();
  const settings = useSettings();
  const { failedFonts, fontCJK } = useFontStatus();
  const { patchSettings, installFonts, removeFont, selectFont } = useAppActions();
  const [busy, setBusy] = useState(false);
  const [pendingRemove, setPendingRemove] = useState('');

  // 有 onChange 时用调用方的通道，否则用 store
  const applyFontFamily = (fontFamily) => {
    if (onChange) onChange({ fontFamily });
    else patchSettings({ fontFamily });
  };
  const applyUserFont = (id) => {
    if (onChange) onChange({ userFont: id });
    else selectFont(id);
  };

  const baseFonts = useMemo(
    () => [
      { key: 'sans', label: '无衬线', stack: 'var(--font-sans)' },
      { key: 'serif', label: '衬线', stack: 'var(--font-serif)' },
      { key: 'mono', label: '等宽', stack: 'var(--font-mono)' },
    ],
    []
  );

  // 当前生效的字体：用户字体优先，否则是基础字体族
  const activeBase = settings.userFont ? '' : settings.fontFamily;

  const handleInstall = async () => {
    setBusy(true);
    try {
      await installFonts();
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id) => {
    // 第一次点击只做标记，第二次才真删 —— 避免误点直接丢文件
    if (pendingRemove !== id) {
      setPendingRemove(id);
      return;
    }
    setPendingRemove('');
    await removeFont(id);
  };

  return (
    <div className={`font-manager${compact ? ' compact' : ''}`}>
      <div className="font-base-row">
        {baseFonts.map((font) => (
          <button
            key={font.key}
            type="button"
            className={`font-base-option${activeBase === font.key ? ' active' : ''}`}
            style={{ fontFamily: font.stack }}
            onClick={() => {
              applyUserFont('');
              applyFontFamily(font.key);
            }}
          >
            <span className="font-option-label">{font.label}</span>
            <span className="font-option-sample">
              <b>汉字</b>
              <i>Ag 24</i>
            </span>
          </button>
        ))}
      </div>

      {fonts.length > 0 && (
        <div className="font-user-list">
          <div className="font-list-head">
            <span className="font-list-title">已安装的字体</span>
            <span className="font-list-count">{fonts.length}</span>
          </div>
          {fonts.map((font) => {
            const active = settings.userFont === font.id;
            const confirming = pendingRemove === font.id;
            // 是否含中文字形：主进程读 cmap 的结果是权威数据；
            // fontCJK 是加载 hook 传来的同一份信息的镜像，作为兼容兜底。
            const hasCJK = typeof font.hasCJK === 'boolean' ? font.hasCJK : fontCJK?.[font.id];
            const loadFailed = failedFonts?.some((f) => f.id === font.id);
            return (
              <div key={font.id} className={`font-user-row${active ? ' active' : ''}`}>
                <button
                  type="button"
                  className="font-user-main"
                  style={{ fontFamily: `"${fontFamilyName(font.id)}", var(--font-sans)` }}
                  onClick={() => applyUserFont(font.id)}
                  title={`使用「${font.family}」`}
                >
                  <span className="font-radio" aria-hidden="true" />
                  <span className="font-user-info">
                    <span className="font-user-name">{font.family}</span>
                    <span className="font-user-meta">
                      {font.format?.toUpperCase() || '字体'} · {(font.size / 1048576).toFixed(1)} MB
                      {hasCJK === false && <em className="font-tag">无中文</em>}
                      {hasCJK === true && <em className="font-tag ok">含中文</em>}
                      {loadFailed && <em className="font-tag bad">加载失败</em>}
                    </span>
                  </span>
                  <span className="font-user-sample">
                    <b>汉字</b>
                    <i>Ag 24</i>
                  </span>
                </button>
                <button
                  type="button"
                  className={`font-remove${confirming ? ' confirming' : ''}`}
                  title={confirming ? '再点一次确认删除' : '删除字体'}
                  onClick={() => handleRemove(font.id)}
                >
                  {confirming ? '确认' : <IconTrash size={15} />}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="font-install-row">
        <button className="btn ghost small" type="button" onClick={handleInstall} disabled={busy}>
          <IconPlus size={13} />
          {busy ? '正在安装…' : '安装字体'}
        </button>
        <span className="font-install-hint">
          {fonts.length > 0 ? '支持 ttf / otf / woff / woff2' : '从系统里挑选字体文件安装到 Folio'}
        </span>
      </div>
    </div>
  );
}
