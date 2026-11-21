package com.folio.reader.data

import com.folio.reader.core.CbzArchive
import com.folio.reader.core.CbzPage

/**
 * 本地 CBZ 漫画的按页读取入口。
 *
 * 文件缺失时返回 null（而不是抛异常）：书架上可能还留着桌面端同步来的元数据，
 * 但整包还没下到手机，UI 需要把「还没同步」和「压缩包坏了」分开提示。
 */
class LocalComicStore(private val files: BookFileStore) {

    fun pageCount(bookId: String): Int? {
        val file = files.cbzFileFor(bookId)
        if (!file.isFile) return null
        return CbzArchive.pageCount(file)
    }

    fun readPage(bookId: String, page: Int): CbzPage? =
        CbzArchive.readPage(files.cbzFileFor(bookId), page)
}
