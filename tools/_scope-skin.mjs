// 一次性脚本：把 miui.css 的规则作用域化到 [data-skin='miui']，生成 skin-miui.css。
// 目的：让 Apple 风格与 MIUI 风格可并存切换，而不是靠 !important 全局互相压制。
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('src/miui.css');
const OUT = path.resolve('src/skin-miui.css');
const PREFIX = "[data-skin='miui']";

const css = fs.readFileSync(SRC, 'utf8');

/** 顶层解析：注释 / 空白原样保留，规则拆成 { selector, body }。 */
function parseTop(source) {
  const items = [];
  let i = 0;
  let segStart = 0;
  while (i < source.length) {
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      items.push({ type: 'raw', text: source.slice(segStart, stop) });
      i = stop;
      segStart = stop;
      continue;
    }
    if (source[i] === '{') {
      let depth = 1;
      let j = i + 1;
      while (j < source.length && depth > 0) {
        if (source.startsWith('/*', j)) {
          const end = source.indexOf('*/', j + 2);
          j = end === -1 ? source.length : end + 2;
          continue;
        }
        if (source[j] === '{') depth += 1;
        else if (source[j] === '}') depth -= 1;
        j += 1;
      }
      items.push({ type: 'rule', selector: source.slice(segStart, i), body: source.slice(i + 1, j - 1) });
      i = j;
      segStart = j;
      continue;
    }
    i += 1;
  }
  if (segStart < source.length) items.push({ type: 'raw', text: source.slice(segStart) });
  return items;
}

function scopeSelector(selector) {
  return selector
    .split(',')
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return trimmed;
      // :root 只定义 --mi-* 专属变量，留给全局；其余规则一律挂到皮肤作用域下。
      if (trimmed === ':root') return trimmed;
      return `${PREFIX} ${trimmed}`;
    })
    .join(',\n');
}

function process(source) {
  const out = [];
  for (const item of parseTop(source)) {
    if (item.type === 'raw') {
      out.push(item.text);
      continue;
    }
    const selector = item.selector.trim();
    if (selector.startsWith('@keyframes')) {
      out.push(`${item.selector}{${item.body}}`);
      continue;
    }
    if (selector.startsWith('@media') || selector.startsWith('@supports')) {
      out.push(`${item.selector}{${process(item.body)}}`);
      continue;
    }
    out.push(`${scopeSelector(item.selector)}{${item.body}}`);
  }
  return out.join('');
}

const header = `/* ==========================================================================
   Miuix Console · 视觉层（由 src/miui.css 作用域化生成）
   ────────────────────────────────────────────────────────────────────────
   所有规则挂在 [data-skin='miui'] 下，与 apple.css 的 Apple 风格并存，
   由「设置 → 外观 → 界面风格」切换。
   不要直接改这个文件；改 src/miui.css 后重新执行 tools/_scope-skin.mjs。
   ========================================================================== */

`;
const result = header + process(css);
fs.writeFileSync(OUT, result, 'utf8');

// 自检：作用域前缀必须成对出现，且不能有裸露的顶层规则（注释除外）
const scoped = (result.match(/\[data-skin='miui'\]/g) || []).length;
const bad = result.match(/^\s*(\.[a-zA-Z][\w-]*|#[a-zA-Z][\w-]*)\s*\{/gm) || [];
console.log('src/miui.css     ->', css.split('\n').length, 'lines');
console.log('src/skin-miui.css->', result.split('\n').length, 'lines');
console.log('scoped rules:', scoped);
console.log('rules left unscoped (应为 0):', bad.length, bad.slice(0, 5));
