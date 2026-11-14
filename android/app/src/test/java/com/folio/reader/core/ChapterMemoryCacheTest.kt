package com.folio.reader.core

import com.folio.reader.data.CloudChapterSource
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files

/**
 * 云端章节的 3 章内存 LRU，以及**零磁盘缓存的断言**。
 *
 * 3.0 的红线（架构文档 §8）：任何缓存都只能是内存对象。
 * 这条用例的做法是：拿两个空目录假装 `filesDir` / `cacheDir`，
 * 读 4 章（触发一次淘汰）后数一遍文件数 —— 一个都不能多。
 * 只要有人以后往 `CloudChapterSource` 里加一句 `File(...).writeText`，
 * 这条就会红。
 */
class ChapterMemoryCacheTest {

    private lateinit var filesDir: File
    private lateinit var cacheDir: File

    @Before
    fun setUp() {
        filesDir = Files.createTempDirectory("folio-files").toFile()
        cacheDir = Files.createTempDirectory("folio-cache").toFile()
    }

    @After
    fun tearDown() {
        filesDir.deleteRecursively()
        cacheDir.deleteRecursively()
    }

    @Test
    fun 只留三章最久未用的先走() {
        val cache = ChapterMemoryCache()
        cache.put("b1", 1, "第一章")
        cache.put("b1", 2, "第二章")
        cache.put("b1", 3, "第三章")
        assertEquals(3, cache.size())

        cache.put("b1", 4, "第四章")
        assertEquals(3, cache.size())
        assertFalse("第 1 章应该被淘汰", cache.has("b1", 1))
        assertTrue(cache.has("b1", 4))
    }

    @Test
    fun 读过的章节会变新鲜不被淘汰() {
        val cache = ChapterMemoryCache()
        cache.put("b1", 1, "第一章")
        cache.put("b1", 2, "第二章")
        cache.put("b1", 3, "第三章")
        // 回看第 1 章 → 它变成最新
        assertEquals("第一章", cache.get("b1", 1))
        cache.put("b1", 4, "第四章")
        assertTrue(cache.has("b1", 1))
        assertFalse("这次该淘汰第 2 章", cache.has("b1", 2))
    }

    @Test
    fun 不同书的缓存互不干扰() {
        val cache = ChapterMemoryCache()
        cache.put("a", 1, "A1")
        cache.put("a", 2, "A2")
        cache.put("b", 1, "B1")
        cache.clear("a")
        assertNull(cache.get("a", 1))
        assertEquals("B1", cache.get("b", 1))
        assertEquals(listOf(1), cache.keys("b"))
    }

    @Test
    fun 清空后大小归零() {
        val cache = ChapterMemoryCache()
        cache.put("b1", 1, "第一章")
        assertTrue(cache.size() > 0)
        assertTrue(cache.bytes() > 0)
        cache.clear()
        assertEquals(0, cache.size())
        assertEquals(0L, cache.bytes())
    }

    @Test
    fun 读四章不产生任何磁盘文件() {
        val beforeFiles = countFiles(filesDir)
        val beforeCache = countFiles(cacheDir)
        assertEquals(0, beforeFiles)
        assertEquals(0, beforeCache)

        val source = CloudChapterSource(
            fetchChapter = { _, index -> "第 $index 章的正文内容" },
            fetchToc = { emptyList<TocChapter>() to "夹具书源" },
        )
        for (index in 0 until 4) {
            val loaded = source.chapter("b1", index)
            assertEquals("第 $index 章的正文内容", loaded.text)
        }
        // 第 4 章进来后第 1 章已被淘汰：回到第 1 章要重新取
        assertEquals(3, source.cacheSize)
        assertTrue(source.cacheBytes > 0)

        assertEquals("filesDir 不能多出文件", beforeFiles, countFiles(filesDir))
        assertEquals("cacheDir 不能多出文件", beforeCache, countFiles(cacheDir))
    }

    @Test
    fun 第二次读同一章走内存缓存() {
        var calls = 0
        val source = CloudChapterSource(
            fetchChapter = { _, index -> calls += 1; "第 $index 章" },
            fetchToc = { emptyList<TocChapter>() to "" },
        )
        val first = source.chapter("b1", 5)
        assertFalse(first.fromCache)
        val second = source.chapter("b1", 5)
        assertTrue(second.fromCache)
        assertEquals("只应该真取一次", 1, calls)
    }

    @Test
    fun 断网时给出连接已断开的文案() {
        val source = CloudChapterSource(
            fetchChapter = { _, _ -> throw com.folio.reader.net.FolioException("socket closed", 0) },
            fetchToc = { emptyList<TocChapter>() to "" },
        )
        val error = runCatching { source.chapter("b1", 0) }.exceptionOrNull()
        assertTrue(error is com.folio.reader.net.FolioException)
        assertEquals("连接已断开 · 重试", error!!.message)
    }

    private fun countFiles(dir: File): Int =
        dir.walkTopDown().count { it.isFile }
}
