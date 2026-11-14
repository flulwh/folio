package com.folio.reader.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import com.folio.reader.data.FontStore
import java.io.File

/**
 * 商店字体的 Compose FontFamily 缓存。
 *
 * 每次组合都 `Font(File)` 会反复解析 20MB 的字体文件，翻页时足够卡出一帧；
 * 这里按「路径 + 大小 + mtime」缓存最近几款，删掉重装会自然换 key。
 *
 * 只允许 4 个：正文 + 预览最多同时用到两三款，缓存无上限等于把内存留给字体。
 */
object FontFamilies {

    private const val MAX_CACHE = 4

    private val cache = object : LinkedHashMap<String, FontFamily>(8, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, FontFamily>?): Boolean =
            size > MAX_CACHE
    }

    /** 文件存在就返回 FontFamily；不存在或解析失败返回 null，由调用方回落系统字体。 */
    fun familyOf(file: File?): FontFamily? {
        if (file == null || !file.isFile) return null
        val key = "${file.absolutePath}#${file.length()}#${file.lastModified()}"
        synchronized(cache) { cache[key]?.let { return it } }
        val family = runCatching { FontFamily(Font(file)) }.getOrNull() ?: return null
        synchronized(cache) { cache[key] = family }
        return family
    }

    /**
     * 阅读页 / 预览用的字体族。
     *
     * [userFontId] 为空、字体被删、文件损坏，一律回落到 [fallback]
     * （用户在系统字体里选的宋体或黑体），不会变成「什么都没选」。
     */
    @Composable
    fun rememberReaderFamily(userFontId: String, fallback: FontFamily): FontFamily {
        val context = LocalContext.current
        return remember(userFontId, fallback) {
            if (userFontId.isBlank()) {
                fallback
            } else {
                familyOf(FontStore(context.filesDir).fileOf(userFontId)) ?: fallback
            }
        }
    }
}
