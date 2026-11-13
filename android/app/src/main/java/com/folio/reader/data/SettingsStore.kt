package com.folio.reader.data

import android.content.Context
import android.content.SharedPreferences

/** App 设置。放在 SharedPreferences 里，读一次就够，不进内存热路径。 */
class SettingsStore(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("folio_settings", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString(KEY_SERVER, "") ?: ""
        set(value) = prefs.edit().putString(KEY_SERVER, value.trim()).apply()

    var token: String
        get() = prefs.getString(KEY_TOKEN, "") ?: ""
        set(value) = prefs.edit().putString(KEY_TOKEN, value.trim()).apply()

    /** 字号（sp），阅读页与桌面端一样按倍数缩放。 */
    var fontScale: Float
        get() = prefs.getFloat(KEY_FONT_SCALE, 1f)
        set(value) = prefs.edit().putFloat(KEY_FONT_SCALE, value.coerceIn(0.8f, 2f)).apply()

    /** 行距倍数。 */
    var lineHeight: Float
        get() = prefs.getFloat(KEY_LINE_HEIGHT, 1.8f)
        set(value) = prefs.edit().putFloat(KEY_LINE_HEIGHT, value.coerceIn(1.2f, 2.6f)).apply()

    /** 页边距（dp）。 */
    var pagePadding: Int
        get() = prefs.getInt(KEY_PAGE_PADDING, 24)
        set(value) = prefs.edit().putInt(KEY_PAGE_PADDING, value.coerceIn(12, 64)).apply()

    /** 主题色（ARGB）。 */
    var accent: Int
        get() = prefs.getInt(KEY_ACCENT, 0xFF1F6FEB.toInt())
        set(value) = prefs.edit().putInt(KEY_ACCENT, value).apply()

    /** 背景色（ARGB）。 */
    var paper: Int
        get() = prefs.getInt(KEY_PAPER, 0xFFFBF8F1.toInt())
        set(value) = prefs.edit().putInt(KEY_PAPER, value).apply()

    /** 文字色（ARGB）。 */
    var ink: Int
        get() = prefs.getInt(KEY_INK, 0xFF23201C.toInt())
        set(value) = prefs.edit().putInt(KEY_INK, value).apply()

    /** 是否允许后台自动同步。默认开。 */
    var autoSync: Boolean
        get() = prefs.getBoolean(KEY_AUTO_SYNC, true)
        set(value) = prefs.edit().putBoolean(KEY_AUTO_SYNC, value).apply()

    /** 是否自动把本地书正文缓存到手机（离线可读）。默认关，按需下载更省流量。 */
    var autoCache: Boolean
        get() = prefs.getBoolean(KEY_AUTO_CACHE, false)
        set(value) = prefs.edit().putBoolean(KEY_AUTO_CACHE, value).apply()

    /** 上次同步时间。 */
    var lastSyncAt: Long
        get() = prefs.getLong(KEY_LAST_SYNC, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_SYNC, value).apply()

    val hasServer: Boolean get() = serverUrl.isNotBlank() && token.isNotBlank()

    companion object {
        private const val KEY_SERVER = "server_url"
        private const val KEY_TOKEN = "token"
        private const val KEY_FONT_SCALE = "font_scale"
        private const val KEY_LINE_HEIGHT = "line_height"
        private const val KEY_PAGE_PADDING = "page_padding"
        private const val KEY_ACCENT = "accent"
        private const val KEY_PAPER = "paper"
        private const val KEY_INK = "ink"
        private const val KEY_AUTO_SYNC = "auto_sync"
        private const val KEY_AUTO_CACHE = "auto_cache"
        private const val KEY_LAST_SYNC = "last_sync_at"
    }
}
