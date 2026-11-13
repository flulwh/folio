package com.folio.reader.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.compose.ui.graphics.asImageBitmap
import com.folio.reader.FolioApp
import com.folio.reader.core.Book
import com.folio.reader.core.BookKind
import com.folio.reader.core.ProgressEntry
import com.folio.reader.core.TextParser
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * 全局状态。
 *
 * 进度保存分两层：本地立刻记在内存里，0.6 秒防抖落盘；
 * 网络回写节流 1.5 秒，连不上就记进 pending，联网后补写。
 */
class AppViewModel(app: Application) : AndroidViewModel(app) {

    private val container = (app as FolioApp).container
    private val settings = container.settings
    private val library = container.library
    private val offline = container.offline
    private val sync = container.sync

    private val _shelf = MutableStateFlow(ShelfUiState())
    val shelf: StateFlow<ShelfUiState> = _shelf.asStateFlow()

    private val _reader = MutableStateFlow(ReaderUiState())
    val reader: StateFlow<ReaderUiState> = _reader.asStateFlow()

    private val _settings = MutableStateFlow(SettingsUiState())
    val settingsState: StateFlow<SettingsUiState> = _settings.asStateFlow()

    /** 目录跳章用的目标段落，由列表状态消费后清空。 */
    private val _scrollTarget = MutableStateFlow(-1)
    val scrollTarget: StateFlow<Int> = _scrollTarget.asStateFlow()

    /** 封面缓存：字节用 LruCache，位图用 StateFlow 驱动重组。 */
    private val coverBytes = android.util.LruCache<String, ByteArray>(24)
    private val _covers = MutableStateFlow<Map<String, androidx.compose.ui.graphics.ImageBitmap>>(emptyMap())
    val covers: StateFlow<Map<String, androidx.compose.ui.graphics.ImageBitmap>> = _covers.asStateFlow()

