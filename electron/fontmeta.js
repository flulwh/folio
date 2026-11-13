/**
 * 字体文件元信息解析（零依赖）。
 *
 * 目标：从 .ttf / .otf / .woff / .woff2 里读出「族名」（family name），
 * 让用户在字体列表里看到真实字体名而不是一串文件名。
 *
 * 实现要点：
 * - TrueType / OpenType 是 sfnt 结构：offset table → table directory → name table。
 *   族名在 name table 里，优先取 nameID=16（Typographic Family），其次 nameID=1（Family）。
 *   平台编码有坑：Windows 用 UTF-16BE，Mac 用 UTF-8/MacRoman，需要分别解码。
 * - WOFF 是 wrapper：表目录里的每个表可能是 zlib 压缩的，要先解压再解析。
 * - WOFF2 是 Brotli + 自定义的表结构，解析成本高；这里退化为用文件名（去掉扩展名）。
 *
 * 只做「够用」的解析：拿不到族名就返回 null，调用方回退到文件名，绝不抛错。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/** WOFF 表目录项：tag(4) offset(4) compLength(4) origLength(4) origChecksum(4) */
const WOFF_ENTRY_SIZE = 20;

function readU16(buf, off) {
  return buf.readUInt16BE(off);
}

function readU32(buf, off) {
  return buf.readUInt32BE(off);
}

function tag(buf, off) {
  return buf.toString('latin1', off, off + 4);
}

/**
 * 解码 name table 里的字符串。
 *
 * 编码坑：Windows 平台同一张表里会同时存在 UCS-2(encodingID=1) 和 UCS-4(encodingID=10)
 * 两种记录，UCS-4 若按 UTF-16 读就会得到「每个字符后面夹一个空位」的乱码。
 * 所以必须按 encodingID 分派，不能只看 platformID。
 *
 * @param {Buffer} buf  name table 的原始字节
 * @param {number} start 字符串在 table 内的偏移
 * @param {number} length 字节长度
 * @param {number} platformID 平台 ID（3 = Windows，1 = Mac，0 = Unicode）
 * @param {number} encodingID 编码 ID
 */
function decodeNameString(buf, start, length, platformID, encodingID) {
  const raw = buf.subarray(start, start + length);

  // UCS-4：每字符 4 字节，Node 没有 utf32le 的字符串解码，手工拆成 UTF-16BE 再转
  if (platformID === 3 && encodingID === 10) {
    if (raw.length % 4 !== 0) return '';
    let out = '';
    for (let i = 0; i < raw.length; i += 4) {
      const code = raw.readUInt32BE(i);
      if (code === 0) continue;
      if (code > 0x10ffff) return '';
      out += String.fromCodePoint(code);
    }
    return out.trim();
  }

  // UCS-2 / Unicode：UTF-16BE
  if (platformID === 3 || platformID === 0) {
    if (raw.length % 2 === 1) return '';
    const swapped = Buffer.from(raw);
    swapped.swap16();
    return swapped.toString('utf16le').replace(/\0/g, '').trim();
  }

  // Mac Roman：近似按 latin1 解，去掉控制字符
  return raw.toString('latin1').replace(/[^\x20-\x7e]/g, '').trim();
}

/**
 * 从 sfnt 的 name table 里挑一个族名。
 */
function parseSfntNameTable(nameTable) {
  if (!nameTable || nameTable.length < 6) return null;
  const count = readU16(nameTable, 2);
  const stringOffset = readU16(nameTable, 4);

  // nameID 16 = Typographic Family（更准确），1 = Family（兼容性名称）
  // 排序策略：先看编码质量（Windows UCS-2 最佳），再看 nameID（16 优于 1）。
  // 同一字体里 Windows 平台的 UCS-2 记录才是干净的族名。
  const wanted = new Map();
  for (let i = 0; i < count; i++) {
    const rec = 6 + i * 12;
    if (rec + 12 > nameTable.length) break;
    const platformID = readU16(nameTable, rec);
    const encodingID = readU16(nameTable, rec + 2);
    const languageID = readU16(nameTable, rec + 4);
    const nameID = readU16(nameTable, rec + 6);
    const length = readU16(nameTable, rec + 8);
    const offset = readU16(nameTable, rec + 10);
    if (nameID !== 1 && nameID !== 16) continue;
    const start = stringOffset + offset;
    if (start + length > nameTable.length) continue;

    const text = decodeNameString(nameTable, start, length, platformID, encodingID);
    if (!text) continue;

    // 编码质量：Windows UCS-2 = 0，Windows UCS-4 = 1，Unicode = 2，Mac = 3
    const encodingRank =
      platformID === 3 ? (encodingID === 10 ? 1 : 0) : platformID === 0 ? 2 : 3;
    // 语言：英文（0x0409）与中性语言优先
    const languageRank = languageID === 0x0409 || languageID === 0 ? 0 : 1;
    // nameID 16 更准确，但排在编码质量之后 —— 先要能读，再要够准
    const nameRank = nameID === 16 ? 0 : 1;
    const rank = encodingRank * 100 + languageRank * 10 + nameRank;

    const prev = wanted.get(nameID);
    if (!prev || rank < prev.rank) {
      wanted.set(nameID, { text, rank });
    }
  }

  const typo = wanted.get(16);
  if (typo) return typo.text;
  const fam = wanted.get(1);
  return fam ? fam.text : null;
}

