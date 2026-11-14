package com.folio.reader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.charset.Charset

/**
 * 编码识别顺序必须与桌面端 `decodeText` 一致：
 * UTF-16 BOM → UTF-8 BOM → 严格 UTF-8 → GBK 兜底。
 *
 * 顺序错了后果很具体：一本 GBK 的书如果先被「宽松 UTF-8」硬解一遍，
 * 会得到满屏 U+FFFD，而 contentHash 是按这份乱码算的 —— 双端永远同步不上。
 */
class TextDecoderTest {

    private val gbk: Charset = Charset.forName("GBK")

    @Test
    fun 无BOM的GBK中文能被认出来() {
        val text = "第一章 风起于青萍之末"
        val bytes = text.toByteArray(gbk)
        // 「第」在 GBK 里是 0xB5 0xDA，先确认夹具字节是真的 GBK 而不是碰巧的 ASCII
        assertEquals(0xB5.toByte(), bytes[0])
        assertEquals(0xDA.toByte(), bytes[1])

        val decoded = TextDecoder.decode(bytes)
        assertEquals(TextDecoder.ENCODING_GBK, decoded.encoding)
        assertEquals(text, decoded.text)
    }

    @Test
    fun 带BOM的UTF16LE优先于其他判断() {
        val text = "第二章 雨落"
        val body = text.toByteArray(Charsets.UTF_16LE)
        val bytes = byteArrayOf(0xFF.toByte(), 0xFE.toByte()) + body

        val decoded = TextDecoder.decode(bytes)
        assertEquals(TextDecoder.ENCODING_UTF16LE, decoded.encoding)
        assertEquals(text, decoded.text)
        // BOM 不能留在正文里，否则第一章第一段会多一个不可见字符，paraIndex 就漂了
        assertFalse(decoded.text.startsWith("\uFEFF"))
    }

    @Test
    fun 带BOM的UTF8被识别为UTF8() {
        val text = "第三章 天晴"
        val bytes = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) +
            text.toByteArray(Charsets.UTF_8)

        val decoded = TextDecoder.decode(bytes)
        assertEquals(TextDecoder.ENCODING_UTF8, decoded.encoding)
        assertEquals(text, decoded.text)
        assertFalse(decoded.text.startsWith("\uFEFF"))
    }

    @Test
    fun 合法UTF8按UTF8解() {
        val text = "第四章 无 BOM 的 UTF-8"
        val decoded = TextDecoder.decode(text.toByteArray(Charsets.UTF_8))
        assertEquals(TextDecoder.ENCODING_UTF8, decoded.encoding)
        assertEquals(text, decoded.text)
    }

    @Test
    fun UTF16BE的BOM也能认() {
        val text = "第五章"
        val bytes = byteArrayOf(0xFE.toByte(), 0xFF.toByte()) +
            text.toByteArray(Charsets.UTF_16BE)
        val decoded = TextDecoder.decode(bytes)
        assertEquals(TextDecoder.ENCODING_UTF16BE, decoded.encoding)
        assertEquals(text, decoded.text)
    }

    @Test
    fun 空字节不炸() {
        val decoded = TextDecoder.decode(ByteArray(0))
        assertEquals("", decoded.text)
    }

    @Test
    fun 二进制文件能被挡住() {
        // PK 头的 docx/xlsx：明显不是纯文本
        val zip = byteArrayOf(0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00)
        assertTrue(TextDecoder.looksBinary(zip))
        // 正常 txt 不该被误判
        assertFalse(TextDecoder.looksBinary("第一章 起风了\n正文\n".toByteArray(Charsets.UTF_8)))
    }
}
