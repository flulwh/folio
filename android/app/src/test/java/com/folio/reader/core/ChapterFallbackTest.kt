package com.folio.reader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 断网时退到最近的已缓存章节。 */
class ChapterFallbackTest {

    @Test
    fun 没有缓存时不给建议() {
        assertNull(ChapterFallback.nearest(emptySet(), 12))
    }

    @Test
    fun 目标章已缓存就选自己() {
        assertEquals(12, ChapterFallback.nearest(setOf(3, 12, 40), 12))
    }

    @Test
    fun 目标章没缓存时选最近的() {
        assertEquals(3, ChapterFallback.nearest(setOf(0, 3, 40), 5))
        assertEquals(40, ChapterFallback.nearest(setOf(0, 3, 40), 30))
    }

    @Test
    fun 距离相同取更靠前的() {
        assertEquals(10, ChapterFallback.nearest(setOf(20, 10), 15))
    }

    @Test
    fun 只有一章缓存也认() {
        assertEquals(7, ChapterFallback.nearest(setOf(7), 400))
    }

    @Test
    fun 判断要不要退让() {
        assertTrue(ChapterFallback.shouldFallback(setOf(1, 2), 300))
        assertTrue(!ChapterFallback.shouldFallback(setOf(1, 300), 300))
        assertTrue(!ChapterFallback.shouldFallback(emptySet(), 300))
    }
}
