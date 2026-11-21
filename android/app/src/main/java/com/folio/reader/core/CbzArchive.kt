package com.folio.reader.core

import java.io.ByteArrayInputStream
import java.io.File
import java.util.zip.ZipFile
import java.util.zip.ZipInputStream

/** 压缩包里的一页：原始字节 + MIME。 */
data class CbzPage(val bytes: ByteArray, val mime: String, val name: String)

/**
 * CBZ / ZIP 漫画读取器。
 *
 * 只认图片条目，按「自然顺序」排页（`2.jpg` 在 `10.jpg` 前），与桌面端
 * `electron/cbz.js` 的排序规则保持一致，否则双端的「第几页」会对不上。
 */
object CbzArchive {

    private val imageTypes = mapOf(
        "jpg" to "image/jpeg",
        "jpeg" to "image/jpeg",
        "png" to "image/png",
        "webp" to "image/webp",
        "gif" to "image/gif",
        "bmp" to "image/bmp",
        "avif" to "image/avif",
    )

    /** 这本漫画一共有多少页；打不开或没有图片时返回 0。 */
    fun pageCount(file: File): Int = imageNames(file)?.size ?: 0

    /** 读第 [page] 页（0 基），越界或读失败返回 null。 */
    fun readPage(file: File, page: Int): CbzPage? {
        val names = imageNames(file) ?: return null
        val name = names.getOrNull(page) ?: return null
        return runCatching {
            ZipFile(file).use { zip ->
                val entry = zip.getEntry(name) ?: return@use null
                zip.getInputStream(entry).use { input ->
                    CbzPage(input.readBytes(), mimeOf(name), name)
                }
            }
        }.getOrNull()
    }

    /** 导入前校验：内存里的字节是否是一个至少含一张图片的 zip。 */
    fun probe(bytes: ByteArray): Int = runCatching {
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            var count = 0
            while (true) {
                val entry = zip.nextEntry ?: break
                if (isImage(entry.name, entry.isDirectory)) count += 1
                zip.closeEntry()
            }
            count
        }
    }.getOrDefault(0)

    private fun imageNames(file: File): List<String>? = runCatching {
        ZipFile(file).use { zip ->
            zip.entries().asSequence()
                .filter { isImage(it.name, it.isDirectory) }
                .map { it.name }
                .toList()
                .sortedWith(naturalOrder)
        }
    }.getOrNull()

    private fun mimeOf(name: String): String {
        val ext = name.substringAfterLast('.', "").lowercase()
        return imageTypes[ext] ?: "image/jpeg"
    }

    private fun isImage(name: String, directory: Boolean): Boolean {
        if (directory || name.isEmpty() || name.endsWith("/")) return false
        if (name.startsWith("__MACOSX/")) return false
        val base = name.substringAfterLast('/')
        if (base.isEmpty() || base.startsWith(".")) return false
        return imageTypes.containsKey(base.substringAfterLast('.', "").lowercase())
    }

    private val naturalOrder = Comparator<String> { left, right -> compareNatural(left, right) }

    private fun compareNatural(a: String, b: String): Int {
        val left = tokens(a)
        val right = tokens(b)
        for (i in 0 until minOf(left.size, right.size)) {
            val x = left[i]
            val y = right[i]
            val diff = if (x.first().isDigit() && y.first().isDigit()) {
                val nx = x.trimStart('0').ifEmpty { "0" }
                val ny = y.trimStart('0').ifEmpty { "0" }
                if (nx.length != ny.length) nx.length - ny.length else nx.compareTo(ny)
            } else {
                x.compareTo(y, ignoreCase = true)
            }
            if (diff != 0) return diff
        }
        return left.size - right.size
    }

    private fun tokens(value: String): List<String> =
        Regex("\\d+|\\D+").findAll(value).map { it.value }.toList()
}
