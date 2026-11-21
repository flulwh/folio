package com.folio.reader.core

import com.folio.reader.data.BookFileStore
import com.folio.reader.data.BookStore
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.charset.Charset
import java.nio.file.Files

/**
 * 导入的口径检查：
 *  - `contentHash` 必须是「解码后重新编码成 UTF-8 的字节」的 sha1，
 *    **不是**用户原始文件的字节（GBK 书会与桌面端永远不等）；
 *  - 同一份内容导入两次，第二次是 [BookImporter.Outcome.Duplicate]，
 *    书架里不会出现第二本；
 *  - 落盘的 `books/<id>.txt` 是 UTF-8，且它的 sha1 就等于 contentHash。
 */
class BookImporterTest {

    private lateinit var root: File
    private lateinit var books: BookStore
    private lateinit var files: BookFileStore
    private lateinit var importer: BookImporter

    @Before
    fun setUp() {
        root = Files.createTempDirectory("folio-import").toFile()
        val library = File(root, "library").apply { mkdirs() }
        books = BookStore(library)
        files = BookFileStore(root)
        importer = BookImporter(books, files)
    }

    @After
    fun tearDown() {
        root.deleteRecursively()
    }

    @Test
    fun 第一次导入成功第二次是重复() {
        val bytes = "第一章 起风了\n风从江面上来。".toByteArray(Charsets.UTF_8)
        val first = importer.importBytes("三体.txt", bytes)
        assertTrue("第一次应该成功：$first", first is BookImporter.Outcome.Imported)
        val book = (first as BookImporter.Outcome.Imported).book
        assertEquals("三体", book.title)
        assertEquals("sha1-${book.contentHash}", book.id)
        assertTrue(book.hasLocalFile)
        assertEquals(1, books.read().size)

        val second = importer.importBytes("三体(1).txt", bytes)
        assertTrue("第二次应该是重复：$second", second is BookImporter.Outcome.Duplicate)
        assertEquals(book.id, (second as BookImporter.Outcome.Duplicate).existingId)
        assertEquals("书架里不能多出一条", 1, books.read().size)
    }

    @Test
    fun 导入CBZ漫画并去重() {
        val bytes = comicZip("002.jpg", "001.png", "notes.txt")
        val outcome = importer.importBytes("海贼王.cbz", bytes)
        val book = (outcome as BookImporter.Outcome.Imported).book
        assertEquals(BookType.COMIC, book.type)
        assertEquals("cbz", book.format)
        assertEquals(HashUtils.sha1(bytes), book.contentHash)
        assertEquals(bytes.size.toLong(), book.size)
        assertTrue(book.hasLocalFile)
        assertTrue("原文件应落在 books/<id>.cbz", files.cbzExists(book.id))
        assertEquals(SyncState.NOT_SYNCED, book.syncState)

        val again = importer.importBytes("海贼王.zip", bytes)
        assertTrue("同一份压缩包不能再进一条", again is BookImporter.Outcome.Duplicate)
    }

    @Test
    fun 没有图片的压缩包不算漫画() {
        val outcome = importer.importBytes("空.zip", comicZip("readme.txt"))
        assertTrue("应拒绝无图片包：$outcome", outcome is BookImporter.Outcome.Failed)
    }

