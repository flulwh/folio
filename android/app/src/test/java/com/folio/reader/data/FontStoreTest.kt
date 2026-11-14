package com.folio.reader.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

/** 字体落盘：校验、命名、清单、目录缓存。 */
class FontStoreTest {

    private fun store(): FontStore = FontStore(Files.createTempDirectory("fonts").toFile())

    private fun catalogFont(size: Long, id: String = "demo") = CatalogFont(
        id = id,
        version = 1,
        name = "示例字体",
        family = "Demo Font",
        category = "hei",
        description = "",
        preview = "",
        homepage = "",
        license = FontLicense("OFL-1.1", "SIL Open Font License 1.1", ""),
        file = FontAsset(
            format = "ttf",
            url = "https://example.com/$id.ttf",
            size = size,
            sha256 = "a".repeat(64),
        ),
    )

    private fun writePart(store: FontStore, id: String, bytes: ByteArray) =
        store.partFile(id, "ttf").apply {
            parentFile?.mkdirs()
            writeBytes(bytes)
        }

    @Test
    fun 提交后落盘并可按id读回() {
        val store = store()
        val part = writePart(store, "demo", byteArrayOf(0, 1, 0, 0))
        val record = store.commit(part, catalogFont(4))
        assertNotNull(record)
        assertEquals("demo", record!!.id)
        assertEquals("demo.ttf", record.file)
        assertEquals(listOf("demo"), store.installed().map { it.id })
        assertTrue(store.fileOf("demo")!!.isFile)
    }

    @Test
    fun 大小不符拒绝提交() {
        val store = store()
        val part = writePart(store, "demo", byteArrayOf(0, 1, 0, 0))
        assertNull(store.commit(part, catalogFont(5)))
        assertTrue(store.installed().isEmpty())
        assertTrue(part.isFile)
    }

    @Test
    fun 不是字体文件拒绝提交() {
        val store = store()
        val part = writePart(store, "demo", "NOPE".toByteArray(Charsets.ISO_8859_1))
        assertNull(store.commit(part, catalogFont(4)))
        assertTrue(store.installed().isEmpty())
    }

    @Test
    fun 移除后文件与清单都清掉() {
        val store = store()
        val record = store.commit(writePart(store, "demo", byteArrayOf(0, 1, 0, 0)), catalogFont(4))
        assertNotNull(record)
        assertTrue(store.remove("demo"))
        assertTrue(store.installed().isEmpty())
        assertNull(store.fileOf("demo"))
    }

    @Test
    fun 重复提交同id只留一条() {
        val store = store()
        store.commit(writePart(store, "demo", byteArrayOf(0, 1, 0, 0)), catalogFont(4))
        store.commit(writePart(store, "demo", "OTTO".toByteArray(Charsets.ISO_8859_1)), catalogFont(4))
        assertEquals(1, store.installed().count { it.id == "demo" })
    }

    @Test
    fun 目录缓存可写可读() {
        val store = store()
        val json = """
            {"schema":1,"fonts":[{"id":"demo","name":"示例","file":{
              "format":"ttf","url":"https://example.com/demo.ttf","size":4,
              "sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}]}
        """.trimIndent()
        assertTrue(store.writeCatalogCache(json, 1234L))
        val cache = store.readCatalogCache()
        assertNotNull(cache)
        assertEquals(1234L, cache!!.fetchedAt)
        assertEquals("demo", cache.fonts.single().id)
    }

    @Test
    fun 坏缓存返回null() {
        val store = store()
        assertTrue(store.writeCatalogCache("not json", 1L).not())
        assertNull(store.readCatalogCache())
    }
}
