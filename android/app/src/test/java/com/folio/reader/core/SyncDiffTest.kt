package com.folio.reader.core

import com.folio.reader.data.SyncDiff
import com.folio.reader.net.RemoteBook
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 差集四分类 + 冲突判定。
 *
 * 这一层是**纯函数**，所以用例可以穷举边界：
 *  - 只有桌面有 → toPull
 *  - 只有手机有 → toPush
 *  - 两边同 hash → both（只换元数据，不传字节）
 *  - `titleKey` 相同但 hash 不同 → conflict（不传，等用户选）
 *  - 超过 30MB / 云端书 → excluded
 */
class SyncDiffTest {

    private fun hash(char: Char): String = char.toString().repeat(40)

    private fun local(
        id: String,
        title: String,
        contentHash: String,
        size: Long = 1024L,
        hasLocalFile: Boolean = true,
        kind: String = BookKind.LOCAL,
    ): LocalBook = LocalBook(
        id = id,
        title = title,
        origin = Origin.LOCAL,
        remoteKind = kind,
        contentHash = contentHash,
        size = size,
        hasLocalFile = hasLocalFile,
    )

    private fun remote(
        id: String,
        title: String,
        contentHash: String,
        syncable: Boolean = true,
        kind: String = BookKind.LOCAL,
        size: Long = 1024L,
    ): RemoteBook = RemoteBook(
        book = LocalBook(
            id = id,
            title = title,
            origin = Origin.DESKTOP,
            remoteKind = kind,
            contentHash = contentHash,
            size = size,
            remoteId = id,
        ),
        syncable = syncable,
        syncableReason = if (syncable) null else "这本 40MB，超过 30MB 上限，只能在本机读",
    )

    @Test
    fun 桌面有手机没有的进待下载() {
        val plan = SyncDiff.plan(
            local = emptyList(),
            remote = listOf(remote("r1", "三体", hash('a'))),
        )
        assertEquals(1, plan.toPull.size)
        assertEquals("r1", plan.toPull.first().book.id)
        assertTrue(plan.toPush.isEmpty())
        assertTrue(plan.both.isEmpty())
        assertTrue(plan.conflicts.isEmpty())
    }

    @Test
    fun 手机有桌面没有的进待上传() {
        val plan = SyncDiff.plan(
            local = listOf(local("sha1-a", "三体", hash('a'))),
            remote = emptyList(),
        )
        assertEquals(1, plan.toPush.size)
        assertEquals(0, plan.toPull.size)
    }

    @Test
    fun 同哈希只换元数据() {
        val plan = SyncDiff.plan(
            local = listOf(local("sha1-a", "三体", hash('a'))),
            remote = listOf(remote("r1", "三体", hash('a'))),
        )
        assertEquals(1, plan.both.size)
        assertEquals("r1", plan.both.first().second.book.id)
        assertTrue(plan.toPull.isEmpty())
        assertTrue(plan.toPush.isEmpty())
        assertTrue(plan.conflicts.isEmpty())
    }

    @Test
    fun 同名不同内容算冲突不传字节() {
        val plan = SyncDiff.plan(
            local = listOf(local("sha1-a", "三体", hash('a'))),
            remote = listOf(remote("r1", "三体", hash('b'))),
        )
        assertEquals(1, plan.conflicts.size)
        assertTrue(plan.toPull.isEmpty())
        assertTrue(plan.toPush.isEmpty())
        assertEquals(SyncDiff.Conflict::class.java, plan.conflicts.first()::class.java)
    }

    @Test
    fun 书名尾部的副本标记不影响冲突判定() {
        // §1.2 的 titleKey 规则：全角括号、`(1)`、`副本` 都要削干净
        val plan = SyncDiff.plan(
            local = listOf(local("sha1-a", "三体（1）", hash('a'))),
            remote = listOf(remote("r1", "三体 副本", hash('b'))),
        )
        assertEquals("削掉副本标记后应该是同名冲突", 1, plan.conflicts.size)
    }

