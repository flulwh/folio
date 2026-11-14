package com.folio.reader.data

import com.folio.reader.core.JsonIo
import com.folio.reader.core.SyncState
import org.json.JSONObject
import java.io.File

/**
 * 每本书的同步状态：`filesDir/library/sync-state.json`。
 *
 * 单独一份文件的原因和进度一样 —— 传输过程中会频繁写 `bytesDone`，
 * 不能拖着书架一起重写。同时它也是「续传」的落点：
 * 断网时留下 `bytesDone`，下次连接先 `upload/status` 或 Range 探测，
 * 从断点接着传，而不是让用户重等一遍。
 */
class SyncStateStore(
    /** `filesDir/library` */
    private val dir: File,
) {

    /** 一本书的同步状态快照。 */
    data class Entry(
        val state: SyncState = SyncState.NOT_SYNCED,
        val lastError: String? = null,
        val at: Long = 0L,
        val bytesDone: Long = 0L,
        val totalBytes: Long = 0L,
    ) {
        val progressPercent: Int
            get() = if (totalBytes <= 0L) 0 else ((bytesDone * 100) / totalBytes).toInt().coerceIn(0, 100)
    }

    private val file: File get() = File(dir, FILE_NAME)

    /** 读全部状态。 */
    @Synchronized
    fun read(): Map<String, Entry> {
        val json = JsonIo.readObject(file) ?: return emptyMap()
        val books = json.optJSONObject(KEY_BOOKS) ?: return emptyMap()
        val out = LinkedHashMap<String, Entry>()
        val keys = books.keys()
        while (keys.hasNext()) {
            val id = keys.next()
            val item = books.optJSONObject(id) ?: continue
            out[id] = Entry(
                state = SyncState.fromWire(item.optString("state")),
                lastError = item.optString("lastError").takeIf { it.isNotBlank() && it != "null" },
                at = item.optLong("at", 0L),
                bytesDone = item.optLong("bytesDone", 0L),
                totalBytes = item.optLong("totalBytes", 0L),
            )
        }
        return out
    }

    fun get(id: String): Entry? = read()[id]

    @Synchronized
    private fun write(all: Map<String, Entry>, lastSyncAt: Long): Boolean {
        val books = JSONObject()
        for ((id, entry) in all) {
            val item = JSONObject()
                .put("state", entry.state.wire)
                .put("at", entry.at)
                .put("bytesDone", entry.bytesDone)
                .put("totalBytes", entry.totalBytes)
            entry.lastError?.let { item.put("lastError", it) }
            books.put(id, item)
        }
        val json = JSONObject().put(KEY_BOOKS, books).put(KEY_LAST_SYNC, lastSyncAt)
        return JsonIo.write(file, json)
    }

    @Synchronized
    fun put(id: String, entry: Entry): Boolean {
        val all = read().toMutableMap()
        all[id] = entry
        return write(all, lastSyncAt())
    }

    @Synchronized
    fun remove(id: String): Boolean {
        val all = read().toMutableMap()
        if (all.remove(id) == null) return false
        return write(all, lastSyncAt())
    }

    /** 开始传输：先记 0，防止上次的 bytesDone 把续传带到错位置。 */
    fun markTransferring(id: String, totalBytes: Long): Boolean =
        put(id, Entry(SyncState.TRANSFERRING, null, System.currentTimeMillis(), 0L, totalBytes))

    /** 传了一部分（写盘节流由调用方控制）。 */
    fun markProgress(id: String, bytesDone: Long, totalBytes: Long): Boolean =
        put(id, Entry(SyncState.TRANSFERRING, null, System.currentTimeMillis(), bytesDone, totalBytes))

    fun markSynced(id: String): Boolean =
        put(id, Entry(SyncState.SYNCED, null, System.currentTimeMillis(), 0L, 0L))

    /** 失败：留着 bytesDone，下次接着传。 */
    fun markFailed(id: String, error: String, bytesDone: Long, totalBytes: Long): Boolean =
        put(id, Entry(SyncState.FAILED, error, System.currentTimeMillis(), bytesDone, totalBytes))

    /** 永不参与同步（超过 30MB / 云端书）。 */
    fun markExcluded(id: String, reason: String): Boolean =
        put(id, Entry(SyncState.EXCLUDED, reason, System.currentTimeMillis(), 0L, 0L))

    /** 同名不同内容：不传，等用户选。 */
    fun markMismatch(id: String, reason: String): Boolean =
        put(id, Entry(SyncState.CONTENT_MISMATCH, reason, System.currentTimeMillis(), 0L, 0L))

    @Synchronized
    fun clear(): Boolean = write(emptyMap(), 0L)

    /** 上次整体同步完成的时间。 */
    @Synchronized
    fun lastSyncAt(): Long = JsonIo.readObject(file)?.optLong(KEY_LAST_SYNC, 0L) ?: 0L

    @Synchronized
    fun setLastSyncAt(at: Long) {
        write(read(), at)
    }

    companion object {
        const val FILE_NAME = "sync-state.json"
        private const val KEY_BOOKS = "books"
        private const val KEY_LAST_SYNC = "lastSyncAt"
    }
}
