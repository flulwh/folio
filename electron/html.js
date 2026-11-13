// 轻量 HTML 解析 + CSS 选择器子集（书源规则引擎用）。
// 不做完整 HTML5 容错：真实书源页面绝大多数是结构良好的服务端渲染 HTML，
// 一个「标签扫描 + 栈」的解析器足够，且没有任何第三方依赖，打包体积为零。
//
// 性能策略：沿用 fb55/entities（BSD-2-Clause, github.com/fb55/entities）的
// 码点快速路径与「无实体则零分配」原则，以及 fb55/css-select 的
// 「选择器编译一次、反复复用」思路；领域语义（Legado 伪类、宽松容错）保留。

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  middot: '·',
  times: '×',
  copy: '©',
};

const MAX_CODE_POINT = 0x10ffff;
const ENTITY_RE = /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g;
const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
const TAG_RE = /<(\/?)([a-zA-Z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const HAS_COMMENT = /<!--/;
const HAS_SCRIPT = /<(script|style|noscript)\b/i;
const HAS_DOCTYPE = /<!DOCTYPE/i;
const NON_WHITESPACE_RE = /\S/;
const SELF_CLOSING_RE = /\/\s*$/;

export function decodeEntities(input) {
  if (!input || input.indexOf('&') === -1) return input || '';
  return input.replace(ENTITY_RE, (whole, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      // String.fromCodePoint throws for non-integers / negatives / > 0x10FFFF.
      // Checking up front gives the same "leave it untouched" result without
      // paying for exception setup on every numeric entity.
      if (!Number.isInteger(code) || code < 0 || code > MAX_CODE_POINT) return whole;
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

function parseAttrs(raw) {
  const attrs = {};
  if (!raw) return attrs;
  // Shared global regexp: exec() resets lastIndex to 0 on a null match, and we
  // also reset explicitly so an aborted parse cannot leak state.
  ATTR_RE.lastIndex = 0;
  let m = ATTR_RE.exec(raw);
  while (m) {
    const name = m[1].toLowerCase();
    const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
    if (name && !(name in attrs)) attrs[name] = decodeEntities(value);
    m = ATTR_RE.exec(raw);
  }
  return attrs;
}

function makeTextNode(text, parent) {
  return { tag: '#text', text, attrs: {}, children: [], parent };
}

/**
 * Strip comments / script-style / doctype. Each replace only runs when a cheap
 * probe says it can match, so ordinary content HTML allocates zero full-text
 * copies instead of three — identical output, since replace() is a no-op when
 * there is no match.
 */
function preprocess(html) {
  let source = String(html || '');
  if (HAS_COMMENT.test(source)) source = source.replace(/<!--[\s\S]*?-->/g, '');
  if (HAS_SCRIPT.test(source)) {
    source = source.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  }
  if (HAS_DOCTYPE.test(source)) source = source.replace(/<!DOCTYPE[^>]*>/gi, '');
  return source;
}

/** 解析 HTML 字符串，返回文档根节点（tag === '#root'）。 */
export function parseHtml(html) {
  const source = preprocess(html);

  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  const stack = [root];
  TAG_RE.lastIndex = 0;
  let cursor = 0;
  let match = TAG_RE.exec(source);

  const pushText = (chunk) => {
    if (!chunk) return;
    const text = decodeEntities(chunk);
    if (!NON_WHITESPACE_RE.test(text)) return;
    const parent = stack[stack.length - 1];
    parent.children.push(makeTextNode(text, parent));
  };

  while (match) {
    if (match.index > cursor) pushText(source.slice(cursor, match.index));
    cursor = TAG_RE.lastIndex;

    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const rawAttrs = match[3] || '';

    if (closing) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
    } else {
      const parent = stack[stack.length - 1];
      const node = { tag, attrs: parseAttrs(rawAttrs), children: [], parent };
      parent.children.push(node);
      const selfClosing = SELF_CLOSING_RE.test(rawAttrs) || VOID_TAGS.has(tag);
      if (!selfClosing) stack.push(node);
    }

    match = TAG_RE.exec(source);
  }

  if (cursor < source.length) pushText(source.slice(cursor));
  return root;
}

/* ------------------------------------------------------------------ */
/* 选择器：tag / .class / #id / [attr] / [attr=~^$*|=v] / :first :last
/*         :nth-child(n) :eq(n) :lt(n) :gt(n)，支持空格与 > */
/* ------------------------------------------------------------------ */

function parseAttrBody(body) {
  const m = /^\s*([\w:.-]+)\s*(?:([~^$*|]?=)\s*([\s\S]*))?$/.exec(body);
  if (!m) return { name: String(body).trim().toLowerCase(), op: null, value: null };
  let value = m[3];
  if (value !== undefined) value = value.trim();
  if (
    value &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  return { name: m[1].toLowerCase(), op: m[2] || null, value: value === undefined ? null : value };
}

function parseSimple(token) {
  const simple = { tag: null, classes: [], id: null, attrs: [], pseudos: [] };
  const text = String(token || '');
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '.') {
      let j = i + 1;
      while (j < text.length && /[\w-]/.test(text[j])) j += 1;
      if (j > i + 1) simple.classes.push(text.slice(i + 1, j));
      i = j;
      continue;
    }
    if (ch === '#') {
      let j = i + 1;
      while (j < text.length && /[\w-]/.test(text[j])) j += 1;
      if (j > i + 1) simple.id = text.slice(i + 1, j);
      i = j;
      continue;
    }
    if (ch === '[') {
      const end = text.indexOf(']', i);
      const body = text.slice(i + 1, end === -1 ? text.length : end);
      simple.attrs.push(parseAttrBody(body));
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (ch === ':') {
      let j = i + 1;
      while (j < text.length && /\w/.test(text[j])) j += 1;
      const name = text.slice(i + 1, j).toLowerCase();
      let arg = null;
      if (text[j] === '(') {
        const end = text.indexOf(')', j);
        arg = text.slice(j + 1, end === -1 ? text.length : end).trim();
        j = end === -1 ? text.length : end + 1;
      }
      if (name) simple.pseudos.push({ name, arg });
      i = j;
      continue;
    }
    let j = i;
    while (j < text.length && !'.#[:'.includes(text[j])) j += 1;
    const name = text.slice(i, j).trim();
    if (name && name !== '*') simple.tag = name.toLowerCase();
    i = j;
  }
  return simple;
}

function parseSelector(selector) {
  return String(selector || '')
    .split(',')
    .map((group) => {
      const steps = [];
      const tokens = group.trim().split(/\s*(>)\s*|\s+/).filter((t) => t !== undefined && t !== '');
      let comb = ' ';
      for (const token of tokens) {
        if (token === '>') {
          comb = '>';
          continue;
        }
        steps.push({ simple: parseSimple(token), comb });
        comb = ' ';
      }
      return steps;
    })
    .filter((steps) => steps.length > 0);
}

// css-select style compile cache: a source rule reuses the same selector text
// on every chapter, so parsing it once removes all per-call regex work.
const SELECTOR_CACHE = new Map();
const SELECTOR_CACHE_MAX = 256;

function compileSelector(selector) {
  const key = String(selector || '');
  const cached = SELECTOR_CACHE.get(key);
  if (cached) return cached;
  const groups = parseSelector(key);
  if (SELECTOR_CACHE.size >= SELECTOR_CACHE_MAX) SELECTOR_CACHE.clear();
  SELECTOR_CACHE.set(key, groups);
  return groups;
}

/**
 * Position among element siblings, computed in one pass. Replaces
 * `children.filter(...).indexOf(node)` — the same index/count, no array.
 */
function elementPosition(node) {
  const parent = node.parent;
  if (!parent) return { index: 0, count: 1 };
  const children = parent.children || [];
  let index = -1;
  let count = 0;
  for (const child of children) {
    if (child.tag === '#text') continue;
    if (child === node) index = count;
    count += 1;
  }
  return { index, count };
}

function matchAttr(node, attr) {
  const raw = node.attrs[attr.name];
  if (attr.op === null) return raw !== undefined;
  const value = raw === undefined ? '' : String(raw);
  const want = attr.value === null ? '' : String(attr.value);
  switch (attr.op) {
    case '=':
      return value === want;
    case '~=': {
      // Legado 常用 `[property~=category|status|update_time]`：命中任意一个即可
      const wanted = want.split('|');
      const words = value.split(/\s+/);
      return wanted.some((item) => words.includes(item) || value === item);
    }
    case '|=':
      return value === want || value.startsWith(`${want}-`);
    case '^=':
      return value.startsWith(want);
    case '$=':
      return value.endsWith(want);
    case '*=':
      return value.includes(want);
    default:
      return false;
  }
}

function matchSimple(node, simple) {
  if (!node || node.tag === '#text') return false;
  if (simple.tag && node.tag !== simple.tag) return false;
  if (simple.id && node.attrs.id !== simple.id) return false;
  if (simple.classes.length) {
    const cls = (node.attrs.class || '').split(/\s+/);
    for (const want of simple.classes) if (!cls.includes(want)) return false;
  }
  for (const attr of simple.attrs) if (!matchAttr(node, attr)) return false;

  let position = null;
  for (const pseudo of simple.pseudos) {
    const name = pseudo.name;
    if (name === 'eq' || name === 'lt' || name === 'gt') continue; // 集合级，交给 selectAll
    if (position === null) position = elementPosition(node);
    const { index, count } = position;
    if (name === 'first' || name === 'first-child') {
      if (index !== 0) return false;
    } else if (name === 'last' || name === 'last-child') {
      if (index !== count - 1) return false;
    } else if (name === 'nth-child' || name === 'nth') {
      const n = Number(pseudo.arg);
      if (!Number.isFinite(n) || index + 1 !== n) return false;
    }
  }
  return true;
}

function matchChain(node, steps) {
  let idx = steps.length - 1;
  if (!matchSimple(node, steps[idx].simple)) return false;
  while (idx > 0) {
    const comb = steps[idx].comb;
    const prev = steps[idx - 1].simple;
    if (comb === '>') {
      node = node.parent;
      if (!node || !matchSimple(node, prev)) return false;
    } else {
      let p = node.parent;
      let found = false;
      while (p && p.tag !== '#root') {
        if (matchSimple(p, prev)) {
          node = p;
          found = true;
          break;
        }
        p = p.parent;
      }
      if (!found) return false;
    }
    idx -= 1;
  }
  return true;
}

/** Iterative pre-order walk: same document order, no recursion depth limit. */
function walk(root, visit) {
  if (!root || !Array.isArray(root.children)) return;
  const stack = [];
  const pushChildren = (node) => {
    const children = node.children || [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (child.tag === '#text') continue;
      stack.push(child);
    }
  };
  pushChildren(root);
  while (stack.length) {
    const node = stack.pop();
    visit(node);
    pushChildren(node);
  }
}

/** 返回匹配节点数组（文档顺序）。`:eq(n)` / `:lt(n)` / `:gt(n)` 作用在该组结果上。 */
export function selectAll(root, selector) {
  const groups = compileSelector(selector);
  if (!groups.length) return [];
  const hits = [];
  const seen = new Set();
  for (const steps of groups) {
    const matched = [];
    walk(root, (node) => {
      if (!seen.has(node) && matchChain(node, steps)) matched.push(node);
    });
    const last = steps[steps.length - 1].simple;
    const setPseudo = last.pseudos.find((item) => item.name === 'eq' || item.name === 'lt' || item.name === 'gt');
    let list = matched;
    if (setPseudo) {
      const n = Number(setPseudo.arg);
      if (setPseudo.name === 'eq') {
        const at = n < 0 ? matched.length + n : n;
        list = Number.isFinite(at) && matched[at] ? [matched[at]] : [];
      } else if (setPseudo.name === 'lt') {
        list = matched.slice(0, Math.max(0, Number.isFinite(n) ? n : 0));
      } else {
        list = matched.slice(Math.max(0, (Number.isFinite(n) ? n : 0) + 1));
      }
    }
    for (const node of list) {
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

/** 节点内纯文本（保留 <br> 换行，压缩空白）。 */
export function textOf(node, { raw = false } = {}) {
  if (!node) return '';
  const parts = [];
  const visit = (current) => {
    for (const child of current.children) {
      if (child.tag === '#text') parts.push(child.text);
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
  const render = (current) => {
    if (current.tag === '#text') return current.text;
    if (current.tag === '#root') return current.children.map(render).join('');
    let attrs = '';
    const keys = Object.keys(current.attrs);
    for (const k of keys) attrs += ` ${k}="${String(current.attrs[k]).replace(/"/g, '&quot;')}"`;
    const inner = current.children.map(render).join('');
    if (VOID_TAGS.has(current.tag)) return `<${current.tag}${attrs}>`;
    return `<${current.tag}${attrs}>${inner}</${current.tag}>`;
  };
  return render(node);
}

/** 取属性，兼容 href/src 的相对地址。 */
export function attrOf(node, name, baseUrl) {
  if (!node) return '';
  const key = String(name || '').toLowerCase();
  const value = key === 'text' ? textOf(node) : key === 'html' ? htmlOf(node) : node.attrs[key] || '';
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
