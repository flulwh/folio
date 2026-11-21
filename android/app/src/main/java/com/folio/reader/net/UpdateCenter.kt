package com.folio.reader.net

import com.folio.reader.BuildConfig
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** 一条已经发布成功的安卓版本。 */
data class ReleaseInfo(
    val version: String,
    /** Release 页面（浏览器打开）。 */
    val pageUrl: String,
    /** APK 资产直链；没有可下载资产时为空串。 */
    val apkUrl: String,
    val notes: String,
)

/** 检查更新的结论。[ok] 为 false 时只有 [error] 有意义。 */
data class UpdateResult(
    val ok: Boolean = false,
    val hasUpdate: Boolean = false,
    val latestVersion: String = "",
    val releaseUrl: String = "",
    val apkUrl: String = "",
    val notes: String = "",
    val error: String = "",
)

/** 一条公告（来自站点上的静态 `notice.json`）。 */
data class Notice(
    val id: String,
    val title: String,
    val body: String,
    /** `yyyy-MM-dd`；原 JSON 缺这一项时为空串。 */
    val date: String,
    val url: String = "",
)

/** 拉公告的结论；网络异常不抛，降级成 [ok] = false。 */
data class NoticeResult(
    val ok: Boolean = false,
    val notices: List<Notice> = emptyList(),
    val error: String = "",
)

/**
 * 检查更新与公告拉取。
 *
 * 与 [FolioClient] 一样只用系统自带的 [HttpURLConnection]，方法都是阻塞的，
 * 调用方负责放到 `Dispatchers.IO`；**任何网络异常都不往外抛**，
 * 统一降级成空列表 / 失败结果，UI 只显示一句短原因。
 */
object UpdateCenter {

    const val RELEASES_URL = "https://api.github.com/repos/flulwh/folio/releases?per_page=30"
    const val NOTICE_URL = "https://flulwh.github.io/folio/notice.json"

    /** GitHub API 要求带 User-Agent，缺了直接 403。 */
    private val USER_AGENT = "Folio-Android/${BuildConfig.VERSION_NAME}"

    /** 公告最多展示 10 条。 */
    const val MAX_NOTICES = 10

    /* ---------------- 对外入口 ---------------- */

    /** 拉 Releases，挑出最新的安卓版本，与 [currentVersion] 比较。 */
    fun check(currentVersion: String): UpdateResult = try {
        val info = pickLatestAndroidRelease(fetch(RELEASES_URL, "application/vnd.github+json"))
        if (info == null) {
            UpdateResult(ok = true)
        } else {
            UpdateResult(
                ok = true,
                hasUpdate = isNewerVersion(info.version, currentVersion),
                latestVersion = info.version,
                releaseUrl = info.pageUrl,
                apkUrl = info.apkUrl,
                notes = info.notes,
            )
        }
    } catch (err: Exception) {
        UpdateResult(ok = false, error = describe(err))
    }

    /** 拉公告；网络失败返回空列表，不是空公告的「成功」。 */
    fun fetchNotices(today: LocalDate = LocalDate.now()): NoticeResult = try {
        NoticeResult(ok = true, notices = parseNotices(fetch(NOTICE_URL, "application/json"), today))
    } catch (err: Exception) {
        NoticeResult(ok = false, error = describe(err))
    }

    /* ---------------- 版本 ---------------- */

    /** 去掉 `android-` 前缀、`v` 前缀与 `-debug` 之类的后缀。 */
    internal fun normalizeVersion(raw: String): String {
        var value = raw.trim()
        if (value.startsWith("android-", ignoreCase = true)) {
            value = value.substring("android-".length)
        }
        if (value.startsWith("v", ignoreCase = true)) value = value.drop(1)
        return value.substringBefore('-').substringBefore('+').trim()
    }

    /** 按数字逐段拆开；非法段按 0 处理。 */
    internal fun versionParts(raw: String): List<Int> {
        val core = normalizeVersion(raw)
        if (core.isEmpty()) return emptyList()
        return core.split('.').map { part ->
            part.takeWhile { it.isDigit() }.toIntOrNull() ?: 0
        }
    }

    /** 逐段比较，缺省段按 0；大于返回 1，小于 -1，相等 0。 */
    internal fun compareVersions(left: String, right: String): Int {
        val a = versionParts(left)
        val b = versionParts(right)
        val size = maxOf(a.size, b.size)
        for (i in 0 until size) {
            val x = a.getOrElse(i) { 0 }
            val y = b.getOrElse(i) { 0 }
            if (x != y) return if (x > y) 1 else -1
        }
        return 0
    }

    internal fun isNewerVersion(latest: String, current: String): Boolean =
        compareVersions(latest, current) > 0

    /* ---------------- Releases ---------------- */

