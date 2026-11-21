/**
 * 最小 CBZ / ZIP 读取器：只做「列出图片页 + 按页取字节」这一件事。
 *
 * 为什么不用第三方库：整条链路只需要读，不需要写；桌面端也不想为 30MB 的
 * 漫画包多引入一个依赖。这里只解析 ZIP 的中央目录与 local header，
 * 支持 store（0）与 deflate（8）两种压缩方式（CBZ 的常见形态）。
 *
 * 限制（明确报错，不静默读错）：
 *  - ZIP64（> 4GB 或条目数 > 65535）：直接拒绝；
 *  - 加密条目、CBR/CB7：不在支持范围；
 *  - 单页解压后上限 32MiB，超过的图跳过。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const MAX_PAGE_BYTES = 32 * 1024 * 1024;
const CACHE_LIMIT = 64;

const IMAGE_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};

/** 解析结果缓存：同一个文件（size + mtime 不变）不重复扫中央目录。 */
const cache = new Map();

/** 按扩展名给 MIME，认不出就按 JPEG 兜底（Chromium 会自己嗅探）。 */
export function mimeOf(name) {
  const ext = path.posix.extname(String(name || '')).toLowerCase();
  return IMAGE_TYPES[ext] || 'image/jpeg';
}

/** 只看文件名，不看压缩包里的目录结构。 */
function isImageEntry(name) {
  if (!name || name.endsWith('/')) return false;
  if (name.startsWith('__MACOSX/')) return false;
  const base = path.posix.basename(name);
  if (!base || base.startsWith('.')) return false;
  return Object.hasOwn(IMAGE_TYPES, path.posix.extname(name).toLowerCase());
}

/** 需要读满 length 字节，短读说明文件被截断。 */
function readAt(fd, position, length) {
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const count = fs.readSync(fd, buffer, read, length - read, position + read);
    if (count <= 0) throw new Error('CBZ/ZIP 读取不完整');
    read += count;
  }
  return buffer;
}

/** 扫 EOCD（末尾最多 64KB），再读中央目录，返回按自然顺序排好的图片条目。 */
function parseEntries(filePath) {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  if (size < 22) throw new Error('不是有效的 CBZ/ZIP 压缩包');
  const fd = fs.openSync(filePath, 'r');
  try {
    const tailLength = Math.min(size, 65557);
    const tail = readAt(fd, size - tailLength, tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('不是有效的 CBZ/ZIP 压缩包');

    const count = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new Error('暂不支持 ZIP64 压缩包');
    }
    if (centralOffset + centralSize > size) throw new Error('CBZ/ZIP 目录损坏');

    const central = readAt(fd, centralOffset, centralSize);
    const entries = [];
    let cursor = 0;
    for (let i = 0; i < count; i += 1) {
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== CENTRAL_SIG) break;
      const method = central.readUInt16LE(cursor + 10);
      const compressedSize = central.readUInt32LE(cursor + 20);
      const uncompressedSize = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentLength = central.readUInt16LE(cursor + 32);
      const localOffset = central.readUInt32LE(cursor + 42);
      const nameStart = cursor + 46;
      const name = central.toString('utf8', nameStart, nameStart + nameLength);
      cursor = nameStart + nameLength + extraLength + commentLength;

      if (!isImageEntry(name)) continue;
      if (method !== 0 && method !== 8) continue;
      if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
        throw new Error('暂不支持 ZIP64 压缩包');
      }
      // 解压后过大的单页直接忽略：真读出来也只会把渲染进程撑爆
      if (uncompressedSize > MAX_PAGE_BYTES) continue;
      entries.push({ name, method, compressedSize, localOffset });
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true, sensitivity: 'base' }));
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

function entriesOf(filePath) {
  const stat = fs.statSync(filePath);
  const key = `${stat.size}:${stat.mtimeMs}`;
  const hit = cache.get(filePath);
  if (hit?.key === key) return hit.entries;
  const entries = parseEntries(filePath);
  cache.delete(filePath);
  cache.set(filePath, { key, entries });
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return entries;
}

/**
 * 这本漫画一共有多少页。
 * @param {string} filePath
 * @returns {number}
 */
export function pageCount(filePath) {
  return entriesOf(filePath).length;
}

/**
 * 读第 index 页。
 * @param {string} filePath
 * @param {number} index 0 基
 * @returns {{buffer: Buffer, type: string, name: string}|null}
 */
export function readPage(filePath, index) {
  const entries = entriesOf(filePath);
  const entry = entries[index];
  if (!entry) return null;

  const fd = fs.openSync(filePath, 'r');
  try {
    const header = readAt(fd, entry.localOffset, 30);
    if (header.readUInt32LE(0) !== LOCAL_SIG) throw new Error('CBZ/ZIP 条目损坏');
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
    const compressed = readAt(fd, dataOffset, entry.compressedSize);
    const buffer = entry.method === 0
      ? compressed
      : zlib.inflateRawSync(compressed, { maxOutputLength: MAX_PAGE_BYTES });
    return { buffer, type: mimeOf(entry.name), name: entry.name };
  } finally {
    fs.closeSync(fd);
  }
}