/**
 * 解析 TrueType / OpenType（sfnt）。
 *
 * @param {Buffer} buf 整个文件的内容
 * @param {number} headerAt sfnt header 在 buf 中的位置。
 *        TTC 里每个子字体的 header 在 offsetTable 指向处，但表目录项里的
 *        offset 仍然是**相对整个文件的绝对偏移**，所以表偏移不能再加 base。
 */
function parseSfnt(buf, headerAt = 0) {
  const tables = parseSfntTables(buf, headerAt);
  return parseSfntNameTable(tables.name);
}

/**
 * 取出 sfnt 的 name 表与 cmap 表。
 *
 * @param {Buffer} buf 整个文件的内容
 * @param {number} headerAt sfnt header 在 buf 中的位置。
 *        TTC 里每个子字体的 header 在 offsetTable 指向处，但表目录项里的
 *        offset 仍然是**相对整个文件的绝对偏移**，所以表偏移不能再加 base。
 */
function parseSfntTables(buf, headerAt = 0) {
  const out = { name: null, cmap: null };
  if (buf.length < headerAt + 12) return out;
  const numTables = readU16(buf, headerAt + 4);

  for (let i = 0; i < numTables; i++) {
    const rec = headerAt + 12 + i * 16;
    if (rec + 16 > buf.length) break;
    const tableTag = tag(buf, rec);
    const offset = readU32(buf, rec + 8);
    const length = readU32(buf, rec + 12);
    if (tableTag !== 'name' && tableTag !== 'cmap') continue;
    if (offset >= buf.length) continue;
    const end = Math.min(buf.length, offset + length);
    const slice = buf.subarray(offset, end);
    if (tableTag === 'name' && !out.name) out.name = slice;
    if (tableTag === 'cmap' && !out.cmap) out.cmap = slice;
    if (out.name && out.cmap) break;
  }

  return out;
}

/**
 * 解析 WOFF（表可能被 zlib 压缩）。
 */
function parseWoff(buf) {
  if (buf.length < 44) return null;
  const numTables = readU16(buf, 12);
  let nameTable = null;

  for (let i = 0; i < numTables; i++) {
    const rec = 44 + i * WOFF_ENTRY_SIZE;
    if (rec + WOFF_ENTRY_SIZE > buf.length) break;
    const tableTag = tag(buf, rec);
    const offset = readU32(buf, rec + 4);
    const compLength = readU32(buf, rec + 8);
    const origLength = readU32(buf, rec + 12);
    if (tableTag !== 'name') continue;
    if (offset + compLength > buf.length) continue;

    const raw = buf.subarray(offset, offset + compLength);
    try {
      // compLength < origLength 说明这张表被压缩过
      nameTable = compLength < origLength ? zlib.inflateSync(raw) : raw;
    } catch {
      nameTable = raw;
    }
    break;
  }

  return parseSfntNameTable(nameTable);
}

/* ---------------------------------------------------------------------------
 * cmap（字符映射表）解析
 *
 * 用途：判断一款字体到底能不能渲染中文。
 *
 * 为什么不用浏览器侧的检测（document.fonts.check / canvas 像素）：
 * - document.fonts.check(family, '汉') 在 Chromium 里会把 fallback 算进去，
 *   纯西文字体也返回 true。
 * - canvas 画「汉」时浏览器会自动 fallback 到系统中文字体，
 *   画出来的是**别的字体的字形**，墨迹计数和像素哈希都无法区分。
 *
 * cmap 是字体的「我有哪些字形」的唯一权威声明，直接读它没有歧义。
 * ------------------------------------------------------------------------- */

/** 常用汉字样本：用来判断字体是否真的收录了中文，而不是零星几个生僻字。 */
const CJK_SAMPLE = '的一是不了人我在有他这为之大来以个中上们到说国和地也子时道出而要于就下得可你年生';

