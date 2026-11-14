package com.folio.reader.data

import com.folio.reader.core.JsonIo
import com.folio.reader.core.ReaderMark
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 书签与划线：`filesDir/library/marks.json`。
 *
 * 结构是 `{ 书 id: [mark, ...] }`，与进度分开存：进度每 0.6 秒写一次，
 * 痕迹是用户主动操作，频率低、体积小，混在一起只会让翻页反复重写大文件。
 *
 * 所有写操作都走 [JsonIo] 的「先写 tmp 再改名」，中途被杀不会留下半份 json。
 */
class MarkStore(
    /** `filesDir/library` */
    private val dir: File,
) {

    private val file: File get() = File(dir, FILE_MARKS)

    @Synchronized
    fun read(bookId: String): List<ReaderMark> {
        val root = JsonIo.readObject(file) ?: return emptyList()
        val array = root.optJSONArray(bookId) ?: return emptyList()
        val out = ArrayList<ReaderMark>(array.length())
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            ReaderMark.fromJson(bookId, item)?.let(out::add)
        }
        return out.sortedWith(compareBy({ it.paraIndex }, { it.createdAt }))
    }

    /** 同一段落同类型只保留一条（重复点书签 = 取消/改写，而不是堆一摞）。 */
    @Synchronized
    fun put(mark: ReaderMark): List<ReaderMark> {
        val root = JsonIo.readObject(file) ?: JSONObject()
        val current = ArrayList<ReaderMark>()
        val array = root.optJSONArray(mark.bookId)
        if (array != null) {
            for (i in 0 until array.length()) {
                val item = array.optJSONObject(i) ?: continue
                ReaderMark.fromJson(mark.bookId, item)?.let(current::add)
            }
        }
        current.removeAll {
            it.paraIndex == mark.paraIndex && it.kind == mark.kind
        }
        current += mark
        root.put(mark.bookId, toArray(current))
        JsonIo.write(file, root)
        return current.sortedWith(compareBy({ it.paraIndex }, { it.createdAt }))
    }

    @Synchronized
    fun remove(bookId: String, id: String): List<ReaderMark> {
        val root = JsonIo.readObject(file) ?: return emptyList()
        val array = root.optJSONArray(bookId) ?: return emptyList()
        val kept = ArrayList<ReaderMark>()
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            val mark = ReaderMark.fromJson(bookId, item) ?: continue
            if (mark.id != id) kept += mark
        }
        root.put(bookId, toArray(kept))
        JsonIo.write(file, root)
        return kept.sortedWith(compareBy({ it.paraIndex }, { it.createdAt }))
    }

    /** 改笔记；同时把书签升级为划线，方便「先收藏、后补一句话」。 */
    @Synchronized
    fun updateNote(bookId: String, id: String, note: String): List<ReaderMark> {
        val root = JsonIo.readObject(file) ?: return emptyList()
        val array = root.optJSONArray(bookId) ?: return emptyList()
        val updated = ArrayList<ReaderMark>()
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            val mark = ReaderMark.fromJson(bookId, item) ?: continue
            updated += if (mark.id == id) {
                mark.copy(
                    note = note,
                    kind = if (note.isBlank()) ReaderMark.KIND_BOOKMARK else ReaderMark.KIND_HIGHLIGHT,
                )
            } else {
                mark
            }
        }
        root.put(bookId, toArray(updated))
        JsonIo.write(file, root)
        return updated.sortedWith(compareBy({ it.paraIndex }, { it.createdAt }))
    }

    /** 引擎删书时一起清掉，避免痕迹文件越攒越大。 */
    @Synchronized
    fun clear(bookId: String) {
        val root = JsonIo.readObject(file) ?: return
        if (!root.has(bookId)) return
        root.remove(bookId)
        JsonIo.write(file, root)
    }

    private fun toArray(marks: List<ReaderMark>): JSONArray {
        val array = JSONArray()
        marks.forEach { array.put(it.toJson()) }
        return array
    }

    companion object {
        private const val FILE_MARKS = "marks.json"
    }
}
