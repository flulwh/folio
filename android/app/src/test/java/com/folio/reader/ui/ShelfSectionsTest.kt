package com.folio.reader.ui

import com.folio.reader.core.Book
import com.folio.reader.core.Origin
import com.folio.reader.core.ProgressEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 书架分区与 LazyColumn item key 的回归测试。
 *
 * 3.0.0 真机上出过一次 P0：`continueReading` 与 `localSection` 没有互斥，一本「有进度的
 * 本机书」会同时落进两个分区，而 `ShelfScreen` 的 item key 只用了 `book.id` →
 * `IllegalArgumentException: Key "book-…" was already used`，书架直接崩、连进度都写不下去。
 *
 * 修复有两层，这里各测一层：
 *  1. `visibleBooks` 按 id 去重（同一个分区里不许有两条同 id）；
 *  2. 分区自带稳定 `key`，item key 由「分区 key + book.id」组成 → 跨分区天然不撞。
 *
 * 分区之间**重叠是对的**（继续阅读是快捷入口，本机书是全集），所以断言不是「不许重叠」，
 * 而是「重叠了也不能产生重复 key」。
 */
class ShelfSectionsTest {

    private fun book(
        id: String,
        title: String = id,
        origin: Origin = Origin.LOCAL,
        hasLocalFile: Boolean = true,
    ): Book = Book(
        id = id,
        title = title,
        origin = origin,
        hasLocalFile = hasLocalFile,
        size = 1024L,
    )

    private fun progressOf(id: String, updatedAt: Long = 1_000L): ProgressEntry = ProgressEntry(
        id = id,
        paraIndex = 3,
        percent = 12.0,
        updatedAt = updatedAt,
    )

    /** 分区 + 书的组合键，正是 `ShelfScreen` 里喂给 `items(key = …)` 的那个值。 */
    private fun ShelfUiState.renderKeys(): List<String> =
        sections.flatMap { section -> section.books.map { "book-${section.key}-${it.id}" } }

    @Test
    fun 有进度的本机书同时进两个分区但渲染键不重复() {
        val state = ShelfUiState(
            books = listOf(book("sha1-a", "夜里读书")),
            progress = mapOf("sha1-a" to progressOf("sha1-a")),
        )

        val sections = state.sections
        assertEquals("应该有「继续阅读」和「本机书」两个分区", 2, sections.size)
        assertTrue("继续阅读里要有它", sections[0].books.any { it.id == "sha1-a" })
        assertTrue("本机书里也要有它", sections[1].books.any { it.id == "sha1-a" })

        val keys = state.renderKeys()
        assertEquals("同一本书出现两次，渲染键必须仍然唯一：$keys", keys.size, keys.toSet().size)
    }

    @Test
    fun 三个分区混排时渲染键全表唯一() {
        val state = ShelfUiState(
            books = listOf(
                book("sha1-a", "本机在读"),
                book("sha1-b", "本机没读"),
                book("remote-c", "桌面端在读", origin = Origin.DESKTOP, hasLocalFile = false),
            ),
            progress = mapOf(
                "sha1-a" to progressOf("sha1-a", updatedAt = 2_000L),
                "remote-c" to progressOf("remote-c", updatedAt = 1_000L),
            ),
            // 离线时默认会藏起「只能在线读」的书，这里要让它出现在分区里
            hideRemoteWhenOffline = false,
        )

        assertEquals("三个分区都该出现", 3, state.sections.size)

        val keys = state.renderKeys()
        assertEquals("混排后渲染键必须唯一：$keys", keys.size, keys.toSet().size)
        // 每本书在一、两个分区里各出现一次，不许多出来
        assertTrue(keys.contains("book-continue-sha1-a"))
        assertTrue(keys.contains("book-local-sha1-a"))
        assertTrue(keys.contains("book-continue-remote-c"))
        assertTrue(keys.contains("book-desktop-remote-c"))
        // 没读过的那本只在「本机书」里
        assertEquals(1, keys.count { it.endsWith("-sha1-b") })
    }

    @Test
    fun 分区标题带本数但分区键保持稳定() {
        val state = ShelfUiState(
            books = listOf(book("sha1-a"), book("sha1-b")),
        )

        val sections = state.sections
        assertEquals(listOf("local"), sections.map { it.key })
        // 标题里带本数是给人看的，但 key 不能跟着变 —— 变了等于每次增删书都重建全部条目
        assertEquals("本机书（2）", sections[0].title)
    }

    @Test
    fun 同一个id在书架里重复只渲染一次() {
        val state = ShelfUiState(
            books = listOf(
                book("sha1-a", "第一次出现"),
                book("sha1-a", "第二次出现"),
            ),
        )

        assertEquals("visibleBooks 要按 id 去重", 1, state.visibleBooks.size)
        assertEquals(1, state.sections.sumOf { it.books.size })
        assertEquals(1, state.renderKeys().size)
    }

    @Test
    fun 空书架没有任何分区() {
        val state = ShelfUiState()
        assertTrue(state.sections.isEmpty())
        assertTrue(state.renderKeys().isEmpty())
    }
}
