package com.folio.reader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

/**
 * `contentHash` 的口径是「规范化 UTF-8 正文字节」，所以哈希工具必须：
 *  - 对同一份字节永远给出同一个 40 位十六进制串；
 *  - 文件与字节数组两条路径结果一致（否则导入与下载会算出两个 hash）；
 *  - 流式算的时候能报进度（30MB 的书要几百毫秒，UI 得能显示）。
 */
class HashUtilsTest {

    @Test
    fun 空内容的sha1是已知值() {
        assertEquals("da39a3ee5e6b4b0d3255bfef95601890afd80709", HashUtils.sha1(ByteArray(0)))
    }

    @Test
    fun abc的sha1是已知值() {
        assertEquals("a9993e364706816aba3e25717850c26c9cd0d89d", HashUtils.sha1("abc"))
        assertEquals(
            "a9993e364706816aba3e25717850c26c9cd0d89d",
            HashUtils.sha1("abc".toByteArray(Charsets.UTF_8)),
        )
    }

    @Test
    fun 中文按UTF8算出来的哈希与字节路径一致() {
        val text = "第一章 起风了\n风从江面上来。"
        val bytes = text.toByteArray(Charsets.UTF_8)
        assertEquals(HashUtils.sha1(bytes), HashUtils.sha1(text))
    }

    @Test
    fun 文件哈希与内容哈希一致且带进度() {
        val dir = Files.createTempDirectory("folio-hash").toFile()
        try {
            val file = File(dir, "a.txt")
            file.writeText("第四章 天晴了\n雨停了。", Charsets.UTF_8)
            val reported = ArrayList<Long>()
            val hash = HashUtils.sha1File(file) { done -> reported.add(done) }
            assertEquals(HashUtils.sha1(file.readBytes()), hash)
            assertEquals(40, hash.length)
            assertTrue("应该至少报一次进度", reported.isNotEmpty())
            assertEquals(file.length(), reported.last())
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test
    fun hashOfUtf8同时给出哈希与字节() {
        val text = "第五章 归途"
        val (hash, bytes) = HashUtils.hashOfUtf8(text)
        assertEquals(HashUtils.sha1(bytes), hash)
        assertEquals(text, String(bytes, Charsets.UTF_8))
    }
}
