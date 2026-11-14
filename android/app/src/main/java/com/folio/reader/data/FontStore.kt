package com.folio.reader.data

import com.folio.reader.core.JsonIo
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** 已经装在手机上的字体。字段与桌面端 fonts.json 的商店记录对齐。 */
data class InstalledFont(
    val id: String,
    val name: String,
    val family: String,
    val file: String,
    val size: Long,
    val version: Int,
    val sha256: String,
    val installedAt: Long,
)

/** 目录缓存：字体列表 + 拉取时间（毫秒）。 */
data class CatalogCache(
    val fonts: List<CatalogFont>,
    val fetchedAt: Long,
)

/**
 * 字体落盘。
 *
 * 布局（与桌面端 fonts/ 目录同构，方便以后做双向拷贝）：
 * ```
 * filesDir/fonts/<id>.ttf        字体本体
 * filesDir/fonts/installed.json  已安装清单
 * filesDir/library/font-catalog.json  目录缓存（离线也能打开商店）
 * ```
 *
 * 下载先写 `<id>.<ext>.part`，校验通过才原子改名；失败保留 `.part` 供续传。
 * 所有方法都是同步 IO，调用方负责放到 `Dispatchers.IO`。
 */
class FontStore(root: File) {

    private val fontsDir = File(root, "fonts")
    private val installedFile = File(fontsDir, "installed.json")
    private val catalogFile = File(root, "library/font-catalog.json")

    private val idPattern = Regex("^[a-z0-9._-]{1,64}$")

    fun dir(): File = fontsDir

    /** 已安装列表。文件丢了的记录顺手跳过，避免选中一款空字体。 */
    fun installed(): List<InstalledFont> {
        val array = JsonIo.readArray(installedFile) ?: return emptyList()
        val out = ArrayList<InstalledFont>(array.length())
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            val font = fromJson(item) ?: continue
            val file = File(fontsDir, font.file)
            if (inside(file) && file.isFile && file.length() > 0L) out.add(font)
        }
        return out
    }

    fun find(id: String): InstalledFont? {
        if (id.isBlank()) return null
        return installed().firstOrNull { it.id == id }
    }

    /** 字体的实际路径；记录不存在或文件被删都返回 null。 */
    fun fileOf(id: String): File? {
        if (!idPattern.matches(id)) return null
        val array = JsonIo.readArray(installedFile) ?: return null
        for (i in 0 until array.length()) {
            val font = fromJson(array.optJSONObject(i) ?: continue) ?: continue
            if (font.id != id) continue
            val file = File(fontsDir, font.file)
            // 记录里的 file 只可能是文件名，仍然复核一次越界
            if (!inside(file) || !file.isFile || file.length() <= 0L) return null
            return file
        }
        return null
    }

    fun partFile(id: String, format: String): File = File(fontsDir, "$id.${safeFormat(format)}.part")

    fun finalFile(id: String, format: String): File = File(fontsDir, "$id.${safeFormat(format)}")

    /**
     * 把下载完成的 `.part` 转正并写清单。
     *
     * @return 成功返回记录；文件大小不符、magic 不像字体、改名失败都返回 null。
     */
    fun commit(part: File, font: CatalogFont): InstalledFont? {
        if (!idPattern.matches(font.id)) return null
        if (!part.isFile || part.length() != font.file.size) return null
        if (!FontMagic.looksLikeFont(readHeader(part))) return null

        val dest = finalFile(font.id, font.file.format)
        if (!inside(dest)) return null
        if (dest.exists() && !dest.delete()) return null
        if (!part.renameTo(dest)) {
            val copied = runCatching { part.copyTo(dest, overwrite = true) }.isSuccess
            if (!copied) return null
            part.delete()
        }

        val record = InstalledFont(
            id = font.id,
            name = font.name,
            family = font.family,
            file = dest.name,
            size = dest.length(),
            version = font.version,
            sha256 = font.file.sha256,
            installedAt = System.currentTimeMillis(),
        )
        val list = installed().filter { it.id != font.id } + record
        writeInstalled(list)
        return record
    }

    /** 删除一款字体（文件 + 记录）。不存在也算成功。 */
    fun remove(id: String): Boolean {
        if (!idPattern.matches(id)) return false
        val array = JsonIo.readArray(installedFile)
        val target = array?.let { list ->
            (0 until list.length())
                .mapNotNull { fromJson(list.optJSONObject(it) ?: return@mapNotNull null) }
                .firstOrNull { it.id == id }
        }
        if (target != null) {
            val file = File(fontsDir, target.file)
            if (inside(file)) file.delete()
        }
        val remaining = installed().filter { it.id != id }
        return writeInstalled(remaining)
    }

    /* ---------------- 目录缓存 ---------------- */

    fun readCatalogCache(): CatalogCache? {
        val root = JsonIo.readObject(catalogFile) ?: return null
        val catalog = root.optJSONObject("catalog") ?: return null
        val fonts = FontCatalog.parse(catalog)
        if (fonts.isEmpty()) return null
        return CatalogCache(fonts = fonts, fetchedAt = root.optLong("fetchedAt", 0L))
    }

    fun writeCatalogCache(text: String, fetchedAt: Long): Boolean {
        val catalog = runCatching { JSONObject(text) }.getOrNull() ?: return false
        val root = JSONObject()
            .put("fetchedAt", fetchedAt)
            .put("catalog", catalog)
        return JsonIo.write(catalogFile, root)
    }

    /* ---------------- 内部 ---------------- */

    private fun writeInstalled(list: List<InstalledFont>): Boolean {
        val array = JSONArray()
        list.forEach { array.put(it.toJson()) }
        return JsonIo.write(installedFile, array)
    }

    private fun fromJson(item: JSONObject?): InstalledFont? {
        if (item == null) return null
        val id = item.optString("id").trim()
        if (!idPattern.matches(id)) return null
        val file = item.optString("file").trim()
        if (file.isEmpty() || file.contains('/') || file.contains('\\')) return null
        return InstalledFont(
            id = id,
            name = item.optString("name").ifBlank { id },
            family = item.optString("family").ifBlank { id },
            file = file,
            size = item.optLong("size", 0L),
            version = item.optInt("version", 1),
            sha256 = item.optString("sha256"),
            installedAt = item.optLong("installedAt", 0L),
        )
    }

    private fun InstalledFont.toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("name", name)
        .put("family", family)
        .put("file", file)
        .put("size", size)
        .put("version", version)
        .put("sha256", sha256)
        .put("installedAt", installedAt)

    private fun safeFormat(format: String): String =
        if (format.lowercase() == "otf") "otf" else "ttf"

    private fun readHeader(file: File): ByteArray {
        val header = ByteArray(4)
        runCatching {
            file.inputStream().use { input ->
                var read = 0
                while (read < header.size) {
                    val count = input.read(header, read, header.size - read)
                    if (count <= 0) break
                    read += count
                }
            }
        }
        return header
    }

    private fun inside(file: File): Boolean = runCatching {
        file.canonicalPath.startsWith(fontsDir.canonicalPath + File.separator)
    }.getOrDefault(false)
}
