package com.folio.reader.data

import com.folio.reader.core.ChapterMemoryCache
import com.folio.reader.core.TocChapter
import com.folio.reader.net.FolioClient
import com.folio.reader.net.FolioException

/**
 * 云端小说按章读取：**只进内存，绝不落盘**。
 *
 * 3.0 把「离线缓存」整个下线了（架构文档 §1.5）。云端书的正文每次都在需要时
 * 从桌面端取，取回来的最近 3 章留在 [ChapterMemoryCache] 里，
 * 让「上一章/下一章」来回翻不必重复走网络。
 *
 * 断网时的文案是固定的 `连接已断开 · 重试`（架构文档 §8）：
 * 用户看到的应该是「网络断了」，而不是「HTTP 0」。
 *
 * 为了让这一层能在纯 JVM 单测里跑（不需要真的起 HTTP 服务），
 * 取数据的动作以**函数**注入，而不是直接依赖 [FolioClient]。
 */
class CloudChapterSource(
    /** 取一章正文。 */
    private val fetchChapter: (bookId: String, index: Int) -> String,
    /** 取目录，返回 (章节列表, 书源名)。 */
    private val fetchToc: (bookId: String) -> Pair<List<TocChapter>, String>,
    private val cache: ChapterMemoryCache = ChapterMemoryCache(),
) {

    /** 便捷构造：真的走局域网。 */
    constructor(
        clientProvider: () -> FolioClient,
        cache: ChapterMemoryCache = ChapterMemoryCache(),
    ) : this(
        fetchChapter = { id, index -> clientProvider().fetchChapter(id, index) },
        fetchToc = { id -> clientProvider().fetchToc(id) },
        cache = cache,
    )

    /** 一章正文 + 它是不是从内存缓存来的（UI 用来打「来自缓存」的角标）。 */
    data class Loaded(val text: String, val fromCache: Boolean)

    /** 目录 + 书源名。 */
    data class Toc(val chapters: List<TocChapter>, val sourceName: String)

    /**
     * 取目录。
     *
     * @throws FolioException 断网 → `连接已断开 · 重试`；桌面端说抓不到 → 它的原话
     */
    fun toc(bookId: String): Toc {
        val (chapters, sourceName) = try {
            fetchToc(bookId)
        } catch (err: Exception) {
            throw translate(err)
        }
        return Toc(chapters, sourceName)
    }

    /**
     * 取某一章。
     *
     * @param index 真实章号（目录里的 `i`，不是列表下标）
     * @throws FolioException 断网 → `连接已断开 · 重试`
     */
    fun chapter(bookId: String, index: Int): Loaded {
        cache.get(bookId, index)?.let { return Loaded(it, fromCache = true) }
        val text = try {
            fetchChapter(bookId, index)
        } catch (err: Exception) {
            throw translate(err)
        }
        if (text.isBlank()) throw FolioException("这一章没有正文，换一章试试", 502)
        cache.put(bookId, index, text)
        return Loaded(text, fromCache = false)
    }

    /**
     * 预取紧邻的几章（当前章的下一章最常见）。
     *
     * 失败一律吞掉：预取只是「顺手变快」，不该让当前这一章报错。
     */
    fun prefetch(bookId: String, indexes: List<Int>) {
        for (index in indexes) {
            if (index < 0) continue
            if (cache.has(bookId, index)) continue
            runCatching { chapter(bookId, index) }
        }
    }

    /** 某一本已缓存的章号（目录里给已缓存的章节打标记用）。 */
    fun cachedIndexes(bookId: String): Set<Int> = cache.keys(bookId).toSet()

    /** 缓存里当前有几章（设置页/诊断用）。 */
    val cacheSize: Int get() = cache.size()

    /** 缓存占用估算（字节）。 */
    val cacheBytes: Long get() = cache.bytes()

    /** 清空全部内存缓存（离开阅读器、切书）。 */
    fun clear() {
        cache.clear()
    }

    /** 清掉某一本（删书）。 */
    fun clear(bookId: String) {
        cache.clear(bookId)
    }

    /* ---------------- 内部 ---------------- */

    /** 把任何失败翻译成给人看的那一句。 */
    private fun translate(err: Exception): FolioException {
        if (err is FolioException) {
            return if (err.network) FolioException("连接已断开 · 重试", 0, err) else err
        }
        return FolioException("连接已断开 · 重试", 0, err)
    }
}
