import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { mimeOf, pageCount, readPage } from '../electron/cbz.js';

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
});
