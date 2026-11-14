package com.folio.reader.data

import com.folio.reader.core.ReaderMark
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

/** 书签 / 划线落盘：覆盖、删除、笔记升级。 */
class MarkStoreTest {

    private fun store(): MarkStore = MarkStore(Files.createTempDirectory("marks").toFile())

    private fun mark(
        paraIndex: Int,
        kind: String = ReaderMark.KIND_BOOKMARK,
        note: String = "",
    ) = ReaderMark.create(
        bookId = "book-1",
        paraIndex = paraIndex,
        chapterTitle = "第一章",
        excerpt = "第 $paraIndex 段",
        kind = kind,
        note = note,
    )

    @Test
    fun 写入后按段落升序读回() {
        val store = store()
        store.put(mark(9))
        store.put(mark(2))
        assertEquals(listOf(2, 9), store.read("book-1").map { it.paraIndex })
    }

    @Test
    fun 同段落同类型只保留一条() {
        val store = store()
        store.put(mark(3))
        val latest = mark(3)
        store.put(latest)
        val marks = store.read("book-1")
        assertEquals(1, marks.size)
        assertEquals(latest.id, marks.first().id)
    }

    @Test
    fun 书签与划线可以并存() {
        val store = store()
        store.put(mark(4))
        store.put(mark(4, ReaderMark.KIND_HIGHLIGHT))
        assertEquals(2, store.read("book-1").size)
    }

    @Test
    fun 删除只影响指定条目() {
        val store = store()
        val first = mark(1)
        store.put(first)
        store.put(mark(5))
        val left = store.remove("book-1", first.id)
        assertEquals(listOf(5), left.map { it.paraIndex })
        assertEquals(1, store.read("book-1").size)
    }

    @Test
    fun 写笔记会把书签升级为划线() {
        val store = store()
        val bookmark = mark(7)
        store.put(bookmark)
        val updated = store.updateNote("book-1", bookmark.id, "这句要记下来")
        val only = updated.first()
        assertEquals(ReaderMark.KIND_HIGHLIGHT, only.kind)
        assertEquals("这句要记下来", only.note)
    }

    @Test
    fun 清空只删当前书() {
        val store = store()
        store.put(mark(1))
        store.put(mark(2))
        store.clear("book-1")
        assertTrue(store.read("book-1").isEmpty())
    }
}
