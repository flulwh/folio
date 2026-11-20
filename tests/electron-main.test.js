import { describe, it, expect } from 'vitest';
import { loadPrivateFunctions } from './helpers/source.mjs';

// main.js 顶层有 app.whenReady() 等 Electron 副作用，不能直接 import；
// 这里从源码中取出纯函数在隔离上下文里执行。
const { decodeText, isProbablyBinary } = loadPrivateFunctions(
  'electron/main.js',
  ['decodeText', 'isProbablyBinary'],
  ['hasUtf16Bom'],
);

const utf8 = (text) => Buffer.from(text, 'utf8');

describe('decodeText', () => {
  it('UTF-8 BOM 被剥掉', () => {
    expect(decodeText(Buffer.from([0xef, 0xbb, 0xbf, ...utf8('正文')]))).toBe('正文');
  });

  it('UTF-16LE BOM 正确解码（Windows 记事本「Unicode」）', () => {
    expect(decodeText(Buffer.from([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65]))).toBe('中文');
  });

  it('UTF-16BE BOM 正确解码', () => {
    expect(decodeText(Buffer.from([0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87]))).toBe('中文');
  });

  it('不带 BOM 的 UTF-8 正常解码', () => {
    expect(decodeText(utf8('第一章 起风了'))).toBe('第一章 起风了');
  });

  it('非法 UTF-8 回落到 GBK', () => {
    expect(decodeText(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]))).toBe('中文');
  });

  it('空 buffer 返回空串', () => {
    expect(decodeText(Buffer.alloc(0))).toBe('');
  });

  it('纯 ASCII 原样返回', () => {
    expect(decodeText(utf8('hello world'))).toBe('hello world');
  });

  it('只有 BOM 时返回空串', () => {
    expect(decodeText(Buffer.from([0xef, 0xbb, 0xbf]))).toBe('');
  });
});

describe('isProbablyBinary', () => {
  it('带 UTF-16LE BOM 的文本放行', () => {
    expect(isProbablyBinary(Buffer.from([0xff, 0xfe, 0x2d, 0x4e]))).toBe(false);
  });

  it('带 UTF-16BE BOM 的文本放行', () => {
    expect(isProbablyBinary(Buffer.from([0xfe, 0xff, 0x4e, 0x2d]))).toBe(false);
  });

  it('ZIP / EPUB 魔数判为二进制', () => {
    expect(isProbablyBinary(Buffer.from('PK\u0003\u0004rest', 'latin1'))).toBe(true);
  });

  it('普通中文文本不是二进制', () => {
    expect(isProbablyBinary(utf8('第一章 起风了\n正文\n'))).toBe(false);
  });

  it('制表符与换行不算控制字节', () => {
    expect(isProbablyBinary(utf8('\t\r\n hello\tworld\n'))).toBe(false);
  });

  it('控制字节占比超过 5% 判为二进制', () => {
    const buf = Buffer.alloc(100, 0x01);
    expect(isProbablyBinary(buf)).toBe(true);
  });

  it('控制字节占比恰好不超过 5% 时放行', () => {
    const buf = Buffer.alloc(100, 0x41);
    for (let i = 0; i < 5; i += 1) buf[i] = 0x01;
    expect(isProbablyBinary(buf)).toBe(false);
  });

  it('空 buffer 不是二进制', () => {
    expect(isProbablyBinary(Buffer.alloc(0))).toBe(false);
  });

  it('长度恰好 4 的 PK 头仍被控制字节启发式拦下', () => {
    // 魔数分支要求 length > 4；这条 4 字节头靠 0x03/0x04 的控制字节比例判为二进制。
    expect(isProbablyBinary(Buffer.from('PK\u0003\u0004', 'latin1'))).toBe(true);
  });

  it('无 BOM 的 UTF-16 会被判成二进制（已知限制）', () => {
    expect(isProbablyBinary(Buffer.from([0x2d, 0x00, 0x4e, 0x00, 0x87, 0x00]))).toBe(true);
  });

  it('只扫描前 4096 字节', () => {
    const buf = Buffer.alloc(8192, 0x41);
    // 把控制字节放在 4096 之后，不应影响判定
    for (let i = 4096; i < 8192; i += 1) buf[i] = 0x01;
    expect(isProbablyBinary(buf)).toBe(false);
  });
});
