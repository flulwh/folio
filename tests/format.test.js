import { describe, it, expect } from 'vitest';
import {
  formatPercent,
  formatCount,
  formatDate,
  estimateRemainingMinutes,
  clamp,
  decodeBuffer,
  isProbablyTextFile,
} from '../src/utils/format.js';

describe('formatPercent', () => {
  it('非正数与非法值都返回 0%', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(-5)).toBe('0%');
    expect(formatPercent(NaN)).toBe('0%');
    expect(formatPercent(Infinity)).toBe('0%');
  });

  it('保留一位小数', () => {
    expect(formatPercent(12.34)).toBe('12.3%');
    expect(formatPercent(12.36)).toBe('12.4%');
    expect(formatPercent(1)).toBe('1%');
  });

  it('接近完成时向上收敛到 100%', () => {
    expect(formatPercent(99.95)).toBe('100%');
    expect(formatPercent(99.949)).toBe('99.9%');
  });
});

describe('formatCount', () => {
  it('小于一万返回原数字字符串', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(9999)).toBe('9999');
  });

  it('负数与非数字返回 0', () => {
    expect(formatCount(-1)).toBe('0');
    expect(formatCount(null)).toBe('0');
    expect(formatCount(undefined)).toBe('0');
  });

  it('万级保留一位小数', () => {
    expect(formatCount(10000)).toBe('1.0万');
    expect(formatCount(12345)).toBe('1.2万');
  });

  it('亿级保留一位小数', () => {
    expect(formatCount(100000000)).toBe('1.0亿');
    expect(formatCount(250000000)).toBe('2.5亿');
  });
});

describe('formatDate', () => {
  const now = Date.now();

  it('空值返回空串', () => {
    expect(formatDate(0)).toBe('');
    expect(formatDate(null)).toBe('');
  });

  it('一分钟内显示刚刚', () => {
    expect(formatDate(now - 5 * 1000)).toBe('刚刚');
  });

  it('一小时内显示分钟前', () => {
    expect(formatDate(now - 5 * 60 * 1000)).toBe('5 分钟前');
  });

  it('一天内显示小时前', () => {
    expect(formatDate(now - 3 * 60 * 60 * 1000)).toBe('3 小时前');
  });

  it('一周内显示天前', () => {
    expect(formatDate(now - 2 * 24 * 60 * 60 * 1000)).toBe('2 天前');
  });

  it('超过一周显示本地日期', () => {
    const ts = now - 30 * 24 * 60 * 60 * 1000;
    const d = new Date(ts);
    expect(formatDate(ts)).toBe(`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`);
  });
});

describe('estimateRemainingMinutes', () => {
  it('不足一分钟', () => {
    expect(estimateRemainingMinutes(0)).toBe('不到 1 分钟');
    expect(estimateRemainingMinutes(100)).toBe('不到 1 分钟');
    expect(estimateRemainingMinutes(-100)).toBe('不到 1 分钟');
  });

  it('分钟级四舍五入', () => {
    expect(estimateRemainingMinutes(420)).toBe('约 1 分钟');
    expect(estimateRemainingMinutes(420 * 30)).toBe('约 30 分钟');
  });

  it('超过一小时带小时与分钟', () => {
    expect(estimateRemainingMinutes(420 * 90)).toBe('约 1 小时 30 分钟');
  });

  it('整小时不显示 0 分钟', () => {
    expect(estimateRemainingMinutes(420 * 60)).toBe('约 1 小时');
  });

  it('可以自定义阅读速度', () => {
    expect(estimateRemainingMinutes(100, 100)).toBe('约 1 分钟');
  });
});

describe('clamp', () => {
  it('范围内原样返回', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('低于下限取最小值', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('高于上限取最大值', () => {
    expect(clamp(50, 0, 10)).toBe(10);
  });

  it('非法值按 NaN 传播（与 Math.min/max 一致）', () => {
    expect(Number.isNaN(clamp(NaN, 0, 10))).toBe(true);
  });
});

describe('decodeBuffer', () => {
  const utf8 = (text) => new TextEncoder().encode(text);

  it('UTF-8 BOM 被剥掉', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('正文')]);
    expect(decodeBuffer(bytes.buffer)).toBe('正文');
  });

  it('UTF-16LE BOM 正确解码', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65]);
    expect(decodeBuffer(bytes.buffer)).toBe('中文');
  });

  it('UTF-16BE BOM 正确解码', () => {
    const bytes = new Uint8Array([0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87]);
    expect(decodeBuffer(bytes.buffer)).toBe('中文');
  });

  it('不带 BOM 的合法 UTF-8 直接解', () => {
    expect(decodeBuffer(utf8('hello 世界').buffer)).toBe('hello 世界');
  });

  it('非法 UTF-8 回落到 GBK', () => {
    const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);
    expect(decodeBuffer(gbk.buffer)).toBe('中文');
  });

  it('空 buffer 返回空串', () => {
    expect(decodeBuffer(new ArrayBuffer(0))).toBe('');
  });
});

describe('isProbablyTextFile', () => {
  it('常见文本后缀返回 true（大小写不敏感）', () => {
    expect(isProbablyTextFile('book.txt')).toBe(true);
    expect(isProbablyTextFile('BOOK.TXT')).toBe(true);
    expect(isProbablyTextFile('note.md')).toBe(true);
    expect(isProbablyTextFile('readme.markdown')).toBe(true);
    expect(isProbablyTextFile('a.text')).toBe(true);
  });

  it('其它后缀返回 false', () => {
    expect(isProbablyTextFile('book.pdf')).toBe(false);
    expect(isProbablyTextFile('book.epub')).toBe(false);
    expect(isProbablyTextFile('txt')).toBe(false);
  });
});
