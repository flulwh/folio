package com.folio.reader.ui

import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.folio.reader.FolioApp
import com.folio.reader.core.Book
import com.folio.reader.core.BookImporter
import com.folio.reader.core.BookKind
import com.folio.reader.core.JsonIo
import com.folio.reader.core.PageKey
import com.folio.reader.core.ProgressEntry
import com.folio.reader.core.ReaderMark
import com.folio.reader.core.SearchHit
import com.folio.reader.core.TextParser
import com.folio.reader.core.TextSearch
import com.folio.reader.core.TocChapter
import com.folio.reader.core.comicPercent
import com.folio.reader.data.ConnectionManager
import com.folio.reader.data.ConnectionState
import com.folio.reader.data.DeleteConfirmer
import com.folio.reader.data.MarkStore
import com.folio.reader.data.SettingsStore
import com.folio.reader.net.LanDiscovery
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 全局状态。
 *
 * 分工（与架构文档 §1.5 一致）：
 *  - **书架真相**在 `books.json`，桌面端清单只用来算差集；
 *  - **连接状态**只由 [ConnectionManager] 判定，UI 不各写一套文案；
 *  - **云端正文零缓存**：小说经 `CloudChapterSource`（3 章内存），
 *    漫画经 `ImageLoader`（按字节内存 LRU），两者都不碰磁盘；
 *  - 进度：本地 0.6 秒防抖落盘，1.5 秒后回写桌面端，失败挂 `pending.json`。
 */
class AppViewModel(app: Application) : AndroidViewModel(app) {

    private val container = (app as FolioApp).container
    private val settings = container.settings
    private val books = container.books
    private val progressStore = container.progress
    private val syncState = container.syncState
    private val files = container.files
    private val importer = container.importer
    private val cloud = container.cloud
    private val connection = container.connection
    private val progressSync = container.progressSync
    private val sync = container.sync
    private val images = container.images
    /** 书签 / 划线：与进度分开一份文件，见 [MarkStore]。 */
    private val marks = MarkStore(File(getApplication<Application>().filesDir, "library"))
    private var searchJob: Job? = null

    private val _shelf = MutableStateFlow(ShelfUiState())
    val shelf: StateFlow<ShelfUiState> = _shelf.asStateFlow()

    private val _reader = MutableStateFlow(ReaderUiState())
    val reader: StateFlow<ReaderUiState> = _reader.asStateFlow()

    private val _comic = MutableStateFlow(ComicUiState())
    val comic: StateFlow<ComicUiState> = _comic.asStateFlow()

    /** 已解码的漫画页（内存）。key 是 `(书, 话, 页)`。 */
    private val _comicPictures = MutableStateFlow<Map<PageKey, ImageBitmap>>(emptyMap())
    val comicPictures: StateFlow<Map<PageKey, ImageBitmap>> = _comicPictures.asStateFlow()

    private val _settings = MutableStateFlow(SettingsUiState())
    val settingsState: StateFlow<SettingsUiState> = _settings.asStateFlow()

    /** T11：桌面端要求删「唯一副本」时，等用户点确认的弹层状态。 */
    private val deleteConfirms = DeleteConfirmQueue()
    val deleteConfirm: StateFlow<DeleteConfirmState?> = deleteConfirms.request

    /** 目录跳章用的目标段落，由列表状态消费后清空。 */
    private val _scrollTarget = MutableStateFlow(-1)
    val scrollTarget: StateFlow<Int> = _scrollTarget.asStateFlow()

    /** 封面缓存：字节用 LruCache，位图用 StateFlow 驱动重组。 */
    private val coverBytes = LruCache<String, ByteArray>(24)
    private val _covers = MutableStateFlow<Map<String, ImageBitmap>>(emptyMap())
    val covers: StateFlow<Map<String, ImageBitmap>> = _covers.asStateFlow()

    private var progressMap: MutableMap<String, ProgressEntry> = mutableMapOf()
    private var persistJob: Job? = null
    private var pushJob: Job? = null
    private var comicProgressJob: Job? = null

    /** 发现请求的序号：自增即取消上一次（一次性广播 + 5 秒窗口）。 */
    private var discoverSeq = 0

    /** 已预取过下一话的（书 + 话），避免翻页时重复预取。 */
    private val prefetchedChapters = HashSet<String>()

    init {
        reloadLocal()
        loadSettingsState()
        if (settings.hasServer) {
            viewModelScope.launch { bootstrap() }
        }
    }

    /* ---------------- 启动 ---------------- */

    private suspend fun bootstrap() {
        val health = withContext(Dispatchers.IO) { connection.check(force = false) }
        applyHealth(health)
        if (!health.ok) return
        if (settings.autoSync) syncNow(silent = true)
    }

    /* ---------------- 本地数据 ---------------- */

    fun reloadLocal() {
        progressMap = progressStore.read()
        // 按 id 去重：迁移或并发写若在 books.json 里留下同一个 id 的两条，
        // 后面所有以 id 为 key 的地方（LazyColumn key、进度索引、同步状态）都会打架。
        val list = books.read().distinctBy { it.id }
        val states = syncState.read()
        _shelf.update {
            it.copy(
                books = list,
                progress = progressMap.toMap(),
                syncStates = states,
                offlineIds = list.filter { book -> book.hasLocalFile }.map { book -> book.id }.toSet(),
                localBytes = list.filter { book -> book.hasLocalFile }.sumOf { book -> book.size },
                lastSyncAt = syncState.lastSyncAt(),
                hideRemoteWhenOffline = settings.hideRemoteWhenOffline,
            )
        }
        _settings.update { it.copy(conflictCount = _shelf.value.conflictCount) }
    }

    /* ---------------- 连接 ---------------- */

    private fun applyHealth(health: ConnectionManager.Health) {
        _shelf.update {
            it.copy(
                connection = health.state,
                connectionLabel = if (health.ok) health.detail else health.message,
                serverVersion = health.serverVersion,
            )
        }
        _settings.update {
            it.copy(
                connection = health.state,
                connectionDetail = health.detail,
                serverVersion = health.serverVersion,
            )
        }
    }

    fun testConnection() {
        viewModelScope.launch {
            val health = withContext(Dispatchers.IO) { connection.check(force = true) }
            applyHealth(health)
            _shelf.update {
                it.copy(
                    message = when {
                        health.ok -> "连上了桌面端"
                        health.state == ConnectionState.NEED_RECONNECT ->
                            "地址或访问码改过了，再连一次"
                        else -> health.message
                    },
                )
            }
            // 刚连上：立刻把在线通道搭起来，不用等下一次前后台切换
            if (health.ok) startDeviceChannel()
        }
    }

    /** 断开连接：只清状态，不删书（本机的书照样能读）。 */
    fun disconnect() {
        stopDeviceChannel()
        connection.reset()
        applyHealth(ConnectionManager.Health(ConnectionState.UNKNOWN, ConnectionState.UNKNOWN.label))
        _shelf.update { it.copy(message = "已断开桌面端") }
    }

