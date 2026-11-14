/* ------------------------------------------------------------------ */
/*  Text pipeline: normalize -> paragraphs -> chapters (regex driven)  */
/* ------------------------------------------------------------------ */

import { sortedLastIndex } from './sortedIndex.js';

export const AUTO_CHAPTER_REGEX =
  '^\\s*(?:' +
  '第[0-9零一二三四五六七八九十百千万两〇]+[章节節回卷部集篇话話]' +
  '|(?:Chapter|CHAPTER|Part|PART|Section|SECTION)\\s+[0-9IVXLCDMivxlcdm]+\\b' +
  '|(?:序章|序言|楔子|引子|前言|后记|後記|尾声|尾聲|终章|終章|番外|附录|附錄)' +
  '|(?:[0-9]{1,4}[、.．:：]\\s*\\S)' +
  '|(?:【[^】]{1,24}】)' +
  ')\\s*.{0,48}$';

// Hoisted so the per-line hot path never rebuilds regex objects.
const SENTENCE_END_RE = /[。！？…」』”’）)]$/;
const OPENING_RE = /^[「『“（(【[]/;
const LATIN_END_RE = /[A-Za-z0-9,;)]$/;
const LATIN_START_RE = /^[A-Za-z0-9(]/;
const HEADING_PUNCT_RE = /[。！？!?；;]$/;
const HEADING_CLOSE_RE = /[】」』”]$/;

const CJK_LO = 0x3400;
const CJK_HI = 0x4dbf;
const CJK_MAIN_LO = 0x4e00;
const CJK_MAIN_HI = 0x9fff;

/** Normalize line endings and strip BOM. Keep original blank lines. */
export function normalizeText(raw) {
  if (!raw) return '';
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\t/g, '  ');
}

/**
 * Split text into paragraphs. Consecutive blank lines collapse into one
 * paragraph marked `blank`, which the reader renders as a breathing space.
 *
 * `headingRegex` is optional: a line that already looks like a chapter heading
 * is never merged into the previous paragraph, otherwise hard-wrapped text
 * would swallow the heading that follows it.
 */
export function splitParagraphs(text, headingRegex = null) {
  const lines = text.split('\n');
  const paragraphs = [];
  let buffer = [];

  const flush = () => {
    if (!buffer.length) return;
    const joined = buffer.join('').trim();
    if (joined) paragraphs.push({ text: joined, blank: false });
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      if (paragraphs.length && !paragraphs[paragraphs.length - 1].blank) {
        paragraphs.push({ text: '', blank: true });
      }
      continue;
    }
    // `headingCore` assumes a non-empty, already trimmed line of length <= 60.
    const looksLikeHeading =
      trimmed.length <= 60 && headingRegex ? headingCore(trimmed, headingRegex) : false;
    const prev = buffer.length ? buffer[buffer.length - 1] : null;
    // Hard-wrapped plain text: join lines that clearly continue a sentence.
    if (
      prev !== null &&
      !looksLikeHeading &&
      SENTENCE_END_RE.test(prev) === false &&
      !OPENING_RE.test(trimmed) &&
      prev.length > 24
    ) {
      const glue = LATIN_END_RE.test(prev) && LATIN_START_RE.test(trimmed) ? ' ' : '';
      buffer[buffer.length - 1] = prev + glue + trimmed;
    } else {
      flush();
      buffer.push(trimmed);
    }
  }
  flush();

  // Drop a trailing blank marker
  while (paragraphs.length && paragraphs[paragraphs.length - 1].blank) paragraphs.pop();
  return paragraphs;
}

export function compileRegex(source) {
  if (!source) return null;
  try {
    return new RegExp(source, 'm');
  } catch (err) {
    return { error: err.message };
  }
}

/** Shared tail of `isHeading`; the caller must have trimmed/length-checked. */
function headingCore(line, regex) {
  if (HEADING_PUNCT_RE.test(line) && !HEADING_CLOSE_RE.test(line)) return false;
  const matched = regex.test(line);
  regex.lastIndex = 0;
  return matched;
}

export function isHeading(text, regex) {
  const line = text.trim();
  if (!line) return false;
  if (line.length > 60) return false;
  return headingCore(line, regex);
}

