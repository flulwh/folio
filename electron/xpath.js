/**
 * Legado 的 `@XPath:` 规则（`AnalyzeByXPath`）。
 *
 * 完整 XPath 太重，这里实现书源里真正会用到的那部分：
 *   /html/body//div[@id='content']/p/text()
 *   //div[@class='list']/a[2]/@href
 *   //ul/li[position()=last()]/a
 *   //div[contains(@class,'intro')]/text()
 *   /html/body/div[1]/a[starts-with(@href,'/read/')]/@href
 * 支持：绝对/相对路径、`//` 后代轴、`*`、`text()`、`node()`、`@attr` 取值、
 * 位置谓词（数字 / `last()` / `position()=n`）、`@attr = 'v'`/`!=`、`contains()`、`starts-with()`、
 * `text()='v'`、顶层 `|` 并集。不支持的写法返回空数组（不会抛错）。
 *
 * 性能策略（沿用 fb55/css-select 与 css-what 的「编译一次、反复执行」思路，
 * BSD-2-Clause, github.com/fb55/css-select）：路径与谓词按文本缓存编译，
 * 求值热路径不再跑正则；后代轴改迭代 DFS；谓词用原地压缩避免中间数组。
 */
import { parseHtml, textOf } from './html.js';

const isElement = (node) => node && node.tag && node.tag !== '#text';

function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '(') depth += 1;
    else if (ch === ']' || ch === ')') depth -= 1;
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function unquote(value) {
  const text = String(value || '').trim();
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
    return text.slice(1, -1);
  }
  return text;
}

function parsePredicates(rest) {
  const predicates = [];
  let i = 0;
  while (i < rest.length) {
    if (rest[i] !== '[') {
      i += 1;
      continue;
    }
    let depth = 0;
    let quote = null;
    let j = i;
    for (; j < rest.length; j += 1) {
      const ch = rest[j];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '[') depth += 1;
      else if (ch === ']') {
        depth -= 1;
        if (depth === 0) {
          predicates.push(rest.slice(i + 1, j).trim());
          i = j + 1;
          break;
        }
      }
    }
    if (j >= rest.length) break;
  }
  return predicates;
}

/* ------------------------------------------------------------------ */
/* Predicate compiler — the same patterns, evaluated once per expression */
/* instead of once per candidate node.                                  */
/* ------------------------------------------------------------------ */

