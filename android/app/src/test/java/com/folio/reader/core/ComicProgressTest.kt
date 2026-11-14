package com.folio.reader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 漫画进度是纯函数，边界能穷举。
 *
 * 口径：`(话下标 + 页下标 / 本话页数) / 话总数 × 100`，与小说
 * `(章下标 + 段下标 / 本章段数) / 章总数 × 100` 同构。
 */
class ComicProgressTest {

    /** 断言两个 double 在 1e-6 内相等（百分比没必要比到浮点末位）。 */
    private fun assertPercent(expected: Double, actual: Double) {
        assertEquals(expected, actual, 1e-6)
    }

    @Test
    fun 第一话第一页是零() {
        assertPercent(0.0, comicPercent(chapterIndex = 0, pageIndex = 0, pageCount = 20, chapterCount = 10))
    }

    @Test
    fun 话内一半是话长的一半() {
        // 第 5 话（下标 5）第 10/20 页 → (5 + 0.5) / 20 × 100
        assertPercent(27.5, comicPercent(chapterIndex = 5, pageIndex = 10, pageCount = 20, chapterCount = 20))
        // 单话作品读到一半就是一半
        assertPercent(50.0, comicPercent(chapterIndex = 0, pageIndex = 5, pageCount = 10, chapterCount = 1))
    }

    @Test
    fun 最后一话最后一页不超过一百且贴近一百() {
        val percent = comicPercent(chapterIndex = 11, pageIndex = 19, pageCount = 20, chapterCount = 12)
        assertTrue("最后一页应 > 99，实际 $percent", percent > 99.0)
        assertTrue("最后一页不能超过 100，实际 $percent", percent <= 100.0)
    }

    @Test
    fun 页数未知时只按话位置算() {
        // 页数还没拿到（0）→ 内层比例按 0 处理，不抛除零
        assertPercent(25.0, comicPercent(chapterIndex = 1, pageIndex = 3, pageCount = 0, chapterCount = 4))
        // 负页数同样按 0 处理
        assertPercent(25.0, comicPercent(chapterIndex = 1, pageIndex = 3, pageCount = -5, chapterCount = 4))
    }

    @Test
    fun 话数未知时是零() {
        assertPercent(0.0, comicPercent(chapterIndex = 3, pageIndex = 5, pageCount = 10, chapterCount = 0))
        assertPercent(0.0, comicPercent(chapterIndex = 0, pageIndex = 0, pageCount = 10, chapterCount = -1))
    }

    @Test
    fun 索引越界夹住不抛异常() {
        // 话下标超出末话 → 夹到末话，结果仍是合法百分比
        val over = comicPercent(chapterIndex = 99, pageIndex = 0, pageCount = 20, chapterCount = 10)
        assertTrue("越界话下标不能超过 100，实际 $over", over in 0.0..100.0)
        assertPercent(90.0, over)

        // 负话下标 / 负页下标 → 夹到 0
        assertPercent(0.0, comicPercent(chapterIndex = -3, pageIndex = -1, pageCount = 20, chapterCount = 10))

        // 页下标超出本话页数 → 夹到本话末页，不会算出 > 100
        val page = comicPercent(chapterIndex = 9, pageIndex = 999, pageCount = 20, chapterCount = 10)
        assertTrue("越界页下标不能超过 100，实际 $page", page <= 100.0)
        assertPercent(99.5, page)
    }
}