    /** 回前台：最多查一次健康检查，连着就顺手同步。 */
    fun onForeground() {
        if (!settings.hasServer) return
        viewModelScope.launch {
            val health = withContext(Dispatchers.IO) { connection.onForeground() }
            applyHealth(health)
            if (health.ok && settings.autoSync && !_shelf.value.syncing) {
                syncNow(silent = true)
            }
        }
    }

    /* ---------------- T09：前台在线通道 ---------------- */

    /**
     * 开 SSE 长连接（ON_START 调）。
     *
     * 只在「有地址 + 是 Wi-Fi（若开了仅 Wi-Fi）」时连接；桌面端没有设备接口时
     * 通道会自己静默退出，这里不做任何状态展示。
     */
    fun startDeviceChannel() {
        if (!settings.hasServer) return
        if (settings.wifiOnly && !onWifi()) return
        connection.channel.start {
            val outcomes = sync.runPendingCommands(confirmer = deleteConfirmer)
            if (outcomes.isNotEmpty()) reloadLocal()
        }
    }

    /** 关 SSE（ON_STOP 调）。App 一退到后台连接就断，离线态自然出现。 */
    fun stopDeviceChannel() {
        connection.channel.stop()
    }

    /* ---------------- T11：删除唯一副本的确认 ---------------- */

    /**
     * 真实的「删唯一副本」确认器：挂起等用户点弹层。
     *
     * 默认实现 `DeleteConfirmer.REJECT` 会一律拒绝 —— 功能上是安全的，但等于
     * 「唯一副本永远删不掉」。这里把决定权交给用户，并且**只在用户点确认后**才
     * 放行删除；弹层被取消/替换时按拒绝处理（见 [DeleteConfirmQueue]）。
     */
    private val deleteConfirmer: DeleteConfirmer = deleteConfirms

    /** 用户点了确认 / 取消。 */
    fun answerDeleteConfirm(allow: Boolean) {
        deleteConfirms.answer(allow)
    }

