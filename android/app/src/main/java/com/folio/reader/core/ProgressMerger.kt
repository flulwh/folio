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
