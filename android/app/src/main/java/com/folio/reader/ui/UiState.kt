package com.folio.reader.ui

import com.folio.reader.core.Book
import com.folio.reader.core.Chapter
import com.folio.reader.core.Paragraph
import com.folio.reader.core.ProgressEntry
import com.folio.reader.core.TocChapter

/** 书架页状态。 */
data class ShelfUiState(
    val books: List<Book> = emptyList(),
    val progress: Map<String, ProgressEntry> = emptyMap(),
    val offlineIds: Set<String> = emptySet(),
    val cloudOfflineChapters: Map<String, Set<Int>> = emptyMap(),
    val query: String = "",
    val filter: String = FILTER_ALL,
    val online: Boolean = false,
    val syncing: Boolean = false,
    val message: String? = null,
    val lastSyncAt: Long = 0L,
) {
    val visibleBooks: List<Book>
        get() {
            val keyword = query.trim()
            return books.filter { book ->
                val matchKeyword = keyword.isEmpty() ||
                    book.title.contains(keyword, ignoreCase = true) ||
                    (book.author ?: "").contains(keyword, ignoreCase = true)
                val matchFilter = when (filter) {
                    FILTER_LOCAL -> !book.isCloud
                    FILTER_CLOUD -> book.isCloud
                    FILTER_OFFLINE -> offlineIds.contains(book.id)
                    else -> true
                }
                matchKeyword && matchFilter
            }
        }

    companion object {
        const val FILTER_ALL = "all"
        const val FILTER_LOCAL = "local"
        const val FILTER_CLOUD = "cloud"
        const val FILTER_OFFLINE = "offline"
    }
}

/** 阅读页状态。 */
data class ReaderUiState(
    val book: Book? = null,
    val loading: Boolean = false,
    val paragraphs: List<Paragraph> = emptyList(),
    val chapters: List<Chapter> = emptyList(),
    val toc: List<TocChapter> = emptyList(),
    val chapterIndex: Int = 0,
    val chapterTitle: String = "",
    val paraIndex: Int = 0,
    val percent: Double = 0.0,
    val offline: Boolean = false,
    val error: String? = null,
    val showToc: Boolean = false,
    val dirty: Boolean = false,
) {
    val isCloud: Boolean get() = book?.isCloud == true
    val totalParagraphs: Int get() = paragraphs.size
}

/** 设置页状态。 */
data class SettingsUiState(
    val serverUrl: String = "",
    val token: String = "",
    val fontScale: Float = 1f,
    val lineHeight: Float = 1.8f,
    val pagePadding: Int = 24,
    val accent: Long = 0xFF1F6FEB,
    val paper: Long = 0xFFFBF8F1,
    val ink: Long = 0xFF23201C,
    val autoSync: Boolean = true,
    val autoCache: Boolean = false,
    val cacheSize: Long = 0L,
    val discovered: List<String> = emptyList(),
    val message: String? = null,
)
