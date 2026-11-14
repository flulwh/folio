package com.folio.reader.core

/**
 * 进度合并：updatedAt 新的胜出，其余字段浅合并。
 * 与桌面端 electron/lan.js 的 mergeProgressEntry 语义一致，
 * 双端互相写进度时不会来回抖动。
 */
object ProgressMerger {

    /** 单条合并。incoming 里的 null 字段视为「没带」，保留 current 的值。 */
    fun mergeEntry(current: ProgressEntry?, incoming: ProgressEntry?): ProgressEntry? {
        if (incoming == null) return current
        if (current == null) return incoming
        if (incoming.updatedAt < current.updatedAt) return current
        return current.copy(
            id = incoming.id.ifBlank { current.id },
            paraIndex = incoming.paraIndex ?: current.paraIndex,
            chapter = incoming.chapter ?: current.chapter,
            chapterIndex = incoming.chapterIndex ?: current.chapterIndex,
            chapterTitle = incoming.chapterTitle ?: current.chapterTitle,
            windowBase = incoming.windowBase ?: current.windowBase,
            percent = incoming.percent ?: current.percent,
            updatedAt = maxOf(current.updatedAt, incoming.updatedAt),
        )
    }

    /**
     * 两条进度是不是「同一个位置」的两种写法。
     *
     * 只比真正的锚点：段落号 + 云端窗口起点。`chapterIndex` 与 `percent` 是派生值——
     * 换字号、换机型重新测量后会有细微差异，桌面端回传的条目还会带上本机没有的
     * `chapterIndex`。拿它们判「有没有移动」，就会把「重新排版」当成「读到了这里」，
     * 给旧位置盖上新时间戳，反过来把桌面端更新的进度冲掉。
     *
     * [includePercent] 给漫画用：漫画的页号只体现在 `percent` 里，
     * 漏掉它会让同话内翻页不落盘。
     */
    fun samePlace(
        current: ProgressEntry?,
        next: ProgressEntry,
        includePercent: Boolean = false,
    ): Boolean {
        if (current == null) return false
        if (current.paraIndex != next.paraIndex) return false
        if (current.windowBase != next.windowBase) return false
        if (includePercent && current.percent != next.percent) return false
        return true
    }

    /** 整份进度合并，返回新表和「有没有真的变化」。 */
    fun merge(
        current: Map<String, ProgressEntry>,
        incoming: Map<String, ProgressEntry>,
    ): Pair<Map<String, ProgressEntry>, Boolean> {
        var changed = false
        val next = LinkedHashMap(current)
        for ((id, entry) in incoming) {
            val merged = mergeEntry(current[id], entry) ?: continue
            val before = current[id]
            if (before == null || before != merged) {
                next[id] = merged
                changed = true
            }
        }
        return next to changed
    }
}