const RE_INDEX = /^\d+$/;
const RE_LAST = /^last\(\)$/;
const RE_POS_EQ = /^position\(\)\s*(=|!=|<=|>=|<|>)\s*(\d+)$/;
const RE_ATTR_EXISTS = /^@([\w:-]+)$/;
const RE_ATTR_EQ = /^@([\w:-]+)\s*(=|!=)\s*(['"])([\s\S]*)\3$/;
const RE_ATTR_CONTAINS = /^contains\(\s*@([\w:-]+)\s*,\s*(['"])([\s\S]*)\2\s*\)$/;
const RE_ATTR_STARTS = /^starts-with\(\s*@([\w:-]+)\s*,\s*(['"])([\s\S]*)\2\s*\)$/;
const RE_TEXT_EQ = /^(?:text\(\)|\.)\s*(=|!=)\s*(['"])([\s\S]*)\2$/;
const RE_TEXT_CONTAINS = /^contains\(\s*(?:text\(\)|\.)\s*,\s*(['"])([\s\S]*)\1\s*\)$/;
const STEP_RE = /^([\w:*-]*)([\s\S]*)$/;

const COMPARATORS = {
  '=': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '<': (a, b) => a < b,
  '>': (a, b) => a > b,
  '<=': (a, b) => a <= b,
  '>=': (a, b) => a >= b,
};

const ALWAYS_TRUE = () => true;
const PREDICATE_CACHE = new Map();
const PREDICATE_CACHE_MAX = 512;

/** Compile a predicate string into (node, position, total) => boolean. */
function compilePredicate(raw) {
  const text = String(raw || '').trim();
  if (!text) return ALWAYS_TRUE;
  const hit = PREDICATE_CACHE.get(text);
  if (hit) return hit;

  let fn;
  let m;
  if (RE_INDEX.test(text)) {
    const want = Number(text);
    fn = (_node, position) => position === want;
  } else if (RE_LAST.test(text)) {
    fn = (_node, position, total) => total > 0 && position === total;
  } else if ((m = RE_POS_EQ.exec(text))) {
    const want = Number(m[2]);
    const cmp = COMPARATORS[m[1]];
    fn = (_node, position) => cmp(position, want);
  } else if ((m = RE_ATTR_EXISTS.exec(text))) {
    const name = m[1];
    fn = (node) => node.attrs?.[name] !== undefined;
  } else if ((m = RE_ATTR_EQ.exec(text))) {
    const name = m[1];
    const equal = m[2] === '=';
    const want = m[4];
    fn = (node) => {
      const actual = String(node.attrs?.[name] ?? '');
      return equal ? actual === want : actual !== want;
    };
  } else if ((m = RE_ATTR_CONTAINS.exec(text))) {
    const name = m[1];
    const want = m[3];
    fn = (node) => String(node.attrs?.[name] ?? '').includes(want);
  } else if ((m = RE_ATTR_STARTS.exec(text))) {
    const name = m[1];
    const want = m[3];
    fn = (node) => String(node.attrs?.[name] ?? '').startsWith(want);
  } else if ((m = RE_TEXT_EQ.exec(text))) {
    const equal = m[1] === '=';
    const want = m[3];
    fn = (node) => {
      const actual = textOf(node);
      return equal ? actual === want : actual !== want;
    };
  } else if ((m = RE_TEXT_CONTAINS.exec(text))) {
    const want = m[2];
    fn = (node) => textOf(node).includes(want);
  } else {
    // 未知谓词：宽松放过，避免整条规则失效
    fn = ALWAYS_TRUE;
  }

  if (PREDICATE_CACHE.size >= PREDICATE_CACHE_MAX) PREDICATE_CACHE.clear();
  PREDICATE_CACHE.set(text, fn);
  return fn;
}

/** `a[2][@href]` / `text()` / `@href` / `*` → 步骤描述 */
function parseStep(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (text === 'text()') return { kind: 'text' };
  if (text === 'node()' || text === '.') return { kind: 'node' };
  if (text.startsWith('@')) return { kind: 'attr', name: text.slice(1).trim() };
  const match = STEP_RE.exec(text);
  const tag = (match[1] || '*').toLowerCase();
  return {
    kind: 'element',
    tag,
    predicates: parsePredicates(match[2] || '').map(compilePredicate),
  };
}

/**
 * Collect axis candidates, optionally filtering by tag straight away so the
 * caller does not need a second `filter()` pass and its temporary array.
 * Descendant traversal is an iterative pre-order DFS with the exact same
 * ordering as the previous recursive walk (no call-stack depth limit).
 */
function collect(nodes, axis, tag = '*') {
  const wantTag = tag === '*' ? null : tag;
  const matches = (node) =>
    isElement(node) && (wantTag === null || String(node.tag).toLowerCase() === wantTag);
  const out = [];

  if (axis === 'self') {
    for (const node of nodes) if (matches(node)) out.push(node);
    return out;
  }
  if (axis === 'child') {
    for (const node of nodes) {
      for (const child of node.children || []) if (matches(child)) out.push(child);
    }
    return out;
  }

  const stack = [];
  // Seed with the children of each start node, in reverse, so popping yields
  // document order. Start nodes themselves are never emitted (matching the
  // original recursive walk). Writing to `out` must happen on pop — doing it
  // while pushing reverses sibling order and breaks `last()` / `[2]`.
  const pushChildren = (node) => {
    const children = node && node.children ? node.children : [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (isElement(child)) stack.push(child);
    }
  };
  for (let i = nodes.length - 1; i >= 0; i -= 1) pushChildren(nodes[i]);
  while (stack.length) {
    const node = stack.pop();
    if (matches(node)) out.push(node);
    // Non-matching elements still have to be traversed: `//` is descendant.
    pushChildren(node);
  }
  return out;
}

const PATH_CACHE = new Map();
const PATH_CACHE_MAX = 256;

/** Parse + compile a path once; repeated source-rule evaluations reuse it. */
function compilePath(expression) {
  const key = String(expression || '').trim();
  const cached = PATH_CACHE.get(key);
  if (cached) return cached;

  let rest = key;
  let axis = 'child';
  // 开头的 `/` 表示以 root 的子节点为起点；`//` 表示后代
  if (rest.startsWith('//')) {
    rest = rest.slice(2);
    axis = 'descendant';
  } else if (rest.startsWith('/')) {
    rest = rest.slice(1);
    axis = 'child';
  } else if (rest.startsWith('./')) {
    rest = rest.slice(2);
    axis = 'child';
  } else if (rest.startsWith('.')) {
    rest = rest.slice(1);
    axis = 'self';
  }

  const rawSteps = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < rest.length; i += 1) {
    const ch = rest[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '(') depth += 1;
    else if (ch === ']' || ch === ')') depth -= 1;
    else if (ch === '/' && depth === 0) {
      rawSteps.push({ axis, text: rest.slice(start, i) });
      if (rest[i + 1] === '/') {
        axis = 'descendant';
        i += 1;
      } else {
        axis = 'child';
      }
      start = i + 1;
    }
  }
  rawSteps.push({ axis, text: rest.slice(start) });

  const steps = [];
  for (const step of rawSteps) {
    const parsed = parseStep(step.text);
    if (!parsed) continue;
    steps.push({ axis: step.axis, parsed });
  }
  if (PATH_CACHE.size >= PATH_CACHE_MAX) PATH_CACHE.clear();
  PATH_CACHE.set(key, steps);
  return steps;
}

function runPath(root, expression) {
  const steps = compilePath(expression);
  let results = [root];

  for (const step of steps) {
    const parsed = step.parsed;
    // text() / @attr 是「对当前节点取值」，不是再往下选子节点
    if (parsed.kind === 'text') {
      results = results
        .map((node) => (typeof node === 'string' ? node : textOf(node)))
        .filter((value) => value !== '');
      continue;
    }
    if (parsed.kind === 'attr') {
      const values = [];
      for (const node of results) {
        if (!node || typeof node === 'string') continue;
        const value = node.attrs?.[parsed.name];
        if (value !== undefined && value !== '') values.push(String(value));
      }
      results = values;
      continue;
    }

    let selected = collect(results, step.axis, parsed.kind === 'element' ? parsed.tag : '*');
    if (parsed.kind === 'node') {
      results = selected;
      continue;
    }
    for (const predicate of parsed.predicates) {
      // In-place compaction: filter() used to allocate one array per predicate.
      const total = selected.length;
      let write = 0;
      for (let i = 0; i < total; i += 1) {
        const node = selected[i];
        if (predicate(node, i + 1, total)) selected[write++] = node;
      }
      selected.length = write;
    }
    results = selected;
  }
  return results;
}

/** 求值，返回节点或字符串组成的数组。 */
export function evalXPath(root, expression) {
  if (!root) return [];
  const start = typeof root === 'string' ? parseHtml(root) : root;
  if (!start) return [];
  const branches = splitTopLevel(String(expression || ''), '|');
  const out = [];
  for (const branch of branches) {
    try {
      const hits = runPath(start, branch);
      // Avoid spread: large result sets used to hit the argument-count limit.
      for (let i = 0; i < hits.length; i += 1) out.push(hits[i]);
    } catch {
      /* 单条分支失败不影响其它 */
    }
  }
  return out;
}

/** XPath 结果转字符串：节点取文字，字符串原样，多个用 `\n` 连接（与 Legado 一致）。 */
export function xpathText(root, expression) {
  return evalXPath(root, expression)
    .map((item) => (typeof item === 'string' ? item : textOf(item)))
    .filter((value) => value !== '')
    .join('\n');
}
