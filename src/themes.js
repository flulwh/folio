/**
 * 主题令牌。
 *
 * 内置主题真正生效的是 CSS 里的 [data-theme='…'] 区块，即 src/design/tokens.css
 * —— 那是唯一的真相来源。这里保留一份同样的令牌，一是为了给设置页和阅读面板
 * 画预览卡（预览卡要显示真实的强调色，不能是另一个配色），二是给自定义主题
 * 做运行时注入。运行时注入写在 <html> 的行内样式上，优先级最高，
 * 所以对内置主题也能覆盖。
 *
 * ⚠ 两份必须保持一致：改 tokens.css 之后要同步这里，并跑 `npm run check:theme`
 *   （tools/_theme-sync.mjs）核对，否则预览卡会和实际主题对不上。
 */

export const THEME_TOKEN_KEYS = [
  'bg',
  'bgElevated',
  'bgSunken',
  'bgHover',
  'text',
  'textSoft',
  'textFaint',
  'line',
  'accent',
  'accentSoft',
  'accentContrast',
  'sheetBg',
  'toolbarBg',
];

/** 令牌名 → CSS 变量名（行内注入时用 --kebab-case） */
export const TOKEN_TO_VAR = {
  bg: '--bg',
  bgElevated: '--bg-elevated',
  bgSunken: '--bg-sunken',
  bgHover: '--bg-hover',
  text: '--text',
  textSoft: '--text-soft',
  textFaint: '--text-faint',
  line: '--line',
  accent: '--accent',
  accentSoft: '--accent-soft',
  accentContrast: '--accent-contrast',
  sheetBg: '--sheet-bg',
  toolbarBg: '--toolbar-bg',
};

export const BUILTIN_THEMES = [
  {
    id: 'paper',
    label: '浅色',
    tone: 'light',
    builtin: true,
    tokens: {
      bg: '#faf8f4',
      bgElevated: '#fffefb',
      bgSunken: '#f1ede4',
      bgHover: 'rgba(28, 24, 19, 0.045)',
      text: '#1c1815',
      textSoft: '#5c554c',
      textFaint: '#736c63',
      line: 'rgba(28, 24, 19, 0.13)',
      accent: '#b1402c',
      accentSoft: 'rgba(177, 64, 44, 0.085)',
      accentContrast: '#fffefb',
      sheetBg: 'rgba(255, 254, 251, 0.92)',
      toolbarBg: 'rgba(250, 248, 244, 0.88)',
    },
  },
  {
    id: 'sepia',
    label: '暖沙',
    tone: 'light',
    builtin: true,
    tokens: {
      bg: '#f2e9d8',
      bgElevated: '#fbf4e6',
      bgSunken: '#e8dcc6',
      bgHover: 'rgba(74, 54, 28, 0.055)',
      text: '#2a2119',
      textSoft: '#6b5b47',
      textFaint: '#726247',
      line: 'rgba(74, 54, 28, 0.16)',
      accent: '#9c4a1a',
      accentSoft: 'rgba(156, 74, 26, 0.09)',
      accentContrast: '#fbf4e6',
      sheetBg: 'rgba(251, 244, 230, 0.94)',
      toolbarBg: 'rgba(242, 233, 216, 0.9)',
    },
  },
  {
    id: 'night',
    label: '深色',
    tone: 'dark',
    builtin: true,
    tokens: {
      bg: '#121114',
      bgElevated: '#1a191d',
      bgSunken: '#0c0b0e',
      bgHover: 'rgba(255, 255, 255, 0.05)',
      text: '#e6e2da',
      textSoft: '#9c968c',
      textFaint: '#8a847b',
      line: 'rgba(230, 226, 218, 0.13)',
      accent: '#d4644c',
      accentSoft: 'rgba(212, 100, 76, 0.14)',
      accentContrast: '#121114',
      sheetBg: 'rgba(26, 25, 29, 0.92)',
      toolbarBg: 'rgba(18, 17, 20, 0.9)',
    },
  },
  {
    id: 'forest',
    label: '冷灰',
    tone: 'light',
    builtin: true,
    tokens: {
      bg: '#f2f4f3',
      bgElevated: '#fbfcfb',
      bgSunken: '#e7ebe8',
      bgHover: 'rgba(24, 40, 34, 0.05)',
      text: '#1a221f',
      textSoft: '#586560',
      textFaint: '#66706a',
      line: 'rgba(24, 40, 34, 0.13)',
      accent: '#2f6b52',
      accentSoft: 'rgba(47, 107, 82, 0.09)',
      accentContrast: '#fbfcfb',
      sheetBg: 'rgba(251, 252, 251, 0.92)',
      toolbarBg: 'rgba(242, 244, 243, 0.9)',
    },
  },
];

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)$/i;