/** 拉丁样本：判断字体是否是纯符号/装饰字体。 */
const LATIN_SAMPLE = 'ABCDEFGHabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * 解析 cmap 的各个子表，构造「码位 → 是否收录」的查询能力。
 *
 * 支持 format 0 / 4 / 6 / 12 —— 覆盖 TrueType 与 OpenType 的全部常见形态。
 *
 * @param {Buffer} cmap cmap 表的原始字节
 * @returns {(cp: number) => boolean} 查询函数
 */
function parseCmap(cmap) {
  if (!cmap || cmap.length < 4) return () => false;

  const numTables = readU16(cmap, 2);
  const subs = [];

  for (let i = 0; i < numTables; i++) {
    const rec = 4 + i * 8;
    if (rec + 8 > cmap.length) break;
    const platformID = readU16(cmap, rec);
    const encodingID = readU16(cmap, rec + 2);
    const offset = readU32(cmap, rec + 4);
    if (offset + 4 > cmap.length) continue;

    const format = readU16(cmap, offset);
    // 符号字体（platform 3 / encoding 0）把字符映射到 F000 私有区，
    // 单独处理：只有符号字体时才把 F000 区映射回低位码位。
    const symbol = platformID === 3 && encodingID === 0;
    subs.push({ format, offset, symbol });
  }

  if (!subs.length) return () => false;

  // 优先用非符号的 Unicode 子表；符号字体才退到符号子表。
  const unicodeSubs = subs.filter((s) => !s.symbol);
  const pool = unicodeSubs.length ? unicodeSubs : subs;
  const allowSymbolFallback = !unicodeSubs.length && subs.some((s) => s.symbol);

  const has = (cp) => {
    for (const sub of pool) {
      if (hasInSubtable(cmap, sub, cp)) return true;
      // 符号字体：把 U+F0xx 段的映射也视作低位字符
      if (allowSymbolFallback && sub.symbol && cp >= 0x20 && cp < 0xff) {
        if (hasInSubtable(cmap, sub, 0xf000 + cp)) return true;
      }
    }
    return false;
  };

  return has;
}

/**
 * 判断某个码位是否在单个 cmap 子表里。
 */
