// HTML 解析与选择器的兼容层。
//
// 解析交给 htmlparser2，选择器交给 css-select，序列化交给 dom-serializer；
// 本文件只保留三件必须自己做的事：
//   1) 把 domhandler 节点补成引擎使用的 `tag / attrs / children / parent` 形状；
//   2) 把 Legado 的私有写法翻译成标准 CSS（`[a~=x|y]`、`:eq/:lt/:gt`、`:first/:last`）；
//   3) 阅读域语义的纯函数（textOf / htmlOf / attrOf / absUrl）。

import { parseDocument } from 'htmlparser2';
import { selectAll as cssSelectAll } from 'css-select';
import render from 'dom-serializer';
import { decodeHTML } from 'entities';

const EMPTY_ATTRS = Object.freeze({});
const WHITESPACE_ONLY = /^\s*$/;
const SET_PSEUDO_RE = /:(eq|lt|gt)\(\s*(-?\d+)\s*\)/g;

const ELEMENT_TYPES = new Set(['tag', 'script', 'style']);

/** 解码 HTML 实体；失败时原样返回，绝不抛错。 */
export function decodeEntities(input) {
  const text = String(input ?? '');
  if (!text || text.indexOf('&') === -1) return text;
  try {
    return decodeHTML(text);
  } catch {
    return text;
  }
}

/**
 * 把 domhandler 树补成引擎认识的形状，并清掉注释、脚本、样式与纯空白文本。
 * 纯空白文本在旧解析器里本来就被丢弃，这里保持同样的可见结果。
 */
function normalizeTree(root) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();

    if (node.type === 'root' || node.type === 'document') {
      node.tag = '#root';
      node.attrs = EMPTY_ATTRS;
    } else if (node.type === 'text') {
      node.tag = '#text';
      node.attrs = EMPTY_ATTRS;
      node.text = node.data;
    } else if (ELEMENT_TYPES.has(node.type)) {
      node.tag = String(node.name || '').toLowerCase();
      node.attrs = node.attribs || EMPTY_ATTRS;
    } else {
      node.tag = `#${node.type}`;
      node.attrs = EMPTY_ATTRS;
      continue;
    }

    const children = node.children;
    if (!Array.isArray(children) || !children.length) continue;

    const kept = [];
    for (const child of children) {
      const type = child.type;
      if (type === 'comment' || type === 'directive' || type === 'cdata') continue;
      if (type === 'text' && WHITESPACE_ONLY.test(child.data || '')) continue;
      if (type === 'script' || type === 'style') continue;
      if (type === 'tag' && String(child.name).toLowerCase() === 'noscript') continue;
      kept.push(child);
    }

    if (kept.length !== children.length) {
      node.children = kept;
      for (let i = 0; i < kept.length; i += 1) {
        kept[i].parent = node;
        kept[i].prev = kept[i - 1] || null;
        kept[i].next = kept[i + 1] || null;
      }
    }

    for (let i = kept.length - 1; i >= 0; i -= 1) stack.push(kept[i]);
  }
}

/** 解析 HTML 字符串，返回文档根节点（tag === '#root'）。 */
export function parseHtml(html) {
  const root = parseDocument(String(html || ''));
  normalizeTree(root);
  return root;
}

/* ------------------------------------------------------------------ */
/* 选择器：标准 CSS 交给 css-select，Legado 私有写法在这里翻译          */
/* ------------------------------------------------------------------ */

/** 按顶层逗号切分选择器组，忽略引号/括号/方括号里的逗号。 */
function splitGroups(selector) {
  const groups = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i];
    if (quote) {
      if (ch === quote && selector[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 0) {
      groups.push(selector.slice(start, i));
      start = i + 1;
    }
  }
  groups.push(selector.slice(start));
  return groups;
}

/**
 * Legado 的 `[property~=a|b|c]` 表示「任意一个命中」，标准 CSS 没有这个语义：
 * 展开成 `:is([property~="a"],[property="a"],[property~="b"],[property="b"],…)`。
 */
