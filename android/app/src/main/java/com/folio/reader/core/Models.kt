package com.folio.reader.core

import org.json.JSONObject

/** 书的类型：本地书（桌面端书架目录里的文件）/ 云端书（书源抓取）。 */
object BookKind {
    const val LOCAL = "local"
    const val CLOUD = "cloud"
}

/**
 * 书架上的一本书。字段与桌面端 /api/state 返回的 slimBook 对齐，
 * 只保留手机端真正用得到的部分。
 */
data class Book(
    val id: String,
    val title: String,
    val author: String? = null,
    val kind: String = BookKind.LOCAL,
    val cover: String? = null,
    val sourceName: String? = null,
    val lastChapter: String? = null,
    val format: String? = null,
    val wordCount: Long? = null,
) {
    val isCloud: Boolean get() = kind == BookKind.CLOUD

    companion object {
        fun fromJson(json: JSONObject): Book? {
            val id = json.optString("id").trim()
            if (id.isEmpty()) return null
            // 桌面端的书架字段叫 name，老版本叫 title，两个都认。
            val title = json.optString("title").ifBlank { json.optString("name") }
            val author = json.optString("author").ifBlank { json.optString("authorName") }
            return Book(
                id = id,
                title = title.ifBlank { "未命名" },
                author = author.takeIf { it.isNotBlank() && it != "null" },
                kind = json.optString("kind").ifBlank { BookKind.LOCAL },
                cover = json.optString("cover").takeIf { it.isNotBlank() && (it.startsWith("http") || it.startsWith("/")) },
                sourceName = json.optString("sourceName").takeIf { it.isNotBlank() },
                lastChapter = json.optString("lastChapter").takeIf { it.isNotBlank() },
                format = json.optString("format").takeIf { it.isNotBlank() },
                wordCount = if (json.has("wordCount")) json.optLong("wordCount") else null,
            )
        }
    }
}

/** 一条阅读进度。字段名与桌面端 progress.json 保持一致，双端才能合并。 */
data class ProgressEntry(
    val id: String,
    val paraIndex: Int? = null,
    val chapter: Int? = null,
    /** 桌面端老字段，与 chapter 同义，一起写回去免得两端对不上。 */
    val chapterIndex: Int? = null,
    val chapterTitle: String? = null,
    val windowBase: Int? = null,
    val percent: Double? = null,
    val updatedAt: Long = 0L,
) {
    val safePercent: Double
        get() = (percent ?: 0.0).coerceIn(0.0, 100.0)

    fun toJson(kind: String): JSONObject {
        val json = JSONObject()
        if (kind == BookKind.CLOUD) {
            val index = chapter ?: 0
            json.put("chapter", index)
            json.put("chapterIndex", index)
            json.put("windowBase", windowBase ?: index)
        }
        json.put("paraIndex", paraIndex ?: 0)
        json.put("chapterTitle", chapterTitle ?: "")
        json.put("percent", safePercent)
        json.put("updatedAt", updatedAt)
        return json
    }

    companion object {
        fun fromJson(id: String, json: JSONObject): ProgressEntry? {
            if (json.optLong("updatedAt", 0L) <= 0L) return null
            return ProgressEntry(
                id = id,
                paraIndex = if (json.has("paraIndex")) json.optInt("paraIndex") else null,
                chapter = if (json.has("chapter")) json.optInt("chapter") else null,
                chapterIndex = if (json.has("chapterIndex")) json.optInt("chapterIndex") else null,
                chapterTitle = json.optString("chapterTitle").takeIf { it.isNotBlank() },
                windowBase = if (json.has("windowBase")) json.optInt("windowBase") else null,
                percent = if (json.has("percent")) json.optDouble("percent") else null,
                updatedAt = json.optLong("updatedAt"),
            )
        }
    }
}

/** 云端书目录项。 */
data class TocChapter(
    val index: Int,
    val title: String,
)

/** 桌面端返回的整份状态。 */
data class ServerState(
    val books: List<Book>,
    val progress: Map<String, ProgressEntry>,
    val serverVersion: String,
    val allowWrite: Boolean,
    val port: Int,
)

/** 一次同步的结果，给 UI 汇报用。 */
data class SyncOutcome(
    val ok: Boolean,
    val message: String,
    val pulled: Int = 0,
    val pushed: Int = 0,
)
