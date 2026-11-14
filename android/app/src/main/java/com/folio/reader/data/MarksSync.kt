package com.folio.reader.data

import com.folio.reader.core.JsonIo
import com.folio.reader.core.MarkSync
import com.folio.reader.core.ReaderMark
import com.folio.reader.net.FolioClient
import org.json.JSONObject
import java.io.File

/** 一次痕迹同步的结果；`supported = false` 表示桌面端还没有 `/api/marks`。 */
data class MarksSyncOutcome(
    val supported: Boolean,
    val pushed: Int = 0,
    val pulled: Int = 0,
    val removedLocal: Int = 0,
    val removedRemote: Int = 0,
    val failed: Int = 0,
    val message: String = "",
) {
    val changed: Boolean get() = pushed + pulled + removedLocal + removedRemote > 0
    val ok: Boolean get() = supported && failed == 0
}

/**
 * 双端痕迹同步。
 *
 * 数据很小（一本书最多几百条），所以不做增量：一次拉全量，在本地按
 * [MarkSync.merge] 算合并结果，再把「要新增/更新的」和「要删的 key」一起推回去。
 *
 * 快照文件 `marks-sync.json` 是删除能否生效的关键 —— 没有它就分不清
 * 「桌面端删了」和「桌面端本来就没有」。
 */
class MarksSync(
    private val store: MarkStore,
    private val books: BookStore,
    /** `filesDir/library/marks-sync.json` */
    private val baseFile: File,
    private val client: () -> FolioClient,
) {

    /**
     * 同步全部有痕迹的书。
     *
     * 单本书的失败（超时、桌面端临时不可写）只记一次 [MarksSyncOutcome.failed]，
     * 不影响其他书，也不清掉那本书的旧快照 —— 下一次还能正确判断删除。
     */
    @Synchronized
    fun sync(): MarksSyncOutcome {
        val snapshot = try {
            client().fetchMarks()
        } catch (err: Exception) {
            return MarksSyncOutcome(supported = true, failed = 1, message = err.message.orEmpty())
        }
        if (!snapshot.supported) return MarksSyncOutcome(supported = false)
        if (!snapshot.ok) {
            return MarksSyncOutcome(supported = true, failed = 1, message = snapshot.message)
        }

        val localAll = store.readAll()
        val nextBase = readBase().toMutableMap()
        var pushed = 0
        var pulled = 0
        var removedLocal = 0
        var removedRemote = 0
        var failed = 0

        for (book in books.read()) {
            val remoteId = book.remoteId ?: book.id
            val local = localAll[book.id].orEmpty()
            val remote = snapshot.marks[remoteId].orEmpty()
            val base = nextBase[remoteId].orEmpty()
            if (local.isEmpty() && remote.isEmpty() && base.isEmpty()) continue

            val plan = MarkSync.merge(local, remote, base)
            var final = plan.merged

            if (plan.needsPush) {
                val result = try {
                    client().pushMarks(remoteId, plan.push, plan.removeRemote)
                } catch (err: Exception) {
                    failed++
                    continue
                }
                if (!result.supported) return MarksSyncOutcome(supported = false)
                if (!result.ok) {
                    failed++
                    continue
                }
                pushed += plan.push.size
                removedRemote += plan.removeRemote.size
                // 桌面端可能拒绝了较旧的版本，以它返回的最终列表为准
                final = result.marks
            }

            if (!sameMarks(local, final)) store.writeAll(book.id, final)
            pulled += plan.pulled
            removedLocal += plan.removedLocal
            nextBase[remoteId] = final.associate { it.syncKey to MarkSync.tagOf(it) }
        }

        writeBase(nextBase)
        return MarksSyncOutcome(
            supported = true,
            pushed = pushed,
            pulled = pulled,
            removedLocal = removedLocal,
            removedRemote = removedRemote,
            failed = failed,
            message = if (failed > 0) "$failed 本书的痕迹没同步上" else "",
        )
    }

    /** 只比较内容，不管顺序与 id。 */
    private fun sameMarks(a: List<ReaderMark>, b: List<ReaderMark>): Boolean {
        if (a.size != b.size) return false
        val right = b.associate { it.syncKey to MarkSync.tagOf(it) }
        return a.all { right[it.syncKey] == MarkSync.tagOf(it) }
    }

    /* ---------------- 快照 ---------------- */

    private fun readBase(): Map<String, Map<String, String>> {
        val root = JsonIo.readObject(baseFile) ?: return emptyMap()
        val out = LinkedHashMap<String, Map<String, String>>()
        val bookIds = root.keys()
        while (bookIds.hasNext()) {
            val bookId = bookIds.next()
            val entry = root.optJSONObject(bookId) ?: continue
            val tags = LinkedHashMap<String, String>()
            val keys = entry.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val tag = entry.optString(key)
                if (tag.isNotBlank()) tags[key] = tag
            }
            out[bookId] = tags
        }
        return out
    }

    private fun writeBase(base: Map<String, Map<String, String>>) {
        val root = JSONObject()
        for ((bookId, tags) in base) {
            val entry = JSONObject()
            for ((key, tag) in tags) entry.put(key, tag)
            root.put(bookId, entry)
        }
        JsonIo.write(baseFile, root)
    }
}
