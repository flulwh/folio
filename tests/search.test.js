import { describe, it, expect } from 'vitest';
import { MAX_SEARCH_RESULTS, searchBook, findMatchRange } from '../src/utils/search.js';

const paragraphs = [
  { text: '第一章 起风了' },
  { text: '', blank: true },
  { text: '今天天气很好，我们去看海。' },
  { text: '第二章 落雨' },
  { text: '海边的风很大，海浪拍打礁石。' },
];
const chapters = [
  { title: '第一章 起风了', paraIndex: 0 },
  { title: '第二章 落雨', paraIndex: 3 },
];

describe('searchBook', () => {
  it('命中多个段落并映射到正确章节', () => {
    const hits = searchBook(paragraphs, chapters, '海');
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ paraIndex: 2, chapterIndex: 0, chapterTitle: '第一章 起风了' });
    expect(hits[1]).toMatchObject({ paraIndex: 4, chapterIndex: 1, chapterTitle: '第二章 落雨' });
  });

  it('短段落摘录就是原文，start/end 指回原文位置', () => {
    const [hit] = searchBook(paragraphs, chapters, '海');
    expect(hit.excerpt).toBe('今天天气很好，我们去看海。');
    expect(hit.excerpt.slice(hit.start, hit.end)).toBe('海');
  });

  it('长段落前半段命中时加前省略号，下标仍对齐原文', () => {
    const text = `${'铺垫'.repeat(20)}关键词${'后续'.repeat(30)}`;
    const [hit] = searchBook([{ text }], [], '关键词');
    expect(hit.excerpt.startsWith('…')).toBe(true);
    expect(hit.excerpt.endsWith('…')).toBe(true);
    expect(hit.excerpt.slice(hit.start, hit.end)).toBe('关键词');
    expect(hit.start).toBe(1 + 18);
  });

  it('命中位置靠后时摘录到段落结尾就不加后省略号', () => {
    const text = `${'铺垫'.repeat(20)}尾词`;
    const [hit] = searchBook([{ text }], [], '尾词');
    expect(hit.excerpt.endsWith('…')).toBe(false);
    expect(hit.excerpt.endsWith('尾词')).toBe(true);
  });

  it('大小写不敏感', () => {
    const [hit] = searchBook([{ text: 'Hello World' }], [], 'hello');
    expect(hit.start).toBe(0);
    expect(hit.end).toBe(5);
  });

  it('关键词首尾空白会被裁掉', () => {
    const hits = searchBook(paragraphs, chapters, '  海  ');
    expect(hits).toHaveLength(2);
    expect(hits[0].end - hits[0].start).toBe(1);
  });

  it('空关键词返回空数组', () => {
    expect(searchBook(paragraphs, chapters, '')).toEqual([]);
    expect(searchBook(paragraphs, chapters, '   ')).toEqual([]);
  });

  it('non-array 段落输入安全返回空数组', () => {
    expect(searchBook(null, chapters, '海')).toEqual([]);
    expect(searchBook([], chapters, '海')).toEqual([]);
  });

  it('跳过 blank 段落', () => {
    const hits = searchBook([{ text: '', blank: true }, { text: '海' }], [], '海');
    expect(hits).toHaveLength(1);
    expect(hits[0].paraIndex).toBe(1);
  });

  it('没有章节表时章节标题为空串、章节号为 0', () => {
    const [hit] = searchBook([{ text: '海' }], [], '海');
    expect(hit.chapterIndex).toBe(0);
    expect(hit.chapterTitle).toBe('');
  });

  it('limit 生效', () => {
    const hits = searchBook(paragraphs, chapters, '海', 1);
    expect(hits).toHaveLength(1);
  });

  it('默认上限是 300 条', () => {
    expect(MAX_SEARCH_RESULTS).toBe(300);
    const many = Array.from({ length: 400 }, (_, i) => ({ text: `行 ${i} 海` }));
    expect(searchBook(many, [], '海')).toHaveLength(300);
  });

  it('没命中时返回空数组', () => {
    expect(searchBook(paragraphs, chapters, '不存在的词')).toEqual([]);
  });

  it('命中在后面的章节标题里时，章节指针已前进到该章', () => {
    const hits = searchBook(paragraphs, chapters, '雨');
    expect(hits.map((h) => h.paraIndex)).toEqual([3]);
    expect(hits[0].chapterIndex).toBe(1);
    expect(hits[0].chapterTitle).toBe('第二章 落雨');
  });
});

describe('findMatchRange', () => {
  it('返回原文下标而不是摘录下标', () => {
    expect(findMatchRange('abcABC', 'abc')).toEqual({ start: 0, end: 3 });
  });

  it('大小写不敏感', () => {
    expect(findMatchRange('前缀 Hello 后缀', 'hello')).toEqual({ start: 3, end: 8 });
  });

  it('没有命中返回 null', () => {
    expect(findMatchRange('abc', 'z')).toBeNull();
  });

  it('空查询或空文本返回 null', () => {
    expect(findMatchRange('abc', '')).toBeNull();
    expect(findMatchRange('abc', '  ')).toBeNull();
    expect(findMatchRange('', 'a')).toBeNull();
    expect(findMatchRange(null, 'a')).toBeNull();
  });

  it('中文关键词定位正确', () => {
    expect(findMatchRange('今天天气很好', '天气')).toEqual({ start: 2, end: 4 });
  });
});
