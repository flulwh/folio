package com.folio.reader.core

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * CBZ 读取口径：
 *  - 只把图片当页，`__MACOSX`、隐藏文件、txt 都忽略；
 *  - 页序与桌面端一致，`2.jpg` 必须排在 `10.jpg` 前；
 *  - 打不开 / 没图片时 `pageCount` 返回 0，不抛异常。
 */
class CbzArchiveTest {

    private lateinit var root: File

    @Before
    fun setUp() {
        root = Files.createTempDirectory("folio-cbz").toFile()
    }

    @After
    fun tearDown() {
        root.deleteRecursively()
    }

    private fun zipOf(vararg files: String): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            files.forEach { name ->
                zip.putNextEntry(ZipEntry(name))
                zip.write("page:$name".toByteArray(Charsets.UTF_8))
                zip.closeEntry()
            }
        }
        return out.toByteArray()
    }

    @Test
    fun 只列图片并按自然顺序排页() {
        val file = File(root, "comic.cbz")
        file.writeBytes(
            zipOf(
                "b/2.jpg",
                "a/10.png",
                "a/2.webp",
                "__MACOSX/._a.jpg",
                "notes.txt",
                "a/",
            )
        )

        assertEquals(3, CbzArchive.pageCount(file))
        assertEquals("a/2.webp", CbzArchive.readPage(file, 0)?.name)
        assertEquals("a/10.png", CbzArchive.readPage(file, 1)?.name)
        assertEquals("b/2.jpg", CbzArchive.readPage(file, 2)?.name)
        assertEquals("image/png", CbzArchive.readPage(file, 1)?.mime)
        assertNull(CbzArchive.readPage(file, 3))
    }

    @Test
    fun 读出的字节就是压缩包里的内容() {
        val file = File(root, "bytes.cbz")
        file.writeBytes(zipOf("001.jpg"))
        assertEquals("page:001.jpg", CbzArchive.readPage(file, 0)?.bytes?.toString(Charsets.UTF_8))
    }

    @Test
    fun 导入前探测图片数量() {
        assertEquals(2, CbzArchive.probe(zipOf("1.jpg", "2.png", "readme.md")))
        assertEquals(0, CbzArchive.probe("not a zip".toByteArray()))
        assertEquals(0, CbzArchive.probe(zipOf("readme.md")))
    }

    @Test
    fun 文件不存在时返回空() {
        val missing = File(root, "missing.cbz")
        assertEquals(0, CbzArchive.pageCount(missing))
        assertNull(CbzArchive.readPage(missing, 0))
        assertTrue(!missing.exists())
    }
}
