package com.folio.reader.core

import org.json.JSONObject

/** 书的类型：本地书（桌面端书架目录里的文件）/ 云端书（书源抓取）。 */
object BookKind {
    const val LOCAL = "local"
    const val CLOUD = "cloud"
}

/**
 * 这本书是从哪来的。
 *
 * - [LOCAL]：用户在本机导入的，正文一开始就在手机上；
 * - [DESKTOP]：从桌面端清单同步过来的元数据（可能没有正文）。
 *
 * 与「现在在哪」无关：一本本机导入的书上传到桌面端之后，`origin` 仍然是 [LOCAL]。
 */
enum class Origin {
    LOCAL,
    DESKTOP;

    companion object {
        fun fromWire(raw: String?): Origin = when (raw?.trim()?.lowercase()) {
            "local" -> LOCAL
            else -> DESKTOP
        }
    }
}

/** 书的内容形态。wire 值必须与桌面端一致：小说 0、漫画 2。 */
enum class BookType(val wire: Int) {
    NOVEL(0),
    COMIC(2);

    companion object {
        fun fromWire(value: Int): BookType = if (value == COMIC.wire) COMIC else NOVEL

        fun fromWire(raw: String?): BookType = fromWire(raw?.trim()?.toIntOrNull() ?: 0)
    }
}

/**
 * 一本本地书相对桌面端的同步状态。
 *
 * wire 值与桌面端 / 架构文档 §8 冻结一致，改一个字就会让双端对不上。
 * [EXCLUDED] 表示永不参与同步（超过 30MB，或本身是云端书）。
 */
enum class SyncState(val wire: String) {
    NOT_SYNCED("notSynced"),
    TRANSFERRING("transferring"),
    SYNCED("synced"),
    FAILED("failed"),
    CONTENT_MISMATCH("contentMismatch"),
    EXCLUDED("excluded");

    companion object {
        fun fromWire(raw: String?): SyncState {
            val value = raw?.trim().orEmpty()
            return entries.firstOrNull { it.wire == value } ?: NOT_SYNCED
        }
    }
}

/**
 * 手机上的一本书。
 *
 * 字段与架构文档 §3.2 一致。设计要点：
 *  - `id`：本机导入的书是 `"sha1-" + contentHash`；桌面来的书先用桌面 id。
 *  - `contentHash`：`sha1(规范化 UTF-8 正文字节)`，**不是**用户原始文件的字节 ——
 *    GBK 原始文件的 sha1 与桌面端 UTF-8 副本的 sha1 永远不等，会假冲突。
 *  - `remoteKind`：在桌面端属于哪类（local / cloud），决定能不能整文件搬运。
 *  - `remoteId`：在桌面端上的 id。上传成功后回填；与本地 `id` 不同时要迁移本地键。
 */
