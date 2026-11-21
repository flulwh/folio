package com.folio.reader.core

import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
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

    /** 单页解压上限，与桌面端 `electron/cbz.js` 的 32MiB 一致：超过就当这页不存在。 */
    private const val MAX_PAGE_BYTES = 32 * 1024 * 1024

    private const val NAME_CACHE_SIZE = 8

    /**
     * 页名列表按「路径 + 大小 + mtime」缓存：翻页时不必每次重新打开 zip 全量排序。
     * 文件被替换（同步覆盖、重新导入）时 key 会变，自然失效。
     */
    private val nameCache = object : LinkedHashMap<String, List<String>>(16, 0.75f, true) {
        override fun removeEldestEntry(
            eldest: MutableMap.MutableEntry<String, List<String>>?,
        ): Boolean = size > NAME_CACHE_SIZE
    }

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
                if (entry.size > MAX_PAGE_BYTES) return@use null
                zip.getInputStream(entry).use { input ->
                    val bytes = readCapped(input, MAX_PAGE_BYTES) ?: return@use null
                    CbzPage(bytes, mimeOf(name), name)
                }
            }
        }.getOrNull()
    }

    /** 单页解压到内存，超过 [limit] 立刻放弃：条目里声明的 size 可能是假的（zip 炸弹）。 */
    private fun readCapped(input: InputStream, limit: Int): ByteArray? {
        val out = java.io.ByteArrayOutputStream(minOf(limit, 1 shl 20))
        val chunk = ByteArray(64 * 1024)
        var total = 0
        while (true) {
            val count = input.read(chunk)
            if (count <= 0) break
            total += count
            if (total > limit) return null
            out.write(chunk, 0, count)
        }
        return out.toByteArray()
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
        val key = "${file.absolutePath}:${file.length()}:${file.lastModified()}"
        synchronized(nameCache) { nameCache[key] }?.let { return@runCatching it }
        val names = ZipFile(file).use { zip ->
            zip.entries().asSequence()
                // 与桌面端一致：超过单页上限的条目直接不参与页序，双端页数才对得上
                .filter { isImage(it.name, it.isDirectory) && it.size <= MAX_PAGE_BYTES }
                .map { it.name }
                .toList()
                .sortedWith(naturalOrder)
        }
        synchronized(nameCache) { nameCache[key] = names }
        names
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

    private val naturalOrder = Comparator<String> { left, right -> comparePageName(left, right) }
}

/** 页名分词：连续数字或连续非数字。与桌面端 `tokenizePageName` 的正则一致。 */
private val pageNameToken = Regex("\\d+|\\D+")

/**
 * 双端共用的页名自然顺序：数字段按数值比较，其余按小写后的 UTF-16 码位，
 * 忽略大小写后仍相同再用原名兜底。桌面端 `electron/cbz.js` 的 `comparePageName`
 * 与此逐条对齐，任何一边改了都要同步改另一边，否则「第几页」会错位。
 */
internal fun comparePageName(a: String, b: String): Int {
    val left = pageNameToken.findAll(a).map { it.value }.toList()
    val right = pageNameToken.findAll(b).map { it.value }.toList()
    for (i in 0 until minOf(left.size, right.size)) {
        val x = left[i]
        val y = right[i]
        // 只把 ASCII 数字当数字段，和 JS 的 \d 口径一致（全角数字走字符串比较）
        val diff = if (isAsciiDigit(x.first()) && isAsciiDigit(y.first())) {
            val nx = x.trimStart('0').ifEmpty { "0" }
            val ny = y.trimStart('0').ifEmpty { "0" }
            if (nx.length != ny.length) nx.length - ny.length else nx.compareTo(ny)
        } else {
            x.lowercase().compareTo(y.lowercase())
        }
        if (diff != 0) return diff
    }
    if (left.size != right.size) return left.size - right.size
    return a.compareTo(b)
}

private fun isAsciiDigit(value: Char): Boolean = value in '0'..'9'
