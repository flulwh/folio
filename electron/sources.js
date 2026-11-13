// 书源（book source）规则引擎：把「书源 JSON」翻译成 搜索 / 目录 / 正文 三类请求。
//
// 方言兼容：
//   1) 简洁自定义：{ name, baseUrl, searchUrl, search:{...}, toc:{...}, content:'...' }
//   2) Legado（「阅读」App）常见字段子集：
//      bookSourceName / bookSourceUrl / searchUrl /
//      ruleSearch{bookList,name,author,coverUrl,bookUrl,intro,lastChapter} /
//      ruleBookInfo{tocUrl} / ruleToc{chapterList,chapterName,chapterUrl} / ruleContent{content}
//
// 规则语法支持：CSS 选择器、`@attr` 取值（text/html/href/src/…）、`##正则` 后处理
// （`##正则##替换`）、`&&` 取第一条、`@css:` 前缀、`@js:` 脚本（见 jsengine.js）、
// `@json:` 极简 JSONPath。
// `@XPath:` 由 xpath.js 提供支持（子集）。

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { parseHtml, selectAll, selectFirst, textOf, htmlOf, attrOf, absUrl } from './html.js';
import { runSourceScript, syncFetch } from './jsengine.js';
import { xpathText } from './xpath.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
const UNSAFE_RULE = /@\s*xpath\s*:/i;

/* ------------------------------ 规则解析 ------------------------------ */

const ATTR_WORDS = new Set([
  'text',
  'textnodes',
  'owntext',
  'html',
  'href',
  'src',
  'content',
  'value',
  'title',
  'alt',
  'data',
]);

/** 常见标签名：`@a`、`@li`、`@p` 这类写法是选择器，不是属性名 */
const TAG_WORDS = new Set([
  'a',
  'abbr',
  'article',
  'aside',
  'audio',
  'b',
  'blockquote',
  'body',
  'br',
  'button',
  'canvas',
  'caption',
  'center',
  'code',
  'dd',
  'del',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'font',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hr',
  'html',
  'i',
  'iframe',
  'img',
  'input',
  'label',
  'li',
  'main',
  'mark',
  'meta',
  'nav',
  'ol',
  'option',
  'p',
  'pre',
  's',
  'section',
  'select',
  'small',
  'source',
  'span',
  'strike',
  'strong',
  'sub',
  'summary',
  'sup',
  'svg',
  'table',
  'tbody',
  'td',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'title',
  'tr',
  'u',
  'ul',
  'video',
]);

/**
 * Legado 的选择器是「步骤串」：`tag.a.0@href@js:…`。
 * 这里把一条规则编译成步骤数组，再逐步求值——CSS 选择器本身表达不了
 * 「第 3 个 <p>」这种索引，也表达不了「取完属性再跑脚本」。
 */
function headAndJs(rule) {
  const text = String(rule);
  const open = text.indexOf('<js>');
  const at = text.indexOf('@js:');
  if (open !== -1 && (at === -1 || open < at)) {
    const close = text.indexOf('</js>', open + 4);
    const code = close === -1 ? text.slice(open + 4) : text.slice(open + 4, close);
    return { head: text.slice(0, open), code: code.trim() };
  }
  if (at !== -1) return { head: text.slice(0, at), code: text.slice(at + 4).trim() };
  return { head: text, code: null };
}

/**
 * 把一条规则拆成「脚本段 / 规则段」序列。
 * Legado 允许 `<js>` 出现在规则任意位置，语义是「拿上一段结果当 result 继续算」：
 *   `<js>java.t2s(result)</js>\n$..list[*]`、`$..url\n<js>result.split("\n")…</js>`、
 *   `class.x@text<js>java.t2s(result)</js>`。
 */
function splitRuleStages(rule) {
  const text = String(rule || '').trim();
  if (!text) return [];
  // 整条规则就是脚本：`@js:…`
  const atJs = /^@js\s*:\s*/i.exec(text);
  if (atJs) return [{ kind: 'js', code: text.slice(atJs[0].length) }];
  const stages = [];
  const re = /<js>([\s\S]*?)<\/js>/gi;
  let last = 0;
  let match = re.exec(text);
  while (match) {
    const before = text.slice(last, match.index).trim();
    if (before) stages.push({ kind: 'rule', text: before });
    stages.push({ kind: 'js', code: match[1].trim() });
    last = re.lastIndex;
    match = re.exec(text);
  }
  const tail = text.slice(last).trim();
  if (tail) stages.push({ kind: 'rule', text: tail });
  return stages;
}
function hasJsStage(rule) {
  const text = String(rule || '').trim();
  return /<js>[\s\S]*?<\/js>/i.test(text) || /^@js\s*:/i.test(text);
}

/** 在 `<js>` 块之外找第一个 `##`，避免把脚本里的字符串当成规则替换符。 */
function indexOfPatternDivider(text) {  const source = String(text || '');
  // `@js:` 整条是脚本，里面的 `##` 不能当替换符
  if (/^\s*@js\s*:/i.test(source)) return -1;
  const ranges = [];
  const re = /<js>([\s\S]*?)<\/js>/gi;
  let match = re.exec(source);
  while (match) {
    ranges.push([match.index, re.lastIndex]);
    match = re.exec(source);
  }
  let at = source.indexOf('##');
  while (at !== -1) {
    const inside = ranges.some(([start, end]) => at >= start && at < end);
    if (!inside) return at;
    at = source.indexOf('##', at + 2);
  }
  return -1;
}

/** 拆分 `{{js}}` / `@get:{k}` 模板片段（Legado 允许它们出现在规则任意位置）。 */
function parseTemplateParts(text) {
  const parts = [];
  const re = /@get:\s*\{([^}]+)\}|\{\{([\s\S]*?)\}\}/gi;
  let last = 0;
  let match = re.exec(text);
  while (match) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    if (match[1]) parts.push({ get: match[1] });
    else parts.push({ code: match[2] });
    last = re.lastIndex;
    match = re.exec(text);
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** 把模板片段求值成字符串（选择器插值、URL 变量都用它）。 */
function resolveTemplate(parts, { store, source, cacheRoot, proxy, bindings, result }) {
  let out = '';
  for (const part of parts || []) {
    if (part.text !== undefined) {
      out += part.text;
      continue;
    }
    if (part.get !== undefined) {
      out += store && store[part.get] !== undefined ? asText(store[part.get]) : '';
      continue;
    }
    if (part.code !== undefined) {
      let piece = '';
      try {
        piece = asText(
          runSourceScript(source, part.code, { result: result ?? '', ...bindings }, { cacheRoot, proxy }),
        );
      } catch (error) {
        // 绝不在主进程上下文里回退执行书源代码（否则等于绕过沙箱），失败就当空串
        piece = '';
      }
      out += piece;
    }
  }
  return out;
}

/**
 * Legado 的 `class.` 后面可以跟**多个** class 名（`class.comics-card pure-u-1-2@text`），
 * 语义是「同时含有这些 class」，要翻成 `[class~="a"][class~="b"]` 才能匹配。
 * 若后面的 token 是裸标签名（`div`/`li`/`a`…），仍按后代选择器处理。
 */
const HTML_TAG_NAMES = new Set([
  'a', 'abbr', 'article', 'aside', 'audio', 'b', 'blockquote', 'body', 'br', 'button', 'canvas',
  'caption', 'code', 'col', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'iframe', 'img',
  'input', 'ins', 'label', 'legend', 'li', 'main', 'nav', 'ol', 'option', 'p', 'pre', 'section',
  'select', 'small', 'source', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',
  'textarea', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'video',
]);

function cssAttrSelectorForClass(name) {
  const value = String(name || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `[class~="${value}"]`;
}

/** 把 Legado 的 `tag.li` / `class.x` / `id.y` 前缀翻成标准 CSS（模板拼出来的选择器也要过一遍）。 */
function normalizeCss(css) {
  let text = String(css || '');
  text = text
    .replace(/\btag\.([\w-]+)/gi, '$1')
    .replace(/\bid\.([\w-]+)/gi, '#$1')
    .replace(/\bchildren\./gi, ' > ');
  // `class.a b c` → `[class~="a"][class~="b"][class~="c"]`
  text = text.replace(
    /\bclass\.([^\s@>+~]+)((?:\s+(?!tag\.|class\.|id\.|children\.)[^\s@>+~]+)*)/gi,
    (whole, first, rest) => {
      const parts = [first, ...String(rest || '').split(/\s+/)]
        .map((part) => part.trim())
        .filter(Boolean);
      const tags = parts.filter((part) => HTML_TAG_NAMES.has(part.toLowerCase()));
      const names = parts.filter((part) => !HTML_TAG_NAMES.has(part.toLowerCase()));
      if (!names.length) return whole;
      const head = names.map(cssAttrSelectorForClass).join('');
      return tags.length ? `${head} ${tags.join(' ')}` : head;
    },
  );
  return text.trim();
}

/**
 * Legado 的下标写法（`AnalyzeByJSoup.ElementsSingle.findIndexSet`）：
 *   旧写法 `tag.div.-1:10:2`（`.` 选 / `!` 排除 / `:` 并列多个下标）
 *   新写法 `tag.div[-1, 3:-2:-10, 2]`（`[!…]` 排除、`start:end:step` 区间、`[-1:0]` 反向）
 */
function parseIndexSpec(token) {
  const text = String(token || '').trim();
  const none = { before: text, mode: 'select', items: [] };
  if (!text) return none;

  const open = text.lastIndexOf('[');
  if (open > -1 && text.endsWith(']')) {
    const inner = text.slice(open + 1, -1);
    if (inner.trim() && /^[!\s\-0-9:,]+$/.test(inner)) {
      const exclude = inner.trim().startsWith('!');
      const body = inner.replace(/^\s*!/, '');
      const items = body
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const bits = part.split(':').map((bit) => bit.trim());
          if (bits.length === 1) return { single: Number(bits[0]) };
          const num = (value) => (value === '' || value === undefined ? undefined : Number(value));
          return { start: num(bits[0]), end: num(bits[1]), step: bits[2] === undefined ? 1 : Number(bits[2]) };
        })
        .filter((item) => (item.single === undefined ? true : Number.isFinite(item.single)));
      if (items.length) {
        return { before: text.slice(0, open).trim(), mode: exclude ? 'exclude' : 'select', items };
      }
    }
  }

  const legacy = text.match(/^(.*?)([.!:])(-?\d+(?::\s*-?\d+)*)$/);
  if (legacy) {
    const items = legacy[3]
      .split(':')
      .map((part) => ({ single: Number(part.trim()) }))
      .filter((item) => Number.isFinite(item.single));
    if (items.length) {
      return { before: legacy[1].trim(), mode: legacy[2] === '!' ? 'exclude' : 'select', items };
    }
  }
  return none;
}

/** 按 Legado 语义套用下标集合（去重、越界跳过、保留写出的顺序）。 */
function applyIndexSpec(nodes, spec) {
  if (!spec || !spec.items.length) return nodes;
  const total = nodes.length;
  if (!total) return nodes;
  const order = [];
  const seen = new Set();
  const push = (index) => {
    if (index >= 0 && index < total && !seen.has(index)) {
      seen.add(index);
      order.push(index);
    }
  };
  for (const item of spec.items) {
    if (item.single !== undefined) {
      const at = item.single < 0 ? total + item.single : item.single;
      push(at);
      continue;
    }
    let start = item.start === undefined ? 0 : item.start;
    let end = item.end === undefined ? total - 1 : item.end;
    if (start < 0) start += total;
    if (end < 0) end += total;
    if (start >= total && end >= total) continue;
    start = Math.min(Math.max(start, 0), total - 1);
    end = Math.min(Math.max(end, 0), total - 1);
    const step = item.step || 1;
    if (start === end || Math.abs(step) >= total) {
      push(start);
      continue;
    }
    if (step > 0) {
      if (end > start) for (let i = start; i <= end; i += step) push(i);
      else for (let i = start; i >= end; i -= step) push(i); // `[-1:0]` 这类反向写法
    } else {
      const size = -step;
      if (end > start) for (let i = start; i <= end; i += size) push(i);
      else for (let i = start; i >= end; i -= size) push(i);
    }
  }
  if (spec.mode === 'exclude') return nodes.filter((_, index) => !seen.has(index));
  return order.map((index) => nodes[index]);
}

/**
 * Legado 规则层：`&&` 优先、`||` 候选、`%%` 逐项交错；`[...]` / `(...)` 内部的分隔符不算。
 */
function splitRuleOutside(rule) {
  const text = String(rule || '');
  const seps = ['&&', '||', '%%'];
  const matches = [];
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '[' || ch === '(') depth += 1;
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      for (const sep of seps) {
        if (text.startsWith(sep, i)) {
          matches.push({ index: i, sep });
          i += sep.length - 1;
          break;
        }
      }
    }
  }
  if (!matches.length) return { parts: [text.trim()].filter(Boolean), type: '' };
  const type = matches[0].sep;
  const parts = [];
  let start = 0;
  for (const match of matches) {
    if (match.sep !== type) continue;
    parts.push(text.slice(start, match.index));
    start = match.index + type.length;
  }
  parts.push(text.slice(start));
  return { parts: parts.map((part) => part.trim()).filter(Boolean), type };
}