    private fun comicZip(vararg names: String): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        java.util.zip.ZipOutputStream(out).use { zip ->
            names.forEach { name ->
                zip.putNextEntry(java.util.zip.ZipEntry(name))
                zip.write(byteArrayOf(1, 2, 3))
                zip.closeEntry()
            }
        }
        return out.toByteArray()
    }

    @Test
    fun contentHash是UTF8正文的sha1而不是原始字节() {
        val text = "第二章 落雨\n雨点敲在窗上。"
        val gbk = Charset.forName("GBK")
        val rawBytes = text.toByteArray(gbk)
        val utf8Bytes = text.toByteArray(Charsets.UTF_8)
        // 前提：两份字节真的不同，否则这个用例什么都没验证
        assertTrue(rawBytes.size != utf8Bytes.size || !rawBytes.contentEquals(utf8Bytes))

        val outcome = importer.importBytes("落雨.txt", rawBytes)
        val book = (outcome as BookImporter.Outcome.Imported).book
        assertEquals(TextDecoder.ENCODING_GBK, book.encoding)
        assertEquals(HashUtils.sha1(utf8Bytes), book.contentHash)
        assertTrue("不能用原始字节的哈希", HashUtils.sha1(rawBytes) != book.contentHash)
    }

    @Test
    fun 落盘的正文是UTF8且哈希自洽() {
        val text = "第三章 天晴\n云散了。"
        val outcome = importer.importBytes("天晴.txt", text.toByteArray(Charsets.UTF_8))
        val book = (outcome as BookImporter.Outcome.Imported).book
        val saved = files.fileFor(book.id)
        assertTrue("正文文件应该存在", saved.isFile)
        assertEquals(text, saved.readText(Charsets.UTF_8))
        assertEquals("文件字节的 sha1 必须等于 contentHash", book.contentHash, HashUtils.sha1File(saved))
        assertEquals(book.size, saved.length())
    }

    @Test
    fun 二进制文件被挡住() {
        // PK 头（zip / docx）：不该被当成 txt 硬解出一堆乱码
        val zip = byteArrayOf(0x50, 0x4B, 0x03, 0x04) + ByteArray(512) { 0x00 }
        val outcome = importer.importBytes("书.docx", zip)
        assertTrue("应该被拒：$outcome", outcome is BookImporter.Outcome.Failed)
        assertEquals(0, books.read().size)
    }

    @Test
    fun 空文件被挡住() {
        val outcome = importer.importBytes("空.txt", ByteArray(0))
        assertTrue(outcome is BookImporter.Outcome.Failed)
    }

    @Test
    fun 书名去掉扩展名() {
        val outcome = importer.importBytes("  三体 第一部.md  ", "正文".toByteArray())
        val book = (outcome as BookImporter.Outcome.Imported).book
        assertEquals("三体 第一部", book.title)
    }

    @Test
    fun 超过三十兆的书标为不参与同步() {
        val big = ByteArray(31 * 1024 * 1024) { 'a'.code.toByte() }
        val outcome = importer.importBytes("大部头.txt", big)
        val book = (outcome as BookImporter.Outcome.Imported).book
        assertEquals(SyncState.EXCLUDED, book.syncState)
        assertEquals(false, book.syncableSize)
    }

    @Test
    fun EPUB按原字节落盘且标为不同步() {
        val epub = epubBytes()
        val outcome = importer.importBytes("三体.epub", epub)
        assertTrue("应该导入成功：$outcome", outcome is BookImporter.Outcome.Imported)
        val book = (outcome as BookImporter.Outcome.Imported).book
        assertEquals("epub", book.format)
        assertTrue(book.isEpub)
        assertEquals("EPUB 不同步，只能是 EXCLUDED", SyncState.EXCLUDED, book.syncState)
        assertEquals("EPUB 不去重编码，哈希取原始字节", HashUtils.sha1(epub), book.contentHash)

        val saved = files.epubFileFor(book.id)
        assertTrue("EPUB 应该落在 books/<id>.epub", saved.isFile)
        assertTrue("必须原样保存，重新打包就坏了", saved.readBytes().contentEquals(epub))
    }

    @Test
    fun 没有扩展名也能按内容认出EPUB() {
        val outcome = importer.importBytes("三体", epubBytes())
        val book = (outcome as BookImporter.Outcome.Imported).book
        assertTrue(book.isEpub)
    }

    @Test
    fun EPUB重复导入只留一本() {
        val epub = epubBytes()
        val first = importer.importBytes("三体.epub", epub) as BookImporter.Outcome.Imported
        val second = importer.importBytes("三体(1).epub", epub)
        assertTrue("第二份应该是重复：$second", second is BookImporter.Outcome.Duplicate)
        assertEquals(first.book.id, (second as BookImporter.Outcome.Duplicate).existingId)
        assertEquals(1, books.read().size)
    }

    /** 最小的「像 EPUB」的字节：zip 头 + 规范要求的 mimetype 串。 */
    private fun epubBytes(): ByteArray =
        byteArrayOf(0x50, 0x4B, 0x03, 0x04) +
            "application/epub+zip".toByteArray(Charsets.US_ASCII) +
            ByteArray(64) { 0x00 }
}
