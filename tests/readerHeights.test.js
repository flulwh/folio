import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  contentFingerprint,
  encodeHeights,
  decodeHeights,
  heightStorageKey,
  loadHeights,
  hasHeights,
  saveHeights,
  measureChunkSize,
} from '../src/utils/readerHeights.js';

/** 最小可用的 localStorage 替身：readerHeights 只用到这几个方法。 */
function fakeStorage() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}

let storage;

beforeEach(() => {
  storage = fakeStorage();
  globalThis.window = { localStorage: storage };
});

afterEach(() => {
  delete globalThis.window;
});

describe('encodeHeights / decodeHeights', () => {
  it('高度与栏宽能原样往返', () => {
    const heights = new Float64Array([12, 24, 36, 48]);
    const decoded = decodeHeights(encodeHeights(700, heights));
    expect(decoded[0]).toBe(700);
    expect(Array.from(decoded.subarray(1))).toEqual([12, 24, 36, 48]);
  });

  it('超出 Uint16 与负值会被夹住', () => {
    const decoded = decodeHeights(encodeHeights(999999, new Float64Array([-5, 70000])));
    expect(decoded[0]).toBe(65535);
    expect(decoded[1]).toBe(0);
    expect(decoded[2]).toBe(65535);
  });
});

describe('loadHeights / saveHeights', () => {
  it('栏宽一致时命中缓存', () => {
    saveHeights('height-book', 700, new Float64Array([10, 20]));
    const loaded = loadHeights('height-book', 700);
    expect(loaded && Array.from(loaded)).toEqual([10, 20]);
  });

  it('栏宽是缓存键的一部分：栏宽变了就重新测量', () => {
    saveHeights('height-book-2', 700, new Float64Array([10]));
    expect(loadHeights('height-book-2', 700)).not.toBeNull();
    expect(loadHeights('height-book-2', 740)).toBeNull();
  });

  it('同一本书只保留当前栏宽的一份缓存', () => {
    saveHeights('height-book-3', 700, new Float64Array([10]));
    saveHeights('height-book-3', 800, new Float64Array([11]));
    const keys = [...storage._map.keys()].filter((k) => k.includes('height-book-3|'));
    expect(keys).toEqual([heightStorageKey('height-book-3', 800)]);
    expect(hasHeights('height-book-3')).toBe(true);
  });

  it('超出上限的段落数不写缓存', () => {
    saveHeights('height-book-4', 700, new Float64Array(1200001));
    expect(hasHeights('height-book-4')).toBe(false);
  });
});

describe('measureChunkSize', () => {
  it('小书按基准批次，大书放大但有单批上限', () => {
    expect(measureChunkSize(100)).toBe(600);
    expect(measureChunkSize(9600)).toBe(600);
    expect(measureChunkSize(160000)).toBe(10000);
    expect(measureChunkSize(4000000)).toBe(24000);
  });
});

describe('contentFingerprint', () => {
  const para = (text, blank = false) => ({ text, blank });

  it('同样的正文得到同样的指纹', () => {
    const a = [para('第一章'), para('', true), para('正文一')];
    const b = [para('第一章'), para('', true), para('正文一')];
    expect(contentFingerprint(a)).toBe(contentFingerprint(b));
  });

  it('段落数不变但内容变了，指纹跟着变', () => {
    const before = [para('第一章'), para('旧的正文')];
    const after = [para('第一章'), para('重新抓取后的正文')];
    expect(contentFingerprint(before)).not.toBe(contentFingerprint(after));
  });

  it('字数相同但分布不同也能区分', () => {
    expect(contentFingerprint([para('ab'), para('c')])).not.toBe(
      contentFingerprint([para('a'), para('bc')])
    );
  });

  it('空行与缺失 text 不抛错', () => {
    expect(() => contentFingerprint([para(''), {}, para('x')])).not.toThrow();
  });
});