export function normalizeTheme(raw, { builtin = false } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) return null;
  const label = String(raw.label || raw.name || id).slice(0, 24);
  const tone = raw.tone === 'dark' ? 'dark' : 'light';
  const tokens = {};
  for (const key of THEME_TOKEN_KEYS) {
    const value = raw.tokens?.[key];
    if (typeof value === 'string' && COLOR_RE.test(value.trim())) tokens[key] = value.trim();
  }
  if (!tokens.bg || !tokens.text) return null;
  tokens.accent = tokens.accent || '#007aff';
  tokens.accentContrast = tokens.accentContrast || (tone === 'dark' ? '#000000' : '#ffffff');
  tokens.bgElevated = tokens.bgElevated || tokens.bg;
  tokens.bgSunken = tokens.bgSunken || tokens.bg;
  tokens.bgHover = tokens.bgHover || (tone === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)');
  tokens.textSoft = tokens.textSoft || tokens.text;
  tokens.textFaint = tokens.textFaint || tokens.textSoft;
  tokens.line = tokens.line || (tone === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.14)');
  tokens.accentSoft = tokens.accentSoft || tokens.bg;
  tokens.sheetBg = tokens.sheetBg || tokens.bgElevated;
  tokens.toolbarBg = tokens.toolbarBg || tokens.bg;
  return { id, label, tone, builtin, tokens };
}

/** 把主题写到 <html>，自定义主题用外壳主题承载结构性规则（阴影/描边等）。 */
export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const theme_ = theme || BUILTIN_THEMES[0];
  const root = document.documentElement;
  const body = document.body;
  const shell = theme_.builtin ? theme_.id : theme_.tone === 'dark' ? 'night' : 'paper';

  for (const el of [root, body]) {
    el.dataset.theme = shell;
    el.dataset.themeId = theme_.id;
    el.dataset.themeTone = theme_.tone;
  }

  if (theme_.builtin) {
    for (const key of THEME_TOKEN_KEYS) root.style.removeProperty(TOKEN_TO_VAR[key]);
    return;
  }
  for (const key of THEME_TOKEN_KEYS) {
    const value = theme_.tokens?.[key];
    if (value) root.style.setProperty(TOKEN_TO_VAR[key], value);
    else root.style.removeProperty(TOKEN_TO_VAR[key]);
  }
}

export function themePreview(theme) {
  const tokens = theme.tokens || {};
  return {
    '--preview-bg': tokens.bg || '#f2f2f7',
    '--preview-elevated': tokens.bgElevated || tokens.bg || '#ffffff',
    '--preview-text': tokens.text || '#000000',
    '--preview-accent': tokens.accent || '#007aff',
  };
}

export function themeToJson(theme) {
  return JSON.stringify(
    { id: theme.id, label: theme.label, tone: theme.tone, tokens: theme.tokens },
    null,
    2,
  );
}

export function parseThemeJson(text) {
  try {
    const data = JSON.parse(String(text || ''));
    return normalizeTheme(data);
  } catch {
    return null;
  }
}
