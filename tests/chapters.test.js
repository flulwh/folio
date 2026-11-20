import { describe, it, expect } from 'vitest';
import {
  AUTO_CHAPTER_REGEX,
  normalizeText,
  splitParagraphs,
  compileRegex,
  isHeading,
  buildChapters,
  chapterIndexForPara,
  mapCloudChapters,
  parseBook,
  parseBookCached,
} from '../src/utils/chapters.js';

const autoRegex = compileRegex(AUTO_CHAPTER_REGEX);

/** 把纯文本按「非空行 = 一段」摊平，够用来测云端章节映射。 */
function paras(...lines) {
  return lines.map((text) => ({ text, blank: text === '' }));
}

describe('mapCloudChapters', () => {
  it('标题与正文完全一致时逐章对上', () => {
    const list = [{ title: '第一章 雪' }, { title: '第二章 灯' }];
    const body = paras('第一章 雪', '雪落了。', '第二章 灯', '灯亮着。');
    expect(mapCloudChapters(list, body)).toEqual([
      { title: '第一章 雪', paraIndex: 0, cloudIndex: 0 },
      { title: '第二章 灯', paraIndex: 2, cloudIndex: 1 },
    ]);
  });

  it('标题带副标题、正文只有前半截时按前缀匹配', () => {
    const list = [{ title: '第一章 雪（上）' }, { title: '第二章 灯' }];
    const body = paras('第一章 雪', '雪落了。', '第二章 灯', '灯亮着。');
    expect(mapCloudChapters(list, body).map((c) => c.paraIndex)).toEqual([0, 2]);
  });

  it('映射不上的章按顺序补齐，章数始终等于目录长度', () => {
    const list = [{ title: '第一章 雪' }, { title: '第二章 找不到' }, { title: '第三章 灯' }];
    const body = paras('第一章 雪', '雪落了。', '灯亮着。', '第三章 灯');
    const out = mapCloudChapters(list, body);
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.paraIndex)).toEqual([0, 1, 3]);
    expect(out.every((c, k) => c.cloudIndex === k && c.title === list[k].title)).toBe(true);
  });

  it('段落号严格递增，不会因为重复标题挤在同一段', () => {
    const list = [{ title: '第一章' }, { title: '第一章' }];
    const body = paras('第一章', '正文');
    const out = mapCloudChapters(list, body);
    expect(out[0].paraIndex).toBe(0);
    expect(out[1].paraIndex).toBeGreaterThan(out[0].paraIndex);
  });

  it('段落为空时也不越界', () => {
    const out = mapCloudChapters([{ title: '第一章' }], []);
    expect(out).toEqual([{ title: '第一章', paraIndex: 0, cloudIndex: 0 }]);
  });
});