    /**
     * 从 Releases JSON 里挑版本最大的安卓发布。
     *
     * 过滤规则：draft / prerelease 都不要，tag 必须以 `android-` 开头；
     * 版本按数字比较而不是字典序（`4.10.0` > `4.9.0`）。
     */
    internal fun pickLatestAndroidRelease(body: String): ReleaseInfo? {
        val array = runCatching { JSONArray(body) }.getOrNull() ?: return null
        var best: ReleaseInfo? = null
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            if (item.optBoolean("draft", false)) continue
            if (item.optBoolean("prerelease", false)) continue
            val tag = item.optString("tag_name").trim()
            if (!tag.startsWith("android-", ignoreCase = true)) continue
            val version = normalizeVersion(tag)
            if (version.isEmpty()) continue
            val info = ReleaseInfo(
                version = version,
                pageUrl = item.optString("html_url").trim(),
                apkUrl = apkUrlOf(item),
                notes = item.optString("body").trim(),
            )
            val known = best
            if (known == null || compareVersions(info.version, known.version) > 0) best = info
        }
        return best
    }

    /** 优先 `Folio-x.y.z-android.apk`，其次任意 `.apk` 资产。 */
    private fun apkUrlOf(item: JSONObject): String {
        val assets = item.optJSONArray("assets") ?: return ""
        var fallback = ""
        for (i in 0 until assets.length()) {
            val asset = assets.optJSONObject(i) ?: continue
            val url = asset.optString("browser_download_url").trim()
            if (url.isEmpty()) continue
            val name = asset.optString("name").trim().ifEmpty { url.substringAfterLast('/') }
            if (!name.endsWith(".apk", ignoreCase = true)) continue
            if (name.endsWith("-android.apk", ignoreCase = true)) return url
            if (fallback.isEmpty()) fallback = url
        }
        return fallback
    }

    /* ---------------- 公告 ---------------- */

    /**
     * 解析 `notices` 数组。
     *
     * 丢弃：缺 id 或标题、`active` 明确为 false、`expiresAt` 早于 [today]。
     * 其余按日期倒序，最多 [MAX_NOTICES] 条。
     */
    internal fun parseNotices(body: String, today: LocalDate = LocalDate.now()): List<Notice> {
        val root = runCatching { JSONObject(body) }.getOrNull() ?: return emptyList()
        val array = root.optJSONArray("notices") ?: return emptyList()
        val out = ArrayList<Notice>(array.length())
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            val id = item.optString("id").trim()
            val title = item.optString("title").trim()
            if (id.isEmpty() || title.isEmpty()) continue
            if (!item.optBoolean("active", true)) continue
            if (isExpired(item.optString("expiresAt"), today)) continue
            out.add(
                Notice(
                    id = id,
                    title = title,
                    body = item.optString("body").trim(),
                    date = item.optString("date").trim().take(10),
                    url = item.optString("url").trim().takeIf { it.startsWith("http") }.orEmpty(),
                ),
            )
        }
        return out.sortedByDescending { it.date }.take(MAX_NOTICES)
    }

    /** `expiresAt` 支持 `yyyy-MM-dd` / ISO 时间戳 / 秒或毫秒时间戳；解析不了就当不过期。 */
    internal fun isExpired(expiresAt: String, today: LocalDate): Boolean {
        val raw = expiresAt.trim()
        if (raw.isEmpty()) return false
        val day = dayOf(raw) ?: return false
        return day.isBefore(today)
    }

    private fun dayOf(raw: String): LocalDate? {
        val millis = raw.toLongOrNull()
        if (millis != null && millis > 0L) {
            val ms = if (millis < 100_000_000_000L) millis * 1000L else millis
            return runCatching {
                Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).toLocalDate()
            }.getOrNull()
        }
        return runCatching { LocalDate.parse(raw.take(10)) }.getOrNull()
    }

    /* ---------------- 网络 ---------------- */

    /** 读一个 JSON 文本；非 2xx 抛 [IOException]，由上面两个入口降级。 */
    private fun fetch(url: String, accept: String): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        conn.connectTimeout = 6000
        conn.readTimeout = 8000
        conn.useCaches = false
        conn.instanceFollowRedirects = true
        conn.setRequestProperty("Accept", accept)
        conn.setRequestProperty("User-Agent", USER_AGENT)
        try {
            val code = conn.responseCode
            if (code !in 200..299) throw IOException("HTTP $code")
            return conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    /** 只给 UI 一行短原因，不搬栈。 */
    private fun describe(err: Exception): String {
        val raw = err.message.orEmpty()
        return when {
            raw.contains("timeout", ignoreCase = true) -> "网络超时"
            raw.startsWith("HTTP") -> "服务器没有正常响应"
            else -> "网络不通"
        }
    }
}
