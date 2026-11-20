package com.folio.reader.data

import coil3.ImageLoader
import coil3.decode.DataSource
import coil3.decode.ImageSource
import coil3.fetch.FetchResult
import coil3.fetch.Fetcher
import coil3.fetch.SourceFetchResult
import coil3.request.Options
import com.folio.reader.core.Book
import com.folio.reader.net.FolioClient
import java.io.IOException
import okio.Buffer
import okio.FileSystem

/**
 * 封面键：桌面端按书取封面，本机书沿用自家 id。
 *
 * 用 data class 的 equals/hashCode 当 Coil 的内存缓存键，书一改 id 自然失效。
 */
data class CoverImage(val bookId: String, val remoteId: String) {

    companion object {
        fun of(book: Book): CoverImage = CoverImage(
            bookId = book.id,
            remoteId = book.remoteId ?: book.id,
        )
    }
}

/** 封面走 Coil：解码、采样、内存上限都由 Coil 管，不再手写 LRU。 */
class CoverImageFetcher(private val client: () -> FolioClient) : Fetcher.Factory<CoverImage> {

    override fun create(data: CoverImage, options: Options, imageLoader: ImageLoader): Fetcher =
        Fetcher {
            val bytes = client().fetchCover(data.remoteId) ?: throw IOException("封面是空的")
            if (bytes.isEmpty()) throw IOException("封面是空的")
            SourceFetchResult(
                source = ImageSource(Buffer().write(bytes), FileSystem.SYSTEM),
                mimeType = null,
                dataSource = DataSource.NETWORK,
            )
        }
}