data class LocalBook(
    val id: String,
    val title: String,
    val author: String? = null,
    val origin: Origin,
    val remoteKind: String? = null,
    val type: BookType = BookType.NOVEL,
    val contentHash: String? = null,
    val size: Long = 0L,
    val encoding: String? = null,
    val hasLocalFile: Boolean = false,
    val cover: String? = null,
    val remoteId: String? = null,
    val addedAt: Long = 0L,
    val lastReadAt: Long = 0L,
    val syncState: SyncState = SyncState.NOT_SYNCED,
    /**
     * 漫画读到第几页（0 基）。**只存本机，绝不参与同步**：
     * 双端进度对齐到「话」级，话内页号是纯本地偏好，传上去只会制造无意义写入。
     */
    val comicPage: Int? = null,
) {
    /** 桌面端那侧的类别；没同步过时按 local 处理（手机导入的都是本地 txt）。 */
    val kind: String get() = remoteKind ?: BookKind.LOCAL

    val isCloud: Boolean get() = kind == BookKind.CLOUD

    val isComic: Boolean get() = type == BookType.COMIC

    /** 冲突判定用的键：书名规整后比较，见 [titleKeyOf]。 */
    val titleKey: String get() = titleKeyOf(title)

    /** 有正文且体积在 30MB 以内，才可能参与整文件同步。 */
    val syncableSize: Boolean get() = size in 1..MAX_SYNC_BYTES

    fun toJson(): JSONObject {
        val json = JSONObject()
            .put("id", id)
            .put("title", title)
            .put("author", author ?: "")
            .put("origin", origin.name.lowercase())
            .put("type", type.wire)
            .put("size", size)
            .put("hasLocalFile", hasLocalFile)
            .put("addedAt", addedAt)
            .put("lastReadAt", lastReadAt)
            .put("syncState", syncState.wire)
        remoteKind?.let { json.put("remoteKind", it) }
        contentHash?.let { json.put("contentHash", it) }
        encoding?.let { json.put("encoding", it) }
        cover?.let { json.put("cover", it) }
        remoteId?.let { json.put("remoteId", it) }
        comicPage?.let { json.put("comicPage", it) }
        return json
    }

    companion object {
        /** 单本可同步上限 30MiB，与桌面端 MAX_TRANSFER 一致。 */
        const val MAX_SYNC_BYTES = 30L * 1024 * 1024

        /** 上传分块 4MiB：30MB 最多 8 块，串行发。 */
        const val CHUNK_BYTES = 4 * 1024 * 1024

        /** 剩余空间预检余量：剩余 < size × 1.2 就拒绝。 */
        const val SPACE_HEADROOM = 1.2

        /**
         * 从 JSON 还原一本书。
         *
         * 同时吃三种输入：桌面端 /api/state 的 slimBook、桌面端 /api/library 的清单项、
         * 以及手机自己写出的 books.json（字段最全）。
         *
         * @param fallbackOrigin 输入里没有 `origin` 时按什么算（桌面来的传 DESKTOP）
         * @return 没有 id 的条目返回 null（宁可丢一条，也不要出现幽灵书）
         */
        fun fromJson(json: JSONObject, fallbackOrigin: Origin = Origin.DESKTOP): LocalBook? {
            val id = json.optString("id").trim()
            if (id.isEmpty()) return null
            // 桌面端的书架字段叫 name，2.6.0 的 /api/library 叫 title，两个都认。
            val title = json.optString("title").ifBlank { json.optString("name") }
            val author = json.optString("author").ifBlank { json.optString("authorName") }
            val declaredOrigin = json.optString("origin").trim()
            val origin = if (declaredOrigin.isEmpty()) fallbackOrigin else Origin.fromWire(declaredOrigin)
            val hash = json.optString("contentHash").trim()
            return LocalBook(
                id = id,
                title = title.ifBlank { "未命名" },
                author = author.takeIf { it.isNotBlank() && it != "null" },
                origin = origin,
                remoteKind = json.optString("kind").ifBlank { json.optString("remoteKind") }
                    .takeIf { it.isNotBlank() && it != "null" },
                type = BookType.fromWire(json.optString("type").ifBlank { "0" }),
                contentHash = hash.takeIf { it.length == 40 },
                size = json.optLong("size", 0L).coerceAtLeast(0L),
                encoding = json.optString("encoding").takeIf { it.isNotBlank() && it != "null" },
                hasLocalFile = json.optBoolean("hasLocalFile", false),
                cover = json.optString("cover")
                    .takeIf { it.isNotBlank() && (it.startsWith("http") || it.startsWith("/")) },
                remoteId = json.optString("remoteId").takeIf { it.isNotBlank() && it != "null" },
                addedAt = json.optLong("addedAt", 0L),
                lastReadAt = json.optLong("lastReadAt", 0L),
                syncState = SyncState.fromWire(json.optString("syncState")),
                comicPage = if (json.has("comicPage") && !json.isNull("comicPage")) {
                    json.optInt("comicPage").coerceAtLeast(0)
                } else {
                    null
                },
            )
        }

        /**
         * 冲突判定用的书名键（架构文档 §1.2）：
         * 去首尾空白 → 全角括号转半角 → 去掉尾部的 `(1)/(2)/ 副本/（数字）`
         * → 压缩空白 → 转小写。
         *
         * 两端用同一套规则，才会得出同一组「同名不同内容」。
         */
        fun titleKeyOf(raw: String): String {
            var text = raw.trim()
            if (text.isEmpty()) return ""
            text = text
                .replace('（', '(')
                .replace('）', ')')
                .replace('【', '[')
                .replace('】', ']')
                .replace('\u3000', ' ')
            // 尾部副本标记可能叠好几层：「三体(1) 副本」也要一路削干净
            val tail = Regex(
                """(?:\s*[\(\[]\s*\d{1,3}\s*[\)\]]|\s*[-_]?\s*副本|\s+cop(?:y|ies))\s*$""",
                RegexOption.IGNORE_CASE,
            )
            repeat(6) {
                val next = text.replace(tail, "").trim()
                if (next != text) text = next
            }
            text = text.replace(Regex("\\s+"), " ")
            return text.lowercase()
        }
    }
}

/**
 * 书的别名。
 *
 * 渲染层（书架 / 阅读器 / 设置）只认 `id`、`title`、`author`、`isCloud` 这几个成员，
 * 用别名可以让 UI 一行不改地跑在新模型上；第二批 UI 大改时再逐步改用 LocalBook。
 */
typealias Book = LocalBook

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

    /** 换一个书 id（上传后桌面端回了不同的 id 时，进度 key 要跟着迁）。 */
    fun withId(newId: String): ProgressEntry = copy(id = newId)

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

/** 桌面端 /api/state 返回的整份状态（旧接口，保留给进度对齐与网页面板）。 */
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
    val conflicts: Int = 0,
    val skipped: Int = 0,
)
