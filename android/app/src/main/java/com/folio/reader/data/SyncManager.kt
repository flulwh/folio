package com.folio.reader.data

import android.content.Context
import com.folio.reader.core.Book
import com.folio.reader.core.BookKind
import com.folio.reader.core.ProgressEntry
import com.folio.reader.core.ProgressMerger
import com.folio.reader.core.SyncOutcome
import com.folio.reader.core.TextParser
import com.folio.reader.net.FolioClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 双端同步。
 *
 * 拉：桌面端书架 + 进度，和手机本地进度按 updatedAt 合并。
 * 推：手机端比桌面端新的进度回写桌面端；断网时记在 pending 里，联网补写。
 */
class SyncManager(
    context: Context,
    private val settings: SettingsStore,
    private val library: LibraryStore,
    private val offline: OfflineStore,
) {
    private val appContext = context.applicationContext

    fun client(): FolioClient = FolioClient(settings.serverUrl, settings.token)

    /** 完整同步一次。 */
    suspend fun sync(): SyncOutcome = withContext(Dispatchers.IO) {
        if (!settings.hasServer) {
            return@withContext SyncOutcome(false, "还没填桌面端地址")
        }
        val client = client()
        try {
            val state = client.fetchState()

            // 1. 书架以桌面端为准
            library.writeBooks(state.books)

            // 2. 进度按 updatedAt 合并
            val local = library.readProgress()
            val (merged, changed) = ProgressMerger.merge(local, state.progress)
            if (changed) library.writeProgress(merged)

            // 3. 把本地更新的进度推回去
            var pushed = 0
            if (state.allowWrite) {
                val kinds = state.books.associate { it.id to it.kind }
                for ((id, entry) in merged) {
                    val serverEntry = state.progress[id]
                    val newer = serverEntry == null || entry.updatedAt > serverEntry.updatedAt
                    if (!newer) continue
                    val kind = kinds[id] ?: BookKind.LOCAL
                    val ok = client.postProgress(id, kind, entry)
                    if (ok) pushed++
                }
            }
            library.writePending(emptySet())
            settings.lastSyncAt = System.currentTimeMillis()
            SyncOutcome(
                ok = true,
                message = "已同步",
                pulled = state.books.size,
                pushed = pushed,
            )
        } catch (err: Exception) {
            SyncOutcome(false, err.message ?: "同步失败")
        }
    }

    /**
     * 推一条进度。离线时返回 false，调用方把它记进 pending。
     */
    suspend fun pushProgress(book: Book, entry: ProgressEntry): Boolean = withContext(Dispatchers.IO) {
        if (!settings.hasServer) return@withContext false
        try {
            client().postProgress(book.id, book.kind, entry)
        } catch (err: Exception) {
            false
        }
    }

    /**
     * 取本地书正文：优先离线缓存，没有才从桌面端拉并缓存。
     * 返回 null 表示这台设备拿不到（离线且没缓存）。
     */
    suspend fun loadLocalText(book: Book): Pair<String?, Boolean> = withContext(Dispatchers.IO) {
        val cached = offline.readLocalBook(book.id)
        if (cached != null) return@withContext cached to true

        if (!settings.hasServer) return@withContext null to false
        try {
            val text = client().fetchBookText(book.id)
            val parsed = TextParser.parseBook(text)
            offline.writeLocalBook(book, parsed)
            parsed.rawText to false
        } catch (err: Exception) {
            null to false
        }
    }

    /**
     * 取云端书某一章：优先离线缓存，没有才从桌面端拉并缓存。
     * 返回 null 表示离线且没缓存这一章。
     */
    suspend fun loadCloudChapter(book: Book, index: Int): Pair<String?, Boolean> =
        withContext(Dispatchers.IO) {
            val cached = offline.readCloudChapter(book.id, index)
            if (cached != null) return@withContext cached to true

            if (!settings.hasServer) return@withContext null to false
            try {
                val text = client().fetchChapter(book.id, index)
                offline.writeCloudChapter(book.id, index, "第 ${index + 1} 章", text)
                text to false
            } catch (err: Exception) {
                null to false
            }
        }

    /** 云端书目录：离线时用已缓存的章节号兜底。 */
    suspend fun loadToc(book: Book): Pair<List<com.folio.reader.core.TocChapter>, Boolean> =
        withContext(Dispatchers.IO) {
            val cached = offline.cachedCloudChapters(book.id)
            if (!settings.hasServer) {
                return@withContext cached.map { com.folio.reader.core.TocChapter(it, "第 ${it + 1} 章") } to true
            }
            try {
                val (chapters, _) = client().fetchToc(book.id)
                chapters to false
            } catch (err: Exception) {
                cached.map { com.folio.reader.core.TocChapter(it, "第 ${it + 1} 章") } to true
            }
        }

    /**
     * 手动把一本书拉到本地，之后断网也能读。
     * 返回缓存的章数；失败返回 -1。
     *
     * 云端书有几百章，全抓一遍既慢又费流量，这里只缓存开头若干章，
     * 剩下的章节在联网读到时顺手缓存。
     */
    suspend fun downloadForOffline(book: Book): Int = withContext(Dispatchers.IO) {
        if (!settings.hasServer) return@withContext -1
        try {
            if (book.isCloud) {
                val (toc, _) = client().fetchToc(book.id)
                val targets = toc.take(OFFLINE_CHAPTER_LIMIT)
                var done = 0
                for (chapter in targets) {
                    val text = client().fetchChapter(book.id, chapter.index)
                    offline.writeCloudChapter(book.id, chapter.index, chapter.title, text)
                    done++
                }
                done
            } else {
                val text = client().fetchBookText(book.id)
                val parsed = TextParser.parseBook(text)
                offline.writeLocalBook(book, parsed)
                1
            }
        } catch (err: Exception) {
            -1
        }
    }

    val cacheSize: Long get() = offline.cacheSize()

    fun clearCache() {
        offline.clearAll()
    }

    val appContextRef: Context get() = appContext

    companion object {
        /** 云端书一次性缓存的章节上限，剩下的靠读到时顺手缓存。 */
        const val OFFLINE_CHAPTER_LIMIT = 12
    }
}
