package com.folio.reader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 正文切段与章节识别要跟桌面端 chapters.js 对齐。 */
class TextParserTest {

    @Test
    fun 规范化去掉BOM和回车() {
        val raw = "\uFEFF第一章\r\n内容\r\n"
        val text = TextParser.normalizeText(raw)
        assertTrue(!text.contains("\uFEFF"))
        assertTrue(!text.contains("\r"))
        assertEquals("第一章\n内容\n", text)
    }

    @Test
    fun 空行变成呼吸段() {
        val parsed = TextParser.parseBook("第一段\n\n第二段")
        val blanks = parsed.paragraphs.count { it.blank }
        assertEquals(1, blanks)
        assertEquals("第一段", parsed.paragraphs[0].text)
        assertEquals("第二段", parsed.paragraphs[2].text)
    }

    @Test
    fun 硬换行的句子会粘回上一段() {
        val text = "这是一段很长很长的句子用来测试硬换行的合并行为呢呀哈\n它没有句号所以会接上"
        val parsed = TextParser.parseBook(text)
        assertEquals(1, parsed.paragraphs.size)
        assertTrue(parsed.paragraphs[0].text.contains("它没有句号所以会接上"))
    }

    @Test
    fun 认出中文章节() {
        val text = "第一章 起风了\n内容一\n第二章 落雨\n内容二"
        val parsed = TextParser.parseBook(text)
        assertTrue(parsed.hasHeadings)
        assertEquals(2, parsed.chapters.size)
        assertEquals("第一章 起风了", parsed.chapters[0].title)
        assertEquals(2, parsed.chapters[1].paraIndex)
    }

    @Test
    fun 认出英文章节() {
        val text = "Chapter 1 The Start\nbody text\nChapter 2 The End\nmore body"
        val parsed = TextParser.parseBook(text)
        assertTrue(parsed.hasHeadings)
        assertEquals(2, parsed.chapters.size)
    }

    @Test
    fun 没有章节时给一个全文() {
        val parsed = TextParser.parseBook("只有一段话\n还是一段话")
        assertTrue(!parsed.hasHeadings)
        assertEquals(1, parsed.chapters.size)
        assertEquals("全文", parsed.chapters[0].title)
    }

    @Test
    fun 章节之前有正文时补一个开篇() {
        val text = "正文先来一段\n第一章 开始\n内容"
        val parsed = TextParser.parseBook(text)
        assertEquals("开篇", parsed.chapters[0].title)
        assertEquals(0, parsed.chapters[0].paraIndex)
    }

    @Test
    fun 找到段落所属章节() {
        val chapters = listOf(Chapter("开篇", 0), Chapter("第一章", 3), Chapter("第二章", 9))
        assertEquals(0, TextParser.chapterIndexForPara(chapters, 1))
        assertEquals(1, TextParser.chapterIndexForPara(chapters, 5))
        assertEquals(2, TextParser.chapterIndexForPara(chapters, 20))
    }

    @Test
    fun 中文字数按字算() {
        val parsed = TextParser.parseBook("一二三四五")
        assertEquals(5, parsed.wordCount)
    }

    @Test
    fun 保留原文用于离线缓存() {
        val parsed = TextParser.parseBook("第一章\r\n内容")
        assertTrue(parsed.rawText.contains("第一章"))
        assertTrue(!parsed.rawText.contains("\r"))
    }
}
