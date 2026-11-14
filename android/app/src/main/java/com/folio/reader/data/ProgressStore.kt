package com.folio.reader.data

import com.folio.reader.core.JsonIo
import com.folio.reader.core.ProgressEntry
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 阅读进度：`filesDir/library/progress.json` 与 `pending.json`。
 *
 * 为什么和书架分开两个文件：翻页时每 0.6 秒就要写一次进度，
 * 如果混在 books.json 里，等于每翻一页把整份书架重写一遍 ——
 * 几百本书时这个开销足以让滚动可见地卡一下。
 *
 * 字段名与桌面端 `progress.json` 一字不差，合并规则仍然只用
 * [com.folio.reader.core.ProgressMerger]（新者赢 + 浅合并），这里不新造规则。
 */
class ProgressStore(
    /** `filesDir/library` */
    private val dir: File,
) {

    private val progressFile: File get() = File(dir, FILE_PROGRESS)
    private val pendingFile: File get() = File(dir, FILE_PENDING)

    @Synchronized
    fun read(): MutableMap<String, ProgressEntry> {
        val result = LinkedHashMap<String, ProgressEntry>()
        val json = JsonIo.readObject(progressFile) ?: return result
        val keys = json.keys()
        while (keys.hasNext()) {
            val id = keys.next()
            val entry = json.optJSONObject(id) ?: continue
            ProgressEntry.fromJson(id, entry)?.let { result[id] = it }
        }
        return result
    }

    @Synchronized
    fun write(progress: Map<String, ProgressEntry>): Boolean {
        val json = JSONObject()
        for ((id, entry) in progress) {
            // 云端书带章节锚点，本地书只有段落号；两者字段都按桌面端口径写
            val kind = if (entry.chapter != null || entry.windowBase != null) "cloud" else "local"
            json.put(id, entry.toJson(kind))
        }
        return JsonIo.write(progressFile, json)
    }

    @Synchronized
    fun put(entry: ProgressEntry): Boolean {
        val current = read()
        current[entry.id] = entry
        return write(current)
    }

    /** 读一条；没有返回 null。 */
    fun get(id: String): ProgressEntry? = read()[id]

    /** 删一条（把书从书架移除时用，否则 progress.json 会留下孤儿键）。 */
    @Synchronized
    fun remove(id: String): Boolean {
        val current = read()
        if (current.remove(id) == null) return false
        write(current)
        val pending = readPending()
        if (pending.remove(id)) writePending(pending)
        return true
    }

    /**
     * 换进度键。上传后桌面端回了不同的 id 时，进度必须跟着搬，
     * 否则用户点开那本书会看到「从头开始」。
     */
    @Synchronized
    fun renameKey(oldId: String, newId: String): Boolean {
        if (oldId == newId) return false
        val current = read()
        val entry = current[oldId] ?: return false
        current.remove(oldId)
        // 新键已有更新的一份就保留更新的那条
        val existing = current[newId]
        if (existing == null || entry.updatedAt >= existing.updatedAt) {
            current[newId] = entry.withId(newId)
        }
        write(current)
        // pending 里的 id 也要一起改，否则补写会指向一个不存在的书
        val pending = readPending()
        if (pending.remove(oldId)) {
            pending.add(newId)
            writePending(pending)
        }
        return true
    }

    /* ---------------- 待补写 ---------------- */

    @Synchronized
    fun readPending(): MutableSet<String> {
        val ids = mutableSetOf<String>()
        val json = JsonIo.readObject(pendingFile) ?: return ids
        val array = json.optJSONArray("ids") ?: return ids
        for (i in 0 until array.length()) {
            array.optString(i).takeIf { it.isNotBlank() }?.let { ids.add(it) }
        }
        return ids
    }

    @Synchronized
    fun writePending(ids: Set<String>): Boolean {
        val array = JSONArray()
        ids.forEach { array.put(it) }
        return JsonIo.write(pendingFile, JSONObject().put("ids", array))
    }

    companion object {
        const val FILE_PROGRESS = "progress.json"
        const val FILE_PENDING = "pending.json"
    }
}