    fun loadCover(book: Book) {
        if (_covers.value.containsKey(book.id)) return
        viewModelScope.launch {
            val bytes = coverBytes.get(book.id) ?: runCatching {
                sync.client().fetchCover(book.id)
            }.getOrNull()
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

    fun scrollToParagraph(paraIndex: Int) {
        _scrollTarget.value = paraIndex
    }

    fun clearScrollTarget() {
        _scrollTarget.value = -1
    }

    fun setFilter(filter: String) {
        _shelf.update { it.copy(filter = filter) }
    }

    private var progressMap: MutableMap<String, ProgressEntry> = mutableMapOf()
    private var pending: MutableSet<String> = mutableSetOf()
    private var persistJob: Job? = null
    private var pushJob: Job? = null

    init {
        reloadLocal()
        loadSettingsState()
        // 打开 App 先同步一次，书架不用等用户手动点。
        if (settings.hasServer && settings.autoSync) {
            syncNow(silent = true)
        }
    }

    /* ---------------- 本地数据 ---------------- */

    fun reloadLocal() {
        progressMap = library.readProgress()
        pending = library.readPending()
        val books = library.readBooks()
        _shelf.update {
            it.copy(
                books = books,
                progress = progressMap.toMap(),
                offlineIds = computeOfflineIds(books),
                cloudOfflineChapters = computeCloudCache(books),
            )
        }
    }

    private fun computeOfflineIds(books: List<Book>): Set<String> {
        val ids = mutableSetOf<String>()
        for (book in books) {
            if (book.isCloud) {
                if (offline.cachedCloudChapters(book.id).isNotEmpty()) ids.add(book.id)
            } else if (offline.hasLocalBook(book.id)) {
                ids.add(book.id)
            }
        }
        return ids
    }

    private fun computeCloudCache(books: List<Book>): Map<String, Set<Int>> {
        val map = HashMap<String, Set<Int>>()
        for (book in books) {
            if (!book.isCloud) continue
            val cached = offline.cachedCloudChapters(book.id)
            if (cached.isNotEmpty()) map[book.id] = cached
        }
        return map
    }

    /* ---------------- 同步 ---------------- */

    fun syncNow(silent: Boolean = false) {
        if (_shelf.value.syncing) return
        _shelf.update { it.copy(syncing = true) }
        viewModelScope.launch {
            val outcome = sync.sync()
            _shelf.update {
                it.copy(
                    syncing = false,
                    online = outcome.ok,
                    message = if (silent && outcome.ok) null else outcome.message,
                    lastSyncAt = settings.lastSyncAt,
                )
            }
            reloadLocal()
        }
    }

    fun dismissMessage() {
        _shelf.update { it.copy(message = null) }
    }

    /* ---------------- 阅读 ---------------- */

    fun openBook(book: Book) {
        _reader.value = ReaderUiState(book = book, loading = true)
        viewModelScope.launch {
            if (book.isCloud) {
                val (toc, offlineOnly) = sync.loadToc(book)
                if (toc.isEmpty()) {
                    _reader.value = ReaderUiState(
                        book = book,
                        error = if (offlineOnly) "离线状态下没有这本书的缓存章节" else "拿不到目录，确认桌面端已打开",
                    )
                    return@launch
                }
                val entry = progressMap[book.id]
                // toc 里的 index 是真实章号；离线兜底时列表还可能是稀疏的，
                // 所以按章号找下标，而不是直接拿章号当位置。
                val target = entry?.chapter ?: toc.first().index
                val startIndex = toc.indexOfFirst { it.index == target }.coerceAtLeast(0)
                _reader.update { it.copy(toc = toc) }
                loadChapter(book, startIndex, entry)
            } else {
                val (text, fromCache) = sync.loadLocalText(book)
                if (text == null) {
                    _reader.value = ReaderUiState(
                        book = book,
                        error = "这本书还没下到手机，连上桌面端再打开一次",
                    )
                    return@launch
                }
                val parsed = TextParser.parseBook(text)
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
                    offline = fromCache,
                )
                recordProgress(book, buildEntry(book, index, chapterIndex, parsed.chapters))
            }
        }
    }

    /**
     * 载入云端书的某一章。[index] 是目录列表里的位置。
     *
     * 离线时如果这一章没缓存，退到离它最近的已缓存章节，而不是直接报错 ——
     * 用户断网后想看的往往是之前读过的部分。
     */
    private suspend fun loadChapter(
        book: Book,
        index: Int,
        entry: ProgressEntry?,
        allowFallback: Boolean = true,
    ) {
        val current = _reader.value
        val toc = if (current.toc.isEmpty()) sync.loadToc(book).first else current.toc
        if (toc.isEmpty()) {
            _reader.update { it.copy(loading = false, error = "拿不到目录，确认桌面端已打开") }
            return
        }
        val position = index.coerceIn(0, toc.size - 1)
        val chapterNo = toc[position].index
        val (text, fromCache) = sync.loadCloudChapter(book, chapterNo)
        if (text == null) {
            if (allowFallback) {
                val cached = offline.cachedCloudChapters(book.id)
                if (com.folio.reader.core.ChapterFallback.shouldFallback(cached, chapterNo)) {
                    val nearest = com.folio.reader.core.ChapterFallback.nearest(cached, chapterNo)
                    val fallbackIndex = if (nearest != null) toc.indexOfFirst { it.index == nearest } else -1
                    if (fallbackIndex >= 0) {
                        loadChapter(book, fallbackIndex, null, allowFallback = false)
                        _reader.update { it.copy(offline = true, error = null) }
                        return
                    }
                }
            }
            _reader.update {
                it.copy(loading = false, error = "这一章还没缓存，连上桌面端再读")
            }
            return
        }
        val parsed = TextParser.parseBook(text)
        val resume = if (entry != null && entry.chapter == chapterNo) (entry.paraIndex ?: 0) else 0
        val paraIndex = resume.coerceIn(0, (parsed.paragraphs.size - 1).coerceAtLeast(0))
        _reader.value = ReaderUiState(
            book = book,
            paragraphs = parsed.paragraphs,
            chapters = parsed.chapters,
            toc = toc,
            chapterIndex = position,
            chapterTitle = toc[position].title,
            paraIndex = paraIndex,
            percent = percentOf(paraIndex, parsed.paragraphs.size, position, toc.size),
            offline = fromCache,
        )
        recordProgress(book, buildEntry(book, paraIndex, position, parsed.chapters, chapterNo))
    }

    fun switchChapter(index: Int) {
        val state = _reader.value
        val book = state.book ?: return
        if (index == state.chapterIndex && state.paragraphs.isNotEmpty()) return
        if (index < 0 || (state.toc.isNotEmpty() && index >= state.toc.size)) return
        _reader.update { it.copy(loading = true, error = null, showToc = false) }
        viewModelScope.launch {
            loadChapter(book, index, progressMap[book.id])
        }
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
                    loadChapter(book, chapter, null)
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
        _reader.update { it.copy(showToc = !it.showToc) }
    }

    fun closeReader() {
        flush()
        _reader.value = ReaderUiState()
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

    /* ---------------- 进度落盘与回写 ---------------- */

    private fun recordProgress(book: Book, entry: ProgressEntry) {
        progressMap[book.id] = entry
        _shelf.update { it.copy(progress = progressMap.toMap()) }
        persistJob?.cancel()
        persistJob = viewModelScope.launch {
            delay(600)
            library.writeProgress(progressMap)
        }
        pushJob?.cancel()
        pushJob = viewModelScope.launch {
            delay(1500)
            val ok = sync.pushProgress(book, entry)
            if (ok) {
                pending.remove(book.id)
                library.writePending(pending)
                _shelf.update { it.copy(online = true) }
            } else {
                pending.add(book.id)
                library.writePending(pending)
                _shelf.update {
                    it.copy(
                        online = false,
                        message = "进度先存在手机里，连上桌面端会自动补同步",
                    )
                }
            }
        }
    }

    /** 立刻把进度写盘并尝试回写。 */
    fun flush() {
        persistJob?.cancel()
        library.writeProgress(progressMap)
        val dirty = pending.toList()
        if (dirty.isEmpty()) return
        viewModelScope.launch {
            var ok = true
            for (id in dirty) {
                val book = _shelf.value.books.find { it.id == id } ?: continue
                val entry = progressMap[id] ?: continue
                if (!sync.pushProgress(book, entry)) {
                    ok = false
                    continue
                }
                pending.remove(id)
            }
            library.writePending(pending)
            if (ok) _shelf.update { it.copy(online = true, message = "进度已同步到桌面端") }
        }
    }

    /* ---------------- 设置 ---------------- */

    fun loadSettingsState() {
        _settings.value = SettingsUiState(
            serverUrl = settings.serverUrl,
            token = settings.token,
            fontScale = settings.fontScale,
            lineHeight = settings.lineHeight,
            pagePadding = settings.pagePadding,
            accent = settings.accent.toLong() and 0xFFFFFFFFL,
            paper = settings.paper.toLong() and 0xFFFFFFFFL,
            ink = settings.ink.toLong() and 0xFFFFFFFFL,
            autoSync = settings.autoSync,
            autoCache = settings.autoCache,
            cacheSize = offline.cacheSize(),
        )
    }

    fun updateServerUrl(value: String) {
        settings.serverUrl = value
        _settings.update { it.copy(serverUrl = value) }
    }

    fun updateToken(value: String) {
        settings.token = value
        _settings.update { it.copy(token = value) }
    }

    fun updateFontScale(value: Float) {
        settings.fontScale = value
        _settings.update { it.copy(fontScale = value) }
    }

    fun updateLineHeight(value: Float) {
        settings.lineHeight = value
        _settings.update { it.copy(lineHeight = value) }
    }

    fun updatePagePadding(value: Int) {
        settings.pagePadding = value
        _settings.update { it.copy(pagePadding = value) }
    }

    fun updateAccent(value: Int) {
        settings.accent = value
        _settings.update { it.copy(accent = value.toLong() and 0xFFFFFFFFL) }
    }

    fun updatePaper(value: Int) {
        settings.paper = value
        _settings.update { it.copy(paper = value.toLong() and 0xFFFFFFFFL) }
    }

    fun updateInk(value: Int) {
        settings.ink = value
        _settings.update { it.copy(ink = value.toLong() and 0xFFFFFFFFL) }
    }

    fun updateAutoSync(value: Boolean) {
        settings.autoSync = value
        _settings.update { it.copy(autoSync = value) }
        if (value) {
            com.folio.reader.work.SyncWorker.schedule(getApplication())
        } else {
            com.folio.reader.work.SyncWorker.cancel(getApplication())
        }
    }

    fun updateAutoCache(value: Boolean) {
        settings.autoCache = value
        _settings.update { it.copy(autoCache = value) }
    }

    /** 把一本书拉到本地，之后断网也能读。 */
    fun downloadOffline(book: Book) {
        viewModelScope.launch {
            _shelf.update { it.copy(message = "正在下载《${book.title}》…") }
            val cached = sync.downloadForOffline(book)
            _shelf.update {
                it.copy(
                    message = when {
                        cached < 0 -> "下载失败，确认桌面端已打开"
                        book.isCloud -> "《${book.title}》已缓存前 $cached 章，其余章节联网时自动缓存"
                        else -> "《${book.title}》已下到手机，断网也能读"
                    },
                    offlineIds = computeOfflineIds(it.books),
                    cloudOfflineChapters = computeCloudCache(it.books),
                )
            }
        }
    }

    fun clearCache() {
        sync.clearCache()
        loadSettingsState()
        _shelf.update {
            it.copy(
                offlineIds = computeOfflineIds(it.books),
                cloudOfflineChapters = computeCloudCache(it.books),
                message = "离线缓存已清空",
            )
        }
    }

    /** 局域网内搜索桌面端。 */
    fun discover(onFound: (List<String>) -> Unit) {
        viewModelScope.launch {
            val found = com.folio.reader.net.LanDiscovery.discover(1500)
            _settings.update { it.copy(discovered = found) }
            onFound(found)
        }
    }

    /** 测试能不能连上桌面端。 */
    fun testConnection() {
        viewModelScope.launch {
            if (!settings.hasServer) {
                _shelf.update { it.copy(message = "先填地址和访问码") }
                return@launch
            }
            val ok = sync.client().ping()
            _shelf.update {
                it.copy(
                    online = ok,
                    message = if (ok) "连上了桌面端" else "连不上，检查地址、端口和访问码",
                )
            }
        }
    }

    companion object {
        const val KIND_LOCAL = BookKind.LOCAL
    }
}
