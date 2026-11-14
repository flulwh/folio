package com.folio.reader.data

import com.folio.reader.core.BookKind
import com.folio.reader.core.LocalBook
import com.folio.reader.core.ProgressEntry
import com.folio.reader.core.ProgressMerger
import com.folio.reader.net.FolioClient
import com.folio.reader.net.FolioException

/**
 * 进度的上下行：推一条、拉回来合并、把 `pending` 里欠的补上。
 *
 * 2.5 里这些活是 `SyncManager` 兼职干的；3.0 把「搬书」交给 [SyncEngine]，
 * 进度这种高频小写入单独留在这里 —— 两者失败原因和对用户的意义完全不同
 * （书没搬完 vs 进度没回写），混在一起会让错误提示说不清。
 *
 * 合并规则一个字都不新造：仍然只用
 * [ProgressMerger]（新者赢 + 浅合并），与桌面端 `mergeProgressEntry` 语义一致。
 */
class ProgressSync(
    private val progress: ProgressStore,
    private val books: BookStore,
    private val clientProvider: () -> FolioClient,
) {

    /** 补写的结果。 */
    data class Outcome(
        val pushed: Int = 0,
        val failed: Int = 0,
        val merged: Int = 0,
        val message: String = "",
    ) {
        val ok: Boolean get() = failed == 0
    }

    /**
     * 推一条进度。失败时把书 id 记进 `pending.json`，下次连上补写。
     *
     * @return true 表示桌面端已接受
     */
    fun push(book: LocalBook, entry: ProgressEntry): Boolean {
        val id = book.remoteId ?: book.id
        return try {
            val accepted = clientProvider().postProgress(id, book.kind, entry)
            if (accepted) markDone(book.id) else markPending(book.id)
            accepted
        } catch (err: Exception) {
            markPending(book.id)
            false
        }
    }

    /**
     * 拉回桌面端进度并合并（新者赢）。
     *
     * 只用于「连上之后对齐一次」，不做轮询：手机上翻页是权威来源，
     * 频繁拉取只会在两端互相覆盖。
     *
     * @return 真的变化了几条
     */
    fun pullAndMerge(): Int {
        val remote = try {
            clientProvider().fetchState().progress
        } catch (err: FolioException) {
            return 0
        } catch (err: Exception) {
            return 0
        }
        if (remote.isEmpty()) return 0
        val local = progress.read()
        val (merged, changed) = ProgressMerger.merge(local, remote)
        if (!changed) return 0
        var count = 0
        for ((id, entry) in merged) {
            if (local[id] != entry) count += 1
        }
        progress.write(merged)
        return count
    }

    /**
     * 把所有 `pending` 补写一遍。
     *
     * 桌面端说「书架上没有这本书」不算失败：说明那本书已经被删了，
     * 继续把它挂在 pending 里只会每轮都报一次错。
     */
    fun flushPending(): Outcome {
        val pending = progress.readPending()
        if (pending.isEmpty()) return Outcome(message = "")
        val all = progress.read()
        var pushed = 0
        var failed = 0
        val keep = mutableSetOf<String>()
        for (id in pending) {
            val entry = all[id]
            if (entry == null) continue
            val book = books.findById(id)
            val targetId = book?.remoteId ?: id
            val kind = book?.kind ?: BookKind.LOCAL
            val accepted = try {
                clientProvider().postProgress(targetId, kind, entry)
            } catch (err: FolioException) {
                if (err.status == 404 || err.status == 400) true else false
            } catch (err: Exception) {
                false
            }
            if (accepted) pushed += 1 else {
                failed += 1
                keep.add(id)
            }
        }
        progress.writePending(keep)
        return Outcome(
            pushed = pushed,
            failed = failed,
            message = when {
                failed == 0 -> "进度已同步到桌面端"
                pushed == 0 -> "进度先存在手机里，连上桌面端会自动补同步"
                else -> "同步了 $pushed 条，还有 $failed 条等下次"
            },
        )
    }

    /* ---------------- 内部 ---------------- */

    private fun markPending(id: String) {
        val pending = progress.readPending()
        if (pending.add(id)) progress.writePending(pending)
    }

    private fun markDone(id: String) {
        val pending = progress.readPending()
        if (pending.remove(id)) progress.writePending(pending)
    }
}
