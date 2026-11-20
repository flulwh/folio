package com.folio.reader.core

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `books.json` 的 `format` 字段口径：
 *  - `txt` 是缺省值，**不写进 JSON**，老版本（不认识这个字段）读到的还是同一份数据；
 *  - 只有 `epub` 才写 `"format": "epub"`；
 *  - 旧 JSON / 桌面端清单没有 `format` 时按 `txt` 读，不能把老书当 EPUB。
 */
class LocalBookFormatTest {

    private fun book(format: String = "txt"): LocalBook = LocalBook(
        id = "sha1-0123456789abcdef0123456789abcdef01234567",
        title = "三体",
        origin = Origin.LOCAL,
        format = format,
        hasLocalFile = true,
    )

    @Test
    fun 文本格式不写format字段() {
        val json = book().toJson()
        assertFalse("txt 是缺省值，写出去只会让旧版本多认一个字段", json.has("format"))
        assertEquals("txt", book().format)
        assertFalse(book().isEpub)
    }

    @Test
    fun epub格式写format字段() {
        val json = book("epub").toJson()
        assertEquals("epub", json.getString("format"))
        assertTrue(book("epub").isEpub)
    }

    @Test
    fun epub往返后仍是epub() {
        val restored = LocalBook.fromJson(book("epub").toJson(), Origin.LOCAL)
        assertEquals("epub", restored?.format)
        assertTrue(restored?.isEpub == true)
    }

    @Test
    fun 旧JSON缺format按文本读() {
        val legacy = JSONObject()
            .put("id", "sha1-0123456789abcdef0123456789abcdef01234567")
            .put("title", "旧书")
            .put("origin", "local")
            .put("hasLocalFile", true)
        val restored = LocalBook.fromJson(legacy, Origin.LOCAL)
        assertEquals("txt", restored?.format)
        assertFalse(restored?.isEpub == true)
    }

    @Test
    fun 未知format回落到文本() {
        val json = JSONObject()
            .put("id", "sha1-0123456789abcdef0123456789abcdef01234567")
            .put("title", "怪格式")
            .put("format", "mobi")
        assertEquals("txt", LocalBook.fromJson(json, Origin.LOCAL)?.format)
    }
}
