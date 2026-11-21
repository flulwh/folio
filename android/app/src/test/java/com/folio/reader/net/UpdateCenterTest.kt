package com.folio.reader.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

/** 版本比较与公告过滤：纯函数，不碰网络。 */
class UpdateCenterTest {

    /* ---------------- 版本 ---------------- */

    @Test
    fun 忽略前缀与调试后缀() {
        assertEquals("4.6.0", UpdateCenter.normalizeVersion("android-4.6.0"))
        assertEquals("4.6.0", UpdateCenter.normalizeVersion("4.6.0-debug"))
        assertEquals("4.6.0", UpdateCenter.normalizeVersion("android-v4.6.0"))
        assertEquals(0, UpdateCenter.compareVersions("android-4.6.0", "4.6.0-debug"))
    }

    @Test
    fun 逐段比较数字而不是字典序() {
        assertTrue(UpdateCenter.isNewerVersion("android-4.10.0", "4.9.0-debug"))
        assertFalse(UpdateCenter.isNewerVersion("android-4.5.9", "4.5.10"))
        assertEquals(0, UpdateCenter.compareVersions("4.6", "4.6.0"))
        assertEquals(1, UpdateCenter.compareVersions("4.6.1", "4.6"))
        assertEquals(-1, UpdateCenter.compareVersions("4.5", "4.6"))
    }

    /* ---------------- Releases ---------------- */

    private fun release(
        tag: String,
        draft: Boolean = false,
        prerelease: Boolean = false,
        apk: String? = "Folio-${tag.removePrefix("android-")}-android.apk",
    ): String {
        val assets = JSONArray()
        if (apk != null) {
            assets.put(
                JSONObject()
                    .put("name", apk)
                    .put("browser_download_url", "https://github.com/flulwh/folio/releases/download/$tag/$apk"),
            )
        }
        return JSONObject()
            .put("tag_name", tag)
            .put("draft", draft)
            .put("prerelease", prerelease)
            .put("html_url", "https://github.com/flulwh/folio/releases/tag/$tag")
            .put("body", "更新说明 $tag")
            .put("assets", assets)
            .toString()
    }

    @Test
    fun 只挑版本最大的安卓正式发布() {
        val body = "[${listOf(
            release("android-4.5.0"),
            release("android-4.9.0", draft = true),
            release("android-5.0.0", prerelease = true),
            release("v2.0.0"),
            release("android-4.10.0"),
        ).joinToString(",")}]"
        val info = UpdateCenter.pickLatestAndroidRelease(body)
        assertNotNull(info)
        assertEquals("4.10.0", info!!.version)
        assertEquals(
            "https://github.com/flulwh/folio/releases/download/android-4.10.0/Folio-4.10.0-android.apk",
            info.apkUrl,
        )
        assertTrue(info.notes.contains("android-4.10.0"))
    }

    @Test
    fun 没有安卓发布时返回空() {
        assertNull(UpdateCenter.pickLatestAndroidRelease("[${release("v2.0.0")}]"))
        assertNull(UpdateCenter.pickLatestAndroidRelease("not json"))
    }

    /* ---------------- 公告 ---------------- */

    private fun notice(
        id: String?,
        title: String? = "标题",
        active: Boolean = true,
        expiresAt: String = "",
        date: String = "2026-11-01",
    ): JSONObject = JSONObject().apply {
        id?.let { put("id", it) }
        title?.let { put("title", it) }
        put("body", "正文 $id")
        put("date", date)
        put("active", active)
        if (expiresAt.isNotBlank()) put("expiresAt", expiresAt)
    }

    private fun notices(vararg items: JSONObject) =
        JSONObject().put("notices", JSONArray(items.toList())).toString()

    @Test
    fun 公告过滤缺字段停用与过期() {
        val today = LocalDate.of(2026, 11, 21)
        val body = notices(
            notice("a", date = "2026-11-20"),
            notice(null, date = "2026-11-19"),
            notice("b", title = null, date = "2026-11-18"),
            notice("c", active = false, date = "2026-11-17"),
            notice("d", expiresAt = "2026-11-20", date = "2026-11-16"),
            notice("e", expiresAt = "2026-12-31", date = "2026-11-15"),
        )
        val list = UpdateCenter.parseNotices(body, today)
        assertEquals(listOf("a", "e"), list.map { it.id })
    }

    @Test
    fun 公告按日期倒序且最多十条() {
        val today = LocalDate.of(2026, 11, 21)
        val items = (1..12).map { index ->
            notice(
                id = "n$index",
                date = "2026-11-%02d".format(index),
            )
        }
        val list = UpdateCenter.parseNotices(notices(*items.toTypedArray()), today)
        assertEquals(UpdateCenter.MAX_NOTICES, list.size)
        assertEquals("n12", list.first().id)
        assertEquals("n3", list.last().id)
    }

    @Test
    fun 过期时间支持日期与时间戳() {
        val today = LocalDate.of(2026, 11, 21)
        assertTrue(UpdateCenter.isExpired("2026-11-20", today))
        assertFalse(UpdateCenter.isExpired("2026-11-21", today))
        assertFalse(UpdateCenter.isExpired("", today))
        assertFalse(UpdateCenter.isExpired("2026-12-31T10:00:00Z", today))
        // 毫秒时间戳（2026-11-01T00:00:00Z 之类）落在过去
        assertTrue(UpdateCenter.isExpired("1793491200000", today))
    }
}
