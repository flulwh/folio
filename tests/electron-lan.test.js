import { describe, it, expect } from 'vitest';
import { mergeProgress, mergeProgressEntry } from '../electron/lan.js';
import { loadPrivateFunctions } from './helpers/source.mjs';

const { parseRangeHeader, parseOffsetHeader } = loadPrivateFunctions('electron/lan.js', [
  'parseRangeHeader',
  'parseOffsetHeader',
]);

describe('mergeProgressEntry', () => {
  it('对端更新更晚时整条替换（浅合并）', () => {
    const current = { updatedAt: 100, paraIndex: 3 };
    expect(mergeProgressEntry(current, { updatedAt: 200, paraIndex: 9 })).toEqual({
      updatedAt: 200,
      paraIndex: 9,
    });
  });

  it('对端更旧时保留本地', () => {
    const current = { updatedAt: 200, paraIndex: 9 };
    expect(mergeProgressEntry(current, { updatedAt: 100, paraIndex: 1 })).toBe(current);
  });

  it('时间相同视为对端不旧，接受并合并', () => {
    expect(mergeProgressEntry({ updatedAt: 5, a: 1 }, { updatedAt: 5, b: 2 })).toEqual({
      updatedAt: 5,
      a: 1,
      b: 2,
    });
  });

  it('缺 updatedAt 时按 0 处理', () => {
    expect(mergeProgressEntry({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it('对端非法时原样返回本地', () => {
    const current = { updatedAt: 1 };
    expect(mergeProgressEntry(current, null)).toBe(current);
    expect(mergeProgressEntry(current, 'bad')).toBe(current);
  });

  it('本地为空时返回对端副本（不共享引用）', () => {
    const incoming = { updatedAt: 1, paraIndex: 2 };
    const merged = mergeProgressEntry(null, incoming);
    expect(merged).toEqual(incoming);
    expect(merged).not.toBe(incoming);
  });

  it('两边都为空时返回 null', () => {
    expect(mergeProgressEntry(null, null)).toBeNull();
  });
});

describe('mergeProgress', () => {
  it('合并更新的条目并标记 changed', () => {
    const current = { a: { updatedAt: 1, paraIndex: 1 } };
    const { progress, changed } = mergeProgress(current, { a: { updatedAt: 2, paraIndex: 5 } });
    expect(changed).toBe(true);
    expect(progress.a.paraIndex).toBe(5);
  });

  it('对端更旧时不改动、不落盘', () => {
    const current = { a: { updatedAt: 9, paraIndex: 9 } };
    const result = mergeProgress(current, { a: { updatedAt: 1 } });
    expect(result.changed).toBe(false);
    expect(result.progress).toBe(current);
  });

  it('内容完全相同时 changed 为 false', () => {
    const current = { a: { updatedAt: 9, paraIndex: 9 } };
    const result = mergeProgress(current, { a: { updatedAt: 9, paraIndex: 9 } });
    expect(result.changed).toBe(false);
  });

  it('新增书目会被合并进去', () => {
    const result = mergeProgress({}, { b: { updatedAt: 1 } });
    expect(result.changed).toBe(true);
    expect(result.progress).toEqual({ b: { updatedAt: 1 } });
  });

  it('浅合并保留本地独有的字段', () => {
    const current = { a: { updatedAt: 1, windowBase: 10 } };
    const { progress } = mergeProgress(current, { a: { updatedAt: 2, paraIndex: 3 } });
    expect(progress.a).toEqual({ updatedAt: 2, windowBase: 10, paraIndex: 3 });
  });

  it('空/非法入参安全', () => {
    expect(mergeProgress(null, null)).toEqual({ progress: {}, changed: false });
    expect(mergeProgress('x', 'y')).toEqual({ progress: {}, changed: false });
    expect(mergeProgress({ a: { updatedAt: 1 } }, { b: null })).toEqual({
      progress: { a: { updatedAt: 1 } },
      changed: false,
    });
  });

  it('不修改传入的当前对象', () => {
    const current = { a: { updatedAt: 1 } };
    mergeProgress(current, { a: { updatedAt: 2 } });
    expect(current.a.updatedAt).toBe(1);
  });
});

describe('parseRangeHeader', () => {
  it('没有 Range 头返回 null', () => {
    expect(parseRangeHeader(undefined)).toBeNull();
    expect(parseRangeHeader('')).toBeNull();
    expect(parseRangeHeader('   ')).toBeNull();
  });

  it('bytes=N- 解析为开区间', () => {
    expect(parseRangeHeader('bytes=0-')).toEqual({ ok: true, from: 0, to: null });
    expect(parseRangeHeader('bytes=1024-')).toEqual({ ok: true, from: 1024, to: null });
  });

  it('bytes=N-M 解析为闭区间', () => {
    expect(parseRangeHeader('bytes=10-99')).toEqual({ ok: true, from: 10, to: 99 });
  });

  it('起止相等是合法区间', () => {
    expect(parseRangeHeader('bytes=5-5')).toEqual({ ok: true, from: 5, to: 5 });
  });

  it('结束小于开始判非法', () => {
    expect(parseRangeHeader('bytes=5-4')).toEqual({ ok: false });
  });

  it('不支持后缀区间与多区间', () => {
    expect(parseRangeHeader('bytes=-5')).toEqual({ ok: false });
    expect(parseRangeHeader('bytes=0-1,3-4')).toEqual({ ok: false });
  });

  it('单位或格式不对判非法', () => {
    expect(parseRangeHeader('items=0-1')).toEqual({ ok: false });
    expect(parseRangeHeader('bytes=abc-')).toEqual({ ok: false });
    expect(parseRangeHeader('bytes=0-abc')).toEqual({ ok: false });
  });

  it('单位大小写敏感', () => {
    expect(parseRangeHeader('Bytes=3-')).toEqual({ ok: false });
  });
});

describe('parseOffsetHeader', () => {
  it('缺失或空值判非法（不能默认成 0）', () => {
    expect(parseOffsetHeader(undefined, 100)).toEqual({
      ok: false,
      message: '缺少 X-Folio-Offset 头',
    });
    expect(parseOffsetHeader(null, 100)).toEqual({
      ok: false,
      message: '缺少 X-Folio-Offset 头',
    });
    expect(parseOffsetHeader('', 100)).toEqual({ ok: false, message: 'X-Folio-Offset 不能为空' });
    expect(parseOffsetHeader('   ', 100)).toEqual({
      ok: false,
      message: 'X-Folio-Offset 不能为空',
    });
  });

  it('重复头（数组）判非法', () => {
    expect(parseOffsetHeader(['1', '2'], 100)).toEqual({
      ok: false,
      message: 'X-Folio-Offset 只能有一个值',
    });
  });

  it('合法整数原样返回', () => {
    expect(parseOffsetHeader('0', 100)).toEqual({ ok: true, value: 0 });
    expect(parseOffsetHeader('42', 100)).toEqual({ ok: true, value: 42 });
    expect(parseOffsetHeader(' 42 ', 100)).toEqual({ ok: true, value: 42 });
  });

  it('等于文件总大小是合法的（表示已传完）', () => {
    expect(parseOffsetHeader('100', 100)).toEqual({ ok: true, value: 100 });
  });

  it('超过文件总大小判非法', () => {
    expect(parseOffsetHeader('101', 100)).toEqual({
      ok: false,
      message: 'X-Folio-Offset 超出了文件总大小',
    });
  });

  it('负数判非法', () => {
    expect(parseOffsetHeader('-1', 100)).toEqual({
      ok: false,
      message: 'X-Folio-Offset 不能是负数',
    });
  });

  it('小数与非数字判非法（不会像 parseInt 那样截断）', () => {
    expect(parseOffsetHeader('1.5', 100)).toEqual({
      ok: false,
      message: 'X-Folio-Offset 必须是整数',
    });
    expect(parseOffsetHeader('12abc', 100)).toEqual({
      ok: false,
      message: 'X-Folio-Offset 必须是整数',
    });
    expect(parseOffsetHeader('abc', 100)).toEqual({
      ok: false,
      message: 'X-Folio-Offset 必须是整数',
    });
  });

  it('total 非法时跳过上界检查', () => {
    expect(parseOffsetHeader('9999', undefined)).toEqual({ ok: true, value: 9999 });
    expect(parseOffsetHeader('9999', NaN)).toEqual({ ok: true, value: 9999 });
  });
});
