import { describe, it, expect } from 'vitest';
import { isInside, isInsideOrEqual, samePath } from '../electron/paths.js';

const win = process.platform === 'win32';
const join = (...parts) => parts.join(win ? '\\' : '/');
const root = win ? 'C:\\library' : '/library';

describe('isInside', () => {
  it('根目录下的文件算在内', () => {
    expect(isInside(root, join(root, 'books', 'a.txt'))).toBe(true);
  });

  it('根目录本身不算在内', () => {
    expect(isInside(root, root)).toBe(false);
  });

  it('前缀相同的相邻目录不算在内', () => {
    const sibling = win ? 'C:\\library-evil\\a.txt' : '/library-evil/a.txt';
    expect(isInside(root, sibling)).toBe(false);
  });

  it('越界的 .. 路径不算在内', () => {
    expect(isInside(root, join(root, '..', 'secret.txt'))).toBe(false);
  });

  it('父目录不算在内', () => {
    expect(isInside(join(root, 'books'), root)).toBe(false);
  });

  it('空参数不会抛异常', () => {
    expect(isInside('', '')).toBe(false);
    expect(typeof isInside(undefined, undefined)).toBe('boolean');
  });

  it('Windows 下盘符大小写不影响判定', () => {
    if (!win) return;
    expect(isInside('C:\\Library', 'c:\\library\\a.txt')).toBe(true);
  });

  it('路径分隔符混用也能正确解析', () => {
    if (!win) return;
    expect(isInside('C:/library', 'C:\\library\\a.txt')).toBe(true);
  });
});

describe('isInsideOrEqual', () => {
  it('等于根目录算在内', () => {
    expect(isInsideOrEqual(root, root)).toBe(true);
  });

  it('子路径算在内', () => {
    expect(isInsideOrEqual(root, join(root, 'a.txt'))).toBe(true);
  });

  it('越界路径不算在内', () => {
    expect(isInsideOrEqual(root, join(root, '..', 'x'))).toBe(false);
  });

  it('Windows 下大小写不同仍算相等', () => {
    if (!win) return;
    expect(isInsideOrEqual('C:\\Library', 'c:\\library')).toBe(true);
  });
});

describe('samePath', () => {
  it('解析后相同的路径返回 true', () => {
    expect(samePath(join(root, 'a.txt'), join(root, 'a.txt'))).toBe(true);
    expect(samePath(join(root, 'sub', '..', 'a.txt'), join(root, 'a.txt'))).toBe(true);
  });

  it('不同路径返回 false', () => {
    expect(samePath(join(root, 'a.txt'), join(root, 'b.txt'))).toBe(false);
  });

  it('空值返回 false', () => {
    expect(samePath('', root)).toBe(false);
    expect(samePath(root, null)).toBe(false);
  });

  it('Windows 下忽略大小写', () => {
    if (!win) return;
    expect(samePath('C:\\Library\\A.TXT', 'c:\\library\\a.txt')).toBe(true);
  });
});
