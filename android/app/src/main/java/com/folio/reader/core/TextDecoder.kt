package com.folio.reader.core

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction

/**
 * 文本编码识别。
 *
 * 判定顺序与桌面端 `electron/main.js` 的 `decodeText()` **完全相同**，
 * 否则同一本 GBK 书在两端解出来的字符不一样，切段就会漂，
 * `paraIndex` 也就不再能互认：
 *
 *   1. `FF FE` → UTF-16LE（跳过 BOM）
 *   2. `FE FF` → UTF-16BE（跳过 BOM）
 *   3. `EF BB BF` → UTF-8（跳过 BOM）
 *   4. 严格 UTF-8 能解通 → UTF-8
 *   5. 否则 GBK（中文 txt 的常见存量编码）
 *   6. GBK 不可用 → 宽松 UTF-8 兜底（宁可出现几个乱码，也不要整本打不开）
 *
 * 注意：BOM 一律被吃掉，解码结果里不含 BOM —— 桌面端写出的正文副本
 * 同样不含 BOM，这样两端算出的 contentHash 才一致。
 */
object TextDecoder {

    /** 常见中文 txt 的编码名，用于展示与排障。 */
    const val ENCODING_UTF8 = "utf-8"
    const val ENCODING_UTF16LE = "utf-16le"
    const val ENCODING_UTF16BE = "utf-16be"
    const val ENCODING_GBK = "gbk"

    /** 解码结果：正文 + 实际用到的编码。 */
    data class Decoded(val text: String, val encoding: String)

    private val GBK: Charset? by lazy {
        runCatching { Charset.forName("GBK") }.getOrNull()
    }

    /** 是否带 UTF-16 BOM（`FF FE` / `FE FF`）。 */
    fun hasUtf16Bom(bytes: ByteArray): Boolean =
        bytes.size >= 2 &&
            ((bytes[0] == 0xFF.toByte() && bytes[1] == 0xFE.toByte()) ||
                (bytes[0] == 0xFE.toByte() && bytes[1] == 0xFF.toByte()))

    /**
     * 解码一段字节。
     *
     * @param bytes 原始字节（文件内容或网络下载内容）
     * @return 正文与编码名；空输入返回空串 + utf-8
     */
    fun decode(bytes: ByteArray): Decoded {
        if (bytes.isEmpty()) return Decoded("", ENCODING_UTF8)

        // 1. UTF-16LE BOM
        if (bytes.size >= 2 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xFE.toByte()) {
            val body = bytes.copyOfRange(2, bytes.size)
            return Decoded(decodeStrict(body, Charsets.UTF_16LE) ?: decodeLenient(body, Charsets.UTF_16LE), ENCODING_UTF16LE)
        }
        // 2. UTF-16BE BOM：少数环境没有 utf-16be 实现，字节对换后用 LE 解
        if (bytes.size >= 2 && bytes[0] == 0xFE.toByte() && bytes[1] == 0xFF.toByte()) {
            val body = bytes.copyOfRange(2, bytes.size)
            val direct = decodeStrict(body, Charsets.UTF_16BE)
            if (direct != null) return Decoded(direct, ENCODING_UTF16BE)
            val swapped = ByteArray(body.size)
            var i = 0
            while (i + 1 < body.size) {
                swapped[i] = body[i + 1]
                swapped[i + 1] = body[i]
                i += 2
            }
            if (i < body.size) swapped[i] = body[i]
            return Decoded(decodeLenient(swapped, Charsets.UTF_16LE), ENCODING_UTF16BE)
        }
        // 3. UTF-8 BOM
        if (bytes.size >= 3 &&
            bytes[0] == 0xEF.toByte() && bytes[1] == 0xBB.toByte() && bytes[2] == 0xBF.toByte()
        ) {
            val body = bytes.copyOfRange(3, bytes.size)
            return Decoded(decodeStrict(body, Charsets.UTF_8) ?: decodeLenient(body, Charsets.UTF_8), ENCODING_UTF8)
        }
        // 4. 严格 UTF-8
        decodeStrict(bytes, Charsets.UTF_8)?.let { return Decoded(it, ENCODING_UTF8) }
        // 5. GBK。桌面端 `new TextDecoder('gbk')` 默认不是 fatal 模式，
        //    遇到非法序列替换成 U+FFFD 而不是抛错 —— 这里保持一致（宽松）。
        GBK?.let { gbk -> return Decoded(decodeLenient(bytes, gbk), ENCODING_GBK) }
        // 6. 兜底：环境里连 GBK 都没有
        return Decoded(decodeLenient(bytes, Charsets.UTF_8), ENCODING_UTF8)
    }

    /** 解码失败返回 null（严格模式，任何非法序列都算失败）。 */
    private fun decodeStrict(bytes: ByteArray, charset: Charset): String? = try {
        charset.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes))
            .toString()
    } catch (err: CharacterCodingException) {
        null
    } catch (err: Exception) {
        null
    }

    /** 宽松解码：非法字节替换成 U+FFFD，绝不抛。 */
    private fun decodeLenient(bytes: ByteArray, charset: Charset): String =
        runCatching {
            charset.newDecoder()
                .onMalformedInput(CodingErrorAction.REPLACE)
                .onUnmappableCharacter(CodingErrorAction.REPLACE)
                .decode(ByteBuffer.wrap(bytes))
                .toString()
        }.getOrDefault(String(bytes, Charsets.UTF_8))

    /**
     * 粗判二进制。
     *
     * 只需要挡住最常见的两类误导入：ZIP/EPUB（`PK` 魔数）和其它控制字节过多的文件。
     * UTF-16 文本里一半是 `0x00`，所以先按 BOM 放行 —— 与桌面端 `isProbablyBinary` 同序。
     */
    fun looksBinary(bytes: ByteArray): Boolean {
        if (hasUtf16Bom(bytes)) return false
        if (bytes.size > 4 && bytes[0] == 0x50.toByte() && bytes[1] == 0x4B.toByte()) return true
        val sample = minOf(bytes.size, 4096)
        if (sample <= 0) return false
        var control = 0
        for (i in 0 until sample) {
            val byte = bytes[i].toInt() and 0xFF
            if (byte == 9 || byte == 10 || byte == 13) continue
            if (byte < 7) control += 1
        }
        return control.toDouble() / sample > 0.05
    }
}