/** Build chapters using an already compiled regex (shared by parseBook). */
function buildChaptersWithRegex(paragraphs, regex) {
  const chapters = [];
  // Readers mark heading paragraphs with a class; keeping this list here saves
  // them a second O(n) regex sweep over the whole book on every open.
  const headingIndexes = [];
  for (let i = 0; i < paragraphs.length; i += 1) {
    const p = paragraphs[i];
    if (p.blank) continue;
    if (isHeading(p.text, regex)) {
      headingIndexes.push(i);
      chapters.push({ title: cleanTitle(p.text), paraIndex: i });
    }
  }

  if (chapters.length === 0) {
    return {
      chapters: [{ title: '全文', paraIndex: 0 }],
      hasHeadings: false,
      headingIndexes,
    };
  }

  if (chapters[0].paraIndex > 0) {
    // Early-exit scan instead of slice().some(): no temporary array.
    let hasRealText = false;
    for (let i = 0; i < chapters[0].paraIndex; i += 1) {
      if (!paragraphs[i].blank) {
        hasRealText = true;
        break;
      }
    }
    if (hasRealText) chapters.unshift({ title: '开篇', paraIndex: 0 });
  }

  return { chapters, hasHeadings: true, headingIndexes };
}

/**
 * Build chapters from paragraphs.
 * Returns { chapters, hasHeadings }
 * chapters: [{ title, paraIndex }]
 */
export function buildChapters(paragraphs, customRegex = '') {
  const patternSource = customRegex.trim() || AUTO_CHAPTER_REGEX;
  let regex = compileRegex(patternSource);
  if (regex instanceof Error || (regex && regex.error)) {
    regex = compileRegex(AUTO_CHAPTER_REGEX);
  }
  return buildChaptersWithRegex(paragraphs, regex);
}

function cleanTitle(text) {
  return text
    .trim()
    .replace(/^[【\[]/, '')
    .replace(/[】\]]$/, '')
    .slice(0, 60);
}

/** Find which chapter contains a paragraph index. */
export function chapterIndexForPara(chapters, paraIndex) {
  // lodash-style upper-bound probe: last index whose paraIndex <= paraIndex.
  const upper = sortedLastIndex(chapters, paraIndex, chapters.length, (c) => c.paraIndex);
  return upper > 0 ? upper - 1 : 0;
}

/** Full parse used by the reader. */
export function parseBook(content, customRegex = '') {
  const text = normalizeText(content);
  let regex = compileRegex(customRegex.trim() || AUTO_CHAPTER_REGEX);
  if (!regex || regex.error) regex = compileRegex(AUTO_CHAPTER_REGEX);
  // Compile once and share the instance across both passes.
  const paragraphs = splitParagraphs(text, regex);
  const { chapters, hasHeadings, headingIndexes } = buildChaptersWithRegex(paragraphs, regex);
  return {
    paragraphs,
    chapters,
    hasHeadings,
    headingIndexes,
    charCount: text.length,
    wordCount: countWords(text),
  };
}

/**
 * 解析缓存：本地书每次打开都重新 parse 一遍，对几 MB 的书是一次明显的卡顿。
 * 缓存键由书 id + 正文长度 + 正文首尾字符 + 正则组成，同一本书再次打开直接命中。
 * 只保留最近几本，避免大书把内存吃满。
 */
const PARSE_CACHE_MAX = 3;
const parseCache = [];

export function parseBookCached(content, customRegex = '', cacheKey = '') {
  const source = content || '';
  const signature = `${cacheKey}|${customRegex}|${source.length}|${source.charCodeAt(0)}|${source.charCodeAt(source.length - 1)}`;
  for (let i = 0; i < parseCache.length; i += 1) {
    if (parseCache[i].signature === signature) {
      const entry = parseCache[i];
      if (i > 0) {
        parseCache.splice(i, 1);
        parseCache.unshift(entry);
      }
      return entry.parsed;
    }
  }
  const parsed = parseBook(source, customRegex);
  parseCache.unshift({ signature, parsed });
  if (parseCache.length > PARSE_CACHE_MAX) parseCache.length = PARSE_CACHE_MAX;
  return parsed;
}

/** CJK characters count as words; latin words by whitespace. */
function countWords(text) {
  // Single pass, O(1) extra space. Previously: two match() arrays plus a
  // full-text replace() copy — three O(n) allocations for one number.
  let cjk = 0;
  let latin = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (
      (code >= CJK_LO && code <= CJK_HI) ||
      (code >= CJK_MAIN_LO && code <= CJK_MAIN_HI)
    ) {
      cjk += 1;
      inWord = false;
      continue;
    }
    const isLatin =
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x30 && code <= 0x39) ||
      code === 0x27;
    if (isLatin) {
      if (!inWord) {
        latin += 1;
        inWord = true;
      }
    } else {
      inWord = false;
    }
  }
  return cjk + latin;
}