    @Test
    fun 名字不同内容不同就是各自新增() {
        val plan = SyncDiff.plan(
            local = listOf(local("sha1-a", "三体", hash('a'))),
            remote = listOf(remote("r1", "球状闪电", hash('b'))),
        )
        assertEquals(1, plan.toPush.size)
        assertEquals(1, plan.toPull.size)
        assertTrue(plan.conflicts.isEmpty())
    }

    @Test
    fun 超过三十兆的书被排除() {
        val big = LocalBook.MAX_SYNC_BYTES + 1
        val plan = SyncDiff.plan(
            local = listOf(local("sha1-a", "大部头", hash('a'), size = big)),
            remote = emptyList(),
        )
        assertEquals(1, plan.excluded.size)
        assertTrue(plan.toPush.isEmpty())
    }

    @Test
    fun 云端书不参与搬运() {
        val plan = SyncDiff.plan(
            local = emptyList(),
            remote = listOf(remote("c1", "云端书", hash('c'), syncable = false, kind = BookKind.CLOUD)),
        )
        assertTrue(plan.toPull.isEmpty())
    }

    @Test
    fun 没有正文文件的书不参与上传() {
        val plan = SyncDiff.plan(
            local = listOf(local("sha1-a", "只有元数据", hash('a'), hasLocalFile = false)),
            remote = emptyList(),
        )
        assertTrue(plan.toPush.isEmpty())
    }

    @Test
    fun 没有内容哈希的条目被忽略() {
        val missing = LocalBook(id = "x", title = "旧数据", origin = Origin.LOCAL, hasLocalFile = true, size = 10)
        val plan = SyncDiff.plan(local = listOf(missing), remote = emptyList())
        assertTrue(plan.toPush.isEmpty())
        assertTrue(plan.excluded.isEmpty())
    }

    @Test
    fun 冲突不会同时出现在下载与上传里() {
        val plan = SyncDiff.plan(
            local = listOf(
                local("sha1-a", "三体", hash('a')),
                local("sha1-d", "独一份", hash('d')),
            ),
            remote = listOf(
                remote("r1", "三体", hash('b')),
                remote("r2", "只有桌面有", hash('e')),
            ),
        )
        assertEquals(1, plan.conflicts.size)
        assertEquals(1, plan.toPush.size)
        assertEquals("sha1-d", plan.toPush.first().id)
        assertEquals(1, plan.toPull.size)
        assertEquals("r2", plan.toPull.first().book.id)
    }

    @Test
    fun 云端书即使被标成可同步也不进下载队列() {
        // 云端书正文在书源那边，本地永远不留副本。现在靠桌面端 syncable=false 兜着，
        // 但这条不能只依赖对端 —— 桌面端哪天改错，手机就会去下一份不存在的正文。
        val plan = SyncDiff.plan(
            local = emptyList(),
            remote = listOf(
                remote("cloud-1", "在线小说", hash('a'), syncable = true, kind = BookKind.CLOUD),
                remote("cloud-2", "在线漫画", hash('b'), syncable = true, kind = BookKind.CLOUD),
            ),
        )
        assertTrue(plan.toPull.isEmpty())
        assertTrue(plan.toPush.isEmpty())
        assertTrue(plan.both.isEmpty())
        assertTrue(plan.conflicts.isEmpty())
    }

    @Test
    fun 云端书永远不会进冲突也不会进上传() {
        // 手机本地有一本同名书、桌面端也有一本同名云端书：不该被判成内容冲突，
        // 因为云端书根本不参与搬运，判冲突只会让用户去做一个没有意义的选择。
        val plan = SyncDiff.plan(
            local = listOf(local("sha1-a", "三体", hash('a'))),
            remote = listOf(
                remote("cloud-1", "三体", hash('b'), syncable = true, kind = BookKind.CLOUD),
            ),
        )
        assertTrue(plan.conflicts.isEmpty())
        assertTrue(plan.toPull.isEmpty())
        assertEquals(1, plan.toPush.size)
        assertEquals("sha1-a", plan.toPush.first().id)
    }
}
