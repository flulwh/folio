package com.folio.reader.data

import com.folio.reader.core.HashUtils
import com.folio.reader.net.FolioClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** 目录结果：[source] = `network` / `cache` / `bundled`。 */
data class CatalogResult(
    val fonts: List<CatalogFont>,
    val source: String,
    val fetchedAt: Long,
    val error: String = "",
)

/** 安装失败：消息直接给人看。 */
class FontInstallException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * 字体商店的数据层。
 *
 * 下载顺序与桌面端一致：先直连目录里的 Release 直链（GitHub），
 * 失败且配置过桌面端地址时，回退到桌面端局域网 `/api/font/:id/download`。
 * 两条路都写同一个 `.part`，所以换路时能接着续传。
 *
 * 只有「大小 + sha256 + magic」都过了才会交给 [FontStore.commit]，
 * 校验失败立即删掉 `.part`，绝不把坏文件写进已安装清单。
 */
class FontRepository(
    private val store: FontStore,
    private val desktop: () -> FolioClient?,
    /**
     * 安装包里随附的目录快照。
     *
     * 首次打开商店时既没有缓存、又连不上 GitHub（国内很常见），
     * 没有这份兜底就只能看到一句「字体目录获取失败」。
     */
    private val bundled: () -> String? = { null },
) {

    suspend fun catalog(force: Boolean = false): CatalogResult = withContext(Dispatchers.IO) {
        val cached = store.readCatalogCache()
        val fresh = cached != null && System.currentTimeMillis() - cached.fetchedAt < TTL_MS
        if (cached != null && fresh && !force) {
            return@withContext CatalogResult(cached.fonts, "cache", cached.fetchedAt)
        }

        try {
            val text = readText(CATALOG_URL, timeoutMs = 15000)
            val fonts = FontCatalog.parse(text)
            if (fonts.isEmpty()) throw IOException("目录里没有可用字体")
            val now = System.currentTimeMillis()
            store.writeCatalogCache(text, now)
            CatalogResult(fonts, "network", now)
        } catch (err: Exception) {
            if (cached != null) {
                CatalogResult(
                    fonts = cached.fonts,
                    source = "cache",
                    fetchedAt = cached.fetchedAt,
                    error = err.message.orEmpty(),
                )
            } else {
                bundledCatalog() ?: throw FontInstallException(
                    "字体目录获取失败：${err.message.orEmpty().ifBlank { "网络不通" }}",
                    err,
                )
            }
        }
    }

    /** 网络与缓存都拿不到时用安装包里的快照，并把它写成缓存。 */
    private fun bundledCatalog(): CatalogResult? {
        val text = runCatching { bundled() }.getOrNull()?.takeIf { it.isNotBlank() } ?: return null
        val fonts = runCatching { FontCatalog.parse(text) }.getOrDefault(emptyList())
        if (fonts.isEmpty()) return null
        val now = System.currentTimeMillis()
        runCatching { store.writeCatalogCache(text, now) }
        return CatalogResult(fonts, "bundled", now)
    }

    /**
     * 下载并安装一款字体。
     *
     * @param onProgress (已收字节, 总字节)；总字节来自目录里的 size，不会是 -1
     */
    suspend fun install(
        font: CatalogFont,
        onProgress: (Long, Long) -> Unit = { _, _ -> },
    ): InstalledFont = withContext(Dispatchers.IO) {
        store.find(font.id)?.let { return@withContext it }

        val part = store.partFile(font.id, font.file.format)
        var directError: Exception? = null
        try {
            downloadDirect(font, part, onProgress)
        } catch (err: Exception) {
            directError = err
        }

        if (directError != null) {
            val client = runCatching { desktop() }.getOrNull()
                ?: throw FontInstallException(
                    "下载失败：${directError.message.orEmpty().ifBlank { "网络不通" }}",
                    directError,
                )
            try {
                client.downloadFont(
                    id = font.id,
                    dest = part,
                    offset = if (part.isFile) part.length() else 0L,
                    expectedSha256 = font.file.sha256,
                    onProgress = onProgress,
                )
            } catch (err: Exception) {
                throw FontInstallException(
                    "下载失败：${err.message.orEmpty().ifBlank { "桌面端也没有这款字体" }}",
                    err,
                )
            }
        }

        val size = if (part.isFile) part.length() else 0L
        if (size != font.file.size) {
            part.delete()
            throw FontInstallException("字体大小不符（$size / ${font.file.size}），请重试")
        }
        val hash = sha256Of(part)
        if (!hash.equals(font.file.sha256, ignoreCase = true)) {
            part.delete()
            throw FontInstallException("字体校验失败，请重试")
        }
        store.commit(part, font)
            ?: throw FontInstallException("字体写入失败，检查手机存储空间")
    }

    /* ---------------- 直连 GitHub ---------------- */

    private fun downloadDirect(
        font: CatalogFont,
        part: File,
        onProgress: (Long, Long) -> Unit,
    ) {
        part.parentFile?.mkdirs()
        val total = font.file.size
        val start = if (part.isFile) part.length().coerceAtMost(total) else 0L

        val conn = URL(font.file.url).openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = true
        conn.connectTimeout = 10_000
        conn.readTimeout = 45_000
        conn.useCaches = false
        conn.setRequestProperty("Accept", "*/*")
        conn.setRequestProperty("Accept-Encoding", "identity")
        if (start > 0L) conn.setRequestProperty("Range", "bytes=$start-")

        try {
            val code = conn.responseCode
            if (code !in 200..299) throw IOException("HTTP $code")
            // 服务端不认 Range 时会把整份发回来，这时必须清空重写
            val append = start > 0L && code == 206
            var written = if (append) start else 0L
            var lastEmit = 0L
            FileOutputStream(part, append).use { output ->
                conn.inputStream.use { input ->
                    val buffer = ByteArray(HashUtils.BUFFER_BYTES)
                    while (true) {
                        val count = input.read(buffer)
                        if (count <= 0) break
                        output.write(buffer, 0, count)
                        written += count
                        if (written > FontCatalog.MAX_BYTES) throw IOException("字体文件超出上限")
                        val now = System.currentTimeMillis()
                        if (now - lastEmit > 200) {
                            lastEmit = now
                            onProgress(written, total)
                        }
                    }
                }
            }
            onProgress(total, total)
        } finally {
            conn.disconnect()
        }
    }

    private fun readText(url: String, timeoutMs: Int): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = true
        conn.connectTimeout = 10_000
        conn.readTimeout = timeoutMs
        conn.useCaches = false
        conn.setRequestProperty("Accept", "application/json")
        try {
            val code = conn.responseCode
            if (code !in 200..299) throw IOException("HTTP $code")
            return conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private fun sha256Of(file: File): String {
        val digest = HashUtils.newSha256Digest()
        file.inputStream().use { input ->
            val buffer = ByteArray(HashUtils.BUFFER_BYTES)
            while (true) {
                val count = input.read(buffer)
                if (count <= 0) break
                digest.update(buffer, 0, count)
            }
        }
        return HashUtils.toHex(digest)
    }

    companion object {
        /** 与桌面端 `electron/font-store.js` 同一个文件。 */
        const val CATALOG_URL = "https://raw.githubusercontent.com/flulwh/folio-fonts/main/catalog.json"

        /** 目录缓存 7 天：字体列表变化很慢，没必要每次开商店都发请求。 */
        const val TTL_MS = 7L * 24 * 3600 * 1000
    }
}
