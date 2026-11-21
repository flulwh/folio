package com.folio.reader.data

import coil3.ImageLoader
import coil3.decode.DataSource
import coil3.decode.ImageSource
import coil3.fetch.FetchResult
import coil3.fetch.Fetcher
import coil3.fetch.SourceFetchResult
import coil3.request.Options
import com.folio.reader.net.FolioClient
import com.folio.reader.net.PageStream
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import okio.FileSystem
import okio.buffer
import okio.source

/**
 * 漫画页的内存键：按「书 + 话 + 页」索引，而不是 URL。
 *
 * 键一旦错了，表现是「翻到第 3 页显示第 2 页」这种最难查的 bug。
 */
data class ComicPage(val bookId: String, val chapter: Int, val page: Int) {

    companion object {
        fun of(bookId: String, chapter: Int, page: Int): ComicPage = ComicPage(
            bookId = bookId.trim(),
            chapter = chapter.coerceAtLeast(0),
            page = page.coerceAtLeast(0),
        )
    }
}

/** 本地 CBZ 的页键：没有「话」的概念，整本就是一个列表。 */
data class LocalComicPage(val bookId: String, val page: Int) {

    companion object {
        fun of(bookId: String, page: Int): LocalComicPage = LocalComicPage(
            bookId = bookId.trim(),
            page = page.coerceAtLeast(0),
        )
    }
}

/** 单页上限：超过 6MiB 的图解码必炸，直接报错比 OOM 好查。 */
const val MAX_COMIC_PAGE_BYTES = 6L * 1024 * 1024

/**
 * 让 Coil 直接吃桌面端的 `/api/comic/.../page`。
 *
 * 采样、并发、请求去重、内存缓存全交给 Coil；这里只负责把字节流接过去。
 */
class ComicImageFetcher(
    private val client: () -> FolioClient,
    private val maxBytes: Long = MAX_COMIC_PAGE_BYTES,
) : Fetcher.Factory<ComicPage> {

    override fun create(data: ComicPage, options: Options, imageLoader: ImageLoader): Fetcher =
        Fetcher {
            val page = client().comicPage(data.bookId, data.chapter, data.page)
            try {
                if (page.length > maxBytes) {
                    throw IOException("这一页超过 ${maxBytes / 1024 / 1024}MiB，无法显示")
                }
                SourceFetchResult(
                    source = ImageSource(
                        source = ClosingInputStream(page).source().buffer(),
                        fileSystem = FileSystem.SYSTEM,
                    ),
                    mimeType = page.mime,
                    dataSource = DataSource.NETWORK,
                )
            } catch (err: Throwable) {
                // 没交出去就自己关：Coil 只在成功拿到结果时才负责关闭 source。
                page.close()
                throw err
            }
        }
}

/**
 * 本地 CBZ 的页源：从 `.cbz` 里解出一页，直接交给 Coil。
 *
 * 每页单独开 ZipFile 再关：打开成本只是一次中央目录扫描，
 * 换来的是不长期占用书库文件的句柄。
 */
class LocalComicImageFetcher(
    private val store: LocalComicStore,
    private val maxBytes: Long = MAX_COMIC_PAGE_BYTES,
) : Fetcher.Factory<LocalComicPage> {

    override fun create(data: LocalComicPage, options: Options, imageLoader: ImageLoader): Fetcher =
        Fetcher {
            val page = store.readPage(data.bookId, data.page)
                ?: throw IOException("这一页不存在或漫画文件还没同步到手机")
            if (page.bytes.size > maxBytes) {
                throw IOException("这一页超过 ${maxBytes / 1024 / 1024}MiB，无法显示")
            }
            SourceFetchResult(
                source = ImageSource(
                    source = ByteArrayInputStream(page.bytes).source().buffer(),
                    fileSystem = FileSystem.SYSTEM,
                ),
                mimeType = page.mime,
                dataSource = DataSource.MEMORY,
            )
        }
}

/** `PageStream.close()` 还要断开连接，只关流会漏 HTTP 连接，所以包一层。 */
private class ClosingInputStream(private val page: PageStream) : InputStream() {

    override fun read(): Int = page.input.read()

    override fun read(b: ByteArray, off: Int, len: Int): Int = page.input.read(b, off, len)

    override fun close() {
        page.close()
    }
}
