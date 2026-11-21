/**
 * 字体元信息：族名与字符覆盖。
 *
 * 解析交给 fontkit（sfnt / WOFF / WOFF2 / TTC 全支持），本文件只保留
 * 「读哪个字段」和「覆盖率阈值」这两件事：
 * - 族名优先 familyName，取不到返回 null，由调用方回退到文件名；
 * - 覆盖率按常用汉字 / 拉丁字母样本计算，阈值 80% / 90% 决定 hasCJK / hasLatin。
 */

import fs from 'node:fs';
import path from 'node:path';
import { openSync } from 'fontkit';

const CJK_SAMPLE = '的一是不了人我在有他这为之大来以个中上们到说国和地也子时道出而要于就下得可你年生';
const LATIN_SAMPLE = 'ABCDEFGHabcdefghijklmnopqrstuvwxyz0123456789';

const EMPTY_COVERAGE = {
  hasCJK: false,
  cjkRatio: 0,
  hasLatin: false,
  latinRatio: 0,
};

// 安装字体时会连着读族名和覆盖率，同一路径同一版本只解析一次。
const OPEN_CACHE = new Map();
const OPEN_CACHE_MAX = 4;

function openFont(filePath) {
  let stamp;
  try {
    const stat = fs.statSync(filePath);
    stamp = `${filePath}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
  const cached = OPEN_CACHE.get(stamp);
  if (cached !== undefined) return cached;

  let font = null;
  try {
    const opened = openSync(filePath);
    // TrueType Collection 取第一份字体。
    font = opened && opened.fonts ? opened.fonts[0] : opened;
  } catch {
    font = null;
  }

  if (OPEN_CACHE.size >= OPEN_CACHE_MAX) OPEN_CACHE.clear();
  OPEN_CACHE.set(stamp, font);
  return font;
}

function ratioOf(font, sample) {
  let hit = 0;
  for (const ch of sample) {
    if (font.hasGlyphForCodePoint(ch.codePointAt(0))) hit += 1;
  }
  return hit / sample.length;
}

function coverageOf(font) {
  if (!font) return { ...EMPTY_COVERAGE };
  try {
    const cjkRatio = ratioOf(font, CJK_SAMPLE);
    const latinRatio = ratioOf(font, LATIN_SAMPLE);
    return {
      hasCJK: cjkRatio >= 0.8,
      cjkRatio: Math.round(cjkRatio * 100) / 100,
      hasLatin: latinRatio >= 0.9,
      latinRatio: Math.round(latinRatio * 100) / 100,
    };
  } catch {
    return { ...EMPTY_COVERAGE };
  }
}

function formatOf(filePath, font) {
  const ext = path.extname(filePath).replace('.', '').toLowerCase();
  if (ext) return ext;
  const type = String(font?.type || '').toLowerCase();
  return type || 'unknown';
}

/**
 * 读一个字体文件的族名与覆盖情况。失败返回 null 族名，由调用方回退到文件名。
 * @param {string} filePath
 * @returns {{ family: string|null, format: string, hasCJK: boolean, cjkRatio: number, hasLatin: boolean, latinRatio: number }}
 */
export function readFontMeta(filePath) {
  const font = openFont(filePath);
  return {
    family: font?.familyName || null,
    format: formatOf(filePath, font),
    ...coverageOf(font),
  };
}

/**
 * 单独读取字体的字符覆盖信息（是否含中文 / 拉丁）。
 * @param {string} filePath
 * @returns {{ hasCJK: boolean, cjkRatio: number, hasLatin: boolean, latinRatio: number }}
 */
export function readFontCoverage(filePath) {
  return coverageOf(openFont(filePath));
}

/**
 * 文件名去掉扩展名，作为族名的兜底。
 */
export function familyFromFilename(filePath) {
  return path.basename(filePath, path.extname(filePath)).trim() || '未命名字体';
}
