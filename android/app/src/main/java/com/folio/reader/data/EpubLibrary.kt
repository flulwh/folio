package com.folio.reader.data

import android.app.Application
import com.folio.reader.core.LocalBook
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.readium.r2.shared.publication.Publication
import org.readium.r2.shared.util.asset.AssetRetriever
import org.readium.r2.shared.util.http.DefaultHttpClient
import org.readium.r2.streamer.PublicationOpener
import org.readium.r2.streamer.parser.DefaultPublicationParser

/**
 * EPUB 的打开与释放。
 *
 * 解析、解压、目录、排版全交给 Readium（`readium-streamer`），本类只做三件事：
 * 找到落盘的原始 zip → 打开成 [Publication] → 页面离开时关掉。
 *
 * 一本 `Publication` 会占住文件句柄和已解析的资源，所以按书 id 只留一份，
 * 同一时间只允许一本在阅读页（导航栈上只有一个 EPUB 页）。
 */
class EpubLibrary(
    private val app: Application,
    private val files: BookFileStore,
) {

    private val http = DefaultHttpClient()
    private val assets = AssetRetriever(app.contentResolver, http)
    private val opener = PublicationOpener(
        DefaultPublicationParser(
            context = app,
            httpClient = http,
            assetRetriever = assets,
            // 只支持 EPUB：没有 PDF 依赖，传 null 即可
            pdfFactory = null,
        ),
    )

    private val opened = mutableMapOf<String, Publication>()

    /** 打开一本 EPUB；重复打开返回同一份。IO 线程执行。 */
    suspend fun open(book: LocalBook): Result<Publication> = withContext(Dispatchers.IO) {
        opened[book.id]?.let { return@withContext Result.success(it) }

        val file = files.epubFileFor(book.id)
        if (!file.isFile) {
            return@withContext Result.failure(IOException("EPUB 文件不见了，请重新导入"))
        }

        val retrieved = assets.retrieve(file)
        if (retrieved.isFailure) {
            return@withContext Result.failure(
                IOException(retrieved.failureOrNull()?.message ?: "读不到这本书")
            )
        }
        val asset = retrieved.getOrNull()
            ?: return@withContext Result.failure(IOException("读不到这本书"))

        val result = opener.open(asset, allowUserInteraction = false)
        if (result.isFailure) {
            return@withContext Result.failure(
                IOException(result.failureOrNull()?.message ?: "这本 EPUB 打不开")
            )
        }
        val publication = result.getOrNull()
            ?: return@withContext Result.failure(IOException("这本 EPUB 打不开"))
        opened[book.id] = publication
        Result.success(publication)
    }

    fun publicationOf(bookId: String): Publication? = opened[bookId]

    fun close(bookId: String) {
        runCatching { opened.remove(bookId)?.close() }
    }
}
