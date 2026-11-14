package com.folio.reader.data

import android.util.Log
import com.folio.reader.core.JsonIo
import com.folio.reader.core.LocalBook
import com.folio.reader.core.Origin
import java.io.File

/**
 * 2.5 → 3.0 的一次性数据迁移。
 *
 * 做三件事，全部幂等，重复跑没有副作用：
 *  1. `library/books.json` 从 2.5 的 `{"books":[...]}` 迁到 3.0 的「顶层数组」，
 *     并把老字段（`kind`）映射成新模型（`remoteKind` + `origin=desktop`）。
 *     老版本的书都是 `/api/state` 同步过来的，所以 origin 一律 DESKTOP。
 *  2. `library/progress.json` 格式本来就是 `{id: {...}}`，字段名一个没动，
 *     只需要能读出来 —— 这里读一遍确认条目数，不做任何改写（改写会丢字段）。
 *  3. 删掉整个 `offline/`：3.0 不做离线缓存，云端章节只在内存里留 3 章。
 *
 * 迁移失败不让应用起不来：所有异常都吞掉并记日志，最坏结果是书架空一次，
 * 下次连上桌面端会自动重新对齐。
 */
class Migration(
    /** App 私有根目录（`context.filesDir`）。 */
    private val filesDir: File,
) {

    /** 迁移结果，给启动日志和自查脚本用。 */
    data class Report(
        val booksMigrated: Int = 0,
        val progressEntries: Int = 0,
        val cleanedBytes: Long = 0L,
        val cleanedFiles: Int = 0,
        val alreadyMigrated: Boolean = false,
    ) {
        val cleanedLabel: String
            get() = if (cleanedBytes <= 0L) "0 字节" else String.format("%.1f MB", cleanedBytes / 1024.0 / 1024.0)
    }

    private val library: File get() = File(filesDir, "library")
    private val booksFile: File get() = File(library, BookStore.FILE_NAME)
    private val progressFile: File get() = File(library, ProgressStore.FILE_PROGRESS)
    private val offlineDir: File get() = File(filesDir, "offline")

    /**
     * 跑一次迁移。
     *
     * @return 迁移报告（首次迁完 `cleanedBytes` 会是从 `offline/` 释放出来的量）
     */
    fun run(): Report {
        val booksMigrated = migrateBooks()
        val progressEntries = countProgress()
        val (cleanedBytes, cleanedFiles) = purgeOffline()
        return Report(
            booksMigrated = booksMigrated,
            progressEntries = progressEntries,
            cleanedBytes = cleanedBytes,
            cleanedFiles = cleanedFiles,
            alreadyMigrated = booksMigrated == 0 && cleanedFiles == 0,
        )
    }

    /** 把老格式的 books.json 换成新格式；已经是新格式返回 0。 */
    private fun migrateBooks(): Int {
        if (!booksFile.isFile) return 0
        // 已经是顶层数组：新格式，什么都不用做
        if (JsonIo.readArray(booksFile) != null) return 0
        val legacy = JsonIo.readObject(booksFile) ?: return 0
        val array = legacy.optJSONArray("books") ?: return 0

        val books = ArrayList<LocalBook>(array.length())
        for (i in 0 until array.length()) {
            val item = array.optJSONObject(i) ?: continue
            val book = LocalBook.fromJson(item, Origin.DESKTOP) ?: continue
            // 老版本把桌面端书架整份抄下来，这些书在手机上都没有正文
            books.add(book.copy(origin = Origin.DESKTOP, remoteId = book.remoteId ?: book.id))
        }
        if (!JsonIo.write(booksFile, BookStore.arrayOf(books))) {
            Log.w(TAG, "迁移 books.json 失败，保持原样")
            return 0
        }
        Log.i(TAG, "已迁移书架到 3.0 格式：${books.size} 本")
        return books.size
    }

    private fun countProgress(): Int {
        if (!progressFile.isFile) return 0
        return JsonIo.readObject(progressFile)?.length() ?: 0
    }

    /**
     * 删掉 2.5 的离线缓存目录，返回 (释放字节数, 删除文件数)。
     * 目录不存在就是已完成迁移。
     */
    private fun purgeOffline(): Pair<Long, Int> {
        if (!offlineDir.exists()) return 0L to 0
        val bytes = JsonIo.sizeOf(offlineDir)
        val files = JsonIo.countOf(offlineDir)
        val ok = runCatching { offlineDir.deleteRecursively() }.getOrDefault(false)
        if (!ok) {
            Log.w(TAG, "删除 offline/ 失败，下次启动再试")
            return 0L to 0
        }
        Log.i(TAG, "已清理旧缓存 $bytes 字节（$files 个文件）")
        return bytes to files
    }

    companion object {
        private const val TAG = "FolioMigration"
    }
}
