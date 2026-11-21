/**
 * 最小 CBZ / ZIP 读取器：只做「列出图片页 + 按页取字节」这一件事。
 *
 * 为什么不用第三方库：整条链路只需要读，不需要写；桌面端也不想为 30MB 的
 * 漫画包多引入一个依赖。这里只解析 ZIP 的中央目录与 local header，
 * 支持 store（0）与 deflate（8）两种压缩方式（CBZ 的常见形态）。
 *
 * 限制（明确报错，不静默读错）：
 *  - ZIP64（条目数 > 65535 或目录/条目字段溢出 32 位）：读 EOCD64 与 64 位 extra；
 *  - 加密条目、CBR/CB7：不在支持范围；
 *  - 单页解压后上限 32MiB，超过的图跳过。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_EXTRA_ID = 0x0001;
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

/** ZIP64 目录：EOCD 的计数值溢出时，真实数值在 EOCD64 记录里（前面还有一个 locator）。 */
function readZip64Directory(fd, eocdAbs) {
  if (eocdAbs < 20) throw new Error('CBZ/ZIP 目录损坏');
  const locator = readAt(fd, eocdAbs - 20, 20);
  if (locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIG) throw new Error('暂不支持 ZIP64 压缩包');
  const recordOffset = Number(locator.readBigUInt64LE(8));
  if (!Number.isSafeInteger(recordOffset) || recordOffset < 0) throw new Error('CBZ/ZIP 目录损坏');
  const record = readAt(fd, recordOffset, 56);
  if (record.readUInt32LE(0) !== ZIP64_EOCD_SIG) throw new Error('CBZ/ZIP 目录损坏');
  const count = Number(record.readBigUInt64LE(32));
  const centralSize = Number(record.readBigUInt64LE(40));
  const centralOffset = Number(record.readBigUInt64LE(48));
  if (![count, centralSize, centralOffset].every(Number.isSafeInteger)) {
    throw new Error('CBZ/ZIP 目录损坏');
  }
  return { count, centralSize, centralOffset };
}

/**
 * 中央目录条目的 ZIP64 extra（id 0x0001）：只补齐被写成 0xffffffff 的字段，
 * 顺序固定为「解压后大小、压缩后大小、local header 偏移、分卷号」。
 */
function readZip64Entry(central, start, length, need) {
  let cursor = start;
  const end = start + length;
  while (cursor + 4 <= end) {
    const id = central.readUInt16LE(cursor);
    const size = central.readUInt16LE(cursor + 2);
    const dataStart = cursor + 4;
    if (dataStart + size > end) break;
    if (id === ZIP64_EXTRA_ID) {
      let point = dataStart;
      const dataEnd = dataStart + size;
      const take = () => {
        if (point + 8 > dataEnd) return null;
        const value = Number(central.readBigUInt64LE(point));
        point += 8;
        return Number.isSafeInteger(value) ? value : null;
      };
      const out = {};
      if (need.uncompressed) out.uncompressed = take();
      if (need.compressed) out.compressed = take();
      if (need.offset) out.offset = take();
      const missing = (need.uncompressed && out.uncompressed == null)
        || (need.compressed && out.compressed == null)
        || (need.offset && out.offset == null);
      return missing ? null : out;
    }
    cursor = dataStart + size;
  }
  return null;
}

/**
 * 双端共用的页名自然顺序：数字段按数值比较，其余按小写后的 UTF-16 码位，
 * 忽略大小写后仍相同再用原名兜底。安卓端 `CbzArchive.comparePageName` 与此逐条对齐。
 */
export function comparePageName(a, b) {
  const left = tokenizePageName(a);
  const right = tokenizePageName(b);
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    const x = left[i];
    const y = right[i];
    let diff;
    if (isAsciiDigits(x) && isAsciiDigits(y)) {
      const nx = x.replace(/^0+/, '') || '0';
      const ny = y.replace(/^0+/, '') || '0';
      diff = nx.length - ny.length || (nx < ny ? -1 : nx > ny ? 1 : 0);
    } else {
      const lx = x.toLowerCase();
      const ly = y.toLowerCase();
      diff = lx < ly ? -1 : lx > ly ? 1 : 0;
    }
    if (diff !== 0) return diff;
  }
  if (left.length !== right.length) return left.length - right.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

function isAsciiDigits(value) {
  return value.length > 0 && value.charCodeAt(0) >= 48 && value.charCodeAt(0) <= 57;
}

function tokenizePageName(value) {
  return String(value || '').match(/\d+|\D+/g) || [];
}

/** 删书时清掉解析缓存：同一路径重新导入时不会命中旧条目。 */
export function forgetComic(filePath) {
  cache.delete(filePath);
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

    let count = tail.readUInt16LE(eocd + 10);
    let centralSize = tail.readUInt32LE(eocd + 12);
    let centralOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      ({ count, centralSize, centralOffset } = readZip64Directory(fd, size - tailLength + eocd));
    }
    if (centralOffset + centralSize > size) throw new Error('CBZ/ZIP 目录损坏');

    const central = readAt(fd, centralOffset, centralSize);
    const entries = [];
    let cursor = 0;
    for (let i = 0; i < count; i += 1) {
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== CENTRAL_SIG) break;
      const method = central.readUInt16LE(cursor + 10);
      let compressedSize = central.readUInt32LE(cursor + 20);
      let uncompressedSize = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentLength = central.readUInt16LE(cursor + 32);
      let localOffset = central.readUInt32LE(cursor + 42);
      const nameStart = cursor + 46;
      const name = central.toString('utf8', nameStart, nameStart + nameLength);
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
        const wide = readZip64Entry(central, nameStart + nameLength, extraLength, {
          uncompressed: uncompressedSize === 0xffffffff,
          compressed: compressedSize === 0xffffffff,
          offset: localOffset === 0xffffffff,
        });
        if (!wide) throw new Error('CBZ/ZIP 目录损坏');
        uncompressedSize = wide.uncompressed ?? uncompressedSize;
        compressedSize = wide.compressed ?? compressedSize;
        localOffset = wide.offset ?? localOffset;
      }
      cursor = nameStart + nameLength + extraLength + commentLength;

      if (!isImageEntry(name)) continue;
      if (method !== 0 && method !== 8) continue;
      // 解压后过大的单页直接忽略：真读出来也只会把渲染进程撑爆
      if (uncompressedSize > MAX_PAGE_BYTES) continue;
      entries.push({ name, method, compressedSize, localOffset });
    }

    entries.sort((a, b) => comparePageName(a.name, b.name));
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
