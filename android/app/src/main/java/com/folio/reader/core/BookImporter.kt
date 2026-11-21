package com.folio.reader.core

import com.folio.reader.data.BookFileStore
import com.folio.reader.data.BookStore
import java.io.File
import java.io.InputStream

/**
 * 本机导入：SAF 选中的文件 → 解码 → 规范化 UTF-8 → sha1 → 落盘 → 元数据。
 *
 * **contentHash 口径**（跨端硬约定，改了就双端永远不同步）：
 *   `contentHash = sha1(解码后重新编码成 UTF-8 的字节)`
 * 绝不用原始文件字节 —— 一本 GBK 的 txt 和桌面端那本 UTF-8 副本的 sha1 必然不同，
 * 会被判成「同名不同内容」，然后无限重传 + 假冲突。
 *
 * 落盘同样是 UTF-8，所以 `sha1(books/<id>.txt 的字节) == contentHash` 永远成立。
 */
class BookImporter(
    private val books: BookStore,
    private val files: BookFileStore,
) {

    /** 导入结果。 */
    sealed class Outcome {
        /** 新导入成功。 */
        data class Imported(val book: LocalBook) : Outcome()

        /** 同一份内容已经在书架里（按 contentHash 判定），不再产生第二本。 */
        data class Duplicate(val existingId: String) : Outcome()

        /** 导入失败，[reason] 直接给人看。 */
        data class Failed(val reason: String) : Outcome()
    }

    /**
     * 从字节导入。
     *
     * @param displayName 用户看到的文件名（带不带扩展名都行，扩展名会被去掉当书名）
     * @param bytes 文件原始字节
     */
    fun importBytes(displayName: String, bytes: ByteArray): Outcome {
        if (bytes.isEmpty()) return Outcome.Failed("这本书是空的")
        // EPUB 是 zip 容器，必须按原字节保存（Readium 直接读它），不能走文本解码。
        if (isEpub(displayName, bytes)) return importEpub(displayName, bytes)
        // 漫画同样按容器原字节保存；先判 EPUB，避免 .zip 结尾的 EPUB 被当漫画
        if (isCbz(displayName)) return importCbz(displayName, bytes)
        if (TextDecoder.looksBinary(bytes)) {
            return Outcome.Failed("暂不支持该格式。可以导入 TXT / Markdown / EPUB / CBZ 漫画。")
        }

        // 1. 解码（顺序与桌面端 decodeText 一致）
        val decoded = TextDecoder.decode(bytes)
        if (decoded.text.isBlank()) return Outcome.Failed("这本书是空的")

        // 2. 按 UTF-8 重新编码 —— 这份字节才是 contentHash 的口径
        val utf8 = decoded.text.toByteArray(Charsets.UTF_8)
        val hash = HashUtils.sha1(utf8)
        val id = "sha1-$hash"

        // 3. 去重：同内容只留一条
        books.findByHash(hash)?.let { existing ->
            return Outcome.Duplicate(existing.id)
        }

        // 4. 落盘（原子）
        val target = files.writeBytes(id, utf8)
            ?: return Outcome.Failed("写入正文失败，检查手机存储空间")

        // 5. 元数据
        val title = titleOf(displayName)
        val book = LocalBook(
            id = id,
            title = title,
            author = null,
            origin = Origin.LOCAL,
            remoteKind = null,
            type = BookType.NOVEL,
            contentHash = hash,
            size = utf8.size.toLong(),
            encoding = decoded.encoding,
            hasLocalFile = true,
            addedAt = System.currentTimeMillis(),
            syncState = if (utf8.size.toLong() <= LocalBook.MAX_SYNC_BYTES) {
                SyncState.NOT_SYNCED
            } else {
                SyncState.EXCLUDED
            },
        )
        books.upsert(book)
        return Outcome.Imported(book)
    }

    /**
     * 从输入流导入。会读满整个流到内存 —— 手机导入的 txt 通常几 MB，
     * 真正的大文件走「先落 .part 再算哈希」的下载路径，不经过这里。
     */
    fun importStream(displayName: String, input: InputStream): Outcome =
        input.use { stream ->
            val limit = when {
                displayName.endsWith(".epub", ignoreCase = true) -> EPUB_INTAKE_LIMIT
                isCbz(displayName) -> CBZ_INTAKE_LIMIT
                else -> INTAKE_LIMIT
            }
            val buffer = java.io.ByteArrayOutputStream()
            val chunk = ByteArray(HashUtils.BUFFER_BYTES)
            while (true) {
                val count = stream.read(chunk)
                if (count <= 0) break
                buffer.write(chunk, 0, count)
                // 单本上限：txt 30MB（同步口径），EPUB 200MB（本机专用，不同步）
                if (buffer.size() > limit) {
                    val mb = limit / 1024 / 1024
                    return@use Outcome.Failed("这本书超过 ${mb}MB，暂时无法导入")
                }
            }
            importBytes(displayName, buffer.toByteArray())
        }

    /** 从磁盘文件导入（调试与脚本用；App 里走 SAF 拿到的是 InputStream）。 */
    fun importFile(file: File): Outcome =
        runCatching { importBytes(file.name, file.readBytes()) }
            .getOrElse { Outcome.Failed("读不到这个文件：${it.message ?: "未知错误"}") }

    /** 文件名 → 书名：去掉扩展名与首尾空白。 */
    private fun titleOf(displayName: String): String {
        val base = displayName.substringBeforeLast('.', displayName).trim()
        return base.ifBlank { "未命名" }
    }

    /** 漫画压缩包：CBZ 与普通 ZIP 都收，内容由 [CbzArchive] 再验一遍。 */
    private fun isCbz(displayName: String): Boolean =
        displayName.endsWith(".cbz", ignoreCase = true) ||
            displayName.endsWith(".zip", ignoreCase = true)

    /** 漫画容器：原字节落盘；30MB 以内参与同步，超过只在本机读。 */
    private fun importCbz(displayName: String, bytes: ByteArray): Outcome {
        if (CbzArchive.probe(bytes) == 0) {
            return Outcome.Failed("这个压缩包里没有图片，暂时无法作为漫画导入")
        }
        val hash = HashUtils.sha1(bytes)
        val id = "sha1-$hash"
        books.findByHash(hash)?.let { existing -> return Outcome.Duplicate(existing.id) }
        files.writeCbz(id, bytes) ?: return Outcome.Failed("写入漫画失败，检查手机存储空间")
        val size = bytes.size.toLong()
        val book = LocalBook(
            id = id,
            title = titleOf(displayName),
            author = null,
            origin = Origin.LOCAL,
            type = BookType.COMIC,
            contentHash = hash,
            size = size,
            format = "cbz",
            hasLocalFile = true,
            addedAt = System.currentTimeMillis(),
            syncState = if (size <= LocalBook.MAX_SYNC_BYTES) {
                SyncState.NOT_SYNCED
            } else {
                SyncState.EXCLUDED
            },
        )
        books.upsert(book)
        return Outcome.Imported(book)
    }

    /** EPUB 判定：扩展名优先，其次看 zip 头与规范要求的 `application/epub+zip`。 */
    private fun isEpub(displayName: String, bytes: ByteArray): Boolean {
        if (displayName.endsWith(".epub", ignoreCase = true)) return true
        if (bytes.size < 4) return false
        if (bytes[0] != 0x50.toByte() || bytes[1] != 0x4B.toByte()) return false
        val probe = bytes.copyOfRange(0, minOf(bytes.size, 2048))
        return String(probe, Charsets.US_ASCII).contains("application/epub+zip")
    }

    /**
     * EPUB 导入：原字节落盘 → 元数据。
     *
     * 不重编码、不算「规范化正文字节」：EPUB 是容器，重新打包就坏了。
     * `syncState = EXCLUDED` 是结构保证：桌面端不认这个格式，永不上传。
     */
    private fun importEpub(displayName: String, bytes: ByteArray): Outcome {
        val hash = HashUtils.sha1(bytes)
        val id = "sha1-$hash"
        books.findByHash(hash)?.let { existing -> return Outcome.Duplicate(existing.id) }
        files.writeEpub(id, bytes) ?: return Outcome.Failed("写入 EPUB 失败，检查手机存储空间")
        val book = LocalBook(
            id = id,
            title = titleOf(displayName),
            author = null,
            origin = Origin.LOCAL,
            type = BookType.NOVEL,
            contentHash = hash,
            size = bytes.size.toLong(),
            format = "epub",
            hasLocalFile = true,
            addedAt = System.currentTimeMillis(),
            syncState = SyncState.EXCLUDED,
        )
        books.upsert(book)
        return Outcome.Imported(book)
    }

    companion object {
        /** SAF 一次导入的字节上限（30MB，与可同步上限一致）。 */
        const val INTAKE_LIMIT = 30 * 1024 * 1024

        /** EPUB 上限：本机专用、不同步，只受内存与磁盘限制。 */
        const val EPUB_INTAKE_LIMIT = 200 * 1024 * 1024

        /** 漫画上限：超过 30MB 仍可本机读，只是不参与同步。 */
        const val CBZ_INTAKE_LIMIT = 100 * 1024 * 1024
    }
}
