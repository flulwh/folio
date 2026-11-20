import { describe, it, expect } from 'vitest';
import { sortedIndexFrom, sortedLastIndex } from '../src/utils/sortedIndex.js';

describe('sortedIndexFrom', () => {
  it('在有序数组里找到第一个 >= 值的位置', () => {
    expect(sortedIndexFrom([1, 3, 5, 7], 5, 0, 4)).toBe(2);
    expect(sortedIndexFrom([1, 3, 5, 7], 4, 0, 4)).toBe(2);
  });

  it('比所有值都大时返回 end', () => {
    expect(sortedIndexFrom([1, 2, 3], 99, 0, 3)).toBe(3);
  });

  it('比所有值都小时返回 start', () => {
    expect(sortedIndexFrom([10, 20, 30], 1, 0, 3)).toBe(0);
  });

  it('start/end 可以限制探测区间（忽略尾部哨兵）', () => {
    expect(sortedIndexFrom([1, 3, 5, 999], 4, 0, 3)).toBe(2);
    expect(sortedIndexFrom([1, 3, 5, 999], 4, 2, 3)).toBe(2);
  });

  it('空区间返回 start', () => {
    expect(sortedIndexFrom([1, 2, 3], 2, 1, 1)).toBe(1);
  });

  it('支持 getter 映射对象键', () => {
    const rows = [{ k: 1 }, { k: 4 }, { k: 9 }];
    expect(sortedIndexFrom(rows, 4, 0, 3, (r) => r.k)).toBe(1);
  });

  it('getter 返回 null 的记录不参与比较', () => {
    const rows = [{ k: null }, { k: 5 }];
    expect(sortedIndexFrom(rows, 1, 0, 2, (r) => r.k)).toBe(0);
  });
});

describe('sortedLastIndex', () => {
  it('返回第一个 > 值的位置（重复值取最后一个之后）', () => {
    expect(sortedLastIndex([1, 2, 2, 2, 3], 2)).toBe(4);
  });

  it('值比所有元素都大时返回 end', () => {
    expect(sortedLastIndex([1, 2, 3], 10)).toBe(3);
  });

  it('值比所有元素都小时返回 0', () => {
    expect(sortedLastIndex([1, 2, 3], 0)).toBe(0);
  });

  it('end 参数可以截断尾部', () => {
    expect(sortedLastIndex([1, 2, 3, 100], 50, 3)).toBe(3);
  });

  it('空数组返回 0', () => {
    expect(sortedLastIndex([], 5)).toBe(0);
  });

  it('支持 getter 映射对象键', () => {
    const chapters = [{ p: 0 }, { p: 5 }, { p: 9 }];
    expect(sortedLastIndex(chapters, 5, chapters.length, (c) => c.p)).toBe(2);
  });

  it('null 键不会被当作相等命中', () => {
    const rows = [{ k: null }, { k: 5 }];
    expect(sortedLastIndex(rows, 1, 2, (r) => r.k)).toBe(0);
  });
});
