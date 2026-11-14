package com.folio.reader.ui

import com.folio.reader.BuildConfig
import com.folio.reader.core.Book
import com.folio.reader.core.Chapter
import com.folio.reader.core.Origin
import com.folio.reader.core.Paragraph
import com.folio.reader.core.ProgressEntry
import com.folio.reader.core.ReaderMark
import com.folio.reader.core.SearchHit
import com.folio.reader.core.SyncState
import com.folio.reader.core.TocChapter
import com.folio.reader.data.ConnectionState
import com.folio.reader.data.SyncStateStore

/**
 * 书架条目右上角的角标。
 *
 * 每种状态颜色都不一样 —— 书架上一眼扫过去就要能分清「等网络」和「内容打架」，
 * 全用同一个灰等于没做角标。
 */
enum class BookBadge(val label: String) {
    /** 正常，不显示角标。 */
    NONE(""),

    /** 本机有正文但还没上传过（或还没对齐）。 */
    NOT_SYNCED("待同步"),

    /** 桌面端的书，还没下到手机，且现在连不上。 */
    NEED_CONNECT("需连接"),

    /** 同名不同内容，等用户选保留哪一版。 */
    MISMATCH("内容不一致"),

    /** 超过 30MB 或云端书，永远不参与整文件同步。 */
    LOCAL_ONLY("仅本机"),

    /** 正在传。 */
    TRANSFERRING("传输中"),

    /** 上次失败，可重试。 */
    FAILED("同步失败"),
}

/**
 * 书架的一个分区（继续阅读 / 本机书 / 桌面端书）。
 *
 * [key] 是**稳定的分区标识**，只用来拼 LazyColumn 的 item key。
 * 不能拿 [title] 去拼 —— 标题里带本数（`本机书（3）`），书一变标题就变，
 * 等于每次增删书都把所有条目重新当成新 item。
 */
data class ShelfSection(
    val key: String,
    val title: String,
    val books: List<Book>,
)

/**
 * 书架一行上「读到哪」的结论，由 [ShelfUiState.progressSummaryOf] 统一给出。
 *
 * [percentText] / [chapterText] 同源同判，所以不会出现「右边说未读、中间写着第一章」。
 */
data class ProgressSummary(
    /** 读过没有。没读过的书两个文案都是空串，由 UI 决定显示「未读」还是「未下载」。 */
    val read: Boolean,
    /** 例如 `42%`；[read] 为 false 时为空串。 */
    val percentText: String,
    /** 上次读到的章节名；[read] 为 false 时为空串。 */
    val chapterText: String,
)

/**
 * 书架页状态。
 *
 * 3.0 的书架是「本地持久化为真相」：分区、角标、灰态全部由本地四份数据推出来，
 * 不依赖一次成功的网络请求。
 */
