import { createHash } from 'node:crypto';
import { runSourceScript } from './jsengine.js';

/**
 * Legado 的「替换规则」（净化规则 / replaceRule）。
 * 结构：{ name, group, pattern, replacement, isRegex, isEnabled, scopeContent, scopeTitle, order }
 * 作用：正文/章节标题展示前做一次文本替换，replacement 支持 @js: 脚本（result = 命中的文本）。
 */

const JS_TEXT = /^\s*@js\s*:/i;

function hashKey(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 10);
}

export function isReplaceRule(item) {
  if (!item || typeof item !== 'object') return false;
  if (typeof item.pattern !== 'string' || typeof item.replacement !== 'string') return false;
  // 书源一定带站点/搜索地址，替换规则没有
  return !item.bookSourceUrl && !item.bookSourceName && !item.searchUrl;
}

export function normalizeRule(item, index = 0) {
  const pattern = String(item?.pattern ?? '');
  if (!pattern) return { error: '缺少匹配规则 pattern' };
  const name = String(item.name || item.group || `规则 ${index + 1}`).trim();
  return {
    id: `r${hashKey(`${name}|${pattern}`)}`,
    name,
    group: String(item.group || '净化').trim() || '净化',
    pattern,
    replacement: String(item.replacement ?? ''),
    isRegex: item.isRegex !== false,
    enabled: item.isEnabled !== false,
    scopeContent: item.scopeContent !== false,
    scopeTitle: item.scopeTitle === true,
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
  };
}

const CJK = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff';
const WORD = `0-9A-Za-z_${CJK}`;
// 字符类内部用的「非词字符」：等价于 Java 语义下 [^\w] 的展开（汉字算词字符）
const NON_WORD =
  '\\u0000-\\u002f\\u003a-\\u0040\\u005b-\\u005e\\u0060\\u007b-\\u33ff\\u4dc0-\\u4dff\\ua000-\\uf8ff\\ufb00-\\uffff';
const HSPACE = ' \\t\\u00a0\\u3000\\u2000-\\u200a';

/**
 * Legado 的规则多半是在 Java 里写的，且大量依赖「汉字算 \w」这一前提
 * （例如 `[^\w「」]+$` 本意是「整行只有标点」）。JS 的 \w 只认 ASCII，
 * 直接跑会把整段中文删掉，所以这里把 \w / \W / \h 换成 Unicode 版本。
 */
function normalizeSyntax(source) {
  let out = '';
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\') {
      const next = source[i + 1] || '';
      if (next === 'w') {
        out += inClass ? WORD : `[${WORD}]`;
        i += 1;
        continue;
      }
      if (next === 'W') {
        // 字符类内部不能嵌套 [^…]，展开成「除词字符以外」的等价片段
        out += inClass ? NON_WORD : `[^${WORD}]`;
        i += 1;
        continue;
      }
      if (next === 'h') {
        out += inClass ? HSPACE : `[${HSPACE}]`;
        i += 1;
        continue;
      }
      out += ch + next;
      i += 1;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    out += ch;
  }
  return out;
}

/** Legado 的 `(?i)` 内联标记在 JS 里不合法，抽出来变成 flag。 */
export function compilePattern(pattern, isRegex) {
  if (!isRegex) return null;
  let source = String(pattern || '');
  let flags = 'g';
  const leading = /^\(\?([imsu]+)\)/.exec(source);
  if (leading) {
    flags += leading[1];
    source = source.slice(leading[0].length);
  }
  source = source.replace(/\(\?([imsu])\)/g, (_, flag) => {
    flags += flag;
    return '';
  });
  source = normalizeSyntax(source);
  flags = [...new Set(flags.split(''))].join('');
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

function runReplacementJs(rule, matched, ctx) {
  const source = ctx.source || { id: 'replace-rules', name: '净化规则' };
  const value = runSourceScript(
    source,
    rule.replacement,
    { result: matched, baseUrl: ctx.baseUrl || '' },
    { cacheRoot: ctx.cacheRoot, proxy: ctx.proxy }
  );
  if (value === undefined || value === null) return matched;
  return String(value);
}

/**
 * 依次套用规则。scope: 'content'（正文，默认）| 'title'（章节标题）。
 */
export function applyRules(text, rules, ctx = {}) {
  let out = String(text ?? '');
  if (!out || !Array.isArray(rules) || !rules.length) return out;
  const scope = ctx.scope === 'title' ? 'title' : 'content';
  const ordered = [...rules].sort((a, b) => (a.order || 0) - (b.order || 0));

  for (const rule of ordered) {
    if (!rule || rule.enabled === false) continue;
    if (scope === 'title' && rule.scopeTitle !== true) continue;
    if (scope === 'content' && rule.scopeContent === false) continue;
    try {
      if (JS_TEXT.test(rule.replacement)) {
        const re = compilePattern(rule.pattern, rule.isRegex);
        if (!re) {
          // 非正则规则：整段交给脚本
          out = runReplacementJs(rule, out, ctx);
          continue;
        }
        const memo = new Map();
        out = out.replace(re, (matched) => {
          if (memo.has(matched)) return memo.get(matched);
          const next = runReplacementJs(rule, matched, ctx);
          memo.set(matched, next);
          return next;
        });
        continue;
      }

      const re = compilePattern(rule.pattern, rule.isRegex);
      if (re) {
        out = out.replace(re, rule.replacement);
      } else if (!rule.isRegex) {
        out = out.split(rule.pattern).join(rule.replacement);
      }
    } catch {
      /* 单条规则出错不影响其它规则 */
    }
  }
  return out;
}

export function detectPayloadKind(items) {
  if (!Array.isArray(items) || !items.length) return 'unknown';
  const rules = items.filter(isReplaceRule).length;
  if (rules === items.length) return 'rules';
  return 'sources';
}
