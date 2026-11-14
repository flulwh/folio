package com.folio.reader.core

/**
 * 正文搜索的一条命中。
 *
 * [excerpt] 是围绕关键词截出来的上下文，[start] / [end] 是关键词在
 * [excerpt] 内的下标 —— UI 直接用它做高亮，不用再算一遍位置。
 */
data class SearchHit(
    val paraIndex: Int,
    val chapterIndex: Int,
    val chapterTitle: String,
    val excerpt: String,
    val start: Int,
    val end: Int,
) {
    val keywordLength: Int get() = end - start
}

/**
 * 全书搜索。
 *
 * 不做索引：一本书解析后段落都在内存里，`contains` 扫一遍几百万字也只要几十毫秒，
 * 而且不会因为书内容变化让索引失效。命中上限 300 条，够用且不会把面板撑爆。
 */
object TextSearch {

    const val MAX_RESULTS = 300
    private const val CONTEXT_BEFORE = 18
    private const val CONTEXT_AFTER = 42

    fun search(
        paragraphs: List<Paragraph>,
        chapters: List<Chapter>,
        query: String,
        limit: Int = MAX_RESULTS,
    ): List<SearchHit> {
        val keyword = query.trim()
        if (keyword.isEmpty()) return emptyList()
        val lower = keyword.lowercase()
        val hits = ArrayList<SearchHit>(minOf(limit, 64))
        var chapterCursor = 0
        for (index in paragraphs.indices) {
            val paragraph = paragraphs[index]
            if (paragraph.blank) continue
            val text = paragraph.text
            val at = text.lowercase().indexOf(lower)
            if (at < 0) continue

            // 章节指针只前进不后退：段落与章节都是按 paraIndex 升序的。
            while (
                chapterCursor + 1 < chapters.size &&
                chapters[chapterCursor + 1].paraIndex <= index
            ) {
                chapterCursor += 1
            }
            val chapter = chapters.getOrNull(chapterCursor)

            val from = (at - CONTEXT_BEFORE).coerceAtLeast(0)
            val to = (at + keyword.length + CONTEXT_AFTER).coerceAtMost(text.length)
            val raw = text.substring(from, to).replace('\n', ' ')
            val prefix = if (from > 0) "…" else ""
            val suffix = if (to < text.length) "…" else ""
            val excerpt = prefix + raw + suffix
            val start = prefix.length + (at - from)

            hits += SearchHit(
                paraIndex = index,
                chapterIndex = chapterCursor,
                chapterTitle = chapter?.title.orEmpty(),
                excerpt = excerpt,
                start = start,
                end = start + keyword.length,
            )
            if (hits.size >= limit) break
        }
        return hits
    }
}
