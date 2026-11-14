package com.folio.reader.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject

/** 字体目录解析：好条目要进来，脏条目要整条丢掉。 */
class FontCatalogTest {

    private val goodFont = """
        {
          "id": "lxgw-wenkai",
          "version": 2,
          "name": "霞鹜文楷",
          "family": "LXGW WenKai",
          "category": "kai",
          "description": "说明",
          "preview": "空山新雨后",
          "homepage": "https://github.com/lxgw/LxgwWenKai",
          "license": {
            "spdx": "OFL-1.1",
            "name": "SIL Open Font License 1.1",
            "url": "https://example.com/ofl"
          },
          "file": {
            "format": "ttf",
            "url": "https://github.com/flulwh/folio-fonts/releases/download/v1/lxgw-wenkai.ttf",
            "size": 25928940,
            "sha256": "2d73eea94ad808999d90c0000c239a84a33b09d4bc6ab6c5b8bbf1eda8a7fc8b"
          }
        }
    """.trimIndent()

    private fun catalog(vararg fonts: String) =
        """{"schema":1,"fonts":[${fonts.joinToString(",")}]}"""

    @Test
    fun 解析合法条目() {
        val fonts = FontCatalog.parse(catalog(goodFont))
        assertEquals(1, fonts.size)
        val font = fonts.single()
        assertEquals("lxgw-wenkai", font.id)
        assertEquals(2, font.version)
        assertEquals("LXGW WenKai", font.family)
        assertEquals("ttf", font.file.format)
        assertEquals(25928940L, font.file.size)
        assertEquals("OFL-1.1", font.license.spdx)
    }

    @Test
    fun 丢掉非法id和非法url() {
        val badId = JSONObject(goodFont).put("id", "../etc/passwd").toString()
        val badUrl = JSONObject(goodFont).apply {
            getJSONObject("file").put("url", "file:///C:/Windows/fonts/a.ttf")
        }.toString()
        val fonts = FontCatalog.parse(catalog(badId, badUrl))
        assertTrue(fonts.isEmpty())
    }

    @Test
    fun 丢掉大小异常和摘要残缺的条目() {
        val huge = JSONObject(goodFont).apply {
            getJSONObject("file").put("size", FontCatalog.MAX_BYTES + 1)
        }.toString()
        val badHash = JSONObject(goodFont).apply {
            getJSONObject("file").put("sha256", "abc")
        }.toString()
        val zero = JSONObject(goodFont).apply {
            getJSONObject("file").put("size", 0)
        }.toString()
        assertTrue(FontCatalog.parse(catalog(huge, badHash, zero)).isEmpty())
    }

    @Test
    fun 丢掉不支持的格式() {
        val woff2 = JSONObject(goodFont).apply {
            getJSONObject("file").put("format", "woff2")
        }.toString()
        assertTrue(FontCatalog.parse(catalog(woff2)).isEmpty())
    }

    @Test
    fun 坏json当成空目录() {
        assertTrue(FontCatalog.parse("not json").isEmpty())
        assertTrue(FontCatalog.parse("""{"fonts":"oops"}""").isEmpty())
    }

    @Test
    fun 字体magic识别() {
        assertTrue(FontMagic.looksLikeFont(byteArrayOf(0, 1, 0, 0)))
        assertTrue(FontMagic.looksLikeFont("OTTO".toByteArray(Charsets.ISO_8859_1)))
        assertTrue(FontMagic.looksLikeFont("ttcf".toByteArray(Charsets.ISO_8859_1)))
        assertTrue(FontMagic.looksLikeFont("true".toByteArray(Charsets.ISO_8859_1)))
        assertFalse(FontMagic.looksLikeFont("NOPE".toByteArray(Charsets.ISO_8859_1)))
        assertFalse(FontMagic.looksLikeFont(byteArrayOf(0, 0)))
    }

    @Test
    fun 缺省字段回落到id() {
        val minimal = JSONObject()
            .put("id", "demo")
            .put(
                "file",
                JSONObject()
                    .put("format", "otf")
                    .put("url", "https://example.com/demo.otf")
                    .put("size", 10)
                    .put("sha256", "a".repeat(64)),
            )
            .toString()
        val font = FontCatalog.parse(catalog(minimal)).singleOrNull()
        assertNotNull(font)
        assertEquals("demo", font!!.name)
        assertEquals("demo", font.family)
    }
}