/** 抽取任意位置的 `@put:{…}`（Legado 允许写在规则任意处，执行前摘掉）。 */
function extractPutRules(rule) {
  const pairs = [];
  const cleaned = String(rule || '').replace(/@put:\s*\{([^{}]*)\}/gi, (_, body) => {
    const re = /["']?([^"':,{}]+)["']?\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
    let m = re.exec(body);
    while (m) {
      pairs.push({ key: String(m[1]).trim(), rule: m[2].slice(1, -1).replace(/\\(["'\\])/g, '$1') });
      m = re.exec(body);
    }
    return '';
  });
  return { rule: cleaned, pairs };
}

function isValueWord(word) {
  const w = String(word || '').toLowerCase();
  return ATTR_WORDS.has(w) || w.startsWith('data');
}

function parseHead(head) {
  const steps = [];
  const trailing = [];
  const raw = String(head || '').trim();
  if (!raw) return steps;
  for (const piece of raw.split('@')) {
    let seg = piece.trim();
    if (!seg) continue;

    // 末尾的 `[a:b]` 只对**取值词**做切片（Legado 的 `@text[0:50]`）；
    // 其余 `[...]` 是节点下标区间（如 `tag.li[-1:0]`），交给 parseIndexSpec
    let sliceOpts = null;
    const sliceOnly = seg.match(/^\[\s*(-?\d+)?\s*:\s*(-?\d+)?\s*\]$/);
    if (sliceOnly) {
      steps.push({
        t: 'slice',
        start: sliceOnly[1] === undefined ? 0 : Number(sliceOnly[1]),
        end: sliceOnly[2] === undefined ? undefined : Number(sliceOnly[2]),
      });
      continue;
    }
    const sliceValue = seg.match(/^([a-zA-Z]+)\[\s*(-?\d+)?\s*:\s*(-?\d+)?\s*\]$/);
    if (sliceValue && isValueWord(sliceValue[1])) {
      const word = sliceValue[1].toLowerCase();
      steps.push({ t: 'attr', name: word === 'textnodes' || word === 'owntext' ? 'text' : word });
      steps.push({
        t: 'slice',
        start: sliceValue[2] === undefined ? 0 : Number(sliceValue[2]),
        end: sliceValue[3] === undefined ? undefined : Number(sliceValue[3]),
      });
      continue;
    }

    if (isValueWord(seg)) {
      const word = seg.toLowerCase();
      steps.push({ t: 'attr', name: word === 'textnodes' || word === 'owntext' ? 'text' : word });
      if (sliceOpts) steps.push(sliceOpts);
      continue;
    }

    // Legado 里 `@` 后紧跟一个普通单词就是属性名（如 @onclick、@data-id）；
    // 但 `@a` / `@li` / `@p` 这些是标签名，要当成选择器
    if (/^[a-zA-Z_][\w:-]*$/.test(seg) && !TAG_WORDS.has(seg.toLowerCase())) {
      steps.push({ t: 'attr', name: seg.toLowerCase() });
      if (sliceOpts) steps.push(sliceOpts);
      continue;
    }

    let token = seg;
    let direct = false;
    const child = token.match(/^children(?:\.(.+))?$/i);
    if (child) {
      direct = true;
      token = (child[1] || '').trim();
    }

    if (/\{\{|@get:\s*\{/i.test(seg)) {
      steps.push({ t: 'selTpl', parts: parseTemplateParts(seg) });
      if (sliceOpts) trailing.push(sliceOpts);
      continue;
    }

    // `text.下一页` —— 按节点文字找元素（Legado 常用于「下一页」这类翻页规则）
    const textPick = token.match(/^text\.(.+)$/i);
    if (textPick) {
      steps.push({ t: 'textsel', text: textPick[1].trim(), direct });
      if (sliceOpts) trailing.push(sliceOpts);
      continue;
    }
    if (!token) continue;

    const spec = parseIndexSpec(token);
    token = spec.before;
    const hasSpec = spec.items.length > 0;
    if (!token && hasSpec) {
      // 只有下标没有前置选择器：Legado 里等价于直接取子节点
      steps.push({ t: 'sel', css: '*', direct: true, spec });
      if (sliceOpts) trailing.push(sliceOpts);
      continue;
    }
    if (!token) continue;
    // `class.a b` 是 Legado 的多 class 写法（同时含有），必须转成 `[class~=…]`
    token = /^class\./i.test(token)
      ? token.replace(/^class\./i, 'class.')
      : token.replace(/^tag\./i, '').replace(/^id\./i, '#').replace(/^all\./i, '');
    token = normalizeCss(token);
    if (!token) continue;
    steps.push({ t: 'sel', css: token, direct, spec: hasSpec ? spec : null });
    if (sliceOpts) trailing.push(sliceOpts);
  }
  steps.push(...trailing);
  return steps;
}

/**
 * 解析一条规则：
 *   `选择器@属性##正则##替换`、`@js:` / `<js>` 脚本、`@json:` / `$.a.b` JSONPath
 */
export function parseRule(rule) {
  if (!rule || typeof rule !== 'string') return null;
  let body = rule.trim();
  if (!body) return null;

  let pattern = null;
  let replacement = '';
  const hashAt = indexOfPatternDivider(body);
  if (hashAt !== -1) {
    const tail = body.slice(hashAt + 2);
    body = body.slice(0, hashAt).trim();
    const second = tail.indexOf('##');
    if (second !== -1) {
      pattern = tail.slice(0, second).trim() || null;
      replacement = tail.slice(second + 2);
    } else {
      pattern = tail.trim() || null;
    }
  }

  // `@@` 转义：后面整段原样当选择器；`@CSS:` 整条规则就是标准 CSS；`@XPath:`（或裸 `/`、`//`）走 XPath
  if (body.startsWith('@@')) body = body.slice(2).trim();
  const cssMode = /^@css:/i.test(body);
  if (cssMode) body = body.slice(5).trim();
  const xpathMode = /^@xpath:/i.test(body) || /^\s*(\/\/|\/|\.\/)/.test(body);
  if (xpathMode) {
    const expr = body.replace(/^@xpath:/i, '').trim();
    const steps = [{ t: 'xpath', expr }];
    return { alternatives: [{ steps }], steps, selector: '', attr: 'text', pattern, replacement, merge: '' };
  }

  // Legado 允许 `@put:{k:"rule",…}` 写在规则任意位置，执行前摘出来
  const put = extractPutRules(body);
  body = put.rule.trim();
  const putSteps = put.pairs.length ? [{ t: 'put', pairs: put.pairs }] : [];
  if (!body && putSteps.length) {
    const steps = putSteps;
    return { alternatives: [{ steps }], steps, selector: '', attr: 'text', pattern: null, replacement: '', merge: '' };
  }

  // 纯 `@get:{k}`
  const getMatch = body.match(/^@get:\s*\{\s*([^}]+?)\s*\}$/i);
  if (getMatch) {
    const steps = [...putSteps, { t: 'get', key: getMatch[1] }];
    return { alternatives: [{ steps }], steps, selector: '', attr: 'text', pattern: null, replacement: '', merge: '' };
  }
  // 整条规则就是一个模板（`{{js}}` / `@get:{k}`）：按字符串拼装处理。
  // 若模板只是嵌在选择器里（如 `li:eq({{1+1}})@text`），交给 parseHead 的 selTpl 步骤。
  // 另外，纯文本前缀 + `{{…}}`（封面/简介/URL 拼接）也是模板，不能当选择器。
  const wholeTemplate =
    /^\s*(?:\{\{[\s\S]*?\}\}|@get:\s*\{[^}]+\})\s*$/i.test(body) ||
    (/\{\{/.test(body) && !/@/.test(body) && !/^\s*[$.#]/.test(body));
  if (wholeTemplate) {
    const parts = parseTemplateParts(body);
    if (parts.length) {
      const steps = [...putSteps, { t: 'tpl', parts }];
      return { alternatives: [{ steps }], steps, selector: '', attr: 'text', pattern, replacement, merge: '' };
    }
  }

  const split = splitRuleOutside(body);
  const alternatives = /(@js:|<js>)/.test(body) ? [body] : split.parts;
  const compiled = [];
  for (const alt of alternatives) {
    if (/^\s*\$/.test(alt) || /^\s*\$\[/.test(alt)) {
      compiled.push({ steps: [...putSteps, { t: 'json', expr: alt }] });
      continue;
    }
    if (looksLikeJsonPath(alt)) {
      compiled.push({ steps: [...putSteps, { t: 'json', expr: `$${alt.trim()}` }] });
      continue;
    }
    if (hasJsStage(alt)) {
      // `<js>` 可以出现在规则任意位置：脚本段 → 规则段 → 脚本段…依次求值
      const steps = [...putSteps];
      for (const stage of splitRuleStages(alt)) {
        if (stage.kind === 'js') {
          steps.push({ t: 'js', code: stage.code });
          continue;
        }
        const part = stage.text;
        if (/^\s*\$/.test(part)) {
          steps.push({ t: 'json', expr: part });
          continue;
        }
        if (looksLikeJsonPath(part)) {
          steps.push({ t: 'json', expr: `$${part.trim()}` });
          continue;
        }
        steps.push(...parseHead(part));
      }
      if (steps.length) compiled.push({ steps });
      continue;
    }
    const { head, code } = headAndJs(alt);
    const steps = [...putSteps, ...parseHead(head)];
    if (code) steps.push({ t: 'js', code });
    if (steps.length) compiled.push({ steps });
  }
  if (!compiled.length) return null;

  const first = compiled[0].steps;
  const selector = first
    .filter((step) => step.t === 'sel')
    .map((step) => step.css)
    .join(' ') || '*';
  const attrStep = [...first].reverse().find((step) => step.t === 'attr');

  return {
    alternatives: compiled,
    steps: first,
    selector,
    attr: attrStep?.name || 'text',
    pattern,
    replacement,
    merge: split.type,
  };
}
/** Legado 里 `$.a.b`/`.chapters[*]` 这种（省略 `$` 的）JSON 路径。 */
function looksLikeJsonPath(rule) {
  const text = String(rule || '').trim();
  if (!/^\.?[\w$]/.test(text)) return false;
  if (!/\[/.test(text) && !text.includes('..')) return false;
  return /^\.{0,2}[\w$-]+(?:(?:\.[\w$-]+)|(?:\[\*?\d*\])|(?:\.\.))+$/.test(text);
}

function applyPost(value, pattern, replacement) {
  if (!pattern) return value;
  try {
    return String(value).replace(new RegExp(pattern, 'gs'), replacement).replace(/\u200b/g, '');
  } catch {
    return value;
  }
}

function extractFrom(nodes, name, baseUrl, join) {
  if (!nodes.length) return '';
  if (name === 'html') {
    const parts = nodes
      .map((node) => htmlOf(node).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, ''))
      .filter(Boolean);
    return join === 'block' ? parts.join('\n\n') : parts.join('\n');
  }
  if (name === 'text') {
    const parts = nodes.map((node) => textOf(node)).filter((text) => text !== '');
    return join === 'block' ? parts.join('\n\n') : parts.join('\n');
  }
  // Legado：属性取值按出现顺序去重
  const seen = new Set();
  const parts = [];
  for (const node of nodes) {
    const value = attrOf(node, name, baseUrl);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    parts.push(value);
  }
  if (join === 'block') return parts.join('\n\n');
  return parts.length > 1 ? parts.join('\n') : parts[0] || '';
}

/** 在当前作用域上跑步骤串，返回字符串（或 JSON 值）。 */
function evaluate(scope, steps, { baseUrl, join = 'space', source, cacheRoot, proxy, bindings, vars } = {}) {
  // scope 允许直接是 HTML 字符串（Legado 的 analyze 也是这么用的）
  const root = typeof scope === 'string' ? parseHtml(scope) : scope;
  let nodes = [root];
  let value = null;
  const store = vars || {};

  for (const step of steps) {
    if (step.t === 'xpath') {
      value = xpathText(root, step.expr);
      nodes = [];
      continue;
    }
    if (step.t === 'json') {
      // 接在脚本段后面时，JSON 作用域是上一段的结果（`$..url\n<js>…</js>`）
      let data;
      if (value !== null && value !== '') {
        data = typeof value === 'string' ? safeParse(value) : value;
      } else if (typeof scope === 'string') {
        data = safeParse(scope);
      } else if (scope && typeof scope === 'object' && typeof scope.tag === 'string' && scope.attrs) {
        // 把 HTML 节点当 JSON 作用域会退化成遍历整棵 DOM 树（极慢，甚至卡死），
        // 先按 HTML 文本解析；JSON 规则落在 HTML 上本来就取不到东西。
        data = safeParse(htmlOf(scope));
      } else {
        data = scope;
      }
      value = jsonPathLoose(data, step.expr);
      nodes = [];
      continue;
    }
    if (step.t === 'textsel') {
      const want = String(step.text || '').replace(/\s+/g, '');
      const hits = [];
      const visit = (node) => {
        for (const child of node.children || []) {
          if (child.tag === '#text') continue;
          const own = String(textOf(child)).replace(/\s+/g, '');
          if (own && own.includes(want)) hits.push(child);
          visit(child);
        }
      };
      for (const node of nodes) visit(node);
      nodes = hits;
      value = null;
      continue;
    }
    if (step.t === 'put') {
      for (const pair of step.pairs || []) {
        store[pair.key] = pickOne(scope, pair.rule, baseUrl, { source, cacheRoot, proxy, bindings, vars: store });
      }
      value = '';
      continue;
    }
    if (step.t === 'tpl') {
      const base = value ?? extractFrom(nodes, 'text', baseUrl, join);
      value = resolveTemplate(step.parts, {
        store,
        source,
        cacheRoot,
        proxy,
        bindings,
        result: asText(base),
      });
      nodes = [];
      continue;
    }    if (step.t === 'selTpl') {
      if (!nodes.length && typeof value === 'string' && value.trim()) {
        nodes = [parseHtml(value)];
        value = null;
      }
      const cssText = normalizeCss(resolveTemplate(step.parts, {
        store,
        source,
        cacheRoot,
        proxy,
        bindings,
        result: asText(value),
      }));
      const next = [];
      for (const node of nodes) {
        let hits = selectAll(node, cssText);
        if (!hits.length && node.tag && node.tag !== '#root' && selfMatches(node, cssText)) hits = [node];
        next.push(...hits);
      }
      nodes = next;
      value = null;
      continue;
    }
    if (step.t === 'get') {
      value = store[step.key] === undefined ? '' : store[step.key];
      continue;
    }    if (step.t === 'sel') {
      // 脚本段把结果换成了 HTML 字符串时，重新挂到文档根上继续选
      if (!nodes.length && typeof value === 'string' && value.trim()) {
        nodes = [parseHtml(value)];
        value = null;
      }
      const next = [];
      const cssText = step.parts
        ? normalizeCss(resolveTemplate(step.parts, { store, source, cacheRoot, proxy, bindings, result: asText(value) }))
        : step.css;
      for (const node of nodes) {
        let hits = selectAll(node, cssText);
        // Legado 允许「节点本身就是目标」（<img class="cover"> 配 class.cover@tag.img）
        if (!hits.length && node.tag && node.tag !== '#root' && selfMatches(node, cssText)) hits = [node];
        if (step.direct) hits = hits.filter((hit) => hit.parent === node);
        if (step.spec) {
          hits = applyIndexSpec(hits, step.spec);
        } else {
          if (Array.isArray(step.exclude) && step.exclude.length) {
            const total = hits.length;
            const drop = new Set(step.exclude.map((n) => (n < 0 ? total + n : n)));
            hits = hits.filter((hit, i) => !drop.has(i));
          }
          if (step.index !== undefined) {
            const at = step.index < 0 ? hits.length + step.index : step.index;
            hits = at >= 0 && at < hits.length ? [hits[at]] : [];
          }
        }
        next.push(...hits);
      }
      nodes = next;
      value = null;
      continue;
    }
    if (step.t === 'attr') {
      value = extractFrom(nodes, step.name, baseUrl, join);
      continue;
    }
    if (step.t === 'slice') {
      const text = String(value ?? extractFrom(nodes, 'text', baseUrl, join));
      value = step.end === undefined ? text.slice(step.start) : text.slice(step.start, step.end);
      continue;
    }
    if (step.t === 'js') {
      // 整条规则只有 @js:（前面没有选择器）时，result 给页面 HTML；
      // 前面已经有选择器/JSONPath 时给上一段结果（与 Legado「上一段结果」一致）。      const domHtml = nodes.length ? nodes.map((node) => htmlOf(node)).join('') : '';
      let result;
      if (value !== null && value !== '') result = asText(value);
      else if (nodes.length) result = domHtml;
      else if (typeof scope === 'string') result = scope;
      else result = asText(scope);
      const ctxExtra = { source, cacheRoot, proxy, bindings, baseUrl };
      const code = interpolateJsCode(step.code, {
        scope,
        value,
        result,
        baseUrl,
        extra: ctxExtra,
        vars: store,
      });
      const out = runSourceScript(
        source,
        code,
        {
          result,
          src: result,
          baseUrl,
          __dom: createDomBridge(domHtml, ctxExtra),
          __jsoup: createJsoup(domHtml, ctxExtra),
          ...(bindings || {}),
        },
        { cacheRoot, proxy },
      );
      value = asText(out).trim();
      continue;
    }
  }

  if (value === null) value = extractFrom(nodes, 'text', baseUrl, join);
  return value;
}
/**
 * `<js>` 代码里常把别的规则包在 `{{…}}` 里（`{{$..id}}`、`{{@@.x@text}}`），
 * 先按当前作用域求值成字符串，再交给脚本引擎。
 */
function interpolateJsCode(code, { scope, value, result, baseUrl, extra = {}, vars } = {}) {
  const text = String(code || '');
  if (!text.includes('{{')) return text;
  return text.replace(/\{\{([\s\S]*?)\}\}/g, (whole, inner) => {
    const expr = String(inner || '').trim();
    if (!expr) return '';
    if (expr.startsWith('@@')) {
      return pickOne(scope, expr.slice(2), baseUrl, { ...extra, vars });
    }
    if (expr.startsWith('$')) {
      const primary = value !== null && value !== undefined && value !== '' ? value : scope;
      const data = typeof primary === 'string' ? safeParse(primary) : primary;
      const out = jsonPath(data, expr);
      return out === null || out === undefined ? '' : asText(out);
    }
    try {
      const out = runSourceScript(
        extra.source,
        expr,
        { result: result ?? '', ...(extra.bindings || {}) },
        { cacheRoot: extra.cacheRoot, proxy: extra.proxy },
      );
      return asText(out);
    } catch {
      return '';
    }
  });
}

/** 规则段求值：JSONPath（含省略 `$` 的写法）或 CSS 选择器。 */
function ruleStageValue(scope, ruleText, extra) {
  const text = String(ruleText || '').trim();
  if (!text) return { kind: 'value', value: '' };
  if (/^\s*\$/.test(text) || JSON_RULE.test(text)) {
    const data = typeof scope === 'string' ? safeParse(scope) : scope;    const expr = JSON_RULE.test(text) ? String(text).replace(JSON_RULE, '') : text;
    return { kind: 'json', value: jsonPathLoose(data, expr) };
  }
  if (looksLikeJsonPath(text)) {
    const data = typeof scope === 'string' ? safeParse(scope) : scope;
    return { kind: 'json', value: jsonPathLoose(data, `$${text}`) };
  }
  const root = typeof scope === 'string' ? parseHtml(scope) : scope;
  return { kind: 'nodes', value: selectNodes(root, text, extra) };
}

/**
 * 列表规则求值：`<js>` 段与规则段可以任意交替，最后一段决定结果形态
 * （节点列表 → DOM 条目；JSON 值 → JSON 条目）。覆盖
 * `<js>java.t2s(result)</js>\n$..list[*]`、`$..url\n<js>…</js>` 这类写法。
 */
export function extractListEntries(scope, rule, extra = {}) {
  const stages = splitRuleStages(rule || '');
  if (!stages.length) return [];
  const ctx = {
    source: extra.source,
    cacheRoot: extra.cacheRoot,
    proxy: extra.proxy,
    bindings: extra.bindings,
    baseUrl: extra.baseUrl,
    vars: extra.vars,
  };
  let current = scope;
  for (let i = 0; i < stages.length; i += 1) {
    const stage = stages[i];
    const last = i === stages.length - 1;
    if (stage.kind === 'js') {
      const text = asText(current);
      const htmlish = /<\w+[\s>]/.test(text) ? text : '';
      const code = interpolateJsCode(stage.code, {
        scope: text,
        value: text,
        result: text,
        baseUrl: extra.baseUrl,
        extra: ctx,
        vars: extra.vars,
      });
      const raw = runSourceScript(
        extra.source,
        code,
        {
          ...(extra.bindings || {}),
          result: text,
          src: text,
          baseUrl: extra.baseUrl,
          __dom: createDomBridge(htmlish, ctx),
          __jsoup: createJsoup(htmlish, ctx),
        },
        { cacheRoot: extra.cacheRoot, proxy: extra.proxy },
      );
      if (last) {
        if (raw && Array.isArray(raw.__nodes) && raw.__nodes.length) {
          return raw.__nodes.map((node) => ({ mode: 'dom', scope: node }));
        }
        return jsonEntries(raw);
      }
      current = asText(raw);
      continue;
    }
    const got = ruleStageValue(current, stage.text, ctx);
    if (last) {
      if (got.kind === 'nodes') return got.value.map((node) => ({ mode: 'dom', scope: node }));
      return jsonEntries(got.value);
    }
    current = got.kind === 'nodes' ? got.value.map((node) => htmlOf(node)).join('') : got.value;
  }
  return [];
}

/** 带 `<js>` 段的 URL 规则：规则段按模板渲染，脚本段拿上一段当 result。 */
export function renderStagedTarget(source, template, vars, { cacheRoot, proxy } = {}) {
  const stages = splitRuleStages(String(template || ''));
  if (!stages.length) return '';
  if (stages.length === 1 && stages[0].kind === 'rule') {
    return renderTemplate(stages[0].text, vars).trim();
  }
  const {
    source: _source,
    cacheRoot: _cacheRoot,
    proxy: _proxy,
    result: _result,
    jsonScope: _jsonScope,
    src: _src,
    bindings: extraBindings,
    ...plainVars
  } = vars;
  let current = asText(vars.result ?? '');
  for (const stage of stages) {
    if (stage.kind === 'rule') {
      current = renderTemplate(stage.text, { ...vars, result: current, src: current }).trim();
      continue;
    }
    const ctx = { source, cacheRoot, proxy, bindings: extraBindings, baseUrl: vars.baseUrl };
    const code = interpolateJsCode(stage.code, {
      scope: current,
      value: current,
      result: current,
      baseUrl: vars.baseUrl,
      extra: ctx,
      vars: plainVars,
    });
    current = asText(
      runSourceScript(
        source,
        code,
        { ...plainVars, ...(extraBindings || {}), result: current, src: current, baseUrl: vars.baseUrl },
        { cacheRoot, proxy },
      ),
    ).trim();
  }
  return current;
}

/** 末段回退不再需要：选择器逐步求值已支持自匹配。 */

function selfMatches(node, selector) {
  if (!node || !node.tag || node.tag === '#root') return false;
  const css = String(selector).trim();
  if (!css) return false;
  const cls = css.match(/^\.([\w-]+)$/);
  if (cls) return String(node.attrs?.class || '').split(/\s+/).includes(cls[1]);
  const id = css.match(/^#([\w-]+)$/);
  if (id) return node.attrs?.id === id[1];
  return node.tag === css.toLowerCase();
}

/** 在一个节点（或文档根）上执行规则，返回字符串。 */
export function pickOne(scope, rule, baseUrl, extra = {}) {
  const parsed = parseRule(rule);
  if (!parsed) return '';
  const values = [];
  for (const alternative of parsed.alternatives) {
    const value = evaluate(scope, alternative.steps, { baseUrl, join: 'space', ...extra });
    const text = asText(value);
    values.push(text);
    if (parsed.merge !== '%%' && text && text.trim()) {
      return applyPost(text, parsed.pattern, parsed.replacement).trim();
    }
  }
  if (parsed.merge === '%%' && values.length > 1) {
    // `%%`：各分支按行交错合并
    const lists = values.map((text) => String(text || '').split('\n').filter((line) => line.trim()));
    const depth = Math.max(0, ...lists.map((list) => list.length));
    const merged = [];
    for (let i = 0; i < depth; i += 1) {
      for (const list of lists) if (i < list.length) merged.push(list[i]);
    }
    const text = merged.join('\n');
    if (text.trim()) return applyPost(text, parsed.pattern, parsed.replacement).trim();
  }
  return '';
}

/** 列表类规则：只跑选择器步骤，返回节点数组。 */
/** 取「节点链」：`tag.div@amp-img` 里的 `amp-img` 在 Legado 里是后代标签选择器，不是属性名。 */
function nodeSteps(steps) {
  const out = [];
  for (const step of steps) {
    if (step.t === 'sel') {
      out.push(step);
      continue;
    }
    if (step.t === 'attr') {
      const name = String(step.name || '');
      if (/^[a-z][a-z0-9-]*$/i.test(name) && !isValueWord(name)) {
        out.push({ t: 'sel', css: name, direct: false });
      }
    }
  }
  return out;
}

export function selectNodes(scope, rule, extra = {}) {
  const parsed = parseRule(rule);
  if (!parsed) return [];
  if (parsed.merge === '%%' && parsed.alternatives.length > 1) {
    const groups = [];
    for (const alternative of parsed.alternatives) {
      const steps = nodeSteps(alternative.steps);
      if (!steps.length) continue;
      groups.push(evaluateNodes(scope, steps, extra));
    }
    const depth = Math.max(0, ...groups.map((group) => group.length));
    const merged = [];
    for (let i = 0; i < depth; i += 1) {
      for (const group of groups) if (i < group.length) merged.push(group[i]);
    }
    return merged;
  }  for (const alternative of parsed.alternatives) {
    const steps = nodeSteps(alternative.steps);
    if (!steps.length) continue;
    const nodes = evaluateNodes(scope, steps, extra);
    if (nodes.length) return nodes;
  }
  return [];
}

function evaluateNodes(scope, steps, extra = {}) {
  const start = typeof scope === 'string' ? parseHtml(scope) : scope;
  let nodes = [start];
  for (const step of steps) {
    const next = [];
    for (const node of nodes) {
      let hits = selectAll(node, step.css);
      if (!hits.length && node.tag && node.tag !== '#root') {
        if (selfMatches(node, step.css)) hits = [node];
      }
      if (step.direct) hits = hits.filter((hit) => hit.parent === node);
      if (step.spec) {
        hits = applyIndexSpec(hits, step.spec);
      } else {
        if (Array.isArray(step.exclude) && step.exclude.length) {
          const total = hits.length;
          const drop = new Set(step.exclude.map((n) => (n < 0 ? total + n : n)));
          hits = hits.filter((hit, i) => !drop.has(i));
        }
        if (step.index !== undefined) {
          const at = step.index < 0 ? hits.length + step.index : step.index;
          hits = at >= 0 && at < hits.length ? [hits[at]] : [];
        }
      }
      next.push(...hits);
    }
    nodes = next;
  }
  return nodes;
}

/** 多节点正文：把每个命中节点的文本按段落拼接。 */
export function pickContent(scope, rule, baseUrl, extra = {}) {
  const parsed = parseRule(rule);
  if (!parsed) return '';
  let raw = '';
  for (const alternative of parsed.alternatives) {
    raw = asText(evaluate(scope, alternative.steps, { baseUrl, join: 'block', ...extra }));
    if (raw && raw.trim()) break;
  }
  const cleaned = applyPost(raw, parsed.pattern, parsed.replacement);
  return htmlToParagraphs(cleaned);
}

/* ------------------------------ 源归一化 ------------------------------ */

function firstDefined(...values) {
  for (const value of values) if (value !== undefined && value !== null && value !== '') return value;
  return '';
}

/** Legado 用 `header`（字符串或对象），也有 `headers`；统一成对象。 */
function normalizeHeaders(input) {
  const raw = input.headers ?? input.header;
  if (!raw) return null;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof raw === 'object' ? raw : null;
}

function normalizeRules(input) {
  const isLegado = !!(input.bookSourceName || input.ruleSearch || input.ruleToc);

  const rawSearch = input.search || {};
  const rawToc = input.toc || {};
  const rawContent = input.content || {};

  const legadoSearch = input.ruleSearch || {};
  const legadoInfo = input.ruleBookInfo || {};
  const legadoToc = input.ruleToc || {};
  const legadoContent = input.ruleContent || {};

  const searchList = isLegado ? legadoSearch.bookList : rawSearch.list;
  const tocList = isLegado ? legadoToc.chapterList : rawToc.list;

  const search = {
    url: firstDefined(input.searchUrl, isLegado ? undefined : rawSearch.url),
    list: firstDefined(searchList),
    name: firstDefined(isLegado ? legadoSearch.name : rawSearch.name, 'h3 a@text', 'a@text'),
    author: firstDefined(isLegado ? legadoSearch.author : rawSearch.author, '.author@text'),
    cover: firstDefined(isLegado ? legadoSearch.coverUrl : rawSearch.cover, 'img@src'),
    link: firstDefined(isLegado ? legadoSearch.bookUrl : rawSearch.link, isLegado ? legadoSearch.bookUrl : rawSearch.link, 'a@href'),
    intro: firstDefined(isLegado ? legadoSearch.intro : rawSearch.intro),
    lastChapter: firstDefined(isLegado ? legadoSearch.lastChapter : rawSearch.lastChapter),
  };

  const toc = {
    url: firstDefined(isLegado ? legadoInfo.tocUrl : rawToc.url),
    list: firstDefined(tocList),
    name: firstDefined(isLegado ? legadoToc.chapterName : rawToc.name, 'a@text'),
    link: firstDefined(isLegado ? legadoToc.chapterUrl : rawToc.link, 'a@href'),
    next: firstDefined(isLegado ? legadoToc.nextTocUrl : rawToc.next),
  };

  const info = {
    init: firstDefined(legadoInfo.init),
    name: firstDefined(legadoInfo.name),
    author: firstDefined(legadoInfo.author),
    kind: firstDefined(legadoInfo.kind),
    intro: firstDefined(legadoInfo.intro),
    cover: firstDefined(legadoInfo.coverUrl, legadoInfo.cover),
    lastChapter: firstDefined(legadoInfo.lastChapter),
    wordCount: firstDefined(legadoInfo.wordCount),
  };

  const contentRule = typeof rawContent === 'string' ? rawContent : firstDefined(rawContent.rule, isLegado ? legadoContent.content : '');
  const content = {
    rule: contentRule,
    next: firstDefined(isLegado ? legadoContent.nextContentUrl : rawContent.next),
    sourceRegex: firstDefined(legadoContent.sourceRegex),
    webJs: firstDefined(legadoContent.webJs),
  };

  return { isLegado, search, toc, info, content };
}

/** 是否是「订阅索引」：`[{title, url, home_page, tags}]` 这种书源列表文件。 */
export function looksLikeFeedIndex(items) {
  if (!Array.isArray(items) || !items.length) return false;
  return items.every((item) => {
    if (!item || typeof item !== 'object') return false;
    if (typeof item.url !== 'string' || !item.url.trim()) return false;
    if (item.bookSourceUrl || item.bookSourceName || item.searchUrl) return false;
    if (item.pattern && item.replacement) return false;
    return item.title !== undefined || item.home_page !== undefined || item.tags !== undefined;
  });
}

/** 把任意来源的 JSON 归一化成内部结构；失败返回 { error }。 */
export function normalizeSource(input) {
  if (!input || typeof input !== 'object') return { error: '不是有效的 JSON 对象' };

  const name = asText(firstDefined(input.name, input.bookSourceName, input.bookSourceUrl)).trim();
  const baseUrl = asText(firstDefined(input.baseUrl, input.url, input.bookSourceUrl)).trim();
  if (!name) return { error: '缺少书源名称（name / bookSourceName）' };
  if (!baseUrl) return { error: '缺少站点地址（baseUrl / bookSourceUrl）' };

  let origin = baseUrl;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return { error: `站点地址无效：${baseUrl}` };
  }

  const { isLegado, search, toc, info, content } = normalizeRules(input);

  const unsupported = [];
  // 现在 XPath（子集）与 webJs 都走本地实现，只保留真正跑不了的提示（见下）
  if (content.sourceRegex) unsupported.push('正文使用 sourceRegex 二次抓取，当前不支持');

  const type = Number(input.bookSourceType || 0);
  const TYPE_LABEL = { 0: '文本', 1: '音频', 2: '图片', 3: '文件' };
  if (type !== 0 && type !== 2) unsupported.push(`该书源类型是${TYPE_LABEL[type] || type}，Folio 只支持文本与图片`);

  if (!search.url) unsupported.push('缺少搜索地址（searchUrl）');
  if (!search.list) unsupported.push('缺少搜索结果列表规则（ruleSearch.bookList）');
  if (!toc.list) unsupported.push('缺少目录列表规则（ruleToc.chapterList）');
  if (!content.rule) unsupported.push('缺少正文规则（ruleContent.content）');

  return {
    id: crypto
      .createHash('sha1')
      .update(`${name}|${origin}`)
      .digest('hex')
      .slice(0, 12),
    name,
    baseUrl: origin,
    // Legado 的 source.getBookSourceUrl()：原始站点地址（保证带结尾 `/`）
    bookSourceUrl: /\/$/.test(baseUrl) ? baseUrl : `${baseUrl.replace(/\/+$/, '')}/`,
    group: firstDefined(input.group, input.bookSourceGroup),
    charset: firstDefined(input.charset),
    headers: normalizeHeaders(input),
    jsLib: typeof input.jsLib === 'string' ? input.jsLib : '',
    userAgent: firstDefined(input.userAgent, input.httpUserAgent) || UA,
    enabled: input.enabled !== false,
    type,
    typeLabel: TYPE_LABEL[type] || String(type),
    enabledExplore: input.enabledExplore !== false,
    exploreUrl: firstDefined(input.exploreUrl),
    weight: Number(input.weight || 0) || 0,
    customOrder: Number(input.customOrder || 0) || 0,
    bookUrlPattern: firstDefined(input.bookUrlPattern),
    loginUrl: firstDefined(input.loginUrl),
    loginCheckJs: firstDefined(input.loginCheckJs),
    concurrentRate: firstDefined(input.concurrentRate),
    comment: firstDefined(input.bookSourceComment),
    customVariables: firstDefined(input.customVariables),
    lastUpdateTime: Number(input.lastUpdateTime || 0) || 0,
    respondTime: Number(input.respondTime || 0) || 0,
    dialect: isLegado ? 'legado' : 'folio',
    search,
    toc,
    info,
    content,
    unsupported,
  };
}

/* ------------------------------ 网络取页 ------------------------------ */
function detectCharset(buffer, contentType, fallback) {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType || '');
  if (fromHeader) return fromHeader[1].toLowerCase();
  const head = buffer.subarray(0, Math.min(buffer.length, 2048)).toString('latin1');
  const meta = /charset\s*=\s*["']?([\w-]+)/i.exec(head);
  if (meta) return meta[1].toLowerCase();
  return fallback || '';
}

/** 把 fetch 的网络错误翻译成人话，并提示可以配置代理。 */
function networkError(targetUrl, err) {
  const host = (() => {
    try {
      return new URL(targetUrl).host;
    } catch {
      return targetUrl;
    }
  })();
  const code = err?.cause?.code || err?.code || '';
  const reason =
    code === 'ENOTFOUND'
      ? '域名解析失败'
      : code === 'ECONNREFUSED'
        ? '连接被拒绝'
        : code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT'
          ? '连接超时'
          : code === 'CERT_HAS_EXPIRED' || code === 'ERR_TLS_CERT_ALTNAME_INVALID'
            ? '证书校验失败'
            : err?.message || '网络错误';
  return new Error(`连不上 ${host}（${reason}）。若该站点需要代理，请在「书源」面板填写代理地址`);
}

function decodeBuffer(buffer, charset) {
  const normalized = String(charset || '').toLowerCase();
  const tryCharsets = [];
  if (normalized) tryCharsets.push(normalized === 'gb2312' ? 'gbk' : normalized);
  tryCharsets.push('utf-8');
  if (normalized !== 'gbk') tryCharsets.push('gbk');

  for (const enc of tryCharsets) {
    try {
      return new TextDecoder(enc, { fatal: enc !== 'utf-8' ? false : true }).decode(buffer);
    } catch {
      /* try next */
    }
  }
  return buffer.toString('utf-8');
}

/** 站点用 JS 反爬（例如只返回一段 _guard 脚本）时给出明确提示。 */
function assertNotGuardPage(html, targetUrl) {
  const text = String(html || '');
  if (text.length > 1200) return;
  if (!/_guard\/|auto\.js|document\.cookie|location\.href/.test(text)) return;
  if (/<body[\s\S]*?<[a-z]/i.test(text) && !/<script[^>]*auto\.js/i.test(text)) return;
  let host = targetUrl;
  try {
    host = new URL(targetUrl).host;
  } catch {
    /* keep */
  }
  const guard = new Error(`${host} 启用了 JS 反爬验证（需要浏览器执行脚本），当前不支持该站点`);
  guard.friendly = true;
  throw guard;
}

/**
 * 渲染 URL 模板：`{{key}}` / `{{page}}` / `{{baseUrl}}` / `{{bookUrl}}`，
 * 以及 Legado 的任意表达式：`{{(page-1)*10}}`、`{{bhost()}}`、
 * `{{source.getBookSourceUrl()}}`、`{{result.match(/works\/([^/-]+)/)[1]}}`、`{{$..id}}`。
 * 简单标识符按 `encodeURIComponent` 处理（关键词要转义），复杂表达式原样求值
 * （URL 里的中文交给 URL 解析器编码，否则 `/`、`:` 会被二次编码）。
 */
const SIMPLE_VAR_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

function resolveSimpleVar(vars, pathText) {
  const parts = String(pathText).split('.');
  let current = vars;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

/** 表达式里的 `$` 开头 JSONPath（如 `{{$..id}}`）：在 result / book 对象上求值。 */
function evalJsonPathExpr(expr, vars) {
  const sources = [vars.result, vars.jsonScope, vars.book && vars.book.raw, vars.book];
  for (const candidate of sources) {
    if (candidate == null) continue;
    const data = typeof candidate === 'string' ? safeParse(candidate) : candidate;
    if (data == null || typeof data !== 'object') continue;
    const value = jsonPath(data, expr);
    if (value !== '' && value != null) return value;
  }
  return '';
}

export function renderTemplate(template, vars = {}) {
  const text = String(template || '');
  const source = vars.source || null;
  return text.replace(/\{\{([\s\S]*?)\}\}/g, (whole, rawExpr) => {
    const expr = String(rawExpr).trim();
    if (!expr) return '';
    if (SIMPLE_VAR_RE.test(expr)) {
      const value = resolveSimpleVar(vars, expr);
      if (value !== undefined && value !== null) return encodeURIComponent(String(value));
      // 没这个变量：可能是 `{{result}}` 之外的未知名字，交给脚本求值（失败给空串）
    }
    if (/^\$/.test(expr)) {
      const value = evalJsonPathExpr(expr, vars);
      return value === '' || value == null ? '' : encodeURIComponent(String(value));
    }
    if (!source) return '';
    try {
      const { cacheRoot, proxy, result, jsonScope, book: _book, source: _source, ...bindings } = vars;
      const out = runSourceScript(
        source,
        expr,
        { ...bindings, result: result == null ? '' : asText(result) },
        { cacheRoot, proxy },
      );
      if (out == null) return '';
      if (typeof out === 'object') return encodeURIComponent(JSON.stringify(out));
      return String(out);
    } catch {
      // 表达式求值失败就当空串（绝不回退到主进程 eval）
      return '';
    }
  });
}

/** 拆分 Legado 的「url,{"method":"POST",...}」写法。 */
function parseRequest(rawUrl) {
  const text = String(rawUrl || '').trim();
  const braceAt = text.indexOf(',{');
  if (braceAt === -1) return { url: text, method: 'GET', body: null, charset: '' };
  const url = text.slice(0, braceAt).trim();
  const rawOptions = text.slice(braceAt + 1);
  const options = parseLooseJson(rawOptions);
  if (!options) return { url, method: 'GET', body: null, charset: '' };
  return {
    url,
    method: (options.method || 'GET').toUpperCase(),
    body: options.body || null,
    charset: options.charset || '',
  };
}

/** Legado 的选项对象常用单引号，或跟着 `;result='';result;` 尾巴，这里尽量宽松解析。 */
function parseLooseJson(text) {
  const source = String(text || '').trim();
  const close = source.lastIndexOf('}');
  const body = close === -1 ? source : source.slice(0, close + 1);
  const attempts = [body, body.replace(/'/g, '"'), body.replace(/'/g, '"').replace(/,\s*}/g, '}')];
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* 继续尝试下一种 */
    }
  }
  return null;
}

/* ------------------------------ 日志 ------------------------------ */

let LOGGER = null;

/** 由主进程注入日志器；没注入时所有日志调用都静默跳过。 */
export function setLogger(logger) {
  LOGGER = logger || null;
}

function logLine(level, tag, message, extra) {
  if (!LOGGER) return;
  try {
    LOGGER[level](tag, message, extra);
  } catch {
    /* 日志不能影响主流程 */
  }
}

export async function fetchPage(source, rawUrl, vars = {}, { timeout = 15000, proxy = '' } = {}) {
  const request = parseRequest(rawUrl);
  const baseVars = { baseUrl: source.baseUrl, ...vars, source };
  const targetUrl = absUrl(source.baseUrl, renderTemplate(request.url, baseVars).trim());

  const headers = {
    'user-agent': source.userAgent || UA,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
    ...(source.headers || {}),
  };
  let body;
  if (request.method === 'POST') {
    headers['content-type'] = headers['content-type'] || 'application/x-www-form-urlencoded';
    body = renderTemplate(request.body || '', baseVars).replace(/%20/g, '+');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const started = Date.now();
  try {
    const res = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const charset = detectCharset(buffer, res.headers.get('content-type'), request.charset || source.charset);
    const html = decodeBuffer(buffer, charset);
    assertNotGuardPage(html, targetUrl);
    logLine('info', 'net', `${request.method} ${targetUrl} ${res.status} ${buffer.length}B ${charset} ${Date.now() - started}ms`, {
      source: source.name,
      finalUrl: res.url && res.url !== targetUrl ? res.url : undefined,
    });
    return { url: targetUrl, html, finalUrl: res.url || targetUrl };
  } catch (err) {
    if (err && err.friendly) {
      logLine('warn', 'net', `${request.method} ${targetUrl} 需要浏览器验证`, { source: source.name });
      throw err;
    }
    logLine('warn', 'net', `${request.method} ${targetUrl} 失败 ${Date.now() - started}ms`, {
      source: source.name,
      error: err?.message || String(err),
      proxy: proxy || undefined,
    });
    // 直连失败而配置了代理时，改走 curl（它认得 -x 代理参数）
    if (!proxy) throw networkError(targetUrl, err);
    try {
      const html = syncFetch(targetUrl, {
        method: request.method,
        headers,
        body,
        proxy,
        timeout: Math.max(5, Math.round(timeout / 1000)),
      });
      return { url: targetUrl, html, finalUrl: targetUrl };
    } catch (proxyErr) {
      throw new Error(`${networkError(targetUrl, err).message}；走代理 ${proxy} 也失败（${proxyErr.message}）`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ 三类请求 ------------------------------ */

const JS_RULE = /^\s*(@js\s*:|<js>)/i;
const JSON_RULE = /^\s*@json\s*:/i;

function isJs(rule) {
  return typeof rule === 'string' && JS_RULE.test(rule);
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readPath(obj, pathText) {
  const parts = String(pathText || '')
    .trim()
    .split(/[.[\]]+/)
    .filter((part) => part && part !== '$');
  return parts.reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

/**
 * JSONPath 的宽松版本：`$.chapters[*]` 取不到时再按 `$..chapters[*]` 递归找一次。
 * 有些书源的规则按「相对 data 对象」书写（G社 `.chapters[*]` / `.title`），
 * 而接口实际返回 `{ data: { chapters: [...] } }`。
 */
function jsonPathLoose(obj, expr) {
  const value = jsonPath(obj, expr);
  const text = String(expr || '').trim();
  const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0);
  if (empty && /^\$\.[^.$]/.test(text)) {
    const alt = jsonPath(obj, `$..${text.slice(2)}`);
    if (alt != null && alt !== '' && !(Array.isArray(alt) && !alt.length)) return alt;
  }
  return value;
}

/** 极简 JSONPath：支持 $.a.b、[0]、[*]。 */
export function jsonPath(obj, expr) {
  // 书源里规则常带换行/空格（`"$.hits[*]\n"`），不 trim 会把换行当成键名
  const text = String(expr || '').trim().replace(/^\$/, '');
  const tokens = [];
  const re = /([^.[\]]+)|\[(\d+|\*)\]/g;
  let match = re.exec(text);
  while (match !== null) {
    if (match[1] !== undefined) {
      const key = match[1];
      // `..` 前面出现过 → 递归降序查找
      const at = match.index;
      const recursive = text.slice(0, at).endsWith('..');
      tokens.push(recursive ? { deep: key } : key);
    } else if (match[2] === '*') tokens.push('*');
    else tokens.push(Number(match[2]));
    match = re.exec(text);
  }
  let current = [obj];
  for (const token of tokens) {
    const next = [];
    for (const node of current) {
      if (node == null) continue;
      if (token === '*') {
        if (Array.isArray(node)) next.push(...node);
        else if (typeof node === 'object') next.push(...Object.values(node));
      } else if (token && typeof token === 'object' && token.deep) {
        const stack = [node];
        while (stack.length) {
          const item = stack.pop();
          if (item == null || typeof item !== 'object') continue;
          if (Array.isArray(item)) {
            stack.push(...item);
            continue;
          }
          if (Object.prototype.hasOwnProperty.call(item, token.deep)) next.push(item[token.deep]);
          for (const value of Object.values(item)) {
            if (value && typeof value === 'object') stack.push(value);
          }
        }
      } else if (typeof node === 'object') {
        next.push(node[token]);
      }
    }
    current = next;
  }
  const flat = current.filter((value) => value != null && value !== '');
  if (!flat.length) return '';
  return flat.length === 1 ? flat[0] : flat;
}

/** 把节点数组包成 Legado `Elements` 那种形状（.length/.size()/.text()/.attr()/.select()）。 */
function wrapElementList(nodes) {
  const safeSelect = (node, rule) => {
    try {
      return selectNodes(node, rule);
    } catch {
      return [];
    }
  };
  const items = nodes.map((node) => ({
    __node: node,
    text: () => textOf(node),
    textNodes: () => textOf(node),
    ownText: () => textOf(node),
    html: () => htmlOf(node),
    attr: (name) => attrOf(node, name) || '',
    select: (rule) => wrapElementList(safeSelect(node, rule)),
    toString: () => textOf(node),
  }));
  const list = {
    __nodes: nodes,
    get length() {
      return items.length;
    },
    size: () => items.length,
    get: (index) => items[index] || null,
    first: () => items[0] || null,
    last: () => items[items.length - 1] || null,
    text: () => nodes.map((node) => textOf(node)).join('\n'),
    textNodes: () => nodes.map((node) => textOf(node)).join('\n'),
    html: () => nodes.map((node) => htmlOf(node)).join(''),
    attr: (name) => (nodes.length ? attrOf(nodes[0], name) || '' : ''),
    select: (rule) => wrapElementList(nodes.length ? safeSelect(nodes[0], rule) : []),
    map: (fn) => items.map(fn),
    forEach: (fn) => items.forEach(fn),
  };
  items.forEach((item, index) => {
    list[index] = item;
  });
  list.toString = () => list.text();
  return list;
}

/** `org.jsoup.Jsoup.parse(html)` 的最小实现：给脚本里直接用 jsoup 的源提供 Document 形态。 */
function createJsoup(initialHtml = '', extra = {}) {
  const makeDoc = (html) => {
    const text =
      typeof html === 'string'
        ? html
        : html && typeof html === 'object'
          ? htmlOf(html)
          : String(html ?? '');
    const root = parseHtml(text);
    const doc = {
      select: (css) => wrapElementList(selectNodes(root, String(css || ''), extra)),
      selectFirst: (css) => wrapElementList(selectNodes(root, String(css || ''), extra)).first(),
      text: () => textOf(root),
      html: () => htmlOf(root),
      outerHtml: () => htmlOf(root),
      attr: (name) => attrOf(root, String(name || '')),
      getElementById: (id) => {
        const value = String(id || '');
        const hits = selectNodes(root, `#${value}`);
        return hits.length ? wrapElementList([hits[0]]) : wrapElementList([]);
      },
      getElementsByTag: (tag) => wrapElementList(selectNodes(root, String(tag || '*'))),
      getElementsByClass: (name) => wrapElementList(selectNodes(root, `.${String(name || '')}`)),
      body: () => wrapElementList(selectNodes(root, 'body')),
      head: () => wrapElementList(selectNodes(root, 'head')),
      toString: () => htmlOf(root),
    };
    return doc;
  };
  makeDoc.parse = makeDoc;
  return makeDoc;
}

/** `java.getElement` 的页面上下文：脚本里 setContent 换页，getElement 按规则选节点。 */
function createDomBridge(initialHtml = '', extra = {}) {
  let content = String(initialHtml || '');
  let root = null;
  const ensureRoot = () => {
    if (!root) root = parseHtml(content);
    return root;
  };
  return {
    setContent(html) {
      content = String(html || '');
      root = null;
    },
    html() {
      return content;
    },
    getElement(rule) {
      if (!content.trim()) return wrapElementList([]);
      try {
        return wrapElementList(selectNodes(ensureRoot(), rule, extra));
      } catch {
        return wrapElementList([]);
      }
    },
    // Legado 的 `java.getString(rule)` / `java.getElements(rule)`：对当前页面按规则取值
    getString(rule) {
      if (!content.trim()) return '';
      try {
        return pickOne(ensureRoot(), rule, extra.baseUrl || '', extra);
      } catch {
        return '';
      }
    },
    getElements(rule) {
      if (!content.trim()) return wrapElementList([]);
      try {
        return wrapElementList(selectNodes(ensureRoot(), rule, extra));
      } catch {
        return wrapElementList([]);
      }
    },
  };
}

function asText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.filter((item) => item != null).join('\n');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** `<js>` / `@js:` 里其实只是「URL,{选项}」写法时，直接当请求解析，别当 JS 跑。 */
function urlRuleFromJs(rule) {
  const text = String(rule || '')
    .replace(/^\s*@js\s*:/i, '')
    .replace(/^\s*<js>([\s\S]*?)<\/js>\s*$/i, '$1')
    .trim();
  const at = text.indexOf(',{');
  if (at === -1) return '';
  if (!/^(\/|https?:)/i.test(text)) return '';
  const close = text.indexOf('}', at);
  if (close === -1) return '';
  return text.slice(0, close + 1);
}

/** HTML 片段 → 纯文本段落。 */
function htmlToParagraphs(html) {
  const raw = String(html || '');
  if (!/<[a-z!/][\s\S]*>/i.test(raw)) {
    return raw
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  const root = parseHtml(raw);
  const blocks = [];
  const walk = (node) => {
    if (!node || !node.children) return;
    for (const child of node.children) {
      if (child.tag === '#text') {
        const text = String(child.text || '').trim();
        if (text) blocks.push(text);
        continue;
      }
      if (/^(p|div|h[1-6]|li|blockquote|section|br)$/i.test(child.tag || '')) {
        const text = textOf(child).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
        if (text) blocks.push(text);
        else walk(child);
        continue;
      }
      walk(child);
    }
  };
  walk(root);
  const merged = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return merged || textOf(root).trim();
}

function sourceCtx(source, cacheRoot, extra = {}) {
  return {
    source,
    cacheRoot,
    baseUrl: source.baseUrl,
    ...extra,
  };
}

function pickItemField(scope, rule, ctx, mode) {
  if (!rule) return '';
  const { source, cacheRoot, proxy = '', baseUrl = source.baseUrl, bindings = {} } = ctx;
  const extra = { source, cacheRoot, proxy, bindings };  if (isJs(rule)) {
    const domHtml = scope && typeof scope === 'object' && scope.tag ? htmlOf(scope) : '';
    const code = interpolateJsCode(rule, {
      scope,
      value: null,
      result: scope,
      baseUrl,
      extra,
      vars: {},
    });
    const value = runSourceScript(
      source,
      code,
      {
        result: scope,
        src: scope,
        baseUrl,
        __dom: createDomBridge(domHtml, extra),
        __jsoup: createJsoup(domHtml, extra),
        ...bindings,
      },
      { cacheRoot, proxy },
    );
    return asText(value).trim();
  }
  if (/\{\{/.test(String(rule))) {
    // 字段规则里混排字面量与 `{{…}}`：`https://reader.hipmh.top/chapter/{{$.hid}}`
    const text = String(rule).replace(/\{\{([\s\S]*?)\}\}/g, (whole, rawExpr) => {
      const expr = String(rawExpr || '').trim();
      if (!expr) return '';
      if (expr.startsWith('@@')) return asText(pickOne(scope, expr.slice(2), baseUrl, extra)).trim();
      if (expr.startsWith('$')) return asText(jsonPathLoose(scope, expr)).trim();
      try {
        return asText(
          runSourceScript(source, expr, { result: scope, src: scope, baseUrl, ...bindings }, { cacheRoot, proxy }),
        ).trim();
      } catch {
        return '';
      }
    });
    return text.trim();
  }
  if (JSON_RULE.test(rule)) {
    return asText(jsonPath(scope, String(rule).replace(JSON_RULE, ''))).trim();
  }  if (/^\s*\$/.test(rule)) {
    return asText(jsonPathLoose(scope, rule)).trim();
  }
  if (mode === 'json') {
    for (const part of String(rule).split('||')) {
      const clean = part.split('##')[0];
      const value = readPath(scope, clean);
      if (value !== undefined && value !== null && value !== '') return asText(value).trim();
      // 相对 data 对象书写的字段（G社 `.title`）：最后按递归路径找一次
      const deep = jsonPath(scope, `$..${String(clean).replace(/^\$?\.?/, '')}`);
      if (deep !== undefined && deep !== null && deep !== '' && !(Array.isArray(deep) && !deep.length)) {
        return asText(deep).trim();
      }
    }
    return '';
  }
  return pickOne(scope, rule, baseUrl, extra);
}

function jsonEntries(raw) {
  const parsed = typeof raw === 'string' ? safeParse(raw) : raw;
  const unwrap = (item) => {
    if (typeof item !== 'string') return item;
    const inner = safeParse(item);
    return inner && typeof inner === 'object' ? inner : null;
  };
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.data)
      ? parsed.data
      : Array.isArray(parsed?.data?.novel?.data)
        ? parsed.data.novel.data
        : Array.isArray(parsed?.data?.items)
          ? parsed.data.items
          : Array.isArray(parsed?.items)
            ? parsed.items
            : [];  return list
    .map(unwrap)
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ mode: 'json', scope: item }));
}

export async function searchSource(source, keyword, page = 1, options = {}) {
  const cacheRoot = options.cacheRoot;
  const proxy = options.proxy || '';
  const bindings = { key: keyword, page, baseUrl: source.baseUrl };
  const ctx = { source, cacheRoot, proxy, baseUrl: source.baseUrl, bindings };

  let target = source.search.url;
  if (isJs(target)) {
    const direct = urlRuleFromJs(target);
    target = direct || asText(runSourceScript(source, target, bindings, { cacheRoot, proxy })).trim();
  }
  if (!target) throw new Error('搜索地址为空（@js 规则没有返回 URL）');

  const { url, html } = await fetchPage(source, target, bindings, { proxy });

  const listRule = source.search.list || '';
  const entries = extractListEntries(html, listRule, {
    source,
    cacheRoot,
    proxy,
    bindings,
    baseUrl: url,
  });

  const results = [];
  for (const { mode, scope } of entries) {
    const name = pickItemField(scope, source.search.name, ctx, mode);
    if (!name) continue;
    let link = pickItemField(scope, source.search.link, ctx, mode);
    if (!link && mode === 'dom') link = pickOne(scope, 'a@href', url);
    const cover = pickItemField(scope, source.search.cover, ctx, mode);
    results.push({
      sourceId: source.id,
      sourceName: source.name,
      name,
      author: pickItemField(scope, source.search.author, ctx, mode),
      cover: cover ? absUrl(source.baseUrl, cover) : '',
      bookUrl: absUrl(source.baseUrl, link),
      intro: pickItemField(scope, source.search.intro, ctx, mode),
      lastChapter: pickItemField(scope, source.search.lastChapter, ctx, mode),
      // 书源类型跟着结果走：2 = 图片（漫画），UI 据此切换阅读器
      type: source.type || 0,
      typeLabel: source.typeLabel || '',
      raw: mode === 'json' ? scope : undefined,
    });
  }
  return results;
}

/** 取书籍详情（Legado 的 ruleBookInfo.init）：返回脚本产出的书对象。 */
export async function fetchBookInfo(source, bookUrl, options = {}) {
  const cacheRoot = options.cacheRoot;
  const proxy = options.proxy || '';
  const info = source.info || {};
  const hasRule = ['name', 'author', 'kind', 'intro', 'cover', 'lastChapter', 'wordCount'].some((key) => info[key]);
  if (!info.init && !hasRule) return null;
  const { html } = await fetchPage(source, bookUrl, { bookUrl }, { proxy });
  const filled = extractInfoFields(source, html, bookUrl, { source, cacheRoot, proxy, bindings: { bookUrl } });
  if (isJs(info.init)) {
    const value = runSourceScript(
      source,
      info.init,
      { result: html, bookUrl, baseUrl: bookUrl },
      { cacheRoot, proxy },
    );
    const text = asText(value).trim();
    const parsed = typeof value === 'string' ? safeParse(text) : value;
    if (parsed && typeof parsed === 'object') return { ...(filled || {}), ...parsed };
  }
  return filled;
}

/* ------------------------------ 目录 / 正文兜底 ------------------------------ */

/**
 * 书籍详情字段（Legado 的 ruleBookInfo）：书名 / 作者 / 分类 / 简介 / 封面 / 最新章节 / 字数。
 * 支持 `@put:{…}` + `@get:{…}` 变量写法（先 init 里存，再各字段取）。
 */
function extractInfoFields(source, html, pageUrl, extra) {
  const info = source.info || {};
  const keys = ['name', 'author', 'kind', 'intro', 'cover', 'lastChapter', 'wordCount'];
  if (!keys.some((key) => info[key])) return null;
  const vars = {};
  const ctx = { ...extra, vars };
  const root = parseHtml(html);
  if (info.init && !isJs(info.init)) {
    try {
      pickOne(root, info.init, pageUrl, ctx);
    } catch {
      /* init 失败不影响其它字段 */
    }
  }
  const out = {};
  for (const key of keys) {
    const rule = info[key];
    if (!rule) continue;
    try {
      const value = pickOne(root, rule, pageUrl, ctx);
      if (value) out[key] = key === 'cover' ? absUrl(source.baseUrl, value) : value;
    } catch {
      /* 单个字段失败忽略 */
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * 规则没命中时的最后一道保险：从页面里挑出"看起来像章节"的链接。
 * 很多站的目录页结构跟规则描述的不一致，但链接文字仍然写着「第 12 章 …」。
 */
const CHAPTER_TEXT_RE =
  /^\s*(?:第[\d零一二三四五六七八九十百千万两〇]{1,10}[章节節回卷部集篇话話]|(?:Chapter|CHAPTER|Part|PART)\s*\d{1,4}|序章|序言|楔子|引子|前言|后记|後記|尾声|尾聲|终章|終章|番外|附录|附錄|\d{1,4}\s*[、.．:：]\s*\S|【[^】]{1,24}】)/;

const JUNK_LINK_RE = /^(?:上一页|下一页|首页|末页|目录|返回|加入书签|投票|推荐|登录|注册|排行|全部)$/;

function autoChaptersFromHtml(html, pageUrl) {
  const root = parseHtml(html);
  const seen = new Set();
  const chapters = [];
  for (const node of selectAll(root, 'a')) {
    const text = textOf(node).replace(/\s+/g, ' ').trim();
    if (!text || text.length > 48 || JUNK_LINK_RE.test(text)) continue;
    if (!CHAPTER_TEXT_RE.test(text)) continue;
    const href = attrOf(node, 'href', pageUrl);
    if (!href) continue;
    const key = `${text}|${href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chapters.push({ title: text, url: href });
  }
  return chapters;
}

/** 站点「家具」文本：导航、版权、广告、推荐位之类，混进正文会毁掉阅读体验。 */
const BOILERPLATE_RES = [
  /^(上一[章页篇]|下一[章页篇]|返回目录|目录|加入书签|投推荐票|返回书页|手机阅读|章节报错|最新网址|章节目录|查看更多)/,
  /(本站所有|版权所有|请与我们联系|立场无关|法律后果|不负任何责任|网友发表|上传并维护|收集自网络|仅供试读|请支持正版)/,
  /^(小说类别|写作状态|最后更新|最新章节|推荐阅读|相关推荐|猜你喜欢|热门推荐)[：:]/,
  /\[点击阅读\]|\[加入书架\]|\[推荐本书\]/,
  /^(https?:\/\/|www\.)\S*$/i,
  /^\S{0,12}(简介|内容简介)[：:]\s*主角/,
  /^正文解析错误$|^本章未完|^请点击|^友情提示|^温馨提示/,
  /^\s*@\S+\s*\.?\s*$|^@[\u4e00-\u9fa5]+小说/,
];

const NAV_ONLY_RE =
  /^(?:首页|分类|排行|书架|书库|搜索|登录|注册|全部|更多|返回|目录|上一[章页篇]|下一[章页篇]|加入书签|投推荐票|手机阅读|电脑版)(?:[\s|/·,、-]*(?:首页|分类|排行|书架|书库|搜索|登录|注册|全部|更多|返回|目录|上一[章页篇]|下一[章页篇]|加入书签|投推荐票|手机阅读|电脑版)){1,24}$/;

function isBoilerplateLine(line) {
  const text = String(line || '').trim();
  if (!text) return true;
  if (NAV_ONLY_RE.test(text)) return true;
  // 一行里挤着 3 个以上章节名，多半是被当成正文抓进来的目录块
  if (text.length <= 400 && countChapterMatches(text) >= 3) return true;
  if (text.length > 200) return false; // 长段落不当作家具，避免误删正文
  return BOILERPLATE_RES.some((re) => re.test(text));
}

function countChapterMatches(text) {
  return (String(text || '').match(chapterNameRegex()) || []).length;
}

/**
 * 「第X章 / Chapter N / 序章 …」的行内版本：不要首尾锚点，
 * 这样既能数出一行里挤了几个章节名，也能按它们把一整串标题切开。
 */
const INLINE_CHAPTER_RE =
  /(?:第[0-9零一二三四五六七八九十百千万两〇]{1,10}[章节節回卷部集篇话話]|(?:Chapter|CHAPTER|Part|PART)\s*\d{1,4}|序章|序言|楔子|引子|终章|終章|番外)/g;

function chapterNameRegex() {
  return new RegExp(INLINE_CHAPTER_RE.source, 'g');
}


/** 去掉正文里混进来的站点家具行；连续空行压成一行。 */
export function stripBoilerplate(text) {
  const lines = String(text || '').split('\n');
  const kept = [];
  for (const line of lines) {
    if (isBoilerplateLine(line)) continue;
    kept.push(line.replace(/[ \t]+$/g, ''));
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 有的源 content 规则直接把整页取下来，于是目录里的一长串「第X章 …」也混进正文。
 * 正文里如果连着出现多行章节名，就当作误抓的目录块清掉。
 */
function dropChapterListLines(text) {
  const lines = String(text || '').split('\n');
  // 只有「连续 ≥3 行都是整行章节名」才认定为误抓的目录块：
  // 正文里零散出现的「1、打开设置」这类编号行不该被删。
  const runs = [];
  let run = [];
  lines.forEach((line, index) => {
    const t = line.trim();
    const isChapterLine = Boolean(t) && t.length <= 60 && CHAPTER_TEXT_RE.test(t);
    if (isChapterLine) {
      run.push(index);
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length) runs.push(run);
  const bigRuns = runs.filter((item) => item.length >= 3);
  if (!bigRuns.length) return text;
  const drop = new Set();
  for (const item of bigRuns) {
    // 目录块通常占正文行数的一大半，占比太低时保守不动
    if (item.length / Math.max(1, lines.length) < 0.3 && item.length < 6) continue;
    for (const index of item) drop.add(index);
  }
  if (!drop.size) return text;
  return lines
    .filter((line, index) => !drop.has(index))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 候选正文打分：中文字数越多越好，家具行越多越差。 */
function scoreContentCandidate(text) {
  const body = String(text || '');
  if (!body) return 0;
  const cjk = (body.match(/[\u4e00-\u9fa5]/g) || []).length;
  const junk = body.split('\n').filter((line) => line.trim() && isBoilerplateLine(line)).length;
  return cjk - junk * 120;
}

/** 正文规则没命中时，按常见容器 / 密段落兜底。 */
const CONTENT_SELECTORS = [
  '#chaptercontent',
  '#content',
  '#chapter_content',
  '#nr1',
  '#booktxt',
  '.content',
  '.chapter-content',
  '.read-content',
  '.yd_text2',
  'article',
  'main',
];

function fallbackContentFromHtml(html) {
  const root = parseHtml(html);
  // 不再「第一个够长的容器就返回」：有的站把整页塞进 #content，
  // 那样会把导航、目录、推荐、页脚一起当成正文。改成逐个候选打分取最优。
  let best = '';
  let bestScore = 0;
  const consider = (text) => {
    const cleaned = stripBoilerplate(text);
    const score = scoreContentCandidate(cleaned);
    if (score > bestScore) {
      bestScore = score;
      best = cleaned;
    }
  };

  for (const selector of CONTENT_SELECTORS) {
    for (const node of selectAll(root, selector)) {
      const text = htmlToParagraphs(htmlOf(node));
      if (text && text.replace(/\s+/g, '').length > 80) consider(text);
    }
  }
  // 还没命中：把整页所有 <p> 里够长的段落拼起来（多数正文站的主要文字都在 <p> 里）
  const paragraphs = [];
  for (const node of selectAll(root, 'p')) {
    const text = textOf(node).replace(/\s+/g, ' ').trim();
    if (text.length >= 12) paragraphs.push(text);
  }
  if (paragraphs.length >= 3) consider(paragraphs.join('\n\n'));

  return bestScore > 0 ? best : '';
}

/** 目录为空时给前端一句能定位问题的说明。 */
/**
 * 章节名被整块拼成一串文字时（目录页把 `<a>第一章 …</a><a>第二章 …</a>` 内联排布，
 * 或者源把整个列表容器当成了一个字段），按「第X章 / Chapter N / 序章」切回来。
 */
function chaptersFromText(pageText, pageHtml, pageUrl) {
  const blob = String(pageText || '');
  if (!blob) return [];

  const links = new Map();
  for (const node of selectAll(parseHtml(pageHtml || ''), 'a')) {
    const text = textOf(node).replace(/\s+/g, ' ').trim();
    if (!text || text.length > 48) continue;
    const href = attrOf(node, 'href', pageUrl);
    if (href && !links.has(text)) links.set(text, href);
  }

  const re = chapterNameRegex();
  const hits = [...blob.matchAll(re)];
  const chapters = [];
  const seen = new Set();
  for (let i = 0; i < hits.length; i += 1) {
    const start = hits[i].index;
    const end = i + 1 < hits.length ? hits[i + 1].index : Math.min(blob.length, start + 60);
    let title = blob.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 48).trim();
    if (!title) continue;
    const url = links.get(title) || null;
    if (!url) continue;
    if (seen.has(title)) continue;
    seen.add(title);
    chapters.push({ title, url });
  }
  return chapters;
}

function catalogLinkFromHtml(html, pageUrl) {
  const root = parseHtml(html);
  const scored = [];
  for (const node of selectAll(root, 'a')) {
    const text = textOf(node).replace(/\s+/g, ' ').trim();
    if (!text || text.length > 20) continue;
    if (!/(全部|目录|章节|回目录|查看|更多|列表)/.test(text)) continue;
    if (/^(上一页|下一页|首页|末页|返回|加入书签)$/.test(text)) continue;
    const href = attrOf(node, 'href', pageUrl);
    if (!href || href === pageUrl) continue;
    let score = 1;
    if (/全部|目录|列表/.test(text)) score += 2;
    // 目录页的地址通常带 list / index / chapter / catalog 这类词
    if (/(list|index|chapter|catalog|mulu)/i.test(href)) score += 2;
    scored.push({ href, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((item) => item.href);
}

/**
 * 页面里若出现「章节文件」链接（.../1418/1418705/157470008.html 这种长数字文件名），
 * 真正的目录往往就是这些文件的上一级目录（.../1418/1418705/）。
 * 用于书源把 tocUrl 指到「最新章节」列表、而该列表没有章节名的站点。
 */
function chapterDirCandidates(html, pageUrl) {
  const root = parseHtml(html);
  const counts = new Map();
  for (const node of selectAll(root, 'a')) {
    const href = attrOf(node, 'href', pageUrl);
    if (!href) continue;
    const matched = /^(.+\/)([^/]+\.html?)(?:[?#].*)?$/i.exec(href);
    if (!matched) continue;
    // 章节文件名通常是一串数字；短数字文件名（1.html）也认，但至少要 2 位
    if (!/^\d{2,}\.html?$/i.test(matched[2])) continue;
    const dir = matched[1];
    if (!dir || dir === pageUrl) continue;
    counts.set(dir, (counts.get(dir) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([dir]) => dir);
}

const CN_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNITS = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

function chineseNumber(text) {
  const raw = String(text || '').trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  if (!raw || !/^[零〇一二三四五六七八九十百千万两]+$/.test(raw)) return NaN;
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const ch of raw) {
    if (ch in CN_DIGITS) {
      digit = CN_DIGITS[ch];
    } else if (ch === '万') {
      total += (section + digit) * 10000;
      section = 0;
      digit = 0;
    } else if (ch in CN_UNITS) {
      section += (digit || 1) * CN_UNITS[ch];
      digit = 0;
    }
  }
  return total + section + digit;
}

function chapterNumber(title) {
  const match = /第\s*([0-9零〇一二三四五六七八九十百千万两]{1,10})\s*[章节節回卷部集篇话話]/.exec(title || '');
  return match ? chineseNumber(match[1]) : NaN;
}

/**
 * 有的源在书籍首页只放「最新章节」，顺序是倒序的。如果整份目录的章号是严格递减的，
 * 就把它翻过来，避免打开书先看到大结局。
 */
function normalizeChapterOrder(chapters) {
  if (!Array.isArray(chapters) || chapters.length < 4) return chapters;
  const nums = chapters.map((item) => chapterNumber(item.title));
  const valid = nums.filter((num) => Number.isFinite(num));
  if (valid.length < chapters.length * 0.8) return chapters;
  let descending = true;
  let ascending = true;
  for (let i = 1; i < nums.length; i += 1) {
    if (!Number.isFinite(nums[i]) || !Number.isFinite(nums[i - 1])) continue;
    if (nums[i] > nums[i - 1]) descending = false;
    if (nums[i] < nums[i - 1]) ascending = false;
  }
  if (descending && !ascending) return [...chapters].reverse();
  return chapters;
}
function describeEmpty(result) {
  const pages = result.pages || [];
  if (!pages.length) return '目录为空（页面没有取回来）';
  const last = pages[pages.length - 1];
  const kb = Math.max(1, Math.round((last.length || 0) / 1024));
  return `目录为空（抓取了 ${last.url} 共 ${kb} KB，规则没匹配到章节）`;
}

export async function fetchToc(source, bookUrl, book = null, options = {}) {
  const cacheRoot = options.cacheRoot;
  const proxy = options.proxy || '';  const bindings = { book, bookUrl, key: bookUrl, baseUrl: bookUrl };
  const ctx = { source, cacheRoot, proxy, baseUrl: bookUrl, bindings };
  const bookScope = (book && book.raw) || book || options.bookInfo || null;
  let target = source.toc.url;
  const tocTemplate = target;
  if (target && (hasJsStage(String(target)) || /\{\{/.test(String(target)))) {
    // 目录地址也可能是模板/脚本：`{{result.match(…)}}`、`{{$..path_word}}` + `<js>` 续接
    const vars = {
      book: bookScope,
      bookUrl,
      key: bookUrl,
      baseUrl: source.baseUrl,
      result: bookUrl,
      jsonScope: bookScope,
      source,
    };    const render = (extra = {}) => renderStagedTarget(source, tocTemplate, { ...vars, ...extra }, { cacheRoot, proxy });
    try {
      target = render({});
    } catch {
      target = '';
    }
    if (!target || !/[/:]/.test(target)) {
      // 有的源要从书籍页 HTML 里抠 mid（G社）：抓一次首页，把 HTML 当 src 再渲染
      try {
        const page = await fetchPage(source, bookUrl, { bookUrl }, { proxy });
        target = render({ src: page.html, result: page.html, bookUrl: page.url });
      } catch {
        target = '';
      }
    }
  } else if (isJs(target)) {
    const direct = urlRuleFromJs(target);
    target = direct || asText(runSourceScript(source, target, { ...bindings, result: book }, { cacheRoot, proxy })).trim();
  } else if (target && !/[\/{}:]/.test(target)) {
    // Legado 的 tocUrl 可能只是书对象的某个字段名（Pixiv 用 catalogUrl）
    const candidates = [book?.raw, book, options.bookInfo].filter(
      (item) => item && typeof item === 'object',
    );    const fieldExpr = String(target).trim();
    for (const candidate of candidates) {
      const value = /^\$/.test(fieldExpr) || JSON_RULE.test(fieldExpr)
        ? jsonPath(candidate, fieldExpr)
        : readPath(candidate, fieldExpr);
      if (value) {
        target = asText(value).trim();
        break;
      }
    }
  }
  // 依然是个取不到的字段名（或为空）：退回书籍地址本身
  if (!target || !/[\/{}:]/.test(target)) target = bookUrl;

  const pages = [];
  const fetchOnce = async (pageUrl) => {
    const page = await fetchPage(source, pageUrl, { bookUrl }, { proxy });
    pages.push({ url: page.url, html: page.html, length: (page.html || '').length });
    return page;
  };
  const extract = (html, pageUrl) => {
    const chapters = [];
    const listRule = source.toc.list || '';
    const entries = extractListEntries(html, listRule, {
      source,
      cacheRoot,
      proxy,
      bindings,
      baseUrl: pageUrl,
    });
    for (const { mode, scope } of entries) {
      const title = pickItemField(scope, source.toc.name, ctx, mode);
      if (!title) continue;
      const link = pickItemField(scope, source.toc.link, ctx, mode);
      chapters.push({ title, url: absUrl(pageUrl, link || bookUrl) });
    }
    return chapters;
  };

  let chapters = [];
  try {
    const first = await fetchOnce(target);
    chapters = extract(first.html, first.url);
  } catch (err) {
    // 目录地址取不到时，退回书籍首页再试一次（不少源的 tocUrl 只是猜测）
    if (target === bookUrl) throw err;
    const first = await fetchOnce(bookUrl);
    chapters = extract(first.html, first.url);
  }

  if (!chapters.length && pages[0] && pages[0].url !== bookUrl) {
    try {
      const page = await fetchOnce(bookUrl);
      chapters = extract(page.html, page.url);
    } catch {
      /* 首页也不通：交给启发式 */
    }
  }

  let fallback = null;
  if (!chapters.length) {
    for (const page of pages) {
      const auto = autoChaptersFromHtml(page.html, page.url);
      if (auto.length >= 3) {
        chapters = auto;
        fallback = 'auto';
        break;
      }
    }
  }

  // 规则/兜底只拿到很少几章（常见于书籍首页只显示「最新章节」）：
  // 在已抓页面里找「目录 / 全部章节」这类入口，去真正的目录页再取一次。
  // 候选可能有多个（「全部章节」「查看目录」各指一处），逐个试、取章数最多的那份。
  if (chapters.length < 20) {
    for (const page of [...pages]) {
      const links = catalogLinkFromHtml(page.html, page.url);
      if (links.length) logLine('debug', 'toc', `候选目录入口 ${links.length} 个`, { from: page.url, links });
      for (const link of links) {
        if (pages.some((item) => item.url === link)) continue;
        try {
          const extra = await fetchOnce(link);
          const byRule = extract(extra.html, extra.url);
          const byAuto = autoChaptersFromHtml(extra.html, extra.url);
          const useRule = byRule.length >= byAuto.length;
          const best = useRule ? byRule : byAuto;
          logLine('debug', 'toc', `探测目录入口 ${link}`, { byRule: byRule.length, byAuto: byAuto.length });
          if (best.length > chapters.length) {
            chapters = best;
            fallback = useRule ? null : 'auto';
          }
        } catch (err) {
          logLine('debug', 'toc', `目录入口取不到 ${link}`, { error: err?.message || String(err) });
          /* 这个候选取不到就换下一个，保留已有结果 */
        }
      }
    }
  }

  // 兜底：页面里散落着「章节文件」链接时，去它们的上一级目录找完整目录。
  // 典型场景：书源把 tocUrl 指到「最新章节」页，那个页面只有几条不带章号的更新记录。
  if (chapters.length < 50) {
    const tried = new Set(pages.map((page) => page.url));
    for (const page of [...pages]) {
      for (const dir of chapterDirCandidates(page.html, page.url)) {
        if (tried.has(dir)) continue;
        tried.add(dir);
        try {
          const extra = await fetchOnce(dir);
          const byRule = extract(extra.html, extra.url);
          const byAuto = autoChaptersFromHtml(extra.html, extra.url);
          const useRule = byRule.length >= byAuto.length;
          const best = useRule ? byRule : byAuto;
          logLine('debug', 'toc', `按章节文件目录探测 ${dir}`, { byRule: byRule.length, byAuto: byAuto.length });
          if (best.length > chapters.length) {
            chapters = best;
            fallback = useRule ? null : 'auto';
            break;
          }
        } catch (err) {
          logLine('debug', 'toc', `章节文件目录取不到 ${dir}`, { error: err?.message || String(err) });
          /* 目录取不到就继续用已有结果 */
        }
      }
      if (chapters.length >= 50) break;
    }
  }

  // 目录分页：nextTocUrl（`text.下一页@href`、`id.pages@option!0@value` 这类规则）
  let tocTruncated = false;
  if (chapters.length && source.toc.next) {
    const seenPages = new Set(pages.map((page) => page.url));
    const TOC_PAGE_LIMIT = 120;
    for (let guard = 0; guard < TOC_PAGE_LIMIT; guard += 1) {
      const cursor = pages[pages.length - 1];
      if (!cursor) break;
      if (guard === TOC_PAGE_LIMIT - 1) {
        tocTruncated = true;
        break;
      }
      let nextUrl = '';
      try {
        if (isJs(source.toc.next)) {
          nextUrl = asText(
            runSourceScript(
              source,
              source.toc.next,
              { result: cursor.html, ...bindings },
              { cacheRoot, proxy },
            ),
          ).trim();
        } else {
          nextUrl = pickOne(parseHtml(cursor.html), source.toc.next, cursor.url, ctx);
        }
      } catch {
        break;
      }
      nextUrl = absUrl(cursor.url, nextUrl);
      if (!nextUrl || seenPages.has(nextUrl)) break;
      seenPages.add(nextUrl);
      let page;
      try {
        page = await fetchOnce(nextUrl);
      } catch {
        break;
      }
      const byRule = extract(page.html, page.url);
      const byAuto = autoChaptersFromHtml(page.html, page.url);
      const more = byRule.length >= byAuto.length ? byRule : byAuto;
      if (!more.length) break;
      if (!fallback && byAuto.length > byRule.length) fallback = 'auto';
      const have = new Set(chapters.map((item) => item.url));
      let added = 0;
      for (const item of more) {
        if (!have.has(item.url)) {
          have.add(item.url);
          chapters.push(item);
          added += 1;
        }
      }
      if (!added) break;
    }
  }

  // 兜底：目录被整块当成一段文字时（章节名连成一串、或只有 1 条超长标题），按章节名切回来
  const titleBlob = chapters.length > 0 && chapters.some((item) => countChapterMatches(item.title) >= 3);
  if (!chapters.length || (chapters.length <= 3 && titleBlob)) {
    for (const page of pages) {
      const auto = autoChaptersFromHtml(page.html, page.url);
      const split = chaptersFromText(textOf(parseHtml(page.html)), page.html, page.url);
      // 页面上有正常章节链接时优先用链接（顺序和地址都可靠）；只有一串标题时才按名切
      const best = auto.length >= split.length ? auto : split;
      if (best.length >= 3) {
        chapters = best;
        fallback = 'auto';
        break;
      }
    }
  }

  // 详情字段（书名/作者/封面/简介…）：先从已抓页面里取，取不到再单独抓书籍页
  let info = null;
  const infoPage = pages.find((page) => page.url === bookUrl) || pages[0];
  if (infoPage) info = extractInfoFields(source, infoPage.html, infoPage.url, ctx);
  if (!info) {
    try {
      const page = await fetchPage(source, bookUrl, { bookUrl }, { proxy });
      info = extractInfoFields(source, page.html, page.url, ctx);
    } catch {
      /* 详情页取不到就算了，不影响目录 */
    }
  }

  const ordered = normalizeChapterOrder(chapters);
  const result = {
    chapters: ordered,
    bookUrl: (pages[0] && pages[0].url) || bookUrl,
    fallback,
    info: info || null,
    truncated: tocTruncated,
    pages: pages.map((page) => ({ url: page.url, length: page.length })),
  };
  if (!chapters.length) result.message = describeEmpty(result);
  logLine('info', 'toc', `${source.name} → ${ordered.length} 章${fallback ? `（${fallback}）` : ''}`, {
    bookUrl,
    pages: result.pages,
    truncated: tocTruncated,
    message: result.message,
  });
  return result;
}

/* ---------------- 图片书（漫画） ---------------- */

const IMG_ATTRS = ['data-src', 'data-original', 'data-echo', 'data-url', 'data-lazy-src', 'data-original-src', 'data-lazyload', 'src'];
const IMG_BAD_RE = /(logo|icon|avatar|banner|qrcode|qr_|spacer|pixel|loading|placeholder|blank\.|touxiang|\/ads?\/|\/advert)/i;
const IMG_STUB_RE = /(placeholder|blank|loading|spacer|pixel|grey|default|noimage)/i;

function chooseImgUrl(attrs) {
  let fallback = '';
  for (const name of IMG_ATTRS) {
    const value = attrs[name];
    if (!value) continue;
    if (!fallback) fallback = value;
    if (IMG_BAD_RE.test(value)) continue;
    // 懒加载站点的 src 常是占位图，真实地址在 data-* 里
    if (name === 'src' && IMG_STUB_RE.test(value)) continue;
    return value;
  }
  return fallback;
}

function looksLikeImageUrl(url) {
  if (!url || /^data:/i.test(url)) return false;
  const clean = String(url).split('#')[0].split('?')[0];
  return /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(clean);
}

/**
 * 从章节页里取图片地址（图片书 / 漫画）。
 * 顺序：`@js:` 规则的返回值 → 规则选中的节点 → 整页 `img` 兜底。
 * 过滤掉 logo / 头像 / 二维码这类站点图标，去掉小尺寸占位图。
 */
export function extractImages(html, rule, pageUrl, extra = {}) {
  const out = [];
  const push = (raw) => {
    const value = String(raw || '').trim();
    if (!value) return;
    const abs = absUrl(pageUrl, value);
    if (!abs || /^data:/i.test(abs)) return;
    if (!out.includes(abs)) out.push(abs);
  };
  const collectFromHtml = (fragment) => {
    if (!fragment) return;
    const root = parseHtml(String(fragment));
    for (const node of selectAll(root, 'img')) {
      const attrs = node.attrs || {};
      if (Number(attrs.width) && Number(attrs.width) <= 120) continue;
      if (Number(attrs.height) && Number(attrs.height) <= 120) continue;
      const chosen = chooseImgUrl(attrs);
      if (!chosen || IMG_BAD_RE.test(chosen)) continue;
      push(chosen);
    }
  };

  // 1) 脚本规则（可带多段）：可能返回 HTML 片段、换行分隔的地址、或 JSON 数组
  if (rule && hasJsStage(rule)) {
    try {
      const stages = splitRuleStages(rule);
      let current = html;
      for (const stage of stages) {
        if (stage.kind === 'rule') {
          const got = ruleStageValue(current, stage.text, { ...extra, baseUrl: pageUrl });
          current = got.kind === 'nodes' ? got.value.map((node) => htmlOf(node)).join('') : got.value;
          continue;
        }
        const stageText = asText(current);
        const htmlish = /<\w+[\s>]/.test(stageText) ? stageText : '';
        const code = interpolateJsCode(stage.code, {
          scope: stageText,
          value: stageText,
          result: stageText,
          baseUrl: pageUrl,
          extra,
          vars: {},
        });
        current = runSourceScript(
          extra.source,
          code,
          {
            result: stageText,
            src: stageText,
            baseUrl: pageUrl,
            __dom: createDomBridge(htmlish, extra),
            __jsoup: createJsoup(htmlish, extra),
            ...(extra.bindings || {}),
          },
          { cacheRoot: extra.cacheRoot, proxy: extra.proxy },
        );
      }
      const text = asText(current);
      if (/<img/i.test(text)) {
        collectFromHtml(text);
      } else {
        const parsed = safeParse(text);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            push(typeof item === 'string' ? item : item && (item.src || item.url || item.image));
          }
        } else {
          for (const token of text.split(/[\s,"'[\]]+/)) {
            if (looksLikeImageUrl(token)) push(token);
          }
        }
      }
    } catch {
      /* 脚本失败就走下面的规则/兜底 */
    }
    if (out.length) return out;
  }
  // 2) CSS 规则：命中的节点可能是 img 本身，也可能包着一堆 img
  if (rule && !hasJsStage(rule)) {
    try {
      const root = parseHtml(html);
      for (const node of selectNodes(root, rule, extra)) {
        const chosen = node.tag === 'img' ? chooseImgUrl(node.attrs || {}) : '';
        if (chosen && !IMG_BAD_RE.test(chosen)) {
          push(chosen);
          continue;
        }
        const inner = htmlOf(node);
        if (/<img/i.test(inner)) collectFromHtml(inner);
      }
    } catch {
      /* 规则坏了也不影响兜底 */
    }
    if (out.length) return out;
  }

  // 3) 兜底：整页 img（很多漫画源正文页就是一堆 img）
  collectFromHtml(html);
  logLine('info', 'image', `解析到 ${out.length} 张图`, {
    rule: rule ? String(rule).slice(0, 60) : '(无规则，整页兜底)',
    pageUrl,
  });
  return out;
}

export async function fetchChapter(source, chapterUrl, bookUrl, chapter = null, options = {}) {
  const cacheRoot = options.cacheRoot;
  const proxy = options.proxy || '';
  const { url, html } = await fetchPage(source, chapterUrl, { bookUrl }, { proxy });
  const bindings = { chapter, title: chapter?.title || '', bookUrl, baseUrl: source.baseUrl };
  const extra = { source, cacheRoot, proxy, bindings };

  const extractText = (pageHtml, pageUrl) => {
    if (isJs(source.content.rule)) {
      // Legado 语义：正文脚本里的 baseUrl 是章节地址，src/result 是页面 HTML，
      // 同时挂上 jsoup / DOM 桥（`org.jsoup.Jsoup.parse(src)` 依赖 __jsoup）
      const bridgeExtra = { ...extra, baseUrl: pageUrl };
      const value = runSourceScript(
        source,
        source.content.rule,
        {
          result: pageHtml,
          src: pageHtml,
          ...bindings,
          baseUrl: pageUrl,
          __dom: createDomBridge(pageHtml, bridgeExtra),
          __jsoup: createJsoup(pageHtml, bridgeExtra),
        },
        { cacheRoot, proxy },
      );
      return htmlToParagraphs(asText(value));
    }
    return pickContent(parseHtml(pageHtml), source.content.rule, pageUrl, extra);
  };

  // Legado 的 webJs：在页面里执行一段脚本再取正文。这里用同一套 JS 运行时跑，
  // 并把页面挂成 DOM 桥（java.getElement / java.getString 可用），返回 HTML 或纯文本都行。
  const runWebJs = (pageHtml, pageUrl) => {
    const code = source.content.webJs;
    if (!code) return null;
    try {
      const value = runSourceScript(
        source,
        code,
        {          result: pageHtml,
          src: pageHtml,
          ...bindings,
          baseUrl: pageUrl,
          __dom: createDomBridge(pageHtml, { ...extra, baseUrl: pageUrl }),
          __jsoup: createJsoup(pageHtml, { ...extra, baseUrl: pageUrl }),
        },
        { cacheRoot, proxy },
      );
      const text = asText(value).trim();
      if (!text) return null;
      return /<[a-z][\s\S]*>/i.test(text) ? htmlToParagraphs(text) : text;
    } catch {
      return null;
    }
  };

  // 番茄等源的章节地址形如 https://…/page/<bid>#<itemId>，HTTP 请求会丢掉 # 片段，
  // 但正文脚本要用它解析 itemId，所以规则上下文里的 baseUrl 保留原始章节地址。
  const ruleBaseUrl = String(chapterUrl || '').includes('#') ? chapterUrl : url;
  const parts = [extractText(html, ruleBaseUrl)];
  const flat = (value) => String(value || '').replace(/\s+/g, '');

  // 正文分页：nextContentUrl（`text.下一页@href`、`.prenext@span.-1@a@href` 这类规则）
  let contentTruncated = false;
  if (source.content.next) {
    const seen = new Set([url]);
    let cursorHtml = html;
    let cursorUrl = url;
    const PAGE_LIMIT = 30;
    for (let guard = 0; guard < PAGE_LIMIT; guard += 1) {
      if (guard === PAGE_LIMIT - 1) {
        contentTruncated = true;
        break;
      }
      let nextUrl = '';
      try {
        if (isJs(source.content.next)) {
          nextUrl = asText(
            runSourceScript(
              source,
              source.content.next,
              { result: cursorHtml, ...bindings },
              { cacheRoot, proxy },
            ),
          ).trim();
        } else {
          nextUrl = pickOne(parseHtml(cursorHtml), source.content.next, cursorUrl, extra);
        }
      } catch {
        break;
      }
      nextUrl = absUrl(cursorUrl, nextUrl);
      if (!nextUrl || seen.has(nextUrl)) break;
      seen.add(nextUrl);
      let page;
      try {
        page = await fetchPage(source, nextUrl, { bookUrl }, { proxy });
      } catch {
        break;
      }
      const part = extractText(page.html, page.url);
      const norm = flat(part);
      cursorHtml = page.html;
      cursorUrl = page.url;
      // 空白页/图片页跳过继续找下一页，别把后面的正文一起丢掉
      if (norm.length < 10) continue;
      const joined = flat(parts.join(''));
      if (joined.includes(norm) || norm.includes(flat(parts[parts.length - 1]))) continue;
      parts.push(part);
    }
  }

  let text = dropChapterListLines(stripBoilerplate(parts.join('\n\n')));

  // webJs 优先（源明确写了「在页面里跑脚本取正文」时，脚本比规则更准）
  const webResult = runWebJs(html, url);
  if (webResult && scoreContentCandidate(webResult) > scoreContentCandidate(text)) {
    text = dropChapterListLines(stripBoilerplate(webResult));
  }

  // 规则命中但明显是「整页/半页」时（混进大量站点家具），再算一次通用兜底，取更干净的那份
  let fallback = null;
  const ruleScore = scoreContentCandidate(text);
  const looksDirty = ruleScore <= 0 || text.replace(/\s+/g, '').length < 20;
  if (looksDirty) {
    const guess = fallbackContentFromHtml(html);
    if (guess && scoreContentCandidate(guess) > ruleScore) {
      text = guess;
      fallback = 'auto';
    }
  }

  logLine('info', 'content', `${source.name} → ${text.replace(/\s+/g, '').length} 字${fallback ? `（${fallback}）` : ''}`, {
    chapterUrl,
    pages: parts.length,
    htmlLength: (html || '').length,
    webJs: webResult ? 'used' : undefined,
    truncated: contentTruncated || undefined,
  });
  return {
    text,
    url,
    fallback,
    htmlLength: (html || '').length,
    pages: parts.length,
    truncated: contentTruncated,
  };
}

/* ------------------------------ 磁盘缓存 ------------------------------ */
// 云端书的磁盘缓存已移到 cloudstore.js（只依赖 Node 内置模块），
// 这样本文件可以整体被主进程懒加载，不必在启动时解析。

export { createCloudStore } from './cloudstore.js';