function expandMultiValueAttrs(group) {
  return group.replace(/\[([\w:.-]+)~=([^\]]+)\]/g, (whole, name, raw) => {
    if (!raw.includes('|')) return whole;
    const parts = raw
      .split('|')
      .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    if (!parts.length) return whole;
    const alts = parts.map((part) => `[${name}~="${part}"],[${name}="${part}"]`).join(',');
    return `:is(${alts})`;
  });
}

/** 把 Legado / jQuery 的简写伪类换成 css-select 支持的标准写法。 */
function prepareSelector(group) {
  const base = group
    .replace(SET_PSEUDO_RE, '')
    .replace(/:first(?!-child)/g, ':first-child')
    .replace(/:last(?!-child)/g, ':last-child')
    .replace(/:nth\(\s*(\d+)\s*\)/g, ':nth-child($1)');
  return expandMultiValueAttrs(base);
}

/** `:eq(n)` / `:lt(n)` / `:gt(n)` 作用在整组结果上，与旧实现一致。 */
function sliceSet(list, kind, n) {
  if (kind === 'eq') {
    const at = n < 0 ? list.length + n : n;
    return Number.isFinite(at) && list[at] ? [list[at]] : [];
  }
  if (kind === 'lt') return list.slice(0, Math.max(0, Number.isFinite(n) ? n : 0));
  return list.slice(Math.max(0, (Number.isFinite(n) ? n : 0) + 1));
}

/** 返回匹配节点数组（文档顺序）。单组选择器出错只丢掉该组，不影响其它组。 */
export function selectAll(root, selector) {
  if (!root) return [];
  const source = String(selector || '');
  if (!source.trim()) return [];

  const hits = [];
  const seen = new Set();
  for (const raw of splitGroups(source)) {
    const group = raw.trim();
    if (!group) continue;

    const pseudo = [...group.matchAll(SET_PSEUDO_RE)].pop();
    let matched;
    try {
      matched = cssSelectAll(prepareSelector(group), root);
    } catch {
      continue;
    }
    if (pseudo) matched = sliceSet(matched, pseudo[1], Number(pseudo[2]));
    for (const node of matched) {
      if (!seen.has(node)) {
        seen.add(node);
        hits.push(node);
      }
    }
  }
  return hits;
}

export function selectFirst(root, selector) {
  return selectAll(root, selector)[0] || null;
}

/** 节点内纯文本（保留 <br> 换行，块级元素前后加换行，压缩空白）。 */
export function textOf(node, { raw = false } = {}) {
  if (!node) return '';
  const parts = [];
  const visit = (current) => {
    for (const child of current.children || []) {
      if (child.tag === '#text') parts.push(child.text ?? child.data ?? '');
      else if (child.tag === 'br') parts.push('\n');
      else if (child.tag === 'p' || child.tag === 'div') {
        parts.push('\n');
        visit(child);
        parts.push('\n');
      } else visit(child);
    }
  };
  visit(node);
  const joined = parts.join('');
  if (raw) return joined;
  return joined
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 节点 outerHTML（用于 @html 规则）。 */
export function htmlOf(node) {
  if (!node) return '';
  if (node.tag === '#text') return node.text ?? node.data ?? '';
  return render(node, { encodeEntities: false });
}

/** 取属性，兼容 href/src 的相对地址。 */
export function attrOf(node, name, baseUrl) {
  if (!node) return '';
  const key = String(name || '').toLowerCase();
  const value = key === 'text' ? textOf(node) : key === 'html' ? htmlOf(node) : node.attrs?.[key] || '';
  if (baseUrl && (key === 'href' || key === 'src' || key === 'content')) return absUrl(baseUrl, value);
  return value;
}

export function absUrl(baseUrl, href) {
  const raw = String(href || '').trim();
  if (!raw) return '';
  if (/^(https?:|data:|mailto:)/i.test(raw)) return raw;
  try {
    return new URL(raw, baseUrl || undefined).toString();
  } catch {
    return raw;
  }
}
