package com.folio.reader.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 漫画页的缓存键。
 *
 * 为什么值得单独测：3.0 **按 `(书, 话, 页)` 索引**而不是按 URL（架构文档 §1.3）。
 * 键一旦错了，表现是「翻到第 3 页显示第 2 页」这种最难查的 bug，
 * 而且只在缓存命中时才出现。
 */
class ComicPageKeyTest {

    @Test
    fun 同一页的键相等() {
        val a = ComicPage("book-1", 2, 7)
        val b = ComicPage("book-1", 2, 7)
        assertEquals(a, b)
        assertEquals(a.hashCode(), b.hashCode())
    }

    @Test
    fun 话号或页号不同就是不同的键() {
        val base = ComicPage("book-1", 2, 7)
        assertNotEquals(base, ComicPage("book-1", 2, 8))
        assertNotEquals(base, ComicPage("book-1", 3, 7))
        assertNotEquals(base, ComicPage("book-2", 2, 7))
    }

    @Test
    fun of会规整脏输入() {
        // 书 id 带空白、话号页号是负数：都要能落到一个确定的键上
        assertEquals(ComicPage("book-1", 0, 0), ComicPage.of("  book-1  ", -3, -1))
        assertEquals(ComicPage("book-1", 4, 9), ComicPage.of("book-1", 4, 9))
    }

    @Test
    fun 放进集合不会互相覆盖() {
        val keys = setOf(
            ComicPage("b", 0, 0),
            ComicPage("b", 0, 1),
            ComicPage("b", 1, 0),
            ComicPage("c", 0, 0),
            ComicPage.of(" b ", 0, 0),
        )
        assertEquals("最后一个是重复键，应该被去重", 4, keys.size)
        assertTrue(keys.contains(ComicPage("b", 1, 0)))
    }
}
