package com.folio.reader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 双端痕迹合并：新增、更新、删除、云端书按章对齐。
 *
 * 这里刻意不用真实文件与网络 —— 合并规则是纯函数，删除能不能生效全靠
 * 「上次同步快照」这几个分支，必须逐条钉住。
 */
class MarkSyncTest {

    private fun mark(
        paraIndex: Int,
        note: String = "",
        kind: String = ReaderMark.KIND_BOOKMARK,
        chapterNo: Int = -1,
        updatedAt: Long = 1_000L,
    ) = ReaderMark(
        id = "id-$chapterNo-$kind-$paraIndex",
        bookId = "b1",
        paraIndex = paraIndex,
        chapterTitle = "第一章",
        excerpt = "摘录 $paraIndex",
        note = note,
        kind = kind,
        chapterNo = chapterNo,
        createdAt = updatedAt,
        updatedAt = updatedAt,
    )

    @Test
    fun 两端各自新增时并集且把本机新增推上去() {
        val plan = MarkSync.merge(
            local = listOf(mark(1)),
            remote = listOf(mark(2)),
            base = emptyMap(),
        )
        assertEquals(2, plan.merged.size)
        assertEquals(listOf(1), plan.push.map { it.paraIndex })
        assertEquals(1, plan.pulled)
        assertTrue(plan.needsPush)
    }

    @Test
    fun 桌面端后补的笔记会盖过手机上的旧版本() {
        val old = mark(3, note = "", updatedAt = 1_000L)
        val newer = mark(3, note = "桌面端补的", updatedAt = 2_000L)
        val plan = MarkSync.merge(
            local = listOf(old),
            remote = listOf(newer),
            base = mapOf(old.syncKey to MarkSync.tagOf(old)),
        )
        assertEquals("桌面端补的", plan.merged.single().note)
        assertEquals(1, plan.pulled)
        assertFalse(plan.needsPush)
    }

    @Test
    fun 手机上更新的笔记会推给桌面端() {
        val old = mark(4, note = "旧", updatedAt = 1_000L)
        val newer = mark(4, note = "新", updatedAt = 3_000L)
        val plan = MarkSync.merge(
            local = listOf(newer),
            remote = listOf(old),
            base = mapOf(old.syncKey to MarkSync.tagOf(old)),
        )
        assertEquals("新", plan.merged.single().note)
        assertEquals(1, plan.push.size)
        assertEquals(0, plan.pulled)
    }

    @Test
    fun 桌面端删掉的痕迹本机也跟着删() {
        val old = mark(5)
        val plan = MarkSync.merge(
            local = listOf(old),
            remote = emptyList(),
            base = mapOf(old.syncKey to MarkSync.tagOf(old)),
        )
        assertTrue(plan.merged.isEmpty())
        assertEquals(1, plan.removedLocal)
        assertFalse(plan.needsPush)
    }

    @Test
    fun 本机删掉的痕迹让桌面端也删() {
        val old = mark(6)
        val plan = MarkSync.merge(
            local = emptyList(),
            remote = listOf(old),
            base = mapOf(old.syncKey to MarkSync.tagOf(old)),
        )
        assertTrue(plan.merged.isEmpty())
        assertEquals(listOf(old.syncKey), plan.removeRemote)
        assertTrue(plan.needsPush)
    }

    @Test
    fun 删掉后又在同一段重新标记会保留并推给桌面端() {
        val old = mark(7, note = "", updatedAt = 1_000L)
        val again = mark(7, note = "重新写的", updatedAt = 5_000L)
        val plan = MarkSync.merge(
            local = listOf(again),
            remote = emptyList(),
            base = mapOf(old.syncKey to MarkSync.tagOf(old)),
        )
        assertEquals("重新写的", plan.merged.single().note)
        assertEquals(1, plan.push.size)
        assertEquals(0, plan.removedLocal)
    }

    @Test
    fun 云端书同段落号的痕迹按章号区分() {
        val first = mark(2, note = "第一章", chapterNo = 10)
        val second = mark(2, note = "第二章", chapterNo = 11)
        val plan = MarkSync.merge(
            local = listOf(first),
            remote = listOf(second),
            base = emptyMap(),
        )
        assertEquals(2, plan.merged.size)
        assertEquals(1, plan.pulled)
    }

    @Test
    fun 没有快照时不做删除判断() {
        // 首次同步：本地一条、远端没有。不能把它当成「远端删了」。
        val mine = mark(8)
        val plan = MarkSync.merge(local = listOf(mine), remote = emptyList(), base = emptyMap())
        assertEquals(1, plan.merged.size)
        assertEquals(1, plan.push.size)
        assertEquals(0, plan.removedLocal)
    }
}
