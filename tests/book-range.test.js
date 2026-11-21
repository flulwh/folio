import { describe, it, expect } from 'vitest';
import { MAX_RANGE_BYTES, normalizeRange } from '../electron/bookrange.js';

/**
 * EPUB / PDF 分段读取的范围计算：
 * 合法请求原样返回；越界截到 EOF；非法输入给中文错误，不让主进程去读越界内存。
 */
describe('normalizeRange', () => {
  it('返回请求的偏移与长度', () => {
    expect(normalizeRange(1000, 10, 100)).toEqual({ offset: 10, length: 100 });
  });

  it('超出文件末尾时截到 EOF', () => {
    expect(normalizeRange(1000, 950, 200)).toEqual({ offset: 950, length: 50 });
  });

  it('偏移正好等于大小视为越界', () => {
    expect(normalizeRange(1000, 1000, 10).error).toBeTruthy();
  });

  it('偏移为负或不是整数时报错', () => {
    expect(normalizeRange(1000, -1, 10).error).toBeTruthy();
    expect(normalizeRange(1000, 1.5, 10).error).toBeTruthy();
    expect(normalizeRange(1000, 'x', 10).error).toBeTruthy();
  });

  it('长度为 0、负数或不是数字时报错', () => {
    expect(normalizeRange(1000, 0, 0).error).toBeTruthy();
    expect(normalizeRange(1000, 0, -5).error).toBeTruthy();
    expect(normalizeRange(1000, 0, Number.NaN).error).toBeTruthy();
  });

  it('单次读取不超过上限', () => {
    const range = normalizeRange(MAX_RANGE_BYTES * 2, 0, MAX_RANGE_BYTES * 2);
    expect(range).toEqual({ offset: 0, length: MAX_RANGE_BYTES });
  });

  it('文件大小不合法时报错', () => {
    expect(normalizeRange(-1, 0, 10).error).toBeTruthy();
    expect(normalizeRange(Number.NaN, 0, 10).error).toBeTruthy();
  });
});