data class ShelfUiState(
    val books: List<Book> = emptyList(),
    val progress: Map<String, ProgressEntry> = emptyMap(),
    val syncStates: Map<String, SyncStateStore.Entry> = emptyMap(),
    /** 本机有正文的书 id（断网也能读）。 */
    val offlineIds: Set<String> = emptySet(),
    val query: String = "",
    val filter: String = FILTER_ALL,
    val connection: ConnectionState = ConnectionState.UNKNOWN,
    /** 顶栏副标题：连着时给「版本 · 端口 · 耗时」，断了给原因。 */
    val connectionLabel: String = ConnectionState.UNKNOWN.label,
    val serverVersion: String = "",
    val syncing: Boolean = false,
    val message: String? = null,
    val lastSyncAt: Long = 0L,
    /** 本机正文总占用（字节）。 */
    val localBytes: Long = 0L,
    /** 连不上时是否隐藏只能在线读的书。 */
    val hideRemoteWhenOffline: Boolean = true,
    /** 未连接横幅被关掉了（只在本次进程有效，重启再提示一次）。 */
    val bannerDismissed: Boolean = false,
    /** 正在导入（SAF 多选可能要好几百毫秒）。 */
    val importing: Boolean = false,
    /** 导入进度文案：`正在导入 2/5…`。 */
    val importLabel: String = "",
    /** 刚导入的书，用来把列表滚过去。 */
    val highlightId: String? = null,
) {
    /** 是否连得上桌面端。 */
    val online: Boolean get() = connection.healthy

    /** 未连接横幅要不要显示。 */
    val showBanner: Boolean get() = !online && !bannerDismissed

    /** 这本书现在能不能打开：本机有正文，或桌面端在。 */
    fun readable(book: Book): Boolean = book.hasLocalFile || online

    /** 这本书的同步状态（以 sync-state.json 为准，回落到书本身字段）。 */
    fun stateOf(book: Book): SyncState = syncStates[book.id]?.state ?: book.syncState

    /** 失败原因 / 排除原因，可能为 null。 */
    fun reasonOf(book: Book): String? = syncStates[book.id]?.lastError

    /** 传输进度百分比（0–100）；非传输中为 0。 */
    fun transferPercent(book: Book): Int =
        syncStates[book.id]?.takeIf { it.state == SyncState.TRANSFERRING }?.progressPercent ?: 0

    /** 来源小标：本机 / 桌面端 / 云端 / 云端 · 漫画。 */
    fun sourceLabelOf(book: Book): String = when {
        book.isCloud && book.isComic -> "云端 · 漫画"
        book.isCloud -> "云端"
        book.origin == Origin.LOCAL -> "本机"
        else -> "桌面端"
    }

    /** 角标判定。顺序很重要：先判「能不能读」，再判同步细节。 */
    fun badgeOf(book: Book): BookBadge = when {
        book.isCloud -> if (online) BookBadge.NONE else BookBadge.NEED_CONNECT
        stateOf(book) == SyncState.CONTENT_MISMATCH -> BookBadge.MISMATCH
        stateOf(book) == SyncState.TRANSFERRING -> BookBadge.TRANSFERRING
        !book.hasLocalFile -> if (online) BookBadge.NOT_SYNCED else BookBadge.NEED_CONNECT
        stateOf(book) == SyncState.EXCLUDED -> BookBadge.LOCAL_ONLY
        stateOf(book) == SyncState.FAILED -> BookBadge.FAILED
        book.origin == Origin.LOCAL && stateOf(book) == SyncState.NOT_SYNCED -> BookBadge.NOT_SYNCED
        else -> BookBadge.NONE
    }

    /** 进度百分比（0–100）。桌面端书还没有进度时返回 0。 */
    fun progressPercentOf(book: Book): Double = progress[book.id]?.safePercent ?: 0.0

    /** 上次读到的章节标题（书架条目第二行用）。 */
    fun lastChapterOf(book: Book): String = progress[book.id]?.chapterTitle.orEmpty()

    /**
     * 一条书架行上「读到哪」的唯一结论。
     *
     * 右侧的百分比与第二行的章节名曾经各算一套，于是出现过「右边写未读、中间写着第一章」
     * 的自相矛盾 —— 判「有没有读过」的口径只允许有一份，就是这里。
     *
     * 规则：百分比 > 0 **或** 有章节记录，才算读过。
     * 没读过时 [chapterText] 为空串，第二行不许再冒出章节名。
     */
    fun progressSummaryOf(book: Book): ProgressSummary {
        val entry = progress[book.id]
        val percent = entry?.safePercent ?: 0.0
        val chapter = entry?.chapterTitle.orEmpty()
        val read = percent > 0.0 || chapter.isNotBlank()
        return ProgressSummary(
            read = read,
            percentText = if (read) "${percent.toInt()}%" else "",
            chapterText = if (read) chapter else "",
        )
    }

    /**
     * 过滤后的书（搜索 + 筛选 + 「未连接时隐藏在线书」）。
     */
    val visibleBooks: List<Book>
        get() {
            val keyword = query.trim()
            return books.filter { book ->
                val matchKeyword = keyword.isEmpty() ||
                    book.title.contains(keyword, ignoreCase = true) ||
                    (book.author ?: "").contains(keyword, ignoreCase = true)
                val matchFilter = when (filter) {
                    FILTER_LOCAL -> book.hasLocalFile
                    FILTER_DESKTOP -> book.origin == Origin.DESKTOP
                    FILTER_CLOUD -> book.isCloud
                    FILTER_READING -> progress.containsKey(book.id)
                    else -> true
                }
                val matchAvailability = !(hideRemoteWhenOffline && !online && !book.hasLocalFile)
                matchKeyword && matchFilter && matchAvailability
                // 同一本书在同一个分区里只能出现一次：books.json 若因迁移/并发写留下重复 id，
                // LazyColumn 的 item key 也会撞，这里先按 id 去重再下游用。
            }.distinctBy { it.id }
        }

    /** 继续阅读：最近在读的 1–3 本，按 lastReadAt。 */
    val continueReading: List<Book>
        get() = visibleBooks
            .filter { progress.containsKey(it.id) }
            .sortedByDescending { progress[it.id]?.updatedAt ?: 0L }
            .take(3)

    /** 本机书：自己导进来、正文在手机上。 */
    val localSection: List<Book>
        get() = visibleBooks.filter { it.origin == Origin.LOCAL && it.hasLocalFile }

    /** 桌面端书：从桌面端清单来的（含云端小说与漫画）。 */
    val desktopSection: List<Book>
        get() = visibleBooks.filter { it.origin == Origin.DESKTOP }

    /**
     * 分区。空分区不显示。
     *
     * 分区之间**允许重叠**：一本有进度的本机书会同时出现在「继续阅读」（当快捷入口）
     * 与「本机书」（当全集）。这是产品上有意为之的，所以渲染时 item key 必须带分区前缀，
     * 否则 Compose 会抛「Key was already used」把整个书架打死（3.0.0 真机上就是这么崩的）。
     */
    val sections: List<ShelfSection>
        get() {
            val list = ArrayList<ShelfSection>(3)
            val reading = continueReading
            if (reading.isNotEmpty()) list.add(ShelfSection("continue", "继续阅读", reading))
            val local = localSection
            if (local.isNotEmpty()) {
                list.add(ShelfSection("local", "本机书（${local.size}）", local))
            }
            val desktop = desktopSection
            if (desktop.isNotEmpty()) {
                list.add(ShelfSection("desktop", "桌面端书（${desktop.size}）", desktop))
            }
            return list
        }

    /** 冲突数量（设置页「冲突列表入口」上的红点）。 */
    val conflictCount: Int
        get() = books.count { stateOf(it) == SyncState.CONTENT_MISMATCH }

    companion object {
        const val FILTER_ALL = "all"
        const val FILTER_LOCAL = "local"
        const val FILTER_DESKTOP = "desktop"
        const val FILTER_CLOUD = "cloud"
        const val FILTER_READING = "reading"

        /** 筛选条目的展示顺序与文案。 */
        val FILTERS: List<Pair<String, String>> = listOf(
            FILTER_ALL to "全部",
            FILTER_LOCAL to "本机",
            FILTER_DESKTOP to "桌面端",
            FILTER_CLOUD to "云端",
            FILTER_READING to "在读",
        )
    }
}

