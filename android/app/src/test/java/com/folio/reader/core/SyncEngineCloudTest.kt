package com.folio.reader.core

import com.folio.reader.data.BookFileStore
import com.folio.reader.data.BookStore
import com.folio.reader.data.ProgressStore
import com.folio.reader.data.SyncEngine
import com.folio.reader.data.SyncStateStore
import com.folio.reader.net.RemoteBook
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * 云端书元数据落地（`SyncEngine.reconcileCloudBooks`）。
 *
 * 这一层是 3.0 的一个关键闭环：云端书正文永远不进手机磁盘，但**书必须出现在书架上**。
 * 之前缺了这一步，`/api/library` 里的云端书只被拿去建搬运索引、建完就被丢弃，
 * 结果手机书架永远没有云端分区，阅读器里 isCloud 的分支全是死代码。
 *
 * 断言一律读**落盘的 JSON 文件**，不信内存返回值 —— 只信返回值的测试，
 * 在写盘失败时会照样变绿。
 */
class SyncEngineCloudTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private lateinit var libraryDir: File
    private lateinit var books: BookStore
    private lateinit var progress: ProgressStore
    private lateinit var syncState: SyncStateStore
    private lateinit var engine: SyncEngine

    private fun setUpStores() {
        libraryDir = File(tmp.root, "library").apply { mkdirs() }
        books = BookStore(libraryDir)
        progress = ProgressStore(libraryDir)
        syncState = SyncStateStore(libraryDir)
        engine = SyncEngine(
            books = books,
            progress = progress,
            syncState = syncState,
            files = BookFileStore(tmp.root),
            // 这一步是纯元数据对齐，不该发任何网络请求；真调到了就让它炸，别静默通过。
            clientProvider = { error("reconcileCloudBooks 不该访问网络") },
        )
    }

    private fun remoteCloud(
        id: String,
        title: String,
        hash: String? = null,
        type: BookType = BookType.NOVEL,
        size: Long = 0L,
    ): RemoteBook = RemoteBook(
        book = LocalBook(
            id = id,
            title = title,
            origin = Origin.DESKTOP,
            remoteKind = BookKind.CLOUD,
            type = type,
            contentHash = hash,
            size = size,
            hasLocalFile = false,
        ),
        // 故意标成「可同步」：云端书即使被标可同步，也绝不能进搬运队列
        syncable = true,
        syncableReason = null,
    )

    private fun diskById(id: String): LocalBook? = books.read().firstOrNull { it.id == id }

    @Test
    fun 快照里的云端书会落进书库且没有本地正文() {
        setUpStores()
        engine.reconcileCloudBooks(
            remote = listOf(
                remoteCloud("cloud-novel", "在线小说"),
                remoteCloud("cloud-comic", "在线漫画", type = BookType.COMIC),
            ),
            stored = emptyList(),
        )

        val novel = diskById("cloud-novel")
        assertEquals("在线小说", novel?.title)
        assertEquals(Origin.DESKTOP, novel?.origin)
        assertEquals(BookKind.CLOUD, novel?.remoteKind)
        assertEquals("cloud-novel", novel?.remoteId)
        assertFalse("云端书不能有本地正文", novel?.hasLocalFile ?: true)
        assertTrue(novel?.isCloud ?: false)

        val comic = diskById("cloud-comic")
        assertTrue("漫画类型要带过来", comic?.isComic ?: false)
        assertEquals(2, books.read().size)
    }

    @Test
    fun 再次同步不覆盖本机的阅读状态() {
        setUpStores()
        // 本机已经读过两章、漫画停在第 37 页、3 天前入库、状态是已同步
        val addedAt = 1_700_000_000_000L
        val readAt = 1_700_900_000_000L
        books.upsert(
            LocalBook(
                id = "cloud-comic",
                title = "在线漫画",
                origin = Origin.DESKTOP,
                remoteKind = BookKind.CLOUD,
                type = BookType.COMIC,
                remoteId = "cloud-comic",
                hasLocalFile = false,
                addedAt = addedAt,
                lastReadAt = readAt,
                comicPage = 37,
                syncState = SyncState.SYNCED,
            ),
        )

        engine.reconcileCloudBooks(
            remote = listOf(remoteCloud("cloud-comic", "在线漫画", type = BookType.COMIC)),
            stored = books.read(),
        )

        val after = diskById("cloud-comic")
        assertEquals("话内页号是纯本地偏好，不能被桌面端清零", 37, after?.comicPage)
        assertEquals(readAt, after?.lastReadAt)
        assertEquals(addedAt, after?.addedAt)
        assertEquals(SyncState.SYNCED, after?.syncState)
        assertEquals("重名同名不该多出一条", 1, books.read().size)
    }

    @Test
    fun 桌面端删掉的云端书连进度和同步态一起清掉() {
        setUpStores()
        books.upsert(
            LocalBook(
                id = "cloud-gone",
                title = "已下架",
                origin = Origin.DESKTOP,
                remoteKind = BookKind.CLOUD,
                remoteId = "cloud-gone",
                hasLocalFile = false,
            ),
        )
        progress.put(ProgressEntry(id = "cloud-gone", chapter = 5, updatedAt = 123L))
        syncState.markSynced("cloud-gone")

        engine.reconcileCloudBooks(
            remote = listOf(remoteCloud("cloud-alive", "还在的")),
            stored = books.read(),
        )

        assertNull("幽灵条目必须清掉，否则书架上一堆点不开的书", diskById("cloud-gone"))
        assertNull("进度也要跟着删，否则下次同名书会读到陌生进度", progress.get("cloud-gone"))
        assertNull("同步态同样要删", syncState.get("cloud-gone"))
        assertEquals(1, books.read().size)
        assertEquals("还在的", books.read().first().title)
    }

    @Test
    fun 本地书不受云端对齐影响() {
        setUpStores()
        val local = LocalBook(
            id = "sha1-aaa",
            title = "本机书",
            origin = Origin.LOCAL,
            contentHash = "a".repeat(40),
            size = 100L,
            hasLocalFile = true,
        )
        books.upsert(local)

        // 快照里没有这本本地书 —— 它不是云端书，绝不该被当成幽灵删掉
        engine.reconcileCloudBooks(
            remote = listOf(remoteCloud("cloud-1", "云端书")),
            stored = books.read(),
        )

        assertEquals("本机导入的书不能因为桌面端没有就被删", local, diskById("sha1-aaa"))
        assertEquals(2, books.read().size)
    }

    @Test
    fun 空快照只清理云端书不碰本地书() {
        setUpStores()
        books.upsert(
            LocalBook(
                id = "cloud-x",
                title = "云端",
                origin = Origin.DESKTOP,
                remoteKind = BookKind.CLOUD,
                remoteId = "cloud-x",
            ),
        )
        books.upsert(
            LocalBook(id = "sha1-b", title = "本机", origin = Origin.LOCAL, hasLocalFile = true),
        )

        engine.reconcileCloudBooks(remote = emptyList(), stored = books.read())

        assertEquals(1, books.read().size)
        assertEquals("sha1-b", books.read().first().id)
    }
}
