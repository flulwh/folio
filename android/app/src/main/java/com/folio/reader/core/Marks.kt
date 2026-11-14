package com.folio.reader.core

import org.json.JSONObject
import java.util.UUID

/**
 * 阅读痕迹：书签与划线（划线可以带一条笔记）。
 *
 * 只记段落号 + 摘录，不记字符偏移 —— 段落是正文的最小稳定单位，
 * 换字号 / 换字体 / 重排之后段落号仍然有效，而偏移量会漂。
 * 后续双端同步时，桌面端按同一份 `contentHash` + 段落号即可对齐。
 */
data class ReaderMark(
    val id: String,
    val bookId: String,
    /** 段落下标（0 基）。本机书是全书下标；云端书是本章内下标。 */
    val paraIndex: Int,
    /** 所在章节标题，列表里直接展示，不必回查目录。 */
    val chapterTitle: String,
    /** 段落摘录（最多 120 字），用于列表与同步对账。 */
    val excerpt: String,
    /** 用户写的笔记；书签与纯划线为空串。 */
    val note: String = "",
    /** [KIND_BOOKMARK] 或 [KIND_HIGHLIGHT]。 */
    val kind: String = KIND_BOOKMARK,
    val createdAt: Long = System.currentTimeMillis(),
    /** 本机书的章节下标；云端书为目录位置。 */
    val chapterIndex: Int = 0,
    /**
     * 云端书的真实章号（服务端 `index`）。本机书为 -1。
     * 云端正文按章加载，段落号只在本章内有意义，跳转必须带章号。
     */
    val chapterNo: Int = -1,
) {
    val isBookmark: Boolean get() = kind == KIND_BOOKMARK

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("paraIndex", paraIndex)
        put("chapter", chapterTitle)
        put("chapterIndex", chapterIndex)
        put("chapterNo", chapterNo)
        put("excerpt", excerpt)
        put("note", note)
        put("kind", kind)
        put("createdAt", createdAt)
    }

    companion object {
        const val KIND_BOOKMARK = "bookmark"
        const val KIND_HIGHLIGHT = "highlight"

        fun create(
            bookId: String,
            paraIndex: Int,
            chapterTitle: String,
            excerpt: String,
            kind: String,
            note: String = "",
            chapterIndex: Int = 0,
            chapterNo: Int = -1,
        ): ReaderMark = ReaderMark(
            id = UUID.randomUUID().toString(),
            bookId = bookId,
            paraIndex = paraIndex,
            chapterTitle = chapterTitle,
            excerpt = excerpt.take(120),
            note = note,
            kind = kind,
            chapterIndex = chapterIndex,
            chapterNo = chapterNo,
        )

        fun fromJson(bookId: String, json: JSONObject): ReaderMark? {
            val id = json.optString("id").takeIf { it.isNotBlank() } ?: return null
            val paraIndex = json.optInt("paraIndex", -1).takeIf { it >= 0 } ?: return null
            return ReaderMark(
                id = id,
                bookId = bookId,
                paraIndex = paraIndex,
                chapterTitle = json.optString("chapter"),
                excerpt = json.optString("excerpt"),
                note = json.optString("note"),
                kind = json.optString("kind").takeIf { it.isNotBlank() } ?: KIND_BOOKMARK,
                createdAt = json.optLong("createdAt", 0L),
                chapterIndex = json.optInt("chapterIndex", 0),
                chapterNo = json.optInt("chapterNo", -1),
            )
        }
    }
}
