// 主题令牌双源校验。
//
// 内置主题的配色在两个地方各有一份：
//   1) src/design/tokens.css —— 真正生效的那份（CSS 变量）
//   2) src/themes.js 的 BUILTIN_THEMES —— 用来画设置页/阅读面板的预览卡
// 两份一旦漂移，预览卡显示的颜色就和实际主题对不上（曾经就是这样：
// 主题已经是朱砂纸本，预览卡还是 iOS 蓝）。这个脚本把两份拉到一起核对。
//
// 用法：node tools/_theme-sync.mjs
// 退出码 0 = 一致；1 = 有漂移（会逐条列出差异）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILTIN_THEMES, TOKEN_TO_VAR } from '../src/themes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TOKENS = path.join(ROOT, 'src', 'design', 'tokens.css');

/** CSS 变量名 → themes.js 里的键名 */
const VAR_TO_KEY = Object.fromEntries(
  Object.entries(TOKEN_TO_VAR).map(([key, cssVar]) => [cssVar, key]),
);

/** 把 tokens.css 拆成 { themeId: { '--bg': '#faf8f4', ... } } */
function readCssThemes(file) {
  const css = fs.readFileSync(file, 'utf8');
  const themes = {};
  const blockRe = /\[data-theme='([a-z]+)'\]\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = blockRe.exec(css))) {
    const [, id, body] = m;
    const vars = {};
    const declRe = /--([a-z-]+)\s*:\s*([^;]+);/g;
    let d;
    while ((d = declRe.exec(body))) {
      vars[`--${d[1]}`] = d[2].trim();
    }
    themes[id] = vars;
  }
  return themes;
}

/** rgba(28, 24, 19, 0.13) 与 rgba(28,24,19,0.13) 视为同一个值 */
function normalize(value) {
  return String(value)
    .toLowerCase()
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

const cssThemes = readCssThemes(TOKENS);
const problems = [];

for (const theme of BUILTIN_THEMES) {
  const cssVars = cssThemes[theme.id];
  if (!cssVars) {
    problems.push(`[${theme.id}] tokens.css 里没有 [data-theme='${theme.id}'] 区块`);
    continue;
  }
  for (const [key, value] of Object.entries(theme.tokens)) {
    const cssVar = TOKEN_TO_VAR[key];
    const cssValue = cssVars[cssVar];
    if (cssValue === undefined) {
      problems.push(`[${theme.id}] tokens.css 缺少 ${cssVar}`);
      continue;
    }
    if (normalize(cssValue) !== normalize(value)) {
      problems.push(
        `[${theme.id}] ${key} 不一致：themes.js=${value}（${cssVar}） tokens.css=${cssValue}`,
      );
    }
  }
}

if (problems.length) {
  console.error('主题令牌漂移：');
  for (const p of problems) console.error('  - ' + p);
  console.error(`\n共 ${problems.length} 处。tokens.css 是运行时真正生效的那份，请以它为准同步 themes.js。`);
  process.exit(1);
}

const count = BUILTIN_THEMES.length * Object.keys(TOKEN_TO_VAR).length;
console.log(`主题令牌一致：${BUILTIN_THEMES.length} 套主题 × ${Object.keys(TOKEN_TO_VAR).length} 个令牌 = ${count} 项全部匹配。`);