    /** 当前是不是 Wi-Fi（「仅在 Wi-Fi 下同步」开关用）。 */
    private fun onWifi(): Boolean {
        val app = getApplication<Application>()
        val manager = app.getSystemService(android.content.Context.CONNECTIVITY_SERVICE)
            as? android.net.ConnectivityManager ?: return true
        val network = manager.activeNetwork ?: return false
        val caps = manager.getNetworkCapabilities(network) ?: return false
        return caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI)
    }

    /* ---------------- 同步 ---------------- */

    fun syncNow(silent: Boolean = false) {
        if (_shelf.value.syncing) return
        if (!settings.hasServer) {
            _shelf.update { it.copy(message = "先填地址和访问码") }
            return
        }
        if (settings.wifiOnly && !onWifi()) {
            _shelf.update { it.copy(message = "设置了只在 Wi-Fi 下同步，现在不是 Wi-Fi") }
            return
        }
        _shelf.update { it.copy(syncing = true) }
        viewModelScope.launch {
            val health = withContext(Dispatchers.IO) { connection.check(force = !silent) }
            applyHealth(health)
            if (!health.ok) {
                _shelf.update { it.copy(syncing = false, message = health.message) }
                return@launch
            }

            val outcome = sync.sync(
                downloadOnly = false,
                autoTransferUnder20MB = settings.autoTransferUnder20MB,
            )
            // 清单搬完之后再对齐进度：书 id 可能刚被归并过，晚一步更不容易丢
            withContext(Dispatchers.IO) { progressSync.pullAndMerge() }
            val flushed = withContext(Dispatchers.IO) { progressSync.flushPending() }

            // T08：同步收尾顺手拉一次排队指令（桌面端没有设备接口时是空列表，不报错）。
            // 逐条串行 + 每条独立回执，执行完不单独提示：书架在下面统一 reload 一次就够了。
            withContext(Dispatchers.IO) { runCatching { sync.runPendingCommands(deleteConfirmer) } }

            val message = when {
                !outcome.ok -> outcome.message
                silent && outcome.ok -> null
                flushed.failed > 0 -> "${outcome.message} · ${flushed.message}"
                else -> outcome.message
            }
            _shelf.update { it.copy(syncing = false, message = message) }
            reloadLocal()
            loadSettingsState()
        }
    }

    /** 同步状态页的单条「重试」。 */
    fun retrySync(book: Book) {
        viewModelScope.launch {
            if (book.hasLocalFile) {
                // 本机书：走一次整体同步，把上传补上
                syncNow(silent = false)
                return@launch
            }
            _shelf.update { it.copy(message = "正在重试《${book.title}》…") }
            val outcome = sync.pullBook(book.remoteId ?: book.id)
            _shelf.update { it.copy(message = outcome.message) }
            reloadLocal()
        }
    }

    fun dismissMessage() {
        _shelf.update { it.copy(message = null) }
        _settings.update { it.copy(message = null) }
    }

    /** 关掉「未连接桌面端」横幅（本次进程内不再弹）。 */
    fun dismissBanner() {
        _shelf.update { it.copy(bannerDismissed = true) }
    }

    /** 列表已经滚到要高亮的那本之后调用。 */
    fun clearHighlight() {
        _shelf.update { it.copy(highlightId = null) }
    }

    /* ---------------- 小说阅读 ---------------- */

    fun openBook(book: Book) {
        if (book.isComic) {
            openComic(book)
            return
        }
        images.clear()
        _reader.value = ReaderUiState(book = book, loading = true)
        viewModelScope.launch {
            books.touchRead(book.id)
            if (book.isCloud) {
                openCloudBook(book)
            } else {
                openLocalBook(book)
            }
        }
    }

    /** 本机书：正文就在 `books/<id>.txt`，断网也能读。 */
    private suspend fun openLocalBook(book: Book) {
        val text = withContext(Dispatchers.IO) { files.readText(book.id) }
        if (text.isNullOrBlank()) {
            _reader.value = ReaderUiState(
                book = book,
                error = "这本书还没下到手机，连接桌面端后可以下载全文",
            )
            return
        }
        val parsed = TextParser.parseBook(text)
        val savedMarks = withContext(Dispatchers.IO) { marks.read(book.id) }
        val entry = progressMap[book.id]
        val index = (entry?.paraIndex ?: 0).coerceIn(0, (parsed.paragraphs.size - 1).coerceAtLeast(0))
        val chapterIndex = TextParser.chapterIndexForPara(parsed.chapters, index)
        _reader.value = ReaderUiState(
            book = book,
            paragraphs = parsed.paragraphs,
            chapters = parsed.chapters,
            chapterIndex = chapterIndex,
            chapterTitle = parsed.chapters.getOrNull(chapterIndex)?.title.orEmpty(),
            paraIndex = index,
            percent = percentOf(index, parsed.paragraphs.size, 0, 0),
            offline = true,
            marks = savedMarks,
            charPrefix = prefixOf(parsed.paragraphs),
        )
        recordProgress(book, buildEntry(book, index, chapterIndex, parsed.chapters))
    }

    /** 云端书：先取目录，再按章取正文（正文只进内存）。 */
    private suspend fun openCloudBook(book: Book) {
        if (!_shelf.value.online) {
            _reader.value = ReaderUiState(
                book = book,
                error = "云端书需要连接桌面端才能阅读",
            )
            return
        }
        val toc = withContext(Dispatchers.IO) { runCatching { cloud.toc(book.id) } }
        val chapters = toc.getOrNull()?.chapters.orEmpty()
        if (chapters.isEmpty()) {
            val reason = toc.exceptionOrNull()?.message?.takeIf { it.isNotBlank() }
            _reader.value = ReaderUiState(
                book = book,
                error = reason ?: "拿不到目录，确认桌面端已打开",
            )
            return
        }
        val entry = progressMap[book.id]
        val target = entry?.chapter ?: chapters.first().index
        val position = chapters.indexOfFirst { it.index == target }.coerceAtLeast(0)
        _reader.update { it.copy(toc = chapters) }
        readCloudChapter(book, chapters, position, entry)
    }

    private suspend fun readCloudChapter(
        book: Book,
        toc: List<TocChapter>,
        position: Int,
        entry: ProgressEntry?,
    ) {        val safePosition = position.coerceIn(0, toc.size - 1)
        val chapterNo = toc[safePosition].index
        val loaded = withContext(Dispatchers.IO) {
            runCatching { cloud.chapter(book.id, chapterNo) }
        }
        val text = loaded.getOrNull()?.text
        if (text.isNullOrBlank()) {
            val reason = loaded.exceptionOrNull()?.message?.takeIf { it.isNotBlank() }
            _reader.update {
                it.copy(loading = false, error = reason ?: "连接已断开 · 重试")
            }
            return
        }
        val parsed = TextParser.parseBook(text)
        val savedMarks = withContext(Dispatchers.IO) { marks.read(book.id) }
        val resume = if (entry != null && entry.chapter == chapterNo) (entry.paraIndex ?: 0) else 0
        val paraIndex = resume.coerceIn(0, (parsed.paragraphs.size - 1).coerceAtLeast(0))
        _reader.update {
            it.copy(
                loading = false,
                error = null,
                paragraphs = parsed.paragraphs,
                chapters = parsed.chapters,
                toc = toc,
                chapterIndex = safePosition,
                chapterTitle = toc[safePosition].title,
                paraIndex = paraIndex,
                percent = percentOf(paraIndex, parsed.paragraphs.size, safePosition, toc.size),
                offline = loaded.getOrNull()?.fromCache == true,
                marks = savedMarks,
                charPrefix = prefixOf(parsed.paragraphs),
            )
        }
        recordProgress(book, buildEntry(book, paraIndex, safePosition, parsed.chapters, chapterNo))
        prefetchNextChapter(book, toc, safePosition)
    }

    /**
     * 翻章失败后的「重试」。
     *
     * 失败时 `readCloudChapter` 只写 `error`，已经读到的 `paragraphs` 原封不动留着，
     * 所以这里重试不会把正文清空 —— 用户看到的是「内容还在，底下提示重试」。
     */
    fun retryChapter() {
        val state = _reader.value
        val book = state.book ?: return
        _reader.update { it.copy(error = null) }
        viewModelScope.launch {
            when {
                state.isCloud && state.toc.isEmpty() -> {
                    _reader.update { it.copy(loading = true) }
                    openCloudBook(book)
                }
                state.isCloud -> readCloudChapter(book, state.toc, state.chapterIndex, progressMap[book.id])
                state.paragraphs.isEmpty() -> {
                    _reader.update { it.copy(loading = true) }
                    openLocalBook(book)
                }
                // 本机书正文在本地，能显示就不会有 error，兜底什么都不做。
                else -> Unit
            }
        }
    }

    /** 顺手把下一章拉进内存，翻章时不用等。失败一律吞掉。 */
    private fun prefetchNextChapter(book: Book, toc: List<TocChapter>, position: Int) {
        val next = toc.getOrNull(position + 1)?.index ?: return
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { cloud.prefetch(book.id, listOf(next)) }
        }
    }

    fun switchChapter(index: Int) {
        val state = _reader.value
        val book = state.book ?: return
        if (index < 0) return
        if (state.isCloud) {
            if (state.toc.isEmpty() || index >= state.toc.size) return
            if (index == state.chapterIndex && state.paragraphs.isNotEmpty()) return
            _reader.update { it.copy(loading = true, error = null, showToc = false) }
            viewModelScope.launch {
                readCloudChapter(book, state.toc, index, progressMap[book.id])
            }
        } else {
            val chapter = state.chapters.getOrNull(index) ?: return
            _reader.update {
                it.copy(chapterIndex = index, chapterTitle = chapter.title, showToc = false)
            }
            scrollToParagraph(chapter.paraIndex)
            updatePosition(chapter.paraIndex)
        }
    }

    fun prevChapter() = jumpChapter(-1)

    fun nextChapter() = jumpChapter(1)

    private fun jumpChapter(delta: Int) {
        val state = _reader.value
        val target = state.chapterIndex + delta
        if (target < 0 || target >= state.chapterCount) return
        switchChapter(target)
    }

    /** 拖动进度条。 */
    fun seekToPercent(percent: Double) {
        val state = _reader.value
        val book = state.book ?: return
        val safe = percent.coerceIn(0.0, 100.0)
        if (state.isCloud) {
            val total = state.toc.size
            if (total <= 0) return
            val position = (safe / 100.0 * total).coerceIn(0.0, (total - 0.0001).coerceAtLeast(0.0))
            val chapter = position.toInt()
            val ratio = position - chapter
            if (chapter == state.chapterIndex) {
                val target = (ratio * (state.paragraphs.size - 1).coerceAtLeast(0)).toInt()
                    .coerceIn(0, (state.paragraphs.size - 1).coerceAtLeast(0))
                updatePosition(target)
            } else {
                _reader.update { it.copy(loading = true) }
                viewModelScope.launch {
                    readCloudChapter(book, state.toc, chapter, null)
                    val after = _reader.value
                    val target = (ratio * (after.paragraphs.size - 1).coerceAtLeast(0)).toInt()
                        .coerceIn(0, (after.paragraphs.size - 1).coerceAtLeast(0))
                    updatePosition(target)
                }
            }
        } else {
            val target = (safe / 100.0 * (state.paragraphs.size - 1).coerceAtLeast(0)).toInt()
                .coerceIn(0, (state.paragraphs.size - 1).coerceAtLeast(0))
            updatePosition(target)
        }
    }

    /** 滚动时上报当前段落。 */
    fun updatePosition(paraIndex: Int) {
        val state = _reader.value
        val book = state.book ?: return
        if (state.paragraphs.isEmpty()) return
        val index = paraIndex.coerceIn(0, state.paragraphs.size - 1)
        val chapterIndex = if (state.isCloud) {
            state.chapterIndex
        } else {
            TextParser.chapterIndexForPara(state.chapters, index)
        }
        val chapterTitle = if (state.isCloud) {
            state.chapterTitle
        } else {
            state.chapters.getOrNull(chapterIndex)?.title.orEmpty()
        }
        _reader.update {
            it.copy(
                paraIndex = index,
                chapterIndex = chapterIndex,
                chapterTitle = chapterTitle,
                percent = percentOf(index, state.paragraphs.size, chapterIndex, state.toc.size),
            )
        }
        val chapterNo = if (state.isCloud) state.toc.getOrNull(chapterIndex)?.index else null
        recordProgress(book, buildEntry(book, index, chapterIndex, state.chapters, chapterNo))
    }

    fun toggleToc() {
        _reader.update {
            val open = !it.showToc
            it.copy(
                showToc = open,
                showStyle = false,
                showMarks = false,
                search = if (open) it.search.copy(open = false) else it.search,
            )
        }
    }

    fun toggleStyle() {
        _reader.update {
            val open = !it.showStyle
            it.copy(
                showStyle = open,
                showToc = false,
                showMarks = false,
                search = if (open) it.search.copy(open = false) else it.search,
            )
        }
    }

    fun toggleControls() {
        _reader.update { it.copy(controls = !it.controls) }
    }

    fun scrollToParagraph(paraIndex: Int) {
        _scrollTarget.value = paraIndex
    }

    fun clearScrollTarget() {
        _scrollTarget.value = -1
    }

    fun closeReader() {
        flush()
        searchJob?.cancel()
        images.clear()
        cloud.clear()
        _reader.value = ReaderUiState()
        // T10：退出阅读器是快照的三个触发点之一（刚读完的书 lastReadAt / 进度都变了）。
        // 60s 内重复会被 SyncEngine 自己挡掉，这里不用再判断。
        viewModelScope.launch { runCatching { sync.reportSnapshot() } }
    }

    /* ---------------- 书签 · 划线 · 笔记 ---------------- */

    /** 每段之前的累计字数，长度 = 段落数 + 1（最后一项是全书总字数）。 */
    private fun prefixOf(paragraphs: List<com.folio.reader.core.Paragraph>): IntArray {
        if (paragraphs.isEmpty()) return IntArray(0)
        val prefix = IntArray(paragraphs.size + 1)
        var sum = 0
        for (index in paragraphs.indices) {
            prefix[index] = sum
            sum += paragraphs[index].text.length
        }
        prefix[paragraphs.size] = sum
        return prefix
    }

    /** 当前段落所属章节标题（本机书按段落号反查，云端书就是当前章）。 */
    private fun chapterTitleOf(state: ReaderUiState, paraIndex: Int): String {
        if (state.isCloud) return state.chapterTitle
        val index = TextParser.chapterIndexForPara(state.chapters, paraIndex)
        return state.chapters.getOrNull(index)?.title.orEmpty()
    }

    fun toggleMarks() {
        _reader.update {
            val open = !it.showMarks
            it.copy(
                showMarks = open,
                showToc = false,
                showStyle = false,
                search = if (open) it.search.copy(open = false) else it.search,
            )
        }
    }

    /** 在指定段落上加 / 取消书签（默认当前段落）。 */
    fun toggleBookmark(paraIndex: Int = _reader.value.paraIndex) {
        val state = _reader.value
        val book = state.book ?: return
        if (state.paragraphs.isEmpty()) return
        val index = paraIndex.coerceIn(0, state.paragraphs.size - 1)
        val existing = state.marks.firstOrNull { it.paraIndex == index && it.isBookmark }
        if (existing != null) {
            removeMark(existing.id)
            return
        }
        val mark = ReaderMark.create(
            bookId = book.id,
            paraIndex = index,
            chapterTitle = chapterTitleOf(state, index),
            excerpt = state.paragraphs[index].text,
            kind = ReaderMark.KIND_BOOKMARK,
            chapterIndex = state.chapterIndex,
            chapterNo = if (state.isCloud) state.toc.getOrNull(state.chapterIndex)?.index ?: -1 else -1,
        )
        commitMark(mark)
    }

    /** 划线（同段落重复划 = 取消）。 */
    fun toggleHighlight(paraIndex: Int = _reader.value.paraIndex) {
        val state = _reader.value
        val book = state.book ?: return
        if (state.paragraphs.isEmpty()) return
        val index = paraIndex.coerceIn(0, state.paragraphs.size - 1)
        val existing = state.marks.firstOrNull {
            it.paraIndex == index && it.kind == ReaderMark.KIND_HIGHLIGHT
        }
        if (existing != null) {
            removeMark(existing.id)
            return
        }
        val mark = ReaderMark.create(
            bookId = book.id,
            paraIndex = index,
            chapterTitle = chapterTitleOf(state, index),
            excerpt = state.paragraphs[index].text,
            kind = ReaderMark.KIND_HIGHLIGHT,
            chapterIndex = state.chapterIndex,
            chapterNo = if (state.isCloud) state.toc.getOrNull(state.chapterIndex)?.index ?: -1 else -1,
        )
        commitMark(mark)
    }

    private fun commitMark(mark: ReaderMark) {
        viewModelScope.launch {
            val list = withContext(Dispatchers.IO) { marks.put(mark) }
            _reader.update { it.copy(marks = list) }
        }
    }

    fun removeMark(id: String) {
        val book = _reader.value.book ?: return
        viewModelScope.launch {
            val list = withContext(Dispatchers.IO) { marks.remove(book.id, id) }
            _reader.update { it.copy(marks = list) }
        }
    }

    /** 给某条痕迹写 / 改笔记；写空即退回纯书签。 */
    fun updateMarkNote(id: String, note: String) {
        val book = _reader.value.book ?: return
        viewModelScope.launch {
            val list = withContext(Dispatchers.IO) { marks.updateNote(book.id, id, note) }
            _reader.update { it.copy(marks = list) }
        }
    }

    /** 跳到某条痕迹所在段落；云端书跨章时先把目标章拉下来。 */
    fun jumpToMark(mark: ReaderMark) {
        val state = _reader.value
        val book = state.book ?: return
        _reader.update { it.copy(showMarks = false, showToc = false) }
        if (state.isCloud) {
            val position = state.toc.indexOfFirst { it.index == mark.chapterNo }
            if (position >= 0 && position != state.chapterIndex) {
                _reader.update { it.copy(loading = true, error = null) }
                viewModelScope.launch {
                    readCloudChapter(
                        book = book,
                        toc = state.toc,
                        position = position,
                        entry = ProgressEntry(
                            id = book.id,
                            paraIndex = mark.paraIndex,
                            chapter = mark.chapterNo,
                            chapterIndex = mark.chapterNo,
                            chapterTitle = mark.chapterTitle,
                            windowBase = mark.chapterNo,
                            percent = state.percent,
                            updatedAt = System.currentTimeMillis(),
                        ),
                    )
                }
                return
            }
        }
        scrollToParagraph(mark.paraIndex)
        updatePosition(mark.paraIndex)
    }

    /* ---------------- 全书搜索 ---------------- */

    fun toggleSearch() {
        val state = _reader.value
        if (state.search.open) {
            closeSearch()
        } else {
            _reader.update {
                it.copy(
                    search = it.search.copy(open = true),
                    showToc = false,
                    showStyle = false,
                    showMarks = false,
                )
            }
        }
    }

    fun closeSearch() {
        searchJob?.cancel()
        _reader.update { it.copy(search = SearchUiState()) }
    }

    fun updateSearchQuery(query: String) {
        _reader.update {
            it.copy(search = it.search.copy(query = query, running = query.isNotBlank(), cursor = -1))
        }
        searchJob?.cancel()
        if (query.isBlank()) {
            _reader.update { it.copy(search = it.search.copy(hits = emptyList(), running = false)) }
            return
        }
        searchJob = viewModelScope.launch {
            delay(260)
            val state = _reader.value
            val hits = withContext(Dispatchers.Default) {
                TextSearch.search(state.paragraphs, state.chapters, query)
            }
            _reader.update {
                if (it.search.query == query) {
                    it.copy(search = it.search.copy(hits = hits, running = false))
                } else {
                    it
                }
            }
        }
    }

    fun jumpToSearchHit(hit: SearchHit) {
        val state = _reader.value
        val cursor = state.search.hits.indexOf(hit)
        _reader.update {
            it.copy(
                search = it.search.copy(cursor = cursor),
                showToc = false,
                showMarks = false,
            )
        }
        scrollToParagraph(hit.paraIndex)
        updatePosition(hit.paraIndex)
    }

    /** 命中列表里上一条 / 下一条。 */
    fun stepSearchHit(delta: Int) {
        val state = _reader.value
        val hits = state.search.hits
        if (hits.isEmpty()) return
        val next = if (state.search.cursor < 0) {
            if (delta > 0) 0 else hits.lastIndex
        } else {
            (state.search.cursor + delta).coerceIn(0, hits.lastIndex)
        }
        jumpToSearchHit(hits[next])
    }

    /* ---------------- 自动滚动 ---------------- */

    fun toggleAutoScroll() {
        val state = _reader.value
        if (state.paragraphs.isEmpty()) return
        _reader.update { it.copy(autoScroll = !it.autoScroll, controls = false) }
    }

    fun stopAutoScroll() {
        if (_reader.value.autoScroll) {
            // 走到书末自动停下时把控件叫回来，否则读者会面对一个没有任何出口的页面。
            _reader.update { it.copy(autoScroll = false, controls = true) }
        }
    }

    private fun percentOf(paraIndex: Int, paraCount: Int, chapterIndex: Int, tocTotal: Int): Double {
        val inner = if (paraCount <= 0) 0.0 else paraIndex.toDouble() / paraCount
        return if (tocTotal > 0) {
            ((chapterIndex + inner) / tocTotal * 100.0).coerceIn(0.0, 100.0)
        } else {
            (inner * 100.0).coerceIn(0.0, 100.0)
        }
    }

    private fun buildEntry(
        book: Book,
        paraIndex: Int,
        chapterIndex: Int,
        chapters: List<com.folio.reader.core.Chapter>,
        chapterNo: Int? = null,
    ): ProgressEntry {
        val state = _reader.value
        val title = if (book.isCloud) {
            state.chapterTitle
        } else {
            chapters.getOrNull(chapterIndex)?.title.orEmpty()
        }
        val cloudChapter = chapterNo ?: chapterIndex
        return ProgressEntry(
            id = book.id,
            paraIndex = paraIndex,
            chapter = if (book.isCloud) cloudChapter else null,
            chapterIndex = if (book.isCloud) cloudChapter else null,
            chapterTitle = title,
            windowBase = if (book.isCloud) cloudChapter else null,
            percent = state.percent,
            updatedAt = System.currentTimeMillis(),
        )
    }

    /* ---------------- 漫画阅读 ---------------- */

    fun openComic(book: Book) {
        cloud.clear()
        images.clear()
        _comicPictures.value = emptyMap()
        prefetchedChapters.clear()
        _comic.value = ComicUiState(
            book = book,
            loading = true,
            direction = settings.comicDirection,
        )
        viewModelScope.launch {
            books.touchRead(book.id)
            if (!_shelf.value.online) {
                _comic.update { it.copy(loading = false, error = "云端书需要连接桌面端才能阅读") }
                return@launch
            }
            val toc = withContext(Dispatchers.IO) { runCatching { cloud.toc(book.id) } }
            val chapters = toc.getOrNull()?.chapters.orEmpty()
            if (chapters.isEmpty()) {
                val reason = toc.exceptionOrNull()?.message?.takeIf { it.isNotBlank() }
                _comic.update {
                    it.copy(loading = false, error = reason ?: "拿不到话列表，确认桌面端已打开")
                }
                return@launch
            }
            val entry = progressMap[book.id]
            val target = entry?.chapter ?: chapters.first().index
            val position = chapters.indexOfFirst { it.index == target }.coerceAtLeast(0)
            loadComicChapter(book, chapters, position, book.comicPage ?: 0)
        }
    }

    private suspend fun loadComicChapter(
        book: Book,
        toc: List<TocChapter>,
        position: Int,
        startPage: Int,
    ) {
        val safePosition = position.coerceIn(0, toc.size - 1)
        val chapterNo = toc[safePosition].index
        val pages = withContext(Dispatchers.IO) {
            runCatching { connection.client().comicPages(book.id, chapterNo) }
        }
        val total = pages.getOrNull()?.total ?: 0
        if (total <= 0) {
            val reason = pages.exceptionOrNull()?.message?.takeIf { it.isNotBlank() }
                ?: "这一话没有图片"
            _comic.update {
                it.copy(loading = false, error = reason)
            }
            return
        }
        val page = startPage.coerceIn(0, total - 1)
        _comic.update {
            it.copy(
                book = book,
                toc = toc,
                chapterIndex = safePosition,
                chapterNo = chapterNo,
                chapterTitle = toc[safePosition].title,
                total = total,
                page = page,
                loading = false,
                error = null,
                pageErrors = emptyMap(),
            )
        }
        requestComicPage(page)
        recordComicProgress(book, toc, safePosition, chapterNo, page, total, immediate = true)
        maybePrefetchNextChapter(book, toc, safePosition, page, total)
    }

    /** 请求某一页（已在缓存/已失败的直接跳过）。 */
    fun requestComicPage(page: Int) {
        val state = _comic.value
        val book = state.book ?: return
        if (page < 0 || (state.total > 0 && page >= state.total)) return
        if (state.pageErrors.containsKey(page)) return
        val key = PageKey.of(book.id, state.chapterNo, page)
        if (_comicPictures.value.containsKey(key)) return
        viewModelScope.launch {
            val bitmap = images.load(key).await()
            if (bitmap == null) {
                val reason = probeComicPageError(book, state.chapterNo, page)
                _comic.update { it.copy(pageErrors = it.pageErrors + (page to reason)) }
            } else {
                _comicPictures.update { it + (key to bitmap.asImageBitmap()) }
            }
        }
    }

    /**
     * 失败页的「重试」：先清掉失败标记，再走一次加载。
     */
    fun retryComicPage(page: Int) {
        _comic.update { it.copy(pageErrors = it.pageErrors - page) }
        requestComicPage(page)
    }

    /**
     * 取失败原因。
     *
     * `ImageLoader` 只回 null（它自己打了日志），但 UI 要显示「为什么失败」，
     * 所以失败时再探一次接口把服务端/网络的原始文案拿回来 —— 只在失败路径上多一次请求。
     */
    private suspend fun probeComicPageError(book: Book, chapterNo: Int, page: Int): String {
        val error = withContext(Dispatchers.IO) {
            runCatching {
                connection.client().comicPage(book.id, chapterNo, page).use { it.input.readBytes() }
            }.exceptionOrNull()
        }
        return error?.message?.takeIf { it.isNotBlank() } ?: "这一页没取到"
    }

    /** 当前页变化（滚动或翻页触发）。 */
    fun onComicPageChanged(page: Int) {
        val state = _comic.value
        val book = state.book ?: return
        if (page == state.page || page < 0) return
        _comic.update { it.copy(page = page) }
        requestComicPage(page)
        requestComicPage(page + 1)
        requestComicPage(page + 2)
        if (page - 1 >= 0) requestComicPage(page - 1)
        recordComicProgress(book, state.toc, state.chapterIndex, state.chapterNo, page, state.total, false)
        maybePrefetchNextChapter(book, state.toc, state.chapterIndex, page, state.total)
    }

    fun switchComicChapter(index: Int) {
        val state = _comic.value
        val book = state.book ?: return
        if (index < 0 || index >= state.toc.size) return
        if (index == state.chapterIndex && state.total > 0) return
        _comic.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            loadComicChapter(book, state.toc, index, 0)
        }
    }

    fun prevComicChapter() {
        val state = _comic.value
        if (!state.hasPrevChapter) return
        switchComicChapter(state.chapterIndex - 1)
    }

    fun nextComicChapter() {
        val state = _comic.value
        if (!state.hasNextChapter) return
        switchComicChapter(state.chapterIndex + 1)
    }

    fun toggleComicControls() {
        _comic.update { it.copy(controls = !it.controls) }
    }

    /** 话选择抽屉的显隐。 */
    fun toggleComicToc() {
        _comic.update { it.copy(showToc = !it.showToc) }
    }

    /**
     * 重试整话：`ComicReaderScreen` 的「重试」按钮走这里。
     *
     * 只清错误标记与失败页记录，已经加载成功的页继续用内存里的图，
     * 不整份重来（重来会把用户翻到的位置打回第一页）。
     */
    fun reloadComic() {
        val state = _comic.value
        val book = state.book ?: return
        _comic.update { it.copy(loading = true, error = null, pageErrors = emptyMap()) }
        viewModelScope.launch {
            if (state.toc.isEmpty()) {
                // 连目录都没拿到 —— 整份重开。
                openComic(book)
                return@launch
            }
            loadComicChapter(book, state.toc, state.chapterIndex, state.page)
        }
    }

    /** 读到本话 80% 就预取下一话的页清单与前两张。 */
    private fun maybePrefetchNextChapter(
        book: Book,
        toc: List<TocChapter>,
        position: Int,
        page: Int,
        total: Int,
    ) {
        if (total <= 0) return
        if ((page + 1).toFloat() / total < 0.8f) return
        val next = toc.getOrNull(position + 1) ?: return
        val stamp = "${book.id}#${next.index}"
        if (!prefetchedChapters.add(stamp)) return
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                val pages = connection.client().comicPages(book.id, next.index)
                for (index in 0 until minOf(2, pages.total)) {
                    val key = PageKey.of(book.id, next.index, index)
                    val bitmap = images.load(key).await()
                    if (bitmap != null) {
                        _comicPictures.update { it + (key to bitmap.asImageBitmap()) }
                    }
                }
            }
        }
    }

    /**
     * 漫画进度：对齐到「话」级。
     *
     * `chapter` / `windowBase` / `paraIndex` 都写话序号（与桌面端口径一致），
     * `percent` 由 [comicPercent] 算（话位置 + 话内页比例）；话内页号只落本机
     * （`LocalBook.comicPage`），不进 `ProgressEntry`，因此不会污染桌面端。
     */
    private fun recordComicProgress(
        book: Book,
        toc: List<TocChapter>,
        position: Int,
        chapterNo: Int,
        page: Int,
        total: Int,
        immediate: Boolean,
    ) {
        val percent = comicPercent(
            chapterIndex = position,
            pageIndex = page,
            pageCount = total,
            chapterCount = toc.size,
        )
        val title = toc.getOrNull(position)?.title.orEmpty()
        val entry = ProgressEntry(
            id = book.id,
            paraIndex = chapterNo,
            chapter = chapterNo,
            chapterIndex = chapterNo,
            chapterTitle = title,
            windowBase = chapterNo,
            percent = percent,
            updatedAt = System.currentTimeMillis(),
        )
        progressMap[book.id] = entry
        _shelf.update { it.copy(progress = progressMap.toMap()) }
        comicProgressJob?.cancel()
        comicProgressJob = viewModelScope.launch {
            if (!immediate) delay(700)
            progressStore.write(progressMap)
            withContext(Dispatchers.IO) { progressSync.push(book, entry) }
        }
    }

    /** 关掉漫画阅读器：把话内页号落到本地，释放图片内存。 */
    fun closeComic() {
        val state = _comic.value
        val book = state.book
        if (book != null) {
            val current = books.findById(book.id)
            if (current != null) {
                books.upsert(current.copy(comicPage = state.page))
            }
        }
        flush()
        images.clear()
        cloud.clear()
        _comicPictures.value = emptyMap()
        _comic.value = ComicUiState(direction = settings.comicDirection)
    }

    /* ---------------- 进度落盘与回写 ---------------- */

    private fun recordProgress(book: Book, entry: ProgressEntry) {
        progressMap[book.id] = entry
        _shelf.update { it.copy(progress = progressMap.toMap()) }
        persistJob?.cancel()
        persistJob = viewModelScope.launch {
            delay(600)
            progressStore.write(progressMap)
        }
        pushJob?.cancel()
        pushJob = viewModelScope.launch {
            delay(1500)
            val ok = withContext(Dispatchers.IO) { progressSync.push(book, entry) }
            if (ok) {
                _shelf.update { it.copy(connection = ConnectionState.CONNECTED) }
            } else {
                _shelf.update {
                    it.copy(message = "进度先存在手机里，连上桌面端会自动补同步")
                }
            }
        }
    }

    /** 立刻把进度写盘并尝试补写。 */
    fun flush() {
        persistJob?.cancel()
        progressStore.write(progressMap)
        val dirty = progressStore.readPending()
        if (dirty.isEmpty()) return
        viewModelScope.launch {
            val outcome = withContext(Dispatchers.IO) { progressSync.flushPending() }
            if (outcome.ok) {
                _shelf.update { it.copy(message = "进度已同步到桌面端") }
            }
        }
    }

    /* ---------------- 封面 ---------------- */

    fun loadCover(book: Book) {
        if (_covers.value.containsKey(book.id)) return
        if (book.cover == null) return
        viewModelScope.launch {
            val bytes = coverBytes.get(book.id) ?: withContext(Dispatchers.IO) {
                runCatching {
                    connection.client().fetchCover(book.remoteId ?: book.id)
                }.getOrNull()
            }
            if (bytes == null) return@launch
            coverBytes.put(book.id, bytes)
            val bitmap = android.graphics.BitmapFactory
                .decodeByteArray(bytes, 0, bytes.size)
                ?.asImageBitmap()
            if (bitmap != null) {
                _covers.update { it + (book.id to bitmap) }
            }
        }
    }

    /* ---------------- 书架动作 ---------------- */

    fun setFilter(filter: String) {
        _shelf.update { it.copy(filter = filter) }
    }

    fun setQuery(query: String) {
        _shelf.update { it.copy(query = query) }
    }

    /** 把一本桌面端的书整本下到手机（之后断网也能读）。 */
    fun downloadOffline(book: Book) {
        if (book.isCloud) {
            _shelf.update { it.copy(message = "云端书需要连接桌面端才能阅读") }
            return
        }
        if (book.hasLocalFile) {
            _shelf.update { it.copy(message = "《${book.title}》已经在本机了") }
            return
        }
        viewModelScope.launch {
            _shelf.update { it.copy(message = "正在下载《${book.title}》…") }
            val outcome = sync.pullBook(book.remoteId ?: book.id)
            _shelf.update { it.copy(message = outcome.message) }
            reloadLocal()
        }
    }

    /**
     * 删除本机副本（本机书的长按菜单）。
     *
     * 正文与条目一起删，否则 `books/` 里会留下没人引用的孤儿文件。
     */
    fun deleteLocalCopy(book: Book) {
        removeEntry(book, message = "已删除《${book.title}》的本机副本")
    }

    /**
     * 从手机书架移除（桌面端书的长按菜单）。
     *
     * 桌面端那份不动：下次同步会重新出现，这是预期行为（手机只是「不看了」）。
     * 如果这本已经下到手机，正文也一并删掉。
     */
    fun removeFromShelf(book: Book) {
        removeEntry(book, message = "已从手机书架移除《${book.title}》")
    }

    private fun removeEntry(book: Book, message: String) {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                files.delete(book.id)
                books.remove(book.id)
                syncState.remove(book.id)
                progressStore.remove(book.id)
                cloud.clear(book.id)
            }
            _covers.update { it - book.id }
            coverBytes.remove(book.id)
            _shelf.update { it.copy(message = message) }
            reloadLocal()
        }
    }

    /* ---------------- 导入 ---------------- */

    /**
     * 导入多个文件（SAF 多选）。
     *
     * 逐个导入是为了给出「2/5」这种进度：一本 20MB 的 txt 在低端机上要几百毫秒，
     * 选十本时如果什么都不显示，用户会以为没反应。
     */
    fun importDocuments(uris: List<Uri>) {
        if (uris.isEmpty()) return
        viewModelScope.launch {
            _shelf.update {
                it.copy(importing = true, importLabel = "正在导入 0/${uris.size}…", message = null)
            }
            var importedId: String? = null
            var importedTitle = ""
            var duplicateTitle = ""
            var failedReason = ""
            var importedCount = 0
            var duplicateCount = 0
            var failedCount = 0

            uris.forEachIndexed { index, uri ->
                _shelf.update { it.copy(importLabel = "正在导入 ${index + 1}/${uris.size}…") }
                when (val outcome = withContext(Dispatchers.IO) { importOne(uri) }) {
                    is BookImporter.Outcome.Imported -> {
                        importedCount += 1
                        importedId = outcome.book.id
                        importedTitle = outcome.book.title
                    }
                    is BookImporter.Outcome.Duplicate -> {
                        duplicateCount += 1
                        duplicateTitle = books.findById(outcome.existingId)?.title.orEmpty()
                    }
                    is BookImporter.Outcome.Failed -> {
                        failedCount += 1
                        if (failedReason.isBlank()) failedReason = outcome.reason
                    }
                }
            }

            val message = when {
                uris.size == 1 && importedCount == 1 -> "《$importedTitle》已加入书架"
                uris.size == 1 && duplicateCount == 1 -> "《${duplicateTitle.ifBlank { "这本书" }}》已在书架里"
                uris.size == 1 && failedCount == 1 -> failedReason
                failedCount > 0 && importedCount > 0 ->
                    "导入 $importedCount 本，$failedCount 本失败：$failedReason"
                failedCount > 0 -> "导入失败：$failedReason"
                duplicateCount > 0 && importedCount == 0 -> "这些书已经在书架里了"
                else -> "已导入 $importedCount 本"
            }
            _shelf.update {
                it.copy(
                    importing = false,
                    importLabel = "",
                    message = message,
                    highlightId = importedId,
                )
            }
            loadSettingsState()
            reloadLocal()
        }
    }

    private fun importOne(uri: Uri): BookImporter.Outcome {
        val app = getApplication<Application>()
        val name = displayNameOf(uri)
        val bytes = runCatching {
            app.contentResolver.openInputStream(uri)?.use { it.readBytes() }
        }.getOrNull() ?: return BookImporter.Outcome.Failed("读不到这个文件")
        if (bytes.size > BookImporter.INTAKE_LIMIT) {
            return BookImporter.Outcome.Failed("这本超过 30MB，只能放在桌面端阅读")
        }
        return importer.importBytes(name, bytes)
    }

    private fun displayNameOf(uri: Uri): String {
        val app = getApplication<Application>()
        val fromProvider = runCatching {
            app.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
            }
        }.getOrNull()
        return fromProvider?.takeIf { it.isNotBlank() }
            ?: uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() }
            ?: "未命名.txt"
    }

    /* ---------------- 设置 ---------------- */

    fun loadSettingsState() {
        val app = getApplication<Application>()
        _settings.update {
            it.copy(
                serverUrl = settings.serverUrl,
                token = settings.token,
                fontSizeSp = settings.fontSizeSp,
                lineHeight = settings.lineHeight,
                letterSpacingEm = settings.letterSpacingEm,
                paragraphSpacing = settings.paragraphSpacing,
                firstLineIndent = settings.firstLineIndent,
                autoScrollSpeed = settings.autoScrollSpeed,
                keepScreenOn = settings.keepScreenOn,
                fontFamily = settings.fontFamily,
                themePreset = settings.themePreset,
                pagePadding = settings.pagePadding,
                comicDirection = settings.comicDirection,
                accent = settings.accent.toLong() and 0xFFFFFFFFL,
                paper = settings.paper.toLong() and 0xFFFFFFFFL,
                ink = settings.ink.toLong() and 0xFFFFFFFFL,
                autoSync = settings.autoSync,
                autoTransferUnder20MB = settings.autoTransferUnder20MB,
                wifiOnly = settings.wifiOnly,
                hideRemoteWhenOffline = settings.hideRemoteWhenOffline,
                connection = connection.cachedHealth().state,
                connectionDetail = connection.cachedHealth().detail,
                serverVersion = connection.cachedHealth().serverVersion,
                lastSyncAt = syncState.lastSyncAt(),
                conflictCount = _shelf.value.conflictCount,
                localBytes = files.root().walkTopDown().filter { it.isFile }.sumOf { it.length() },
                memoryBytes = cloud.cacheBytes + images.sizeBytes(),
                // 恒 0 自证：直接读 cacheDir 实际占用，而不是写死 0
                cacheBytes = JsonIo.sizeOf(app.cacheDir),
            )
        }
    }

    fun updateServerUrl(value: String) {
        settings.serverUrl = value
        connection.noteConfigChanged()
        // 旧连接还带着旧地址：先断开，测试连接成功后 testConnection 会重新拉起
        connection.channel.stop()
        _settings.update { it.copy(serverUrl = value, connection = connection.cachedHealth().state) }
    }

    fun updateToken(value: String) {
        settings.token = value
        connection.noteConfigChanged()
        connection.channel.stop()
        _settings.update { it.copy(token = value, connection = connection.cachedHealth().state) }
    }

    /* --- 排版：小说 --- */

    fun updateFontSize(value: Float) {
        val size = value.coerceIn(12f, 32f)
        settings.fontSizeSp = size
        _settings.update { it.copy(fontSizeSp = size) }
    }

    fun updateLineHeight(value: Float) {
        settings.lineHeight = value
        _settings.update { it.copy(lineHeight = value) }
    }

    fun updateLetterSpacing(value: Float) {
        settings.letterSpacingEm = value
        _settings.update { it.copy(letterSpacingEm = value) }
    }

    fun updateParagraphSpacing(value: Float) {
        settings.paragraphSpacing = value
        _settings.update { it.copy(paragraphSpacing = value) }
    }

    fun updateFirstLineIndent(value: Boolean) {
        settings.firstLineIndent = value
        _settings.update { it.copy(firstLineIndent = value) }
    }

    fun updateAutoScrollSpeed(value: Int) {
        settings.autoScrollSpeed = value
        _settings.update { it.copy(autoScrollSpeed = value.coerceIn(0, 3)) }
    }

    fun updateKeepScreenOn(value: Boolean) {
        settings.keepScreenOn = value
        _settings.update { it.copy(keepScreenOn = value) }
    }

    fun updateFontFamily(value: String) {
        settings.fontFamily = value
        _settings.update { it.copy(fontFamily = value) }
    }

    fun updateThemePreset(preset: String) {
        val (paper, ink) = colorsOf(preset)
        settings.themePreset = preset
        settings.paper = paper
        settings.ink = ink
        _settings.update {
            it.copy(
                themePreset = preset,
                paper = paper.toLong() and 0xFFFFFFFFL,
                ink = ink.toLong() and 0xFFFFFFFFL,
            )
        }
    }

    fun updatePagePadding(value: Int) {
        settings.pagePadding = value
        _settings.update { it.copy(pagePadding = value) }
    }

    fun updateAccent(value: Int) {
        settings.accent = value
        _settings.update { it.copy(accent = value.toLong() and 0xFFFFFFFFL) }
    }

    /* --- 排版：漫画 --- */

    fun updateComicDirection(value: String) {
        settings.comicDirection = value
        _settings.update { it.copy(comicDirection = value) }
        _comic.update { it.copy(direction = value) }
    }

    /* --- 同步开关 --- */

    fun updateAutoSync(value: Boolean) {
        settings.autoSync = value
        _settings.update { it.copy(autoSync = value) }
    }

    fun updateAutoTransfer(value: Boolean) {
        settings.autoTransferUnder20MB = value
        _settings.update { it.copy(autoTransferUnder20MB = value) }
    }

    fun updateWifiOnly(value: Boolean) {
        settings.wifiOnly = value
        _settings.update { it.copy(wifiOnly = value) }
    }

    fun updateHideRemote(value: Boolean) {
        settings.hideRemoteWhenOffline = value
        _settings.update { it.copy(hideRemoteWhenOffline = value) }
        _shelf.update { it.copy(hideRemoteWhenOffline = value) }
    }

    /** 清掉内存缓存（章节 + 图片 + 封面）。磁盘上本来就没有缓存可清。 */
    fun clearMemoryCache() {
        cloud.clear()
        images.clear()
        _comicPictures.value = emptyMap()
        coverBytes.evictAll()
        _covers.value = emptyMap()
        loadSettingsState()
        _settings.update { it.copy(message = "内存缓存已清空，磁盘缓存本来就是 0") }
    }

    /** 局域网内搜索桌面端：一次性广播 + 5 秒窗口，可取消。 */
    fun discover(onFound: (List<String>) -> Unit) {
        val seq = ++discoverSeq
        _settings.update { it.copy(searching = true, message = null) }
        viewModelScope.launch {
            val found = withContext(Dispatchers.IO) {
                LanDiscovery.discover { seq != discoverSeq }
            }
            if (seq != discoverSeq) return@launch
            val urls = found.map { it.url }
            _settings.update { it.copy(discovered = urls, searching = false) }
            _shelf.update {
                it.copy(message = if (urls.isEmpty()) "没搜到桌面端，确认同一 Wi-Fi" else "找到 ${urls.size} 台桌面端")
            }
            onFound(urls)
        }
    }

    /** 取消正在进行的搜索。 */
    fun cancelDiscover() {
        discoverSeq += 1
        _settings.update { it.copy(searching = false) }
    }

    override fun onCleared() {
        super.onCleared()
        connection.channel.stop()
        images.clear()
        cloud.clear()
    }

    companion object {
        const val KIND_LOCAL = BookKind.LOCAL

        /** 底色预设 → (背景, 文字)。夜间模式也走同一套 Material 主题，不另开分支。 */
        fun colorsOf(preset: String): Pair<Int, Int> = when (preset) {
            SettingsStore.THEME_PAPER -> 0xFFFBF8F1.toInt() to 0xFF23201C.toInt()
            SettingsStore.THEME_CREAM -> 0xFFF1E7D3.toInt() to 0xFF1F1A12.toInt()
            SettingsStore.THEME_GRAPHITE -> 0xFF1C1C1E.toInt() to 0xFFE6E6E1.toInt()
            SettingsStore.THEME_NIGHT -> 0xFF0C0C0E.toInt() to 0xFFC9C9C4.toInt()
            else -> 0xFFF4F4F1.toInt() to 0xFF111111.toInt()
        }
    }
}
