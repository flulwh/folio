package com.folio.reader.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 进度与书架的 JSON 字段名必须和桌面端对得上，否则双端互相覆盖。 */
class ProgressCodecTest {

    @Test
    fun 本地书进度不带章节号() {
        val entry = ProgressEntry(
            id = "b1",
            paraIndex = 12,
            chapterTitle = "第一章",
            percent = 33.3,
            updatedAt = 1700000000000,
        )
        val json = entry.toJson(BookKind.LOCAL)
        assertTrue(!json.has("chapter"))
        assertTrue(!json.has("windowBase"))
        assertEquals(12, json.getInt("paraIndex"))
        assertEquals("第一章", json.getString("chapterTitle"))
        assertEquals(1700000000000L, json.getLong("updatedAt"))
    }

    @Test
    fun 云端书进度带章节号和窗口基线() {
        val entry = ProgressEntry(
            id = "c1",
            paraIndex = 5,
            chapter = 3,
            chapterTitle = "第 4 章",
            windowBase = 3,
            percent = 40.0,
            updatedAt = 1700000000000,
        )
        val json = entry.toJson(BookKind.CLOUD)
        assertEquals(3, json.getInt("chapter"))
        assertEquals(3, json.getInt("windowBase"))
        assertEquals(5, json.getInt("paraIndex"))
    }

    @Test
    fun 能读回桌面端写来的进度() {
        val desktop = JSONObject()
            .put("paraIndex", 8)
            .put("chapterTitle", "第二章")
            .put("percent", 21.5)
            .put("updatedAt", 1700000000000L)
        val entry = ProgressEntry.fromJson("b1", desktop)
        assertNotNull(entry)
        assertEquals(8, entry!!.paraIndex)
        assertEquals("第二章", entry.chapterTitle)
        assertEquals(21.5, entry.percent!!, 0.001)
    }

    @Test
    fun 没有时间戳的进度不认() {
        val desktop = JSONObject().put("paraIndex", 8).put("percent", 21.5)
        assertNull(ProgressEntry.fromJson("b1", desktop))
    }

    @Test
    fun 解析书架条目() {
        val json = JSONObject()
            .put("id", "book-1")
            .put("title", "三体")
            .put("author", "刘慈欣")
            .put("kind", "cloud")
            .put("sourceName", "示例书源")
            .put("cover", "/api/cover/book-1")
        val book = Book.fromJson(json)
        assertNotNull(book)
        assertEquals("三体", book!!.title)
        assertEquals("刘慈欣", book.author)
        assertTrue(book.isCloud)
    }

    @Test
    fun 相对路径封面保留下来() {
        val json = JSONObject()
            .put("id", "book-2")
            .put("title", "本地书")
            .put("kind", "local")
            .put("cover", "/api/cover/book-2")
        val book = Book.fromJson(json)
        // 封面是相对路径，拼接时要用桌面端地址补全
        assertEquals("/api/cover/book-2", book!!.cover)
    }

    @Test
    fun 桌面端用name字段时也能拿到书名() {
        val json = JSONObject()
            .put("id", "cloud-1")
            .put("name", "蛊真人")
            .put("author", "作者：蛊真人")
            .put("kind", "cloud")
        val book = Book.fromJson(json)
        assertEquals("蛊真人", book!!.title)
        assertTrue(book.isCloud)
    }

    @Test
    fun 没有id的书不认() {
        assertNull(Book.fromJson(JSONObject().put("title", "无 id")))
    }
}
