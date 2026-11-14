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
        if (TextDecoder.looksBinary(bytes)) {
            return Outcome.Failed("暂不支持该格式。当前版本专注于纯文本（TXT / Markdown）电子书，请导入 TXT 或 Markdown 文件。")
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
            val buffer = java.io.ByteArrayOutputStream()
            val chunk = ByteArray(HashUtils.BUFFER_BYTES)
            while (true) {
                val count = stream.read(chunk)
                if (count <= 0) break
                buffer.write(chunk, 0, count)
                // 单本上限 30MB：超过就没法同步，也没必要读进内存
                if (buffer.size() > INTAKE_LIMIT) {
                    return@use Outcome.Failed("这本书超过 30MB，暂时只能放在桌面端阅读")
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

    companion object {
        /** SAF 一次导入的字节上限（30MB，与可同步上限一致）。 */
        const val INTAKE_LIMIT = 30 * 1024 * 1024
    }
}
