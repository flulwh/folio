/**
 * 全书搜索：与 Android `TextSearch.kt` 保持同一套输出。
 *
 * 不做索引 —— 一本书解析后段落都在内存里，直接扫一遍几百万字也只要几十毫秒，
 * 而且不会因为正文变化让索引失效。命中上限 300 条，够用且不会把面板撑爆。
 */

export const MAX_SEARCH_RESULTS = 300;
const CONTEXT_BEFORE = 18;
const CONTEXT_AFTER = 42;

/**
 * 在正文段落里搜关键词。
 *
 * @param {Array<{text:string, blank?:boolean}>} paragraphs
 * @param {Array<{title:string, paraIndex:number}>} chapters
 * @param {string} query
 * @returns {Array<{paraIndex:number, chapterIndex:number, chapterTitle:string, excerpt:string, start:number, end:number}>}
 */
export function searchBook(paragraphs, chapters, query, limit = MAX_SEARCH_RESULTS) {
  const keyword = String(query || '').trim();
  if (!keyword || !Array.isArray(paragraphs) || !paragraphs.length) return [];
  const lower = keyword.toLowerCase();
  const list = Array.isArray(chapters) ? chapters : [];
  const hits = [];
  let chapterCursor = 0;

  for (let index = 0; index < paragraphs.length; index += 1) {
    const para = paragraphs[index];
    if (!para || para.blank) continue;
    const text = para.text || '';
    const at = text.toLowerCase().indexOf(lower);
    if (at < 0) continue;

    // 章节指针只前进不后退：段落与章节都是按 paraIndex 升序的。
    while (chapterCursor + 1 < list.length && list[chapterCursor + 1].paraIndex <= index) {
      chapterCursor += 1;
    }
    const chapter = list[chapterCursor];

    const from = Math.max(0, at - CONTEXT_BEFORE);
    const to = Math.min(text.length, at + keyword.length + CONTEXT_AFTER);
    // 只替换换行、不压缩空白：excerpt 内的下标必须和原文对得上
    const raw = text.slice(from, to).replace(/\n/g, ' ');
    const prefix = from > 0 ? '…' : '';
    const suffix = to < text.length ? '…' : '';
    const start = prefix.length + (at - from);

    hits.push({
      paraIndex: index,
      chapterIndex: chapterCursor,
      chapterTitle: chapter?.title || '',
      excerpt: prefix + raw + suffix,
      start,
      end: start + keyword.length,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/**
 * 在一段原文里定位关键词首次出现的位置，用于跳转后的正文高亮。
 * 返回原文下标（不是摘录下标）；没找到返回 null。
 */
export function findMatchRange(text, query) {
  const keyword = String(query || '').trim();
  if (!keyword || !text) return null;
  const at = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (at < 0) return null;
  return { start: at, end: at + keyword.length };
}