/**
 * 「唯一副本删除」的确认请求（T11）。
 *
 * 只会在 `remove-book{unique:true}` 时出现：`CommandExecutor` 只在需要二次确认的
 * 分支调用 [com.folio.reader.data.DeleteConfirmer]，普通删除不回问用户。
 * [requestId] 用来让「用户点完」与「弹层被新的请求替换」不会互相踩。
 */
data class DeleteConfirmState(
    val book: Book,
    val requestId: Long,
)

/**
 * 阅读页状态（小说）。
 *
 * [controls] / [showStyle] 是 UI 自己的显隐开关，放在状态里是为了
 * 点击正文、按返回键时都能统一收起来。
 */
data class ReaderUiState(
    val book: Book? = null,
    val loading: Boolean = false,
    val paragraphs: List<Paragraph> = emptyList(),
    val chapters: List<Chapter> = emptyList(),
    /** 云端书的目录（本地书为空，章节来自 [chapters]）。 */
    val toc: List<TocChapter> = emptyList(),
    val chapterIndex: Int = 0,
    val chapterTitle: String = "",
    val paraIndex: Int = 0,
    val percent: Double = 0.0,
    /** 当前正文来自内存缓存（不是磁盘缓存 —— 3.0 没有磁盘缓存）。 */
    val offline: Boolean = false,
    val error: String? = null,
    val showToc: Boolean = false,
    val showStyle: Boolean = false,
    val controls: Boolean = true,
    val dirty: Boolean = false,
    /** 本书的书签与划线（按段落升序）。 */
    val marks: List<ReaderMark> = emptyList(),
    /** 书签 / 划线抽屉是否展开。 */
    val showMarks: Boolean = false,
    /** 全书搜索状态。 */
    val search: SearchUiState = SearchUiState(),
    /** 自动滚动是否在跑（不持久化，退出阅读器即停）。 */
    val autoScroll: Boolean = false,
    /**
     * 每段之前的累计字数，长度 = 段落数 + 1。
     * 预先算好，滚动时算「剩余阅读时间」就是一次减法，不用每次遍历正文。
     */
    val charPrefix: IntArray = IntArray(0),
) {
    val isCloud: Boolean get() = book?.isCloud == true
    val totalParagraphs: Int get() = paragraphs.size

    /** 章节总数：本地书按正则切出来的章，云端书按目录。 */
    val chapterCount: Int get() = if (isCloud) toc.size else chapters.size

    /** 能不能上一章 / 下一章。 */
    val hasPrevChapter: Boolean get() = chapterIndex > 0
    val hasNextChapter: Boolean get() = chapterIndex < chapterCount - 1

    fun charsBefore(paraIndex: Int): Int =
        if (charPrefix.isEmpty()) 0 else charPrefix[paraIndex.coerceIn(0, charPrefix.lastIndex)]

    val totalChars: Int get() = if (charPrefix.isEmpty()) 0 else charPrefix.last()

    /** 全书剩余阅读时间（分钟）。按中文 420 字/分钟估。 */
    fun minutesLeft(paraIndex: Int, charsPerMinute: Int = 420): Int {
        val left = (totalChars - charsBefore(paraIndex)).coerceAtLeast(0)
        return ((left + charsPerMinute - 1) / charsPerMinute).coerceAtLeast(if (left == 0) 0 else 1)
    }

    /** 本章剩余阅读时间（分钟）。云端书只有当前章在内存，按当前章算。 */
    fun chapterMinutesLeft(paraIndex: Int, charsPerMinute: Int = 420): Int {
        val end = if (isCloud) paragraphs.size else chapters.getOrNull(chapterIndex + 1)?.paraIndex
        val endIndex = end ?: paragraphs.size
        val left = (charsBefore(endIndex) - charsBefore(paraIndex)).coerceAtLeast(0)
        return ((left + charsPerMinute - 1) / charsPerMinute).coerceAtLeast(if (left == 0) 0 else 1)
    }

    val bookmarkedParagraphs: Set<Int>
        get() = marks.filter { it.isBookmark }.map { it.paraIndex }.toSet()
}

