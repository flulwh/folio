package com.folio.reader.data

import org.json.JSONObject

/** 字体许可：只用来展示与跳转，不做校验。 */
data class FontLicense(
    val spdx: String = "",
    val name: String = "",
    val url: String = "",
)

/** 字体文件：url 是 Release 直链，size / sha256 用于下载与校验。 */
data class FontAsset(
    val format: String,
    val url: String,
    val size: Long,
    val sha256: String,
)

/** 目录里的一款字体。字段与桌面端 `electron/font-store.js` 的 normalizeFont 对齐。 */
data class CatalogFont(
    val id: String,
    val version: Int,
    val name: String,
    val family: String,
    val category: String,
    val description: String,
    val preview: String,
    val homepage: String,
    val license: FontLicense,
    val file: FontAsset,
)

/**
 * 字体目录解析。
 *
 * 目录来自公开仓库的 catalog.json，属于「不可信输入」：id 会拼进文件名、
 * url 会被直接请求、size 决定磁盘预检。所以这里逐字段收紧，坏条目整条丢掉，
 * 不让一条脏数据把整个商店带崩。
 */
object FontCatalog {

    /** 单款字体上限，与桌面端一致（最大的思源宋体约 24MB）。 */
    const val MAX_BYTES: Long = 48L * 1024 * 1024

    private val ID_PATTERN = Regex("^[a-z0-9._-]{1,64}$")
    private val SHA256_PATTERN = Regex("^[a-f0-9]{64}$")

    /** 解析整份目录；不是 `{fonts: [...]}` 形状就返回空列表。 */
    fun parse(text: String): List<CatalogFont> {
        val root = runCatching { JSONObject(text) }.getOrNull() ?: return emptyList()
        return parse(root)
    }

    fun parse(root: JSONObject): List<CatalogFont> {
        val array = root.optJSONArray("fonts") ?: return emptyList()
        val out = ArrayList<CatalogFont>(array.length())
        for (i in 0 until array.length()) {
            parseFont(array.optJSONObject(i))?.let(out::add)
        }
        return out
    }

    /** 解析单条；任何关键字段不合法都返回 null。 */
    fun parseFont(item: JSONObject?): CatalogFont? {
        if (item == null) return null
        val id = item.optString("id").trim()
        if (!ID_PATTERN.matches(id)) return null

        val fileJson = item.optJSONObject("file") ?: return null
        val url = fileJson.optString("url").trim()
        if (!url.startsWith("https://") && !url.startsWith("http://")) return null

        val format = fileJson.optString("format", "ttf").trim().lowercase()
        if (format != "ttf" && format != "otf") return null

        val size = fileJson.optLong("size", 0L)
        if (size <= 0L || size > MAX_BYTES) return null

        val sha256 = fileJson.optString("sha256").trim().lowercase()
        if (!SHA256_PATTERN.matches(sha256)) return null

        val licenseJson = item.optJSONObject("license")
        return CatalogFont(
            id = id,
            version = item.optInt("version", 1),
            name = item.optString("name").ifBlank { id },
            family = item.optString("family").ifBlank { item.optString("name").ifBlank { id } },
            category = item.optString("category"),
            description = item.optString("description"),
            preview = item.optString("preview"),
            homepage = item.optString("homepage").takeIf { it.startsWith("https://") }.orEmpty(),
            license = FontLicense(
                spdx = licenseJson?.optString("spdx").orEmpty(),
                name = licenseJson?.optString("name").orEmpty(),
                url = licenseJson?.optString("url")?.takeIf { it.startsWith("https://") }.orEmpty(),
            ),
            file = FontAsset(format = format, url = url, size = size, sha256 = sha256),
        )
    }
}

/** 一眼判断「这个文件是不是字体」：ttf / otf / ttc 的 magic。 */
object FontMagic {
    fun looksLikeFont(header: ByteArray): Boolean {
        if (header.size < 4) return false
        val tag = String(header, 0, 4, Charsets.ISO_8859_1)
        if (tag == "OTTO" || tag == "true" || tag == "ttcf") return true
        // 0x00010000：普通 TrueType
        return header[0].toInt() == 0x00 &&
            header[1].toInt() == 0x01 &&
            header[2].toInt() == 0x00 &&
            header[3].toInt() == 0x00
    }
}
