// Legado `@XPath:` 支持。
//
// 求值交给成熟的 `xpath` 包；本文件只负责把引擎的轻量节点树适配成 DOM 形状
// （nodeType / nodeName / childNodes / attributes / textContent），
// 以及把结果映射回「节点或字符串」的旧接口。

import * as xpath from 'xpath';
import { parseHtml, textOf } from './html.js';

const TO_WRAPPER = new WeakMap();
const TO_LEGACY = new WeakMap();
const EXPR_CACHE = new Map();
const EXPR_CACHE_MAX = 256;

const DOCUMENT_NODE = 9;
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const ATTRIBUTE_NODE = 2;

/** 把引擎节点包装成 xpath 包能识别的 DOM 形状（带缓存，父子互相引用）。 */
function wrap(node) {
  if (!node || typeof node !== 'object') return null;
  const cached = TO_WRAPPER.get(node);
  if (cached) return cached;

  const tag = node.tag;
  let wrapper;

  if (tag === '#text') {
    const value = String(node.text ?? node.data ?? '');
    wrapper = {
      nodeType: TEXT_NODE,
      nodeName: '#text',
      nodeValue: value,
      data: value,
      textContent: value,
      childNodes: [],
      parentNode: null,
      ownerDocument: null,
    };
  } else if (tag === '#root') {
    wrapper = {
      nodeType: DOCUMENT_NODE,
      nodeName: '#document',
      nodeValue: null,
      childNodes: [],
      parentNode: null,
      ownerDocument: null,
      documentElement: null,
      textContent: '',
    };
  } else {
    const name = String(tag || '').toLowerCase();
    wrapper = {
      nodeType: ELEMENT_NODE,
      nodeName: name.toUpperCase(),
      tagName: name.toUpperCase(),
      localName: name,
      prefix: null,
      namespaceURI: null,
      childNodes: [],
      parentNode: null,
      ownerDocument: null,
      attributes: [],
      textContent: '',
    };
  }

  TO_WRAPPER.set(node, wrapper);
  TO_LEGACY.set(wrapper, node);
  wrapper.firstChild = null;
  wrapper.lastChild = null;
  wrapper.previousSibling = null;
  wrapper.nextSibling = null;

  if (wrapper.nodeType === DOCUMENT_NODE) {
    wrapper.ownerDocument = wrapper;
  }
  if (wrapper.nodeType === ELEMENT_NODE) {
    const attributes = Object.entries(node.attrs || {}).map(([key, value]) => ({
      nodeType: ATTRIBUTE_NODE,
      nodeName: key,
      name: key,
      localName: key,
      value: String(value ?? ''),
      nodeValue: String(value ?? ''),
      ownerElement: wrapper,
      specified: true,
    }));
    // xpath 包按 NamedNodeMap 的用法读 attributes.item(i)。
    attributes.item = (index) => attributes[index] ?? null;
    wrapper.attributes = attributes;
    wrapper.getAttribute = (key) => {
      const hit = node.attrs?.[String(key).toLowerCase()];
      return hit === undefined ? null : String(hit);
    };
    wrapper.hasAttribute = (key) => node.attrs?.[String(key).toLowerCase()] !== undefined;
    wrapper.textContent = textOf(node);
  }

  const children = Array.isArray(node.children) ? node.children : [];
  wrapper.childNodes = children.map((child) => wrap(child)).filter(Boolean);

  const doc = wrapper.ownerDocument || wrapper;
  const list = wrapper.childNodes;
  for (let i = 0; i < list.length; i += 1) {
    const child = list[i];
    child.parentNode = wrapper;
    child.ownerDocument = doc;
    child.previousSibling = list[i - 1] || null;
    child.nextSibling = list[i + 1] || null;
  }
  // xpath 包的轴遍历走 firstChild / nextSibling，不读 childNodes。
  wrapper.firstChild = list[0] || null;
  wrapper.lastChild = list[list.length - 1] || null;
  if (wrapper.nodeType === DOCUMENT_NODE) {
    wrapper.documentElement = list.find((child) => child.nodeType === ELEMENT_NODE) || null;
    // xpath 包在给属性节点找 ownerElement 时会调用 document.getElementsByTagName。
    wrapper.getElementsByTagName = (name) => {
      const wanted = String(name || '').toLowerCase();
      const found = [];
      const scan = (current) => {
        for (const child of current.childNodes || []) {
          if (child.nodeType !== ELEMENT_NODE) continue;
          if (wanted === '*' || child.localName === wanted) found.push(child);
          scan(child);
        }
      };
      scan(wrapper);
      found.item = (index) => found[index] ?? null;
      return found;
    };
  }
  return wrapper;
}

function compile(expression) {
  const key = String(expression || '').trim();
  const cached = EXPR_CACHE.get(key);
  if (cached) return cached;
  const parsed = xpath.parse(key);
  if (EXPR_CACHE.size >= EXPR_CACHE_MAX) EXPR_CACHE.clear();
  EXPR_CACHE.set(key, parsed);
  return parsed;
}

/** xpath 结果 → 旧接口：元素给节点，文本/属性给字符串。 */
function unwrap(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return value;
  const legacy = TO_LEGACY.get(value);
  if (legacy) {
    if (legacy.tag === '#text') return String(legacy.text ?? '');
    return legacy;
  }
  if (value.nodeType === ATTRIBUTE_NODE) return String(value.value ?? '');
  if (typeof value.nodeValue === 'string') return value.nodeValue;
  return null;
}

/** 求值，返回节点或字符串组成的数组。单条分支失败不影响其它分支。 */
export function evalXPath(root, expression) {
  if (!root) return [];
  const start = typeof root === 'string' ? parseHtml(root) : root;
  if (!start) return [];

  const text = String(expression || '');
  const branches = text
    .split('|')
    .map((branch) => branch.trim())
    .filter(Boolean);
  const out = [];
  for (const branch of branches) {
    try {
      const hits = compile(branch).select({
        node: wrap(start),
        isHtml: true,
        allowAnyNamespaceForNoPrefix: true,
      });
      for (const hit of hits) {
        const value = unwrap(hit);
        if (value !== null && value !== '') out.push(value);
      }
    } catch {
      /* 单条分支失败不影响其它 */
    }
  }
  return out;
}

/** XPath 结果转字符串：节点取文字，字符串原样，多个用 `\n` 连接（与 Legado 一致）。 */
export function xpathText(root, expression) {
  const text = String(expression || '').trim();
  const render = (items) =>
    items
      .map((item) => (typeof item === 'string' ? item : textOf(item)))
      .filter((value) => value !== '')
      .join('\n');

  const direct = render(evalXPath(root, text));
  if (direct) return direct;

  // 书源常用 `//div[@id='content']/text()`，而正文往往包在 <p> 里：
  // 严格 XPath 只取直接文本节点会得到空串。旧实现会取整段文字，这里保留那个更宽松的结果。
  const trimmed = /\/text\(\)$/i.test(text) ? text.replace(/\/text\(\)$/i, '') : '';
  if (!trimmed) return '';
  return render(evalXPath(root, trimmed));
}