/** 全书搜索的 UI 状态。 */
data class SearchUiState(
    val open: Boolean = false,
    val query: String = "",
    val running: Boolean = false,
    val hits: List<SearchHit> = emptyList(),
    /** 当前聚焦的命中下标；-1 表示还没有跳转过。 */
    val cursor: Int = -1,
) {
    val total: Int get() = hits.size
    val current: SearchHit? get() = hits.getOrNull(cursor)
}

/** 漫画阅读页状态。 */
data class ComicUiState(
    val book: Book? = null,
    /** 话列表（来自 `/api/toc`，`index` 是真实话号）。 */
    val toc: List<TocChapter> = emptyList(),
    /** 当前在 [toc] 里的下标。 */
    val chapterIndex: Int = 0,
    /** 当前话的真实话号（写进度用）。 */
    val chapterNo: Int = 0,
    val chapterTitle: String = "",
    /** 本话总页数（拿到清单前是 0）。 */
    val total: Int = 0,
    /** 当前页（0 基）。 */
    val page: Int = 0,
    val loading: Boolean = false,
    /** 话级错误（拿不到目录 / 拿不到页数）。 */
    val error: String? = null,
    /** 单页失败原因：页号 → 文案。只影响那一页。 */
    val pageErrors: Map<Int, String> = emptyMap(),
    val direction: String = "vertical",
    val controls: Boolean = true,
    /** 话选择抽屉是否展开。 */
    val showToc: Boolean = false,
) {
    val hasPrevChapter: Boolean get() = chapterIndex > 0
    val hasNextChapter: Boolean get() = toc.isNotEmpty() && chapterIndex < toc.size - 1

    /** 本话读完的比例（0–1），预取下一话用。 */
    val chapterProgress: Float
        get() = if (total <= 0) 0f else (page + 1).toFloat() / total
}

