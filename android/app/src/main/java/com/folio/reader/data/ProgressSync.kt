package com.folio.reader.data

import com.folio.reader.core.BookKind
import com.folio.reader.core.LocalBook
import com.folio.reader.core.ProgressEntry
import com.folio.reader.core.ProgressMerger
import com.folio.reader.net.FolioClient
import com.folio.reader.net.FolioException

/**
 * 进度的双向同步。
 *
 * 一次 [sync] 做三件事，顺序不能换：
 *  1. **拉**：取桌面端整份进度，按「桌面 id → 本机 id」翻译后与本地逐条合并，
 *     `updatedAt` 新的赢、字段浅合并（规则见 [ProgressMerger]，与桌面端一致）。
 *  2. **落**：只有真的变了才写 `progress.json`，避免无谓的整文件重写。
 *  3. **回推**：凡是合并后**本地这份更新**的条目，原样写回桌面端；台面上再没有
 *     「只拉不推」或「只推不拉」，两端一轮之后就收敛到同一位置。
 *
 * 推送失败（桌面端没开、网络断了）只把书 id 记进 `pending.json`，下次连上补写；
 * 桌面端回 404/400 说明这本书在那边已经被删了，不算失败，也不该永远挂着。
 */
class ProgressSync(
    private val progress: ProgressStore,
    private val books: BookStore,
    private val clientProvider: () -> FolioClient,
) {

    /** 双向合并的结果，给 UI 汇报用。 */
    data class Report(
        /** 桌面端更新、手机采纳的条数。 */
        val adopted: Int = 0,
        /** 被采纳的书 id（本机 id），用来把正在读的那本书同步挪位。 */
        val adoptedIds: Set<String> = emptySet(),
        /** 手机更新、回写桌面端的条数。 */
        val pushed: Int = 0,
        /** 回写失败、留待下次的条数。 */
        val failed: Int = 0,
        /** 这次到底有没有连上桌面端。 */
        val reachable: Boolean = true,
        val message: String = "",
    )

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
     * 双向对齐一次：拉回来合并，再把手机这边更新的条目推回去。
     *
     * 拉不到桌面端进度时什么都不改，返回 `reachable = false`，
     * 让调用方保留「进度先存在手机里」的提示，而不是假装同步成功。
     */
    fun sync(): Report {
        val client = clientProvider()
        val state = try {
            client.fetchState()
        } catch (err: Exception) {
            return Report(reachable = false, message = "连不上桌面端，进度先存在本机")
        }
        val remote = state.progress
        // 桌面端书架里没有的书不回写：否则每次同步都会拿 404 撞一遍
        val remoteBookIds = state.books.map { it.id }.toSet()
        if (remote.isEmpty()) return Report()

        val allBooks = books.read()
        val byLocalId = allBooks.associateBy { it.id }
        val byRemoteId = allBooks.associateBy { it.remoteId ?: it.id }

        // 1+2. 拉回来合并。桌面端的键是它的书 id，本机进度按本机 id 存，
        // 两边 id 不一致时（上传归并过、或手机自己导入的书）必须先翻译，
        // 否则进度会落在一个永远没人读的键上。
        val local = progress.read()
        val next = LinkedHashMap(local)
        var adopted = 0
        val adoptedIds = mutableSetOf<String>()
        for ((remoteId, remoteEntry) in remote) {
            val book = byRemoteId[remoteId]
            val localId = book?.id ?: remoteId
            val incoming = remoteEntry.withId(localId)
            val current = next[localId]
            val merged = ProgressMerger.mergeEntry(current, incoming) ?: continue
            if (merged == current) continue
            next[localId] = merged
            if (current == null || incoming.updatedAt > current.updatedAt) {
                adopted += 1
                adoptedIds += localId
            }
        }
        if (next != local) progress.write(next)

        // 3. 回推：本地比桌面端新的条目写回去，两端收敛到同一份。
        // 相等就跳过，避免两端互相推同一条形成来回抖动。
        val pending = progress.readPending()
        var pushed = 0
        var failed = 0
        for ((localId, entry) in next) {
            val book = byLocalId[localId]
            val remoteId = book?.remoteId ?: localId
            if (remoteId !in remoteBookIds) continue
            val remoteEntry = remote[remoteId]
            if (remoteEntry != null && entry.updatedAt <= remoteEntry.updatedAt) continue
            when (val result = post(client, book, remoteId, entry)) {
                PushResult.DONE -> {
                    pushed += 1
                    pending.remove(localId)
                }
                PushResult.GONE -> pending.remove(localId)
                PushResult.FAILED -> {
                    failed += 1
                    pending.add(localId)
                }
            }
        }
        progress.writePending(pending)

        return Report(
            adopted = adopted,
            adoptedIds = adoptedIds,
            pushed = pushed,
            failed = failed,
            message = messageOf(adopted, pushed, failed),
        )
    }

    /**
     * 推一条进度。失败时把书 id 记进 `pending.json`，下次连上补写。
     *
     * @return true 表示桌面端已接受
     */
    fun push(book: LocalBook, entry: ProgressEntry): Boolean {
        val id = book.remoteId ?: book.id
        val result = post(clientProvider(), book, id, entry)
        return when (result) {
            PushResult.DONE -> {
                markDone(book.id)
                true
            }
            PushResult.GONE -> {
                markDone(book.id)
                true
            }
            PushResult.FAILED -> {
                markPending(book.id)
                false
            }
        }
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
            when (post(clientProvider(), book, targetId, entry)) {
                PushResult.DONE -> pushed += 1
                PushResult.GONE -> Unit
                PushResult.FAILED -> {
                    failed += 1
                    keep.add(id)
                }
            }
        }
        progress.writePending(keep)
        return Outcome(
            pushed = pushed,
            failed = failed,
            message = when {
                failed == 0 && pushed > 0 -> "进度已同步到桌面端"
                pushed == 0 -> "进度先存在手机里，连上桌面端会自动补同步"
                else -> "同步了 $pushed 条，还有 $failed 条等下次"
            },
        )
    }

    /* ---------------- 内部 ---------------- */

    private enum class PushResult { DONE, GONE, FAILED }

    private fun post(
        client: FolioClient,
        book: LocalBook?,
        remoteId: String,
        entry: ProgressEntry,
    ): PushResult {
        val kind = book?.kind
            ?: if (entry.chapter != null || entry.windowBase != null) BookKind.CLOUD else BookKind.LOCAL
        return try {
            val ok = client.postProgress(remoteId, kind, entry.withId(remoteId))
            if (ok) PushResult.DONE else PushResult.FAILED
        } catch (err: FolioException) {
            // 404/400：桌面端没有这本书（删了，或书 id 已变），别无限重试
            if (err.status == 404 || err.status == 400) PushResult.GONE else PushResult.FAILED
        } catch (err: Exception) {
            PushResult.FAILED
        }
    }

    private fun messageOf(adopted: Int, pushed: Int, failed: Int): String {
        if (adopted == 0 && pushed == 0) {
            return if (failed > 0) "进度回写失败 $failed 条，下次连上补写" else ""
        }
        val head = when {
            adopted > 0 && pushed > 0 -> "进度已双向对齐（取回 $adopted 条、回写 $pushed 条）"
            adopted > 0 -> "从桌面端取回 $adopted 条最新进度"
            else -> "已把 $pushed 条本机进度回写桌面端"
        }
        return if (failed > 0) "$head，另有 $failed 条等下次" else head
    }

    private fun markPending(id: String) {
        val pending = progress.readPending()
        if (pending.add(id)) progress.writePending(pending)
    }

    private fun markDone(id: String) {
        val pending = progress.readPending()
        if (pending.remove(id)) progress.writePending(pending)
    }
}
