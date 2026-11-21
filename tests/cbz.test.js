import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { comparePageName, forgetComic, mimeOf, pageCount, readPage } from '../electron/cbz.js';

/** 现场拼一个 ZIP：不依赖第三方库，store + deflate 都能测到。 */
function buildZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.data);
    const method = entry.method ?? 0;
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);

    const item = Buffer.alloc(46);
    item.writeUInt32LE(0x02014b50, 0);
    item.writeUInt16LE(20, 4);
    item.writeUInt16LE(20, 6);
    item.writeUInt16LE(method, 10);
    item.writeUInt32LE(body.length, 20);
    item.writeUInt32LE(raw.length, 24);
    item.writeUInt16LE(name.length, 28);
    item.writeUInt32LE(offset, 42);
    central.push(item, name);

    offset += 30 + name.length + body.length;
  }

  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, eocd]);
}

let workDir = null;

function writeCbz(buffer) {
  workDir ||= fs.mkdtempSync(path.join(os.tmpdir(), 'folio-cbz-'));
  const file = path.join(workDir, `comic-${Math.random().toString(16).slice(2)}.cbz`);
  fs.writeFileSync(file, buffer);
  return file;
}

afterEach(() => {
  if (workDir) {
    fs.rmSync(workDir, { recursive: true, force: true });
    workDir = null;
  }
});

describe('cbz reader', () => {
  it('只列图片，并按自然顺序排序', () => {
    const file = writeCbz(
      buildZip([
        { name: 'b/2.jpg', data: 'page-b2', method: 8 },
        { name: 'a/10.png', data: 'page-a10' },
        { name: 'a/2.webp', data: 'page-a2' },
        { name: '__MACOSX/._a.jpg', data: 'noise' },
        { name: 'readme.txt', data: 'not a page' },
        { name: 'a/', data: '' },
      ])
    );

    expect(pageCount(file)).toBe(3);
    expect(readPage(file, 0)).toMatchObject({ name: 'a/2.webp', type: 'image/webp' });
    expect(readPage(file, 1)).toMatchObject({ name: 'a/10.png', type: 'image/png' });
    expect(readPage(file, 2)).toMatchObject({ name: 'b/2.jpg', type: 'image/jpeg' });
  });

  it('store 与 deflate 都能还原原始字节', () => {
    const file = writeCbz(
      buildZip([
        { name: '001.jpg', data: Buffer.from('stored-bytes'), method: 0 },
        { name: '002.jpg', data: Buffer.from('deflated-bytes'.repeat(64)), method: 8 },
      ])
    );

    expect(readPage(file, 0)?.buffer.toString()).toBe('stored-bytes');
    expect(readPage(file, 1)?.buffer.toString()).toBe('deflated-bytes'.repeat(64));
  });

  it('越界返回 null，重新导入后缓存失效', () => {
    const first = writeCbz(buildZip([{ name: '1.jpg', data: 'one' }]));
    expect(readPage(first, 1)).toBeNull();

    fs.writeFileSync(
      first,
      buildZip([
        { name: '1.jpg', data: 'one' },
        { name: '2.jpg', data: 'two' },
      ])
    );
    // 同一路径、mtime 变了，必须重新扫中央目录
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(first, later, later);
    expect(pageCount(first)).toBe(2);
  });

  it('MIME 兜底', () => {
    expect(mimeOf('x.PNG')).toBe('image/png');
    expect(mimeOf('unknown.bin')).toBe('image/jpeg');
  });

  it('ZIP64 目录与 64 位条目字段', () => {
    const file = writeCbz(buildZip64([{ name: '1.jpg', data: 'zip64-page' }]));
    expect(pageCount(file)).toBe(1);
    expect(readPage(file, 0)?.buffer.toString()).toBe('zip64-page');
  });

  it('删书后清缓存，同路径重新导入能读到新页数', () => {
    // 两次内容字节数相同（只是把 txt 换成同名长的第二张图），再把 mtime 固定到整秒：
    // 缓存 key（size + mtimeMs）才可能不变，用来验证 forgetComic 真的清了缓存。
    const file = writeCbz(buildZip([
      { name: '1.jpg', data: 'one' },
      { name: 'x.txt', data: 'two' },
    ]));
    fs.utimesSync(file, 1700000000, 1700000000);
    expect(pageCount(file)).toBe(1);
    fs.writeFileSync(file, buildZip([
      { name: '1.jpg', data: 'one' },
      { name: '2.jpg', data: 'two' },
    ]));
    fs.utimesSync(file, 1700000000, 1700000000);
    expect(pageCount(file)).toBe(1);
    forgetComic(file);
    expect(pageCount(file)).toBe(2);
  });
});

