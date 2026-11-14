package com.folio.reader.data

import com.folio.reader.core.LocalBook
import org.json.JSONArray
import org.json.JSONObject

/**
 * 快照节流（T10）。
 *
 * 为什么要手机侧再挡一层：桌面端自己只做 30s 节流，而手机的触发点有三个
 * （连接成功 / 同步结束 / 退出阅读器），弱网下一晚上重连二十次就会把
 * 「快照」打成同步之外的第二条流量来源。这里的内存节流是第一道闸，
 * **只记在内存里**：进程被杀就清零，宁可多报一次，也不要落盘一个会撒谎的时间戳。
 */
object SnapshotThrottle {

    /** 两次快照的最小间隔：60s（架构文档 §4）。 */
    const val INTERVAL_MS = 60_000L

    /**
     * 现在该不该发。
     *
     * @param lastAt 上次真正发出请求的时刻；0 表示本次进程还没发过
     * @param now 当前时刻
     *
     * 时钟回拨（`now < lastAt`）也要放行：用户手动改过系统时间的话，
     * 死守 `now - lastAt` 会让快照永久停摆，而多报一次的代价远小于设备页一直显示旧书架。
     */
    fun shouldSend(lastAt: Long, now: Long): Boolean {
        if (lastAt <= 0L) return true
        if (now < lastAt) return true
        return now - lastAt >= INTERVAL_MS
    }
}

/**
 * 快照体构建（T10）：**只带摘要，不带正文、不带手机路径**。
 *
 * 桌面端 `devicestore.setSnapshot` 只认四个字段：
 * `books[].{hash,title,size,hasLocalFile}` + `storageTotal/storageFree/booksBytes`，
 * 其余（`appVersion` / `apiVersion` / `truncated`）是给人看的与排障用的，
 * 多带了桌面端也不会炸 —— 但它会原样存进 devices.json，所以一个字节也别浪费。
 *
 * 体积上限取 200KB 而不是桌面端拒绝线的 256KB：留出 JSON 转义与后续加字段的余量，
 * 免得某天书多到卡在「刚好超一点」上，每次同步都白跑一趟再被 400。
 */
object SnapshotBuilder {

    /** 单次快照的体积上限 200KB。 */
    const val MAX_BYTES = 200 * 1024

    /** 外壳字段（存储三项 + 版本 + 条数）的预留字节数，别让外壳把上限吃掉。 */
    private const val SHELL_BYTES = 512

    /** 构建结果。 */
    data class Built(
        val body: JSONObject,
        /** 是不是因为超上限被截断了（桌面端据此提示「书架没看全」）。 */
        val truncated: Boolean,
        /** 实际字节数（UTF-8）。 */
        val bytes: Int,
        /** 真正进快照的书数。 */
        val count: Int,
    )

    /**
     * 拼快照体。
     *
     * @param books 手机书架（顺序不重要，内部按 `addedAt` 倒序：新书先留）
     * @param storageTotal 手机存储总量（字节）
     * @param storageFree 手机剩余空间（字节）
     * @param booksBytes 正文文件实际占用（字节）
     * @param maxBytes 体积上限，单测要把它调小才能验截断
     */
    fun build(
        books: List<LocalBook>,
        storageTotal: Long,
        storageFree: Long,
        booksBytes: Long,
        appVersion: String,
        apiVersion: Int,
        maxBytes: Int = MAX_BYTES,
    ): Built {
        val limit = if (maxBytes > 0) maxBytes else MAX_BYTES
        // 没有 40 位 hash 的书进不了快照：桌面端两侧对账全靠 hash，塞空串只会让它以为有本无名书
        val ordered = books
            .filter { it.contentHash?.length == 40 }
            .sortedByDescending { it.addedAt }

        val array = JSONArray()
        var used = SHELL_BYTES
        var truncated = false
        for (book in ordered) {
            val item = JSONObject()
                .put("hash", book.contentHash.orEmpty().lowercase())
                .put("title", book.title)
                .put("size", book.size)
                .put("hasLocalFile", book.hasLocalFile)
            val itemBytes = item.toString().toByteArray(Charsets.UTF_8).size + 1
            if (used + itemBytes > limit) {
                truncated = true
                break
            }
            array.put(item)
            used += itemBytes
        }

        var body = compose(array, storageTotal, storageFree, booksBytes, appVersion, apiVersion, truncated)
        // 估算用的是「每条单独序列化」的字节数，转义规则与整段一致，理论上不会超；
        // 但上限是硬约束，宁可多削几条也不能赌。
        while (bytesOf(body) > limit && array.length() > 0) {
            array.remove(array.length() - 1)
            truncated = true
            body = compose(array, storageTotal, storageFree, booksBytes, appVersion, apiVersion, truncated)
        }

        return Built(body = body, truncated = truncated, bytes = bytesOf(body), count = array.length())
    }

    private fun compose(
        books: JSONArray,
        storageTotal: Long,
        storageFree: Long,
        booksBytes: Long,
        appVersion: String,
        apiVersion: Int,
        truncated: Boolean,
    ): JSONObject = JSONObject()
        .put("books", books)
        .put("storageTotal", storageTotal)
        .put("storageFree", storageFree)
        .put("booksBytes", booksBytes)
        .put("appVersion", appVersion)
        .put("apiVersion", apiVersion)
        .put("truncated", truncated)

    private fun bytesOf(body: JSONObject): Int = body.toString().toByteArray(Charsets.UTF_8).size
}
