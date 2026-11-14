package com.folio.reader.data

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import java.util.UUID

/**
 * App 设置。放在 SharedPreferences 里，读一次就够，不进内存热路径。
 *
 * 3.0 的字段变化（架构文档 §1.5）：
 *  - **删** `autoCache`：3.0 不做任何磁盘缓存，云端章节只在内存里留 3 章，
 *    没有任何「要不要缓存」的选择可做；
 *  - **加** [autoTransferUnder20MB]：小于 20MB 的书连上就自动搬，大于它的等用户点；
 *  - **加** [wifiOnly]：只在这条 Wi-Fi 是计费网络时才需要用户关掉；
 *  - **加** [hideRemoteWhenOffline]：连不上桌面端时把「只能在线读」的书灰掉/隐藏，
 *    免得用户点进去只看到一句报错；
 *  - **加** [connectionState] 与 [lastHealthAt]：重启后能立刻显示上次的连接状态，
 *    不用白等一次健康检查，也便于「回前台只查一次」。
 */
class SettingsStore(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("folio_settings", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString(KEY_SERVER, "") ?: ""
        set(value) = prefs.edit().putString(KEY_SERVER, value.trim()).apply()

    var token: String
        get() = prefs.getString(KEY_TOKEN, "") ?: ""
        set(value) = prefs.edit().putString(KEY_TOKEN, value.trim()).apply()

    /**
     * 小说正文字号（sp）。12–32，步进 1。
     *
     * 3.0 直接用绝对值而不是「倍数」：用户说「字太小」时，28sp 比 160% 更有意义，
     * 也不受系统字体缩放影响，两端观感一致。
     */
    var fontSizeSp: Float
        get() = prefs.getFloat(KEY_FONT_SIZE, 17f)
        set(value) = prefs.edit().putFloat(KEY_FONT_SIZE, value.coerceIn(12f, 32f)).apply()

    /** 行距倍数：1.3–2.4 连续可调。 */
    var lineHeight: Float
        get() = prefs.getFloat(KEY_LINE_HEIGHT, 1.8f)
        set(value) = prefs.edit().putFloat(KEY_LINE_HEIGHT, value.coerceIn(1.3f, 2.4f)).apply()

    /** 字距（em）：0–0.12，中文衬线体给一点点更耐读。 */
    var letterSpacingEm: Float
        get() = prefs.getFloat(KEY_LETTER_SPACING, 0.01f)
        set(value) = prefs.edit().putFloat(KEY_LETTER_SPACING, value.coerceIn(0f, 0.12f)).apply()

    /** 段距（相对字号倍数）：0–2，控制段与段之间的呼吸。 */
    var paragraphSpacing: Float
        get() = prefs.getFloat(KEY_PARAGRAPH_SPACING, 0.6f)
        set(value) = prefs.edit().putFloat(KEY_PARAGRAPH_SPACING, value.coerceIn(0f, 2f)).apply()

    /** 首行缩进两个字符。中文小说默认开，英文书用户可关。 */
    var firstLineIndent: Boolean
        get() = prefs.getBoolean(KEY_FIRST_LINE_INDENT, true)
        set(value) = prefs.edit().putBoolean(KEY_FIRST_LINE_INDENT, value).apply()

    /** 正文字体：`serif`（系统宋体）/ `sans`（系统无衬线）。 */
    var fontFamily: String
        get() = prefs.getString(KEY_FONT_FAMILY, FONT_SERIF) ?: FONT_SERIF
        set(value) = prefs.edit().putString(KEY_FONT_FAMILY, value).apply()

    /** 底色预设：`white` 冷白 / `paper` 纸白 / `cream` 米色 / `graphite` 石墨 / `night` 夜间。 */
    var themePreset: String
        get() = prefs.getString(KEY_THEME_PRESET, THEME_WHITE) ?: THEME_WHITE
        set(value) = prefs.edit().putString(KEY_THEME_PRESET, value).apply()

    /** 自动滚动速度档位（0 慢 – 3 快），对应 UI 上的档位表。 */
    var autoScrollSpeed: Int
        get() = prefs.getInt(KEY_AUTO_SCROLL_SPEED, 1)
        set(value) = prefs.edit().putInt(KEY_AUTO_SCROLL_SPEED, value.coerceIn(0, 3)).apply()

    /** 阅读时保持屏幕常亮。默认开——读到一半熄屏是最扫兴的打断。 */
    var keepScreenOn: Boolean
        get() = prefs.getBoolean(KEY_KEEP_SCREEN_ON, true)
        set(value) = prefs.edit().putBoolean(KEY_KEEP_SCREEN_ON, value).apply()

    /**
     * 点屏幕左右两侧翻页。默认开。
     *
     * 关掉后点击只切换顶 / 底栏（3.2 之前的行为），给习惯纯滚动的用户留退路。
     */
    var tapToTurn: Boolean
        get() = prefs.getBoolean(KEY_TAP_TURN, true)
        set(value) = prefs.edit().putBoolean(KEY_TAP_TURN, value).apply()

    /**
     * 音量键翻页。默认开。
     *
     * 上键上一页、下键下一页 —— 单手拿手机时大拇指正好落在音量键上，
     * 不需要把手挪到屏幕底部。关掉后音量键恢复调音量。
     */
    var volumeKeysTurn: Boolean
        get() = prefs.getBoolean(KEY_VOLUME_TURN, true)
        set(value) = prefs.edit().putBoolean(KEY_VOLUME_TURN, value).apply()

    /** 漫画默认阅读方向：`vertical` 竖向连续 / `horizontal` 横向逐页。 */
    var comicDirection: String
        get() = prefs.getString(KEY_COMIC_DIRECTION, COMIC_VERTICAL) ?: COMIC_VERTICAL
        set(value) = prefs.edit().putString(KEY_COMIC_DIRECTION, value).apply()

    /** 页边距（dp）：12–48 连续可调。 */
    var pagePadding: Int
        get() = prefs.getInt(KEY_PAGE_PADDING, 24)
        set(value) = prefs.edit().putInt(KEY_PAGE_PADDING, value.coerceIn(12, 48)).apply()

    /** 主题色（ARGB）。 */
    var accent: Int
        get() = prefs.getInt(KEY_ACCENT, 0xFFC4251C.toInt())
        set(value) = prefs.edit().putInt(KEY_ACCENT, value).apply()

    /** 背景色（ARGB）。 */
    var paper: Int
        get() = prefs.getInt(KEY_PAPER, 0xFFF4F4F1.toInt())
        set(value) = prefs.edit().putInt(KEY_PAPER, value).apply()

    /** 文字色（ARGB）。 */
    var ink: Int
        get() = prefs.getInt(KEY_INK, 0xFF111111.toInt())
        set(value) = prefs.edit().putInt(KEY_INK, value).apply()

    /** 是否允许自动同步（连接成功 / 回前台 / 手动点按）。默认开。 */
    var autoSync: Boolean
        get() = prefs.getBoolean(KEY_AUTO_SYNC, true)
        set(value) = prefs.edit().putBoolean(KEY_AUTO_SYNC, value).apply()

    /**
     * 小于 20MB 的书连上就自动搬，不打扰用户。
     *
     * 阈值来自架构文档 §8 的 `AUTO_TRANSFER = 20MiB`：
     * 按「待传输字节数」（UTF-8 副本大小）算，它等于实际流量与落盘占用。
     */
    var autoTransferUnder20MB: Boolean
        get() = prefs.getBoolean(KEY_AUTO_TRANSFER, true)
        set(value) = prefs.edit().putBoolean(KEY_AUTO_TRANSFER, value).apply()

    /** 只在 Wi-Fi 下传输。默认关（局域网本来就只在 Wi-Fi 里），给按流量计费的网络留开关。 */
    var wifiOnly: Boolean
        get() = prefs.getBoolean(KEY_WIFI_ONLY, false)
        set(value) = prefs.edit().putBoolean(KEY_WIFI_ONLY, value).apply()

    /** 连不上桌面端时隐藏「只能在线读」的书。默认开。 */
    var hideRemoteWhenOffline: Boolean
        get() = prefs.getBoolean(KEY_HIDE_REMOTE, true)
        set(value) = prefs.edit().putBoolean(KEY_HIDE_REMOTE, value).apply()

    /** 上次整体同步完成的时间。 */
    var lastSyncAt: Long
        get() = prefs.getLong(KEY_LAST_SYNC, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_SYNC, value).apply()

    /** 上次健康检查成功的时间。 */
    var lastHealthAt: Long
        get() = prefs.getLong(KEY_LAST_HEALTH, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_HEALTH, value).apply()

    /** 上次健康检查的结论（[com.folio.reader.data.ConnectionState.wire]）。 */
    var connectionState: String
        get() = prefs.getString(KEY_CONNECTION_STATE, "") ?: ""
        set(value) = prefs.edit().putString(KEY_CONNECTION_STATE, value).apply()

    /**
     * 设备身份（T07）：桌面端「设备管理」靠它认出这台手机。
     *
     * 第一次读时生成 UUID 并**立刻落盘**，之后永不变更 —— 桌面端用这个 id 记住
     * 「这是哪台设备、它的指令队列在哪」。卸载重装会换新 id，桌面端视为新设备，
     * 这是设计意图：旧 installId 对应的队列已经没人消费了，找回来只会复活一堆幽灵指令。
     */
    val installId: String
        get() {
            val saved = prefs.getString(KEY_INSTALL_ID, "")?.trim().orEmpty()
            if (saved.isNotEmpty()) return saved
            val fresh = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_INSTALL_ID, fresh).apply()
            return fresh
        }

    /**
     * 设备名：系统机型（`Build.MODEL`），读不到就是 `Android`。
     *
     * 只用于桌面端设备列表里给人看，**不可编辑** —— 让用户改名字只会让
     * 「哪台是哪台」更难认。同样只算一次就落盘，避免每台机器上 `Build` 抖动。
     */
    val deviceName: String
        get() {
            val saved = prefs.getString(KEY_DEVICE_NAME, "")?.trim().orEmpty()
            if (saved.isNotEmpty()) return saved
            // `Build.MODEL` 在极少数 ROM 上为空；单测环境里根本拿不到，一律兜底
            val model = runCatching { Build.MODEL?.trim() }.getOrNull().orEmpty()
            val name = model.ifEmpty { FALLBACK_DEVICE_NAME }
            prefs.edit().putString(KEY_DEVICE_NAME, name).apply()
            return name
        }

    /** 地址与访问码都填了才谈得上连接。 */
    val hasServer: Boolean get() = serverUrl.isNotBlank() && token.isNotBlank()

    companion object {
        /** 自动搬运的体积上限：20MiB（架构文档 §8 `AUTO_TRANSFER`）。 */
        const val AUTO_TRANSFER_BYTES = 20L * 1024 * 1024

        /** 拿不到 `Build.MODEL` 时的设备名。不能为空 —— 桌面端列表里空名字没法认。 */
        const val FALLBACK_DEVICE_NAME = "Android"

        /* 字体与底色预设的 wire 值：UI、设置、阅读器共用一套字符串 */
        const val FONT_SERIF = "serif"
        const val FONT_SANS = "sans"

        const val THEME_WHITE = "white"
        const val THEME_PAPER = "paper"
        const val THEME_CREAM = "cream"
        const val THEME_GRAPHITE = "graphite"
        const val THEME_NIGHT = "night"

        const val COMIC_VERTICAL = "vertical"
        const val COMIC_HORIZONTAL = "horizontal"

        /** 自动滚动速度档位（px/秒），与 UI 上的四档一一对应。 */
        val AUTO_SCROLL_SPEEDS = intArrayOf(18, 32, 52, 80)

        private const val KEY_SERVER = "server_url"
        private const val KEY_TOKEN = "token"
        private const val KEY_FONT_SIZE = "font_size_sp"
        private const val KEY_LINE_HEIGHT = "line_height"
        private const val KEY_LETTER_SPACING = "letter_spacing_em"
        private const val KEY_PARAGRAPH_SPACING = "paragraph_spacing"
        private const val KEY_FIRST_LINE_INDENT = "first_line_indent"
        private const val KEY_AUTO_SCROLL_SPEED = "auto_scroll_speed"
        private const val KEY_KEEP_SCREEN_ON = "keep_screen_on"
        private const val KEY_TAP_TURN = "tap_to_turn"
        private const val KEY_VOLUME_TURN = "volume_keys_turn"
        private const val KEY_FONT_FAMILY = "font_family"
        private const val KEY_THEME_PRESET = "theme_preset"
        private const val KEY_COMIC_DIRECTION = "comic_direction"
        private const val KEY_PAGE_PADDING = "page_padding"
        private const val KEY_ACCENT = "accent"
        private const val KEY_PAPER = "paper"
        private const val KEY_INK = "ink"
        private const val KEY_AUTO_SYNC = "auto_sync"
        private const val KEY_AUTO_TRANSFER = "auto_transfer_under_20mb"
        private const val KEY_WIFI_ONLY = "wifi_only"
        private const val KEY_HIDE_REMOTE = "hide_remote_when_offline"
        private const val KEY_LAST_SYNC = "last_sync_at"
        private const val KEY_LAST_HEALTH = "last_health_at"
        private const val KEY_CONNECTION_STATE = "connection_state"
        private const val KEY_INSTALL_ID = "install_id"
        private const val KEY_DEVICE_NAME = "device_name"
    }
}
