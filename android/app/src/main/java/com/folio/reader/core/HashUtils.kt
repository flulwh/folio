package com.folio.reader.core

import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/**
 * SHA-1 工具。
 *
 * 统一走流式，任何时候都不把整本正文读进内存：手机上传 30MB 的书如果先
 * `readBytes()` 再算哈希，等于把整个文件再复制一份，低端机直接 OOM。
 *
 * 输出固定为 40 位小写十六进制，与桌面端 `fileSha1()` 逐位可比。
 */
object HashUtils {

    /** 流式读盘用的缓冲区：64KB 在「系统调用次数」和「内存占用」之间比较平衡。 */
    const val BUFFER_BYTES = 64 * 1024

    private val HEX = "0123456789abcdef".toCharArray()

    /** 算内存里的字节。 */
    fun sha1(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-1").digest(bytes)
        return toHex(digest)
    }

    /** 算一段文本的 UTF-8 字节 —— 这就是 contentHash 的口径。 */
    fun sha1(text: String): String = sha1(text.toByteArray(Charsets.UTF_8))

    /** 新建一个可增量喂数据的 digest，供「边写边算」的场景用。 */
    fun newDigest(): MessageDigest = MessageDigest.getInstance("SHA-1")

    /** 把 digest 收成 40 位小写 hex。 */
    fun toHex(digest: MessageDigest): String = toHex(digest.digest())

    private fun toHex(bytes: ByteArray): String {
        val out = CharArray(bytes.size * 2)
        for (i in bytes.indices) {
            val value = bytes[i].toInt() and 0xFF
            out[i * 2] = HEX[value ushr 4]
            out[i * 2 + 1] = HEX[value and 0x0F]
        }
        return String(out)
    }

    /**
     * 流式计算一个文件的 sha1。
     *
     * @param file 待算的文件
     * @param onProgress 已经读过的字节数回调（节流由调用方决定，这里每个缓冲区回调一次）
     * @return 40 位小写 hex
     */
    fun sha1File(file: File, onProgress: ((Long) -> Unit)? = null): String {
        val digest = newDigest()
        var read = 0L
        file.inputStream().use { input ->
            val buffer = ByteArray(BUFFER_BYTES)
            while (true) {
                val count = input.read(buffer)
                if (count <= 0) break
                digest.update(buffer, 0, count)
                read += count
                onProgress?.invoke(read)
            }
        }
        return toHex(digest)
    }

    /**
     * 流式计算一个输入流的 sha1。**不关闭**调用方的流（由调用方负责生命周期）。
     *
     * @param input 数据源
     * @param onProgress 已读字节数回调
     */
    fun sha1Stream(input: InputStream, onProgress: ((Long) -> Unit)? = null): String {
        val digest = newDigest()
        val buffer = ByteArray(BUFFER_BYTES)
        var read = 0L
        while (true) {
            val count = input.read(buffer)
            if (count <= 0) break
            digest.update(buffer, 0, count)
            read += count
            onProgress?.invoke(read)
        }
        return toHex(digest)
    }

    /** 把一段文本按 UTF-8 落成字节，顺便算出 contentHash。 */
    fun hashOfUtf8(text: String): Pair<String, ByteArray> {
        val bytes = text.toByteArray(Charsets.UTF_8)
        return sha1(bytes) to bytes
    }
}
