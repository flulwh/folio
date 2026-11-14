package com.folio.reader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 全书搜索：命中位置、章节归属、上限。 */
class TextSearchTest {

    private fun paragraphs(vararg texts: String): List<Paragraph> =
        texts.map { Paragraph(it, it.isBlank()) }

    @Test
    fun 命中位置能直接切出关键词() {
        val text = "清晨的风穿过长廊，带来一点潮气。"
        val hits = TextSearch.search(
            paragraphs(text),
            listOf(Chapter("第一章", 0)),
            "长廊",
        )
        assertEquals(1, hits.size)
        val hit = hits.first()
        assertEquals("长廊", hit.excerpt.substring(hit.start, hit.end))
    }

    @Test
    fun 英文关键词不区分大小写() {
        val hits = TextSearch.search(
            paragraphs("The Lantern Festival", "another lantern"),
            listOf(Chapter("一", 0)),
            "LANTERN",
        )
        assertEquals(2, hits.size)
        hits.forEach {
            assertEquals("lantern", it.excerpt.substring(it.start, it.end).lowercase())
        }
    }

    @Test
    fun 章节归属按段落号递增() {
        val hits = TextSearch.search(
            paragraphs("开头", "第二章内容", "第二章又一句", "第三章内容"),
            listOf(Chapter("第一章", 0), Chapter("第二章", 1), Chapter("第三章", 3)),
            "内容",
        )
        assertEquals(listOf("第二章", "第三章"), hits.map { it.chapterTitle })
    }

    @Test
    fun 空白段不参与搜索() {
        val hits = TextSearch.search(
            paragraphs(" ", "", "目标"),
            listOf(Chapter("一", 0)),
            "目标",
        )
        assertEquals(1, hits.size)
        assertEquals(2, hits.first().paraIndex)
    }

    @Test
    fun 命中数量受上限约束() {
        val hits = TextSearch.search(
            paragraphs(*(0 until 50).map { "重复词" }.toTypedArray()),
            emptyList(),
            "重复词",
            limit = 10,
        )
        assertEquals(10, hits.size)
    }

    @Test
    fun 空关键词没有命中() {
        assertTrue(TextSearch.search(paragraphs("正文"), emptyList(), "   ").isEmpty())
    }
}