/** 阅读页翻页请求；[seq] 只用来区分「新的一次」，[direction] 1 下一页 / -1 上一页。 */
data class PageTurn(
    val seq: Long = 0L,
    val direction: Int = 0,
)

/** 设置页状态。 */
data class SettingsUiState(
    val serverUrl: String = "",
    val token: String = "",
    /** 小说正文字号（sp，12–32）。 */
    val fontSizeSp: Float = 17f,
    /** 行距倍数（1.3–2.4）。 */
    val lineHeight: Float = 1.8f,
    /** 字距（em，0–0.12）。 */
    val letterSpacingEm: Float = 0.01f,
    /** 段距（字号倍数，0–2）。 */
    val paragraphSpacing: Float = 0.6f,
    /** 首行缩进。 */
    val firstLineIndent: Boolean = true,
    /** `serif` / `sans`。 */
    val fontFamily: String = "serif",
    /** `white` / `paper` / `cream` / `graphite` / `night`。 */
    val themePreset: String = "white",
    /** 自动滚动速度档位（0–3）。 */
    val autoScrollSpeed: Int = 1,
    /** 阅读时保持常亮。 */
    val keepScreenOn: Boolean = true,
    /** 点屏幕左右两侧翻页；中间仍然切换顶/底栏。 */
    val tapToTurn: Boolean = true,
    /** 音量键翻页：上 = 上一页，下 = 下一页。 */
    val volumeKeysTurn: Boolean = true,
    /** 页边距（dp，12–48）。 */
    val pagePadding: Int = 24,
    /** 阅读方式：`scroll` 上下滚动 / `paged` 左右翻页。 */
    val readingMode: String = "scroll",
    /** 漫画阅读方向：`vertical` / `horizontal`。 */
    val comicDirection: String = "vertical",
    val accent: Long = 0xFFC4251C,
    val paper: Long = 0xFFF4F4F1,
    val ink: Long = 0xFF111111,
    val autoSync: Boolean = true,
    /** 小于 20MB 的书连上就自动搬。 */
    val autoTransferUnder20MB: Boolean = true,
    val wifiOnly: Boolean = false,
    val hideRemoteWhenOffline: Boolean = true,
    val connection: ConnectionState = ConnectionState.UNKNOWN,
    /** 连接诊断：「桌面端 2.6.0 · api 2 · 端口 57321 · 12ms」。 */
    val connectionDetail: String = "",
    /** 上次同步时间（毫秒）。 */
    val lastSyncAt: Long = 0L,
    /** 冲突本数（同步页入口的红点）。 */
    val conflictCount: Int = 0,
    /** 本机正文占用（字节）。 */
    val localBytes: Long = 0L,
    /** 内存缓存占用（章节 + 图片）—— 只用于展示，**不是**磁盘占用。 */
    val memoryBytes: Long = 0L,
    /**
     * 磁盘缓存占用。3.0 的零缓存红线要求它**恒为 0**，
     * 这里直接读 `cacheDir` 实际大小上报，用数据自证而不是嘴上保证。
     */
    val cacheBytes: Long = 0L,
    val discovered: List<String> = emptyList(),
    val searching: Boolean = false,
    val message: String? = null,
    /**
     * 设置页「本机版本」。
     *
     * 直接读打包配置，和 `versionName` / `X-Folio-App-Version` 同一个真相；
     * 这里曾写死过 `3.0.0`，发到 3.4.x 后设置页仍显示旧版本。
     */
    val appVersion: String = BuildConfig.VERSION_NAME,
    val serverVersion: String = "",
) {
    /** 磁盘缓存是真的空（设置页拿它画对勾）。 */
    val cacheIsZero: Boolean get() = cacheBytes <= 0L
}
