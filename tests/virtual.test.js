import { describe, it, expect } from 'vitest';
import { clampIndex, indexAtOffset, indexAtScrollTop, offsetOfIndex } from '../src/utils/virtual.js';

/** 构造前缀偏移表：heights 是每段高度，末尾补总高哨兵。 */
function table(heights) {
  const offsets = new Float64Array(heights.length + 1);
  let acc = 0;
  for (let i = 0; i < heights.length; i += 1) {
    offsets[i] = acc;
    acc += heights[i];
  }
  offsets[heights.length] = acc;
  return offsets;
}

describe('indexAtOffset', () => {
  it('等高段落（含空行）按偏移取段', () => {
    // 空行也被赋成固定高度，整本书是等高表
    const offsets = table([100, 100, 100, 100, 100]);
    expect(indexAtOffset(offsets, 5, 0)).toBe(0);
    expect(indexAtOffset(offsets, 5, 98)).toBe(0);
    expect(indexAtOffset(offsets, 5, 100)).toBe(1);
    expect(indexAtOffset(offsets, 5, 250)).toBe(2);
    expect(indexAtOffset(offsets, 5, 499)).toBe(4);
  });

  it('高度突变（超长段落）时偏移落在该段内部仍指向它', () => {
    const offsets = table([50, 1200, 60, 40]);
    expect(indexAtOffset(offsets, 4, 20)).toBe(0);
    expect(indexAtOffset(offsets, 4, 500)).toBe(1);
    expect(indexAtOffset(offsets, 4, 1240)).toBe(1);
    expect(indexAtOffset(offsets, 4, 1260)).toBe(2);
  });

  it('小数 scrollTop 在边界下方不误判成上一段', () => {
    const offsets = table([100, 100, 100]);
    expect(indexAtOffset(offsets, 3, 100.4)).toBe(1);
    // 边界上方超过容差时才归到上一段
    expect(indexAtOffset(offsets, 3, 98.5)).toBe(0);
  });

  it('尾部哨兵不参与探测（偏移超出总高时停在最后一段）', () => {
    const offsets = table([100, 100, 100]);
    expect(indexAtOffset(offsets, 3, 99999)).toBe(2);
    expect(indexAtOffset(offsets, 3, offsets[2])).toBe(2);
  });

  it('空表或非正 count 返回 0', () => {
    expect(indexAtOffset(new Float64Array(1), 0, 123)).toBe(0);
  });
});

describe('indexAtScrollTop（窗口 origin 非零）', () => {
  it('物理 scrollTop 需要加上 origin 才是逻辑偏移', () => {
    const offsets = table([100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
    // origin 1000 时，scrollTop 0 对应逻辑 1000 → 第 10 段
    expect(indexAtScrollTop(offsets, 10, 0, 1000)).toBe(9);
    // scrollTop 50 → 逻辑 1050 → 仍然在第 10 段内
    expect(indexAtScrollTop(offsets, 10, 50, 1000)).toBe(9);
    // 换一个窗口：origin 0、scrollTop 450 → 第 5 段
    expect(indexAtScrollTop(offsets, 10, 450, 0)).toBe(4);
  });

  it('origin 非零时负数/缺失参数按 0 处理', () => {
    const offsets = table([100, 100, 100]);
    expect(indexAtScrollTop(offsets, 3, -20)).toBe(0);
    expect(indexAtScrollTop(offsets, 3, 250, undefined)).toBe(2);
  });
});

describe('offsetOfIndex', () => {
  it('目标在末尾返回最后一段的顶部偏移，而不是总高哨兵', () => {
    const offsets = table([100, 100, 100, 100]);
    expect(offsetOfIndex(offsets, 3, 4)).toBe(300);
    expect(offsetOfIndex(offsets, 3, 4)).not.toBe(offsets[4]);
  });

  it('目标越界时夹到合法范围', () => {
    const offsets = table([100, 100, 100]);
    expect(offsetOfIndex(offsets, 99, 3)).toBe(200);
    expect(offsetOfIndex(offsets, -7, 3)).toBe(0);
    expect(offsetOfIndex(offsets, Number.NaN, 3)).toBe(0);
    expect(offsetOfIndex(offsets, 1, 0)).toBe(0);
  });
});

describe('clampIndex', () => {
  it('与高度表口径一致地夹取索引', () => {
    expect(clampIndex(5, 4)).toBe(3);
    expect(clampIndex(-1, 4)).toBe(0);
    expect(clampIndex(2, 4)).toBe(2);
    expect(clampIndex(2, 0)).toBe(0);
  });
});
