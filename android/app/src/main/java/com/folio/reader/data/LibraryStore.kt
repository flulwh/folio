package com.folio.reader.data

import android.content.Context
import android.util.Log
import com.folio.reader.core.Book
import com.folio.reader.core.ProgressEntry
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 手机本地书架与进度。
 *
 * 三份小文件放在 App 私有目录：
 * - books.json     桌面端同步过来的书架
 * - progress.json  双端合并后的进度
 * - pending.json   还没被桌面端接受的进度，断网时记下来，联网补写
 */
class LibraryStore(context: Context) {

    private val dir: File = File(context.filesDir, "library").apply { mkdirs() }
    private val booksFile = File(dir, "books.json")
    private val progressFile = File(dir, "progress.json")
    private val pendingFile = File(dir, "pending.json")

    /* ---------------- 书架 ---------------- */

    fun readBooks(): List<Book> {
        val array = readJson(booksFile)?.optJSONArray("books") ?: return emptyList()
        val books = ArrayList<Book>()
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            Book.fromJson(item)?.let { books.add(it) }
        }
        return books
    }

    fun writeBooks(books: List<Book>) {
        val array = JSONArray()
        for (book in books) {
            array.put(
                JSONObject()
                    .put("id", book.id)
                    .put("title", book.title)
                    .put("author", book.author ?: "")
                    .put("kind", book.kind)
                    .put("cover", book.cover ?: "")
                    .put("sourceName", book.sourceName ?: "")
                    .put("lastChapter", book.lastChapter ?: "")
                    .put("format", book.format ?: ""),
            )
        }
        writeJson(booksFile, JSONObject().put("books", array))
    }

    /* ---------------- 进度 ---------------- */

    fun readProgress(): MutableMap<String, ProgressEntry> {
        val result = LinkedHashMap<String, ProgressEntry>()
        val json = readJson(progressFile) ?: return result
        val keys = json.keys()
        while (keys.hasNext()) {
            val id = keys.next()
            val entry = json.optJSONObject(id) ?: continue
            ProgressEntry.fromJson(id, entry)?.let { result[id] = it }
        }
        return result
    }

    fun writeProgress(progress: Map<String, ProgressEntry>) {
        val json = JSONObject()
        for ((id, entry) in progress) json.put(id, entry.toJson("cloud"))
        writeJson(progressFile, json)
    }

    /* ---------------- 待同步 ---------------- */

    fun readPending(): MutableSet<String> {
        val json = readJson(pendingFile) ?: return mutableSetOf()
        val array = json.optJSONArray("ids") ?: return mutableSetOf()
        val ids = mutableSetOf<String>()
        for (i in 0 until array.length()) {
            array.optString(i).takeIf { it.isNotBlank() }?.let { ids.add(it) }
        }
        return ids
    }

    fun writePending(ids: Set<String>) {
        val array = JSONArray()
        ids.forEach { array.put(it) }
        writeJson(pendingFile, JSONObject().put("ids", array))
    }

    /* ---------------- 底层 ---------------- */

    private fun readJson(file: File): JSONObject? {
        if (!file.exists()) return null
        return runCatching { JSONObject(file.readText(Charsets.UTF_8)) }
            .onFailure { Log.w(TAG, "读取 ${file.name} 失败", it) }
            .getOrNull()
    }

    private fun writeJson(file: File, json: JSONObject) {
        runCatching {
            val tmp = File(file.parentFile, file.name + ".tmp")
            tmp.writeText(json.toString(), Charsets.UTF_8)
            if (file.exists()) file.delete()
            tmp.renameTo(file)
        }.onFailure { Log.w(TAG, "写入 ${file.name} 失败", it) }
    }

    companion object {
        private const val TAG = "FolioLibrary"
    }
}