describe('normalizeText', () => {
  it('把 CRLF / CR 统一成 LF', () => {
    expect(normalizeText('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('去掉 BOM、不换行空格，并把 tab 换成两个空格', () => {
    expect(normalizeText('\uFEFF甲\u00a0乙\t丙')).toBe('甲 乙  丙');
  });

  it('空输入返回空串', () => {
    expect(normalizeText('')).toBe('');
    expect(normalizeText(null)).toBe('');
  });
});

describe('splitParagraphs', () => {
  it('连续空行折叠成一个 blank 段落，且结尾不保留 blank', () => {
    const paragraphs = splitParagraphs('甲\n\n\n\n乙\n\n');
    expect(paragraphs).toEqual([
      { text: '甲', blank: false },
      { text: '', blank: true },
      { text: '乙', blank: false },
    ]);
  });

  it('开头的空行不产生 blank 段落', () => {
    expect(splitParagraphs('\n\n\n正文')).toEqual([{ text: '正文', blank: false }]);
  });

  it('短行不会被硬换行合并（每行自成一段）', () => {
    expect(splitParagraphs('abc\ndef')).toEqual([
      { text: 'abc', blank: false },
      { text: 'def', blank: false },
    ]);
  });

  it('上一行较长且没有句末标点时合并硬换行（不加空格）', () => {
    const first = '这是一个超过二十四个字符的很长段落，用来测试硬换行';
    const second = '合并是否生效。';
    expect(splitParagraphs(`${first}\n${second}`)).toEqual([
      { text: `${first}${second}`, blank: false },
    ]);
  });

  it('英文硬换行在两侧都是拉丁字符时补一个空格', () => {
    const first = 'This is a fairly long English sentence that will';
    const second = 'continue on the next line.';
    expect(splitParagraphs(`${first}\n${second}`)[0].text).toBe(`${first} ${second}`);
  });

  it('上一行以句末标点结尾时不合并', () => {
    const first = '这一行虽然很长很长很长很长很长很长但是已经结束了。';
    expect(splitParagraphs(`${first}\n下一行`)).toHaveLength(2);
  });

  it('下一行以引号或括号开头时不合并（通常是对白换行）', () => {
    const first = '这一行很长很长很长很长很长很长很长很长没有结束';
    expect(splitParagraphs(`${first}\n「新的对白」`)).toHaveLength(2);
  });

  it('识别为标题的行永远不被上一段吞掉', () => {
    const first = '这一行很长很长很长很长很长很长很长很长没有结束';
    const paragraphs = splitParagraphs(`${first}\n第一章 起点`, autoRegex);
    expect(paragraphs.map((p) => p.text)).toEqual([first, '第一章 起点']);
  });

  it('空文本返回空数组', () => {
    expect(splitParagraphs('')).toEqual([]);
    expect(splitParagraphs('\n \n\t')).toEqual([]);
  });
});

describe('compileRegex / isHeading', () => {
  it('空来源返回 null', () => {
    expect(compileRegex('')).toBeNull();
    expect(compileRegex(undefined)).toBeNull();
  });

  it('非法正则以 { error } 返回而不是抛出', () => {
    const result = compileRegex('([');
    expect(result).toBeTruthy();
    expect(typeof result.error).toBe('string');
  });

  it('合法来源返回 RegExp', () => {
    expect(compileRegex('^第.+章')).toBeInstanceOf(RegExp);
  });

  it('识别常见章节标题', () => {
    expect(isHeading('第一章 起风了', autoRegex)).toBe(true);
    expect(isHeading('  第12节 归途  ', autoRegex)).toBe(true);
    expect(isHeading('Chapter 3 Home', autoRegex)).toBe(true);
    expect(isHeading('【第一卷】', autoRegex)).toBe(true);
    expect(isHeading('序章', autoRegex)).toBe(true);
    expect(isHeading('12、开端', autoRegex)).toBe(true);
  });

  it('普通正文不算标题', () => {
    expect(isHeading('他走进屋子，看到桌上放着一封信。', autoRegex)).toBe(false);
    expect(isHeading('', autoRegex)).toBe(false);
    expect(isHeading('    ', autoRegex)).toBe(false);
  });

  it('以句号结尾的行即使匹配也判为非标题', () => {
    expect(isHeading('第一章 结束了。', autoRegex)).toBe(false);
  });

  it('超过 60 个字符的行不当作标题', () => {
    const long = `第一章 ${'很'.repeat(60)}`;
    expect(long.length).toBeGreaterThan(60);
    expect(isHeading(long, autoRegex)).toBe(false);
  });
});

describe('buildChapters', () => {
  it('没有标题时退化成「全文」一章', () => {
    const result = buildChapters([{ text: '正文一', blank: false }]);
    expect(result.hasHeadings).toBe(false);
    expect(result.chapters).toEqual([{ title: '全文', paraIndex: 0 }]);
    expect(result.headingIndexes).toEqual([]);
  });

  it('首个标题前有正文时插入「开篇」', () => {
    const paragraphs = [
      { text: '版权信息', blank: false },
      { text: '第一章 起点', blank: false },
      { text: '正文', blank: false },
      { text: '第二章 终点', blank: false },
    ];
    const result = buildChapters(paragraphs);
    expect(result.hasHeadings).toBe(true);
    expect(result.headingIndexes).toEqual([1, 3]);
    expect(result.chapters).toEqual([
      { title: '开篇', paraIndex: 0 },
      { title: '第一章 起点', paraIndex: 1 },
      { title: '第二章 终点', paraIndex: 3 },
    ]);
  });

  it('首个标题就是第 0 段时不插入「开篇」', () => {
    const paragraphs = [
      { text: '第一章 起点', blank: false },
      { text: '正文', blank: false },
    ];
    const result = buildChapters(paragraphs);
    expect(result.chapters[0]).toEqual({ title: '第一章 起点', paraIndex: 0 });
    expect(result.chapters).toHaveLength(1);
  });

  it('标题外层的【】会被清掉', () => {
    const result = buildChapters([{ text: '【第一卷】', blank: false }]);
    expect(result.chapters[0].title).toBe('第一卷');
  });

  it('自定义正则生效', () => {
    const paragraphs = [
      { text: '## 自定义标题', blank: false },
      { text: '正文', blank: false },
    ];
    const result = buildChapters(paragraphs, '^##\\s+');
    expect(result.hasHeadings).toBe(true);
    expect(result.chapters.map((c) => c.paraIndex)).toEqual([0]);
  });

  it('自定义正则非法时回落到内置规则', () => {
    const paragraphs = [{ text: '第一章 起点', blank: false }];
    const result = buildChapters(paragraphs, '([');
    expect(result.hasHeadings).toBe(true);
  });
});

describe('chapterIndexForPara', () => {
  const chapters = [
    { title: '开篇', paraIndex: 0 },
    { title: '第一章', paraIndex: 5 },
    { title: '第二章', paraIndex: 9 },
  ];

  it('段落在章节起点时返回该章', () => {
    expect(chapterIndexForPara(chapters, 5)).toBe(1);
  });

  it('段落在两章之间时返回上一章', () => {
    expect(chapterIndexForPara(chapters, 4)).toBe(0);
    expect(chapterIndexForPara(chapters, 8)).toBe(1);
  });

  it('超出最后一章时仍返回最后一章', () => {
    expect(chapterIndexForPara(chapters, 999)).toBe(2);
  });

  it('空章节表返回 0', () => {
    expect(chapterIndexForPara([], 10)).toBe(0);
  });

  it('第 0 段返回 0', () => {
    expect(chapterIndexForPara(chapters, 0)).toBe(0);
  });
});

describe('parseBook', () => {
  it('统计段落、章节与字符数', () => {
    const content = '第一章 起风了\n\n正文第一段。\n\n第二章 落雨\n\n正文第二段。';
    const parsed = parseBook(content);
    expect(parsed.paragraphs.map((p) => p.text)).toEqual([
      '第一章 起风了',
      '',
      '正文第一段。',
      '',
      '第二章 落雨',
      '',
      '正文第二段。',
    ]);
    expect(parsed.chapters).toEqual([
      { title: '第一章 起风了', paraIndex: 0 },
      { title: '第二章 落雨', paraIndex: 4 },
    ]);
    expect(parsed.hasHeadings).toBe(true);
    expect(parsed.headingIndexes).toEqual([0, 4]);
    expect(parsed.charCount).toBe(content.length);
  });

  it('中文字符按字计数，英文按词计数', () => {
    expect(parseBook('中文字').wordCount).toBe(3);
    expect(parseBook('hello world').wordCount).toBe(2);
    expect(parseBook('你好 world').wordCount).toBe(3);
  });

  it('标点与空白不计入词数', () => {
    expect(parseBook('，。！\n  \t').wordCount).toBe(0);
  });

  it('BOM 与 CRLF 不会破坏首章识别', () => {
    const parsed = parseBook('\uFEFF第一章 起风了\r\n正文');
    expect(parsed.hasHeadings).toBe(true);
    expect(parsed.chapters[0].paraIndex).toBe(0);
  });
});

describe('parseBookCached', () => {
  it('相同内容 + 键命中缓存，返回同一个对象', () => {
    const a = parseBookCached('第一章 甲\n正文', '', 'book-1');
    const b = parseBookCached('第一章 甲\n正文', '', 'book-1');
    expect(b).toBe(a);
  });

  it('内容不同则重新解析', () => {
    const a = parseBookCached('第一章 甲\n正文', '', 'book-2');
    const b = parseBookCached('第一章 乙\n正文多几个字', '', 'book-2');
    expect(b).not.toBe(a);
    expect(b.chapters[0].title).toBe('第一章 乙');
  });

  it('cacheKey 不同则各自缓存', () => {
    const a = parseBookCached('第一章 甲', '', 'book-a');
    const b = parseBookCached('第一章 甲', '', 'book-b');
    expect(b).not.toBe(a);
  });

  it('空内容也能解析', () => {
    const parsed = parseBookCached('', '', 'empty');
    expect(parsed.paragraphs).toEqual([]);
    expect(parsed.chapters).toEqual([{ title: '全文', paraIndex: 0 }]);
  });
});
