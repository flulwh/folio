package com.folio.reader.data

import com.folio.reader.core.HashUtils
import java.io.File

/**
 * 本机正文文件仓库：`filesDir/books/<id>.txt` 与 `filesDir/books/<id>.txt.part`。
 *
 * 这一层只管「字节怎么安全落到磁盘」，不认识书、不认识同步：
 *  - 写永远走 `.part` 再原子改名，不会出现半本正文；
 *  - id 来自桌面端（可能带 `://`、`::`、`/`），直接拼文件名会逃出目录，
 *    所以不安全的 id 统一换成 `b-<sha1 前 24 位>`，映射是确定的，同一个 id 永远同一个文件。
 */
class BookFileStore(
    /** App 私有根目录，正式环境传 `context.filesDir`，单测传临时目录。 */
    private val filesDir: File,
) {

    /** `books/` 目录（按需创建）。 */
    fun root(): File = File(filesDir, DIR).apply { if (!isDirectory) mkdirs() }

    /** 正文文件。 */
    fun fileFor(id: String): File = File(root(), safeName(id) + ".txt")

    /** 下载中的临时文件。 */
    fun partFor(id: String): File = File(root(), safeName(id) + ".txt.part")

    /**
     * EPUB 原文件。
     *
     * EPUB 是 zip 容器，Readium 要直接读它，所以**保留原始字节**，
     * 不能像 txt 那样重新编码。
     */
    fun epubFileFor(id: String): File = File(root(), safeName(id) + ".epub")

    fun epubPartFor(id: String): File = File(root(), safeName(id) + ".epub.part")

    fun epubExists(id: String): Boolean = epubFileFor(id).isFile

    /** CBZ 漫画原文件。 */
    fun cbzFileFor(id: String): File = File(root(), safeName(id) + ".cbz")

    fun cbzPartFor(id: String): File = File(root(), safeName(id) + ".cbz.part")

    fun cbzExists(id: String): Boolean = cbzFileFor(id).isFile

    /** 按格式取正式文件：txt / epub / cbz。 */
    fun fileForBook(id: String, format: String): File = when (format) {
        "epub" -> epubFileFor(id)
        "cbz" -> cbzFileFor(id)
        else -> fileFor(id)
    }

    /** 按格式取下载中的临时文件。 */
    fun partForBook(id: String, format: String): File = when (format) {
        "epub" -> epubPartFor(id)
        "cbz" -> cbzPartFor(id)
        else -> partFor(id)
    }

    fun existsBook(id: String, format: String): Boolean = fileForBook(id, format).isFile

    fun exists(id: String): Boolean = fileFor(id).isFile

    fun sizeOf(id: String): Long = fileFor(id).let { if (it.isFile) it.length() else 0L }

    fun sizeOfBook(id: String, format: String): Long =
        fileForBook(id, format).let { if (it.isFile) it.length() else 0L }

    fun partSizeOf(id: String): Long = partFor(id).let { if (it.isFile) it.length() else 0L }

    fun partSizeOfBook(id: String, format: String): Long =
        partForBook(id, format).let { if (it.isFile) it.length() else 0L }

    fun readText(id: String): String? {
        val file = fileFor(id)
        if (!file.isFile) return null
        return runCatching { file.readText(Charsets.UTF_8) }.getOrNull()
    }

    fun readBytes(id: String): ByteArray? {
        val file = fileFor(id)
        if (!file.isFile) return null
        return runCatching { file.readBytes() }.getOrNull()
    }

    /** 原子写整本正文（先 `.part` 再改名）。返回最终文件，失败返回 null。 */
    fun writeBytes(id: String, bytes: ByteArray): File? {
        val part = partFor(id)
        return try {
            part.writeBytes(bytes)
            commitPart(id)
        } catch (err: Exception) {
            runCatching { part.delete() }
            null
        }
    }

    /** 原子写 EPUB 原文件（先 `.epub.part` 再改名）。 */
    fun writeEpub(id: String, bytes: ByteArray): File? {
        val part = epubPartFor(id)
        return try {
            part.writeBytes(bytes)
            val target = epubFileFor(id)
            if (target.exists()) target.delete()
            if (part.renameTo(target)) target else null
        } catch (err: Exception) {
            runCatching { part.delete() }
            null
        }
    }

    /** 原子写 CBZ 原文件（先 `.cbz.part` 再改名）。 */
    fun writeCbz(id: String, bytes: ByteArray): File? {
        val part = cbzPartFor(id)
        return try {
            part.writeBytes(bytes)
            val target = cbzFileFor(id)
            if (target.exists()) target.delete()
            if (part.renameTo(target)) target else null
        } catch (err: Exception) {
            runCatching { part.delete() }
            null
        }
    }

    /** 原子写文本（按 UTF-8）。 */
    fun writeText(id: String, text: String): File? = writeBytes(id, text.toByteArray(Charsets.UTF_8))

    /** 清掉旧的 `.part`，准备从头下载。 */
    fun resetPartFor(id: String, format: String): File {
        val part = partForBook(id, format)
        runCatching { part.delete() }
        return part
    }

    /** 清掉旧的 `.part`，准备从头下载。 */
    fun resetPart(id: String): File {
        val part = partFor(id)
        runCatching { part.delete() }
        root()
        return part
    }

    /** `.part` 改名成正式文件。改名后 `.part` 不存在。 */
    fun commitPart(id: String): File? = commitPartFor(id, "txt")

    /** 按格式把 `.part` 改名成正式文件。 */
    fun commitPartFor(id: String, format: String): File? {
        val part = partForBook(id, format)
        if (!part.isFile) return null
        val target = fileForBook(id, format)
        if (target.exists()) target.delete()
        return if (part.renameTo(target)) target else null
    }

    /** 丢弃下载中的文件（取消上传/下载、校验失败）。 */
    fun discardPart(id: String) {
        runCatching { partFor(id).delete() }
    }

    fun discardPartFor(id: String, format: String) {
        runCatching { partForBook(id, format).delete() }
    }

    /** 删掉一本的正文与临时文件（txt / epub / cbz 一起清）。 */
    fun delete(id: String) {
        runCatching { fileFor(id).delete() }
        runCatching { partFor(id).delete() }
        runCatching { epubFileFor(id).delete() }
        runCatching { epubPartFor(id).delete() }
        runCatching { cbzFileFor(id).delete() }
        runCatching { cbzPartFor(id).delete() }
    }

    /** 这个文件系统的可用字节数（空间预检用）。 */
    fun freeBytes(): Long = runCatching { filesDir.usableSpace }.getOrDefault(0L)

    /** 已经落盘的正文文件数，用于自查与设置页展示。 */
    fun count(): Int = runCatching {
        root().listFiles()?.count {
            it.isFile && (
                it.name.endsWith(".txt") || it.name.endsWith(".epub") || it.name.endsWith(".cbz")
                )
        } ?: 0
    }.getOrDefault(0)

    /**
     * 把书 id 变成安全的文件名主干。
     *
     * 本机导入的 `sha1-<40hex>` 与普通短 id 原样保留（好看、好排查），
     * 其余（桌面端带 `://`、`::`、`/` 的 id）走哈希，绝不出现 `../`。
     */
    fun safeName(id: String): String {
        val raw = id.trim()
        if (raw.isEmpty()) return "empty"
        val safe = raw.length <= 80 && raw.all { it.isLetterOrDigit() || it == '-' || it == '_' || it == '.' }
        if (safe && !raw.contains("..")) return raw
        return "b-" + HashUtils.sha1(raw).take(24)
    }

    companion object {
        const val DIR = "books"
    }
}