function hasInSubtable(cmap, sub, cp) {
  const { format, offset } = sub;
  try {
    if (format === 0) {
      // 字节编码：只覆盖 0x00–0xFF
      if (cp > 0xff) return false;
      const at = offset + 6 + cp;
      return at < cmap.length && cmap[at] !== 0;
    }

    if (format === 4) {
      if (cp > 0xffff) return false;
      const segCountX2 = readU16(cmap, offset + 6);
      const segCount = segCountX2 / 2;
      const endCodes = offset + 14;
      const startCodes = endCodes + segCountX2 + 2;
      const idDeltas = startCodes + segCountX2;
      const idRangeOffsets = idDeltas + segCountX2;

      for (let i = 0; i < segCount; i++) {
        const end = readU16(cmap, endCodes + i * 2);
        if (cp > end) continue;
        const start = readU16(cmap, startCodes + i * 2);
        if (cp < start) return false;

        const idDelta = readU16(cmap, idDeltas + i * 2);
        const idRangeOffset = readU16(cmap, idRangeOffsets + i * 2);
        if (idRangeOffset === 0) {
          // 段内直接用 idDelta 映射
          return ((cp + idDelta) & 0xffff) !== 0;
        }
        // idRangeOffset 指向一个 16 位数组，该数组相对于自己的位置
        const glyphIndexAddr = idRangeOffsets + i * 2 + idRangeOffset + (cp - start) * 2;
        if (glyphIndexAddr + 2 > cmap.length) return false;
        const glyph = readU16(cmap, glyphIndexAddr);
        if (glyph !== 0) return true;
        return ((glyph + idDelta) & 0xffff) !== 0;
      }
      return false;
    }

    if (format === 6) {
      const first = readU16(cmap, offset + 6);
      const count = readU16(cmap, offset + 8);
      if (cp < first || cp >= first + count) return false;
      const at = offset + 10 + (cp - first) * 2;
      if (at + 2 > cmap.length) return false;
      return readU16(cmap, at) !== 0;
    }

    if (format === 12) {
      const nGroups = readU32(cmap, offset + 12);
      // 二分查找
      let lo = 0;
      let hi = nGroups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const rec = offset + 16 + mid * 12;
        if (rec + 12 > cmap.length) return false;
        const start = readU32(cmap, rec);
        const end = readU32(cmap, rec + 4);
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else return readU32(cmap, rec + 8) !== 0;
      }
      return false;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * 判断字体是否收录了常用汉字。
 *
 * 阈值取 80%：有些中文字体会缺个别生僻字，但常用字必须齐；
 * 而纯西文字体是 0%。
 */
function countCovered(sample, has) {
  let hit = 0;
  for (const ch of sample) {
    if (has(ch.codePointAt(0))) hit++;
  }
  return hit / sample.length;
}

/**
 * 读一个字体文件的族名。失败返回 null，由调用方回退到文件名。
 * @param {string} filePath
 * @returns {{ family: string|null, format: string }}
 */
export function readFontMeta(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return { family: null, format: ext.replace('.', '') || 'unknown' };
  }
  if (buf.length < 12) return { family: null, format: ext.replace('.', '') || 'unknown' };

  let family = null;
  let format = ext.replace('.', '') || 'unknown';
  let cmap = null;

  try {
    const sig = buf.toString('latin1', 0, 4);
    if (sig === 'wOFF') {
      format = 'woff';
      family = parseWoff(buf);
    } else if (sig === 'wOF2') {
      // WOFF2 是 Brotli + 自定义表结构，这里不解析，用文件名
      format = 'woff2';
      family = null;
    } else if (sig === 'ttcf') {
      // TrueType Collection：取第一份字体。
      // 表偏移是相对整个文件的，所以不切片，直接传 base。
      format = 'ttc';
      const firstOffset = readU32(buf, 12);
      if (firstOffset > 0 && firstOffset < buf.length) {
        const tables = parseSfntTables(buf, firstOffset);
        family = parseSfntNameTable(tables.name);
        cmap = tables.cmap;
      }
    } else if (sig === 'OTTO' || buf.readUInt32BE(0) === 0x00010000) {
      format = sig === 'OTTO' ? 'otf' : 'ttf';
      const tables = parseSfntTables(buf);
      family = parseSfntNameTable(tables.name);
      cmap = tables.cmap;
    }
  } catch {
    family = null;
  }

  const coverage = coverageFromCmap(cmap);
  return { family, format, ...coverage };
}

/**
 * 从 cmap 表算出字体的字符覆盖情况。
 */
function coverageFromCmap(cmap) {
  if (!cmap) return { hasCJK: false, cjkRatio: 0, hasLatin: false, latinRatio: 0 };
  try {
    const has = parseCmap(cmap);
    const cjkRatio = countCovered(CJK_SAMPLE, has);
    const latinRatio = countCovered(LATIN_SAMPLE, has);
    return {
      hasCJK: cjkRatio >= 0.8,
      cjkRatio: Math.round(cjkRatio * 100) / 100,
      hasLatin: latinRatio >= 0.9,
      latinRatio: Math.round(latinRatio * 100) / 100,
    };
  } catch {
    return { hasCJK: false, cjkRatio: 0, hasLatin: false, latinRatio: 0 };
  }
}

/**
 * 单独读取字体的字符覆盖信息（是否含中文 / 拉丁）。
 *
 * 用于安装字体时记录元信息，让界面能提前告诉用户
 * 「这款字体不含中文，正文会回退到系统字体」—— 而不是让人自己撞墙。
 *
 * @param {string} filePath
 * @returns {{ hasCJK: boolean, cjkRatio: number, hasLatin: boolean, latinRatio: number }}
 */
export function readFontCoverage(filePath) {
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return { hasCJK: false, cjkRatio: 0, hasLatin: false, latinRatio: 0 };
  }
  if (buf.length < 12) return { hasCJK: false, cjkRatio: 0, hasLatin: false, latinRatio: 0 };

  try {
    const sig = buf.toString('latin1', 0, 4);
    if (sig === 'ttcf') {
      const firstOffset = readU32(buf, 12);
      if (firstOffset > 0 && firstOffset < buf.length) {
        return coverageFromCmap(parseSfntTables(buf, firstOffset).cmap);
      }
      return { hasCJK: false, cjkRatio: 0, hasLatin: false, latinRatio: 0 };
    }
    if (sig === 'OTTO' || buf.readUInt32BE(0) === 0x00010000) {
      return coverageFromCmap(parseSfntTables(buf).cmap);
    }
  } catch {
    /* 落到默认 */
  }
  return { hasCJK: false, cjkRatio: 0, hasLatin: false, latinRatio: 0 };
}

/**
 * 文件名去掉扩展名，作为族名的兜底。
 */
export function familyFromFilename(filePath) {
  return path.basename(filePath, path.extname(filePath)).trim() || '未命名字体';
}
