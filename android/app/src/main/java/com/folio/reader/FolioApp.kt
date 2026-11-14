package com.folio.reader

import android.app.Application
import android.content.ComponentCallbacks2
import android.util.Log
import com.folio.reader.core.BookImporter
import com.folio.reader.core.ChapterMemoryCache
import com.folio.reader.core.ImageLoader
import com.folio.reader.data.BookFileStore
import com.folio.reader.data.BookStore
import com.folio.reader.data.CloudChapterSource
import com.folio.reader.data.ConnectionManager
import com.folio.reader.data.Migration
import com.folio.reader.data.ProgressStore
import com.folio.reader.data.ProgressSync
import com.folio.reader.data.SettingsStore
import com.folio.reader.data.SyncEngine
import com.folio.reader.data.SyncStateStore
import java.io.File

/**
 * 依赖容器。手写单例比引入 DI 框架更省电也更省包体。
 *
 * 3.0 的容器把 2.5 那套（LibraryStore / OfflineStore / SyncManager）全换掉了：
 *  - 四份本地数据各有一个薄 Store（书架 / 进度 / 同步状态 / 正文文件），
 *    按写入频率拆开，翻页不会重写整个书架；
 *  - [ConnectionManager] 独占「连接状态」这一件事，错误文案只有一处定义；
 *  - [SyncEngine] 只搬书，[ProgressSync] 只同步进度，失败原因互不干扰；
 *  - 三处缓存**全是内存对象**（章节 3 章、图片按字节 LRU、封面小 LRU），
 *    没有任何一个持有 `cacheDir`，这是「缓存占用恒 0」的结构保证。
 */
class AppContainer(app: Application) {

    val settings = SettingsStore(app)

    /** `filesDir/library`：四份 json 都放这里（架构文档 §3.2）。 */
    private val libraryDir: File = File(app.filesDir, "library").apply {
        if (!isDirectory) mkdirs()
    }

    val books = BookStore(libraryDir)
    val progress = ProgressStore(libraryDir)
    val syncState = SyncStateStore(libraryDir)
    val files = BookFileStore(app.filesDir)
    val importer = BookImporter(books, files)

    /** 云端小说 3 章内存缓存。 */
    val chapters = ChapterMemoryCache()

    val connection = ConnectionManager(settings)

    val cloud = CloudChapterSource(
        clientProvider = { connection.client() },
        cache = chapters,
    )

    val progressSync = ProgressSync(progress, books) { connection.client() }

    val sync = SyncEngine(books, progress, syncState, files) { connection.client() }

    /** 漫画页：按 `(书, 话, 页)` 取图，全内存。 */
    val images = ImageLoader(
        openPage = { key -> connection.client().comicPage(key.bookId, key.chapter, key.page) },
        screenWidthPx = { app.resources.displayMetrics.widthPixels },
    )

    val migration = Migration(app.filesDir)
}

class FolioApp : Application() {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)

        // 2.5 → 3.0 的一次性迁移：旧 books.json 转数组、清掉 offline/
        val report = container.migration.run()
        Log.i(
            TAG,
            "已清理旧缓存 ${report.cleanedBytes} 字节（${report.cleanedFiles} 个文件）；" +
                "迁移书架 ${report.booksMigrated} 本；" +
                "书架现有 ${container.books.read().size} 本；" +
                "进度 ${report.progressEntries} 条",
        )
        // 3.0 没有后台任务：只在「连接成功 / 回前台 / 手动点按」时同步。
    }

    /** 内存压力：图片与章节缓存跟着让路，绝不去动磁盘（本来也没有磁盘缓存）。 */
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        container.images.onTrimMemory(level)
        if (level >= ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) {
            container.chapters.clear()
        }
    }

    companion object {
        private const val TAG = "FolioApp"
    }
}
