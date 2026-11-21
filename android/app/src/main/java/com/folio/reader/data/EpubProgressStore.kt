package com.folio.reader.data

import com.folio.reader.core.JsonIo
import java.io.File
import org.json.JSONObject
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.util.Url
import org.readium.r2.shared.util.mediatype.MediaType

/**
 * EPUB 阅读位置：`filesDir/library/epub-progress.json`。
 *
 * 这份文件只存本机：`href` 是 Readium 的定位信息，桌面端用不上。
 * 与桌面端对齐的是全书百分比——每次落盘位置时，`SessionStore` 会另写一条
 * `ProgressEntry.percent` 进 `progress.json`，跟着进度同步走。
 *
 * 只存 Readium 定位必需的三样：`href`（章节资源路径）、标题、
 * `progression` / `totalProgression`（章内 / 全书百分比）。
 */
class EpubProgressStore(private val dir: File) {

    data class Saved(
        val href: String,
        val title: String? = null,
        val progression: Double? = null,
        val totalProgression: Double? = null,
        val updatedAt: Long = 0L,
    ) {

        /** 还原成 Readium 的 [Locator]；存储损坏时返回 null（从头读）。 */
        fun toLocator(): Locator? {
            val url = runCatching { Url(href) }.getOrNull() ?: return null
            return Locator(
                href = url,
                mediaType = MediaType.XHTML,
                title = title,
                locations = Locator.Locations(
                    progression = progression,
                    totalProgression = totalProgression,
                ),
            )
        }
    }

    private val file: File get() = File(dir, FILE_NAME)

    @Synchronized
    fun load(bookId: String): Saved? = readAll()[bookId]

    /** 存一次位置；失败只影响「下次从哪继续」，不打断阅读。 */
    @Synchronized
    fun save(bookId: String, locator: Locator) {
        val href = locator.href.toString()
        if (href.isBlank()) return
        val all = readAll().toMutableMap()
        all[bookId] = Saved(
            href = href,
            title = locator.title,
            progression = locator.locations.progression,
            totalProgression = locator.locations.totalProgression,
            updatedAt = System.currentTimeMillis(),
        )
        val json = JSONObject()
        all.forEach { (id, saved) ->
            json.put(id, JSONObject().apply {
                put("href", saved.href)
                saved.title?.let { put("title", it) }
                saved.progression?.let { put("progression", it) }
                saved.totalProgression?.let { put("totalProgression", it) }
                put("updatedAt", saved.updatedAt)
            })
        }
        JsonIo.write(file, json)
    }

    private fun readAll(): Map<String, Saved> {
        val json = JsonIo.readObject(file) ?: return emptyMap()
        val out = LinkedHashMap<String, Saved>()
        val keys = json.keys()
        while (keys.hasNext()) {
            val id = keys.next()
            val item = json.optJSONObject(id) ?: continue
            val href = item.optString("href").takeIf { it.isNotBlank() } ?: continue
            out[id] = Saved(
                href = href,
                title = item.optString("title").takeIf { it.isNotBlank() && it != "null" },
                progression = item.optDouble("progression").takeIf { !it.isNaN() },
                totalProgression = item.optDouble("totalProgression").takeIf { !it.isNaN() },
                updatedAt = item.optLong("updatedAt", 0L),
            )
        }
        return out
    }

    private companion object {
        const val FILE_NAME = "epub-progress.json"
    }
}