describe('页名自然顺序（与安卓端同一套规则）', () => {
  const sortNames = (names) => [...names].sort(comparePageName);

  it('数字段按数值而不是字典序', () => {
    expect(sortNames(['10.jpg', '2.jpg', '1.jpg'])).toEqual(['1.jpg', '2.jpg', '10.jpg']);
  });

  it('中文数字与标点按码位比较', () => {
    expect(sortNames(['第10话.png', '第2话.png'])).toEqual(['第2话.png', '第10话.png']);
    // 空格（0x20）< 连字符（0x2D）< 点（0x2E）：'A.jpg' 的第二段是 '.'，排在两段式的后面
    expect(sortNames(['a-b.jpg', 'a b.jpg', 'A.jpg'])).toEqual(['a b.jpg', 'a-b.jpg', 'A.jpg']);
  });

  it('忽略大小写后相同用原名兜底', () => {
    expect(sortNames(['b.JPG', 'a.jpg', 'A.jpg'])).toEqual(['A.jpg', 'a.jpg', 'b.JPG']);
  });
});

/** 强制使用 ZIP64：中央目录条目与 EOCD 的 32 位字段全部写成 0xffffffff。 */
function buildZip64(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = Buffer.from(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(45, 4);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, body);

    const extra = Buffer.alloc(28);
    extra.writeUInt16LE(0x0001, 0);
    extra.writeUInt16LE(24, 2);
    extra.writeBigUInt64LE(BigInt(body.length), 4);
    extra.writeBigUInt64LE(BigInt(body.length), 12);
    extra.writeBigUInt64LE(BigInt(offset), 20);

    const item = Buffer.alloc(46);
    item.writeUInt32LE(0x02014b50, 0);
    item.writeUInt16LE(45, 4);
    item.writeUInt16LE(45, 6);
    item.writeUInt32LE(0, 10);
    item.writeUInt32LE(0xffffffff, 20);
    item.writeUInt32LE(0xffffffff, 24);
    item.writeUInt16LE(nameBuf.length, 28);
    item.writeUInt16LE(extra.length, 30);
    item.writeUInt32LE(0xffffffff, 42);
    central.push(item, nameBuf, extra);

    offset += local.length + nameBuf.length + body.length;
  }

  const directory = Buffer.concat(central);
  const centralStart = offset;
  const record = Buffer.alloc(56);
  record.writeUInt32LE(0x06064b50, 0);
  record.writeBigUInt64LE(44n, 4);
  record.writeUInt16LE(45, 12);
  record.writeUInt16LE(45, 14);
  record.writeBigUInt64LE(BigInt(entries.length), 24);
  record.writeBigUInt64LE(BigInt(entries.length), 32);
  record.writeBigUInt64LE(BigInt(directory.length), 40);
  record.writeBigUInt64LE(BigInt(centralStart), 48);

  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(centralStart + directory.length), 8);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0xffff, 8);
  eocd.writeUInt16LE(0xffff, 10);
  eocd.writeUInt32LE(0xffffffff, 12);
  eocd.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([...parts, directory, record, locator, eocd]);
}
