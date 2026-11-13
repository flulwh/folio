package com.folio.reader.data

import android.content.Context
import android.util.Log
import com.folio.reader.core.Book
import com.folio.reader.core.Chapter
import com.folio.reader.core.ParsedBook
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * 离线正文缓存。
 *
 * 本地书：整本存一份 txt，配一份 meta（章节表）。
 * 云端书：按章存，联网读到哪章就顺手缓存哪章，断网后仍能接着看。
 */
class OfflineStore(context: Context) {

    private val root: File = File(context.filesDir, "offline").apply { mkdirs() }
    private val cloudDir: File = File(root, "cloud").apply { mkdirs() }

    /* ---------------- 本地书 ---------------- */

    fun hasLocalBook(bookId: String): Boolean = textFile(bookId).exists()

    /** 写入本地书正文与章节表。 */
    fun writeLocalBook(book: Book, parsed: ParsedBook) {
        val target = textFile(book.id)
        runCatching {
            target.writeText(parsed.rawText, Charsets.UTF_8)
            val meta = JSONObject()
                .put("id", book.id)
                .put("title", book.title)
                .put("kind", book.kind)
                .put("cachedAt", System.currentTimeMillis())
                .put("charCount", parsed.charCount)
                .put("paraCount", parsed.paragraphs.size)
                .put("chapters", JSONArray().apply {
                    parsed.chapters.forEach { chapter ->
                        put(JSONObject().put("title", chapter.title).put("paraIndex", chapter.paraIndex))
                    }
                })
            writeText(metaFile(book.id), meta.toString())
        }.onFailure { Log.w(TAG, "缓存本地书失败：${book.title}", it) }
    }

    /** 读本地书正文；没缓存过返回 null。 */
    fun readLocalBook(bookId: String): String? {
        val file = textFile(bookId)
        if (!file.exists()) return null
        return runCatching { file.readText(Charsets.UTF_8) }.getOrNull()
    }

    /** 读本地书缓存的章节表。 */
    fun readLocalChapters(bookId: String): List<Chapter> {
        val meta = readMeta(bookId) ?: return emptyList()
        val array = meta.optJSONArray("chapters") ?: return emptyList()
        val chapters = ArrayList<Chapter>()
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            chapters.add(Chapter(item.optString("title"), item.optInt("paraIndex")))
        }
        return chapters
    }

    fun localCachedAt(bookId: String): Long = readMeta(bookId)?.optLong("cachedAt") ?: 0L

    /* ---------------- 云端书 ---------------- */

    fun cloudChapterFile(bookId: String, index: Int): File =
        File(cloudDir, "${hash(bookId)}-$index.txt")

    fun hasCloudChapter(bookId: String, index: Int): Boolean =
        cloudChapterFile(bookId, index).exists()

    fun writeCloudChapter(bookId: String, index: Int, title: String, text: String) {
        runCatching {
            val file = cloudChapterFile(bookId, index)
            file.writeText(text, Charsets.UTF_8)
            writeText(
                File(cloudDir, "${hash(bookId)}-$index.json"),
                JSONObject().put("id", bookId).put("index", index).put("title", title).toString(),
            )
        }.onFailure { Log.w(TAG, "缓存云端章节失败", it) }
    }

    fun readCloudChapter(bookId: String, index: Int): String? {
        val file = cloudChapterFile(bookId, index)
        if (!file.exists()) return null
        return runCatching { file.readText(Charsets.UTF_8) }.getOrNull()
    }

    /** 已经缓存过的云端章节序号。 */
    fun cachedCloudChapters(bookId: String): Set<Int> {
        val prefix = hash(bookId) + "-"
        val result = sortedSetOf<Int>()
        cloudDir.listFiles()?.forEach { file ->
            if (!file.name.startsWith(prefix)) return@forEach
            if (!file.name.endsWith(".txt")) return@forEach
            val index = file.name.removePrefix(prefix).removeSuffix(".txt").toIntOrNull()
            if (index != null) result.add(index)
        }
        return result
    }

    /** 清掉某本书的离线缓存。 */
    fun clear(bookId: String) {
        runCatching {
            textFile(bookId).delete()
            metaFile(bookId).delete()
            val prefix = hash(bookId) + "-"
            cloudDir.listFiles()?.forEach { file ->
                if (file.name.startsWith(prefix)) file.delete()
            }
        }
    }

    /** 清掉全部离线缓存，返回释放的字节数。 */
    fun clearAll(): Long {
        val before = cacheSize()
        runCatching {
            root.deleteRecursively()
            root.mkdirs()
            cloudDir.mkdirs()
        }
        return before
    }

    fun cacheSize(): Long {
        var total = 0L
        root.walkTopDown().forEach { if (it.isFile) total += it.length() }
        return total
    }

    /* ---------------- 内部 ---------------- */

    private fun textFile(bookId: String) = File(root, "${hash(bookId)}.txt")

    private fun metaFile(bookId: String) = File(root, "${hash(bookId)}.json")

    private fun readMeta(bookId: String): JSONObject? {
        val file = metaFile(bookId)
        if (!file.exists()) return null
        return runCatching { JSONObject(file.readText(Charsets.UTF_8)) }.getOrNull()
    }

    private fun writeText(file: File, text: String) {
        runCatching { file.writeText(text, Charsets.UTF_8) }
    }

    private fun hash(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        val sb = StringBuilder(32)
        for (i in 0 until 16) sb.append("%02x".format(digest[i].toInt() and 0xFF))
        return sb.toString()
    }

    companion object {
        private const val TAG = "FolioOffline"
    }
}
