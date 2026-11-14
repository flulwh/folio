package com.folio.reader.data

import com.folio.reader.core.JsonIo
import com.folio.reader.core.LocalBook
import com.folio.reader.core.Origin
import com.folio.reader.core.SyncState
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 书架真相：`filesDir/library/books.json`。
 *
 * 3.0 的核心变化 —— 桌面端的书架清单降级成「元数据提示」，
 * 手机这份文件才是真相。所以它必须：
 *  - 每次写都原子落盘（[JsonIo] 负责 tmp+rename）；
 *  - 支持按键改名（上传后桌面端回了不同的 id，键要跟着迁，否则同一本书变两条）；
 *  - 读坏文件时返回空列表而不是抛异常，UI 至少能起来。
 *
 * 单独一个文件、单独一把锁：进度写入频率远高于书架，混在一起会让
 * 每次翻页都重写整份书架。
 */
class BookStore(
    /** `filesDir/library` */
    private val dir: File,
) {

    private val file: File get() = File(dir, FILE_NAME)

    /** 读全部书。文件坏了返回空列表（不抛）。 */
    @Synchronized
    fun read(): List<LocalBook> {
        // 新格式：顶层就是数组
        JsonIo.readArray(file)?.let { array -> return array.toBooks(Origin.DESKTOP) }
        // 兼容 2.5 的 `{ "books": [...] }`
        val legacy = JsonIo.readObject(file)?.optJSONArray("books")
        return legacy?.toBooks(Origin.DESKTOP) ?: emptyList()
    }

    /** 覆盖写。 */
    @Synchronized
    fun write(books: List<LocalBook>): Boolean {
        val array = JSONArray()
        books.forEach { array.put(it.toJson()) }
        return JsonIo.write(file, array)
    }

    /** 有则更新、无则追加（按 id 匹配）。返回写入后的完整列表。 */
    @Synchronized
    fun upsert(book: LocalBook): List<LocalBook> {
        val current = read().toMutableList()
        val index = current.indexOfFirst { it.id == book.id }
        if (index >= 0) current[index] = book else current.add(book)
        write(current)
        return current
    }

    /** 批量合并（同一 id 后者覆盖前者）。 */
    @Synchronized
    fun upsertAll(incoming: List<LocalBook>): List<LocalBook> {
        if (incoming.isEmpty()) return read()
        val current = read().toMutableList()
        for (book in incoming) {
            val index = current.indexOfFirst { it.id == book.id }
            if (index >= 0) current[index] = book else current.add(book)
        }
        write(current)
        return current
    }

    @Synchronized
    fun remove(id: String): List<LocalBook> {
        val current = read().filterNot { it.id == id }
        write(current)
        return current
    }

    fun findById(id: String): LocalBook? = read().firstOrNull { it.id == id }

    /** 按内容哈希找已有的书（导入去重、上传复用服务端 id 都要用）。 */
    fun findByHash(hash: String): LocalBook? =
        if (hash.isBlank()) null else read().firstOrNull { it.contentHash == hash }

    /** 按桌面端 id 找（清单对齐时不能只看本地 id）。 */
    fun findByRemoteId(remoteId: String): LocalBook? =
        if (remoteId.isBlank()) null else read().firstOrNull { it.remoteId == remoteId || it.id == remoteId }

    /**
     * 换主键。
     *
     * 场景：本机导入的书是 `sha1-<hash>`，上传后桌面端说「这本我早就有，id 是 X」。
     * 此时必须把 books.json 的 id 与 remoteId 一起改成 X，并让调用方迁移进度键；
     * 漏掉这一步的后果是同一本书在两端各一条、进度也分裂成两份。
     *
     * @return 改好的书；找不到或新 id 已经被别的书占用时返回 null（宁可不动，也不要产生重复键）
     */
    @Synchronized
    fun renameKey(oldId: String, newId: String): LocalBook? {
        if (oldId == newId) return findById(oldId)
        val current = read().toMutableList()
        val index = current.indexOfFirst { it.id == oldId }
        if (index < 0) return null
        if (current.any { it.id == newId }) return current.firstOrNull { it.id == newId }
        val renamed = current[index].copy(id = newId, remoteId = current[index].remoteId ?: newId)
        current[index] = renamed
        write(current)
        return renamed
    }

    /** 记一下最近阅读时间（书架排序用，失败不抛）。 */
    @Synchronized
    fun touchRead(id: String, at: Long = System.currentTimeMillis()): LocalBook? {
        val current = read().toMutableList()
        val index = current.indexOfFirst { it.id == id }
        if (index < 0) return null
        current[index] = current[index].copy(lastReadAt = at)
        write(current)
        return current[index]
    }

    /** 更新同步状态（只动一两个字段，避免整对象覆盖掉别的改动）。 */
    @Synchronized
    fun updateSyncState(id: String, state: SyncState, hash: String? = null, size: Long? = null): LocalBook? {
        val current = read().toMutableList()
        val index = current.indexOfFirst { it.id == id }
        if (index < 0) return null
        current[index] = current[index].copy(
            syncState = state,
            contentHash = hash ?: current[index].contentHash,
            size = size ?: current[index].size,
        )
        write(current)
        return current[index]
    }

    private fun JSONArray.toBooks(origin: Origin): List<LocalBook> {
        val out = ArrayList<LocalBook>(length())
        for (i in 0 until length()) {
            val item = optJSONObject(i) ?: continue
            LocalBook.fromJson(item, origin)?.let { out.add(it) }
        }
        return out
    }

    companion object {
        const val FILE_NAME = "books.json"

        /** 供迁移用：直接构造一份 json 数组。 */
        fun arrayOf(books: List<LocalBook>): JSONArray {
            val array = JSONArray()
            books.forEach { array.put(it.toJson()) }
            return array
        }

        /** 供迁移用：把旧格式对象里的 books 数组取出来。 */
        fun legacyArray(json: JSONObject?): JSONArray? = json?.optJSONArray("books")
    }
}
