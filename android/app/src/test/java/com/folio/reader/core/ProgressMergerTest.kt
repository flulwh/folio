package com.folio.reader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 进度合并必须和桌面端 mergeProgressEntry 一个语义。 */
class ProgressMergerTest {

    @Test
    fun 新的时间戳赢() {
        val current = ProgressEntry("b1", paraIndex = 10, percent = 20.0, updatedAt = 1000)
        val incoming = ProgressEntry("b1", paraIndex = 30, percent = 40.0, updatedAt = 2000)
        val merged = ProgressMerger.mergeEntry(current, incoming)
        assertNotNull(merged)
        assertEquals(30, merged!!.paraIndex)
        assertEquals(40.0, merged.percent!!, 0.001)
    }

    @Test
    fun 旧的时间戳不改写() {
        val current = ProgressEntry("b1", paraIndex = 30, percent = 40.0, updatedAt = 2000)
        val incoming = ProgressEntry("b1", paraIndex = 10, percent = 20.0, updatedAt = 1000)
        val merged = ProgressMerger.mergeEntry(current, incoming)
        assertEquals(30, merged!!.paraIndex)
        assertEquals(2000, merged.updatedAt)
    }

    @Test
    fun 缺字段时保留对方已有的值() {
        val current = ProgressEntry(
            "b1",
            paraIndex = 30,
            chapter = 4,
            chapterTitle = "第四章",
            windowBase = 4,
            percent = 40.0,
            updatedAt = 1000,
        )
        // 只带百分比的进度，不该把章节号抹掉
        val incoming = ProgressEntry("b1", percent = 55.0, updatedAt = 2000)
        val merged = ProgressMerger.mergeEntry(current, incoming)
        assertEquals(30, merged!!.paraIndex)
        assertEquals(4, merged.chapter)
        assertEquals("第四章", merged.chapterTitle)
        assertEquals(55.0, merged.percent!!, 0.001)
    }

    @Test
    fun 空表时直接收下() {
        val merged = ProgressMerger.mergeEntry(null, ProgressEntry("b1", paraIndex = 3, updatedAt = 10))
        assertNotNull(merged)
        assertEquals(3, merged!!.paraIndex)
    }

    @Test
    fun 整份合并只动真正变化的条目() {
        val current = mapOf(
            "a" to ProgressEntry("a", paraIndex = 1, updatedAt = 10),
            "b" to ProgressEntry("b", paraIndex = 2, updatedAt = 10),
        )
        val incoming = mapOf(
            "a" to ProgressEntry("a", paraIndex = 1, updatedAt = 10),
            "b" to ProgressEntry("b", paraIndex = 5, updatedAt = 20),
        )
        val (merged, changed) = ProgressMerger.merge(current, incoming)
        assertTrue(changed)
        assertEquals(5, merged["b"]!!.paraIndex)
        assertEquals(2, merged.size)
    }

    @Test
    fun 没有新内容时不标记变化() {
        val current = mapOf("a" to ProgressEntry("a", paraIndex = 1, updatedAt = 10))
        val incoming = mapOf("a" to ProgressEntry("a", paraIndex = 1, updatedAt = 10))
        val (_, changed) = ProgressMerger.merge(current, incoming)
        assertTrue(!changed)
    }

    @Test
    fun 空的传入不覆盖() {
        val current = ProgressEntry("a", paraIndex = 7, updatedAt = 10)
        val merged = ProgressMerger.mergeEntry(current, null)
        assertEquals(current, merged)
    }
}
