package com.folio.reader.net

import com.folio.reader.core.HashUtils
import com.folio.reader.core.LocalBook
import com.folio.reader.core.Origin
import com.folio.reader.core.ProgressEntry
import com.folio.reader.core.ServerState
import com.folio.reader.core.TocChapter
import org.json.JSONObject
import java.io.Closeable
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.util.zip.GZIPInputStream

/** 与桌面端通信失败时抛出，消息直接给人看。 */
class FolioException(
    message: String,
    /** HTTP 状态码；0 表示没拿到响应（网络层失败）。 */
    val status: Int = 0,
    cause: Throwable? = null,
) : Exception(message, cause) {
    /** 访问码不对（401）：这一类要单独引导用户去改访问码。 */
    val unauthorized: Boolean get() = status == 401

    /** 连不上/超时/地址不对，都属于「网络层」。 */
    val network: Boolean get() = status == 0
}

/** 上传分块时 offset 与服务端已收字节数不连续（409）。 */
class UploadConflictException(message: String, val received: Long) : Exception(message)

/** `/api/ping` 的能力位。 */
data class Capabilities(
    val serverVersion: String,
    val port: Int,
    val apiVersion: Int,
    val features: Set<String>,
    val limits: Limits?,
) {
    val supportsLibrary: Boolean get() = apiVersion >= 2 && features.contains("library")
    val supportsUpload: Boolean get() = apiVersion >= 2 && features.contains("upload")
    val supportsRange: Boolean get() = apiVersion >= 2 && features.contains("range")
    val supportsComic: Boolean get() = apiVersion >= 2 && features.contains("comic")

    /** 设备管理（T07）：桌面端能收心跳、发指令、收回执。 */
    val supportsDevices: Boolean get() = apiVersion >= 2 && features.contains("devices")

    companion object {
        /** 桌面端 2.6.0 起才是 apiVersion 2；小于它的要提示升级。 */
        const val REQUIRED_API_VERSION = 2
    }
}

/** 服务端声明的上限，避免客户端硬编码。 */
data class Limits(
    val transfer: Long = 30L * 1024 * 1024,
    val chunk: Long = 4L * 1024 * 1024,
    val chunkBody: Long = 6L * 1024 * 1024,
    val image: Long = 6L * 1024 * 1024,
)

/**
 * 设备身份（T07）：随每个请求发出去的五个头。
 *
 * 桌面端「设备管理」靠 [installId] 认设备、靠 [name] 给人认，[appVersion] / [apiVersion]
 * 决定它敢不敢给这台手机下发某些指令。**没有 installId 就一个头都不发** ——
 * 老桌面端不认识这些头，多发没有好处，还会让抓包看起来像新客户端。
 */
data class DeviceIdentity(
    val installId: String = "",
    /** 桌面端只收 `[A-Za-z0-9._:-]` 的 id；脏值会被当成没带，这里不做过滤，由 `SettingsStore` 保证。 */
    val name: String = DEFAULT_NAME,
    val platform: String = PLATFORM,
    val appVersion: String = APP_VERSION,
    val apiVersion: Int = Capabilities.REQUIRED_API_VERSION,
) {
    companion object {
        const val PLATFORM = "android"

        /**
         * 设备页上显示的手机端版本：**直接读打包配置**，绝不写第二个常量。
         *
         * 之前这里写死过 `"3.1.0"`，`versionName` 还是 `3.0.0`，结果手机自己报了一个
         * 不是它的版本号；常量每发一次版就要人肉改一次，迟早再漂。改成读
         * [com.folio.reader.BuildConfig.VERSION_NAME] 之后，`versionName` 是唯一真相。
         *
         * 注意：debug 变体带 `versionNameSuffix = "-debug"`，所以调试包会报
         * `3.1.0-debug` —— 这正是想要的，设备页上一眼能看出装的是调试包。
         */
        val APP_VERSION: String = com.folio.reader.BuildConfig.VERSION_NAME

        const val DEFAULT_NAME = "Android"

        /** 没身份时的空对象：所有设备头都不发。 */
        val NONE = DeviceIdentity()
    }
}

/** 桌面端认出来的设备。 */
data class DeviceInfo(
    val id: String,
    val name: String,
    val online: Boolean,
)

/**
 * 心跳结果。
 *
 * [supported] 为 false 表示桌面端根本没有设备接口（2.5 / 2.6 早期），
 * 调用方应当**静默跳过**，绝不能因此把连接判成失败。
 */
data class DeviceStatus(
    val supported: Boolean,
    val ok: Boolean = false,
    val device: DeviceInfo? = null,
    val pending: Int = 0,
    val serverTime: Long = 0L,
    /** 桌面端说不行时的原话（`missing_device` 之类），只在 [ok] 为 false 时有值。 */
    val message: String = "",
)

/** 桌面端排队等手机执行的一条指令。 */
data class DeviceCommand(
    val id: String,
    val type: String,
    /** 原样转交的 payload：执行器自己解析，客户端不猜结构。 */
    val payloadJson: String,
    val batchId: String? = null,
    val createdAt: Long = 0L,
    val expiresAt: Long = 0L,
)

/** 拉指令的结果；[supported] 语义同 [DeviceStatus]。 */
data class CommandFetch(
    val supported: Boolean,
    val ok: Boolean = false,
    val commands: List<DeviceCommand> = emptyList(),
    val message: String = "",
)

/** 回执 / 快照提交的结果；[supported] 语义同 [DeviceStatus]。 */
data class DeviceAck(
    val supported: Boolean,
    val ok: Boolean = false,
    val state: String = "",
    val message: String = "",
)

/** `/api/library` 里的一个条目：书 + 能不能整文件搬运。 */
data class RemoteBook(
    val book: LocalBook,
    val syncable: Boolean,
    val syncableReason: String?,
)

/** `/api/library` 的整份快照。 */
data class LibrarySnapshot(
    val apiVersion: Int,
    val now: Long,
    val truncated: Boolean,
    val books: List<RemoteBook>,
)

/** `/api/upload/status` 的结果。 */
data class UploadStatus(
    val hash: String,
    val received: Long,
    val done: Boolean,
)

/** 一次分块上传的结果。 */
data class ChunkResult(
    val received: Long,
    val done: Boolean,
    val id: String? = null,
    val title: String? = null,
    val created: Boolean = false,
)

/** 一次整文件下载的结果。 */
data class DownloadResult(
    val hash: String,
    val size: Long,
    val bytesWritten: Long,
    val fromOffset: Long,
)

/** `/api/comic/:id/pages` 的结果：只有总数，没有源站地址。 */
data class ComicPages(
    val index: Int,
    val total: Int,
    val fromCache: Boolean,
)

/**
 * 一页漫画的字节流。
 *
 * 故意返回 [InputStream] 而不是 ByteArray：图片动辄几百 KB，
 * 直接把流交给 BitmapFactory 解码（`decodeStream`）比先读成字节再解码省一半内存。
 * 用完必须 [close]，否则连接不会释放。
 */
class PageStream(
    val input: InputStream,
    val mime: String,
    val length: Long,
    val page: Int,
    val total: Int,
    private val connection: HttpURLConnection,
) : Closeable {
    override fun close() {
        runCatching { input.close() }
        runCatching { connection.disconnect() }
    }
}

/**
 * 一条已经建立的 SSE 长连接（`/api/events`）。
 *
 * 只交出 [reader]：协议解析（`event:` / `data:` 分帧）由
 * [com.folio.reader.data.DeviceChannel] 负责，客户端只保证「连接、鉴权、设备头」
 * 这三件事和普通请求完全一致 —— 设备头本来就只在 [FolioClient.open] 里加一次。
 *
 * 用完必须 [close]：SSE 的字节永远读不完，不关就是一根泄漏的连接。
 */
class EventStream(
    val reader: java.io.BufferedReader,
    private val input: InputStream,
    private val connection: HttpURLConnection,
) : Closeable {
    override fun close() {
        // 只关底层流，不关 reader：readLine 可能正被另一个线程阻塞着并持有 reader 的锁，
        // 关底层流能让它立刻抛 IOException 退出；关 reader 反而会卡到读超时。
        runCatching { input.close() }
        runCatching { connection.disconnect() }
    }
}

/**
 * Folio 桌面端局域网服务客户端。
 *
 * 只用系统自带的 [HttpURLConnection]：不引 OkHttp，APK 更小，
 * 后台也没有额外的常驻线程池，省电。
 *
 * 所有方法都是阻塞的，调用方负责放到 `Dispatchers.IO` 上。
 */
class FolioClient(
    baseUrl: String,
    private val token: String,
    /** 设备身份；默认 [DeviceIdentity.NONE]，此时一个设备头都不发（兼容老桌面端）。 */
    private val device: DeviceIdentity = DeviceIdentity.NONE,
) {
    private val root: String = normalizeBase(baseUrl)

    val baseUrl: String get() = root

    /* ---------------- 能力与连接 ---------------- */

    /** 服务是否可达。返回 true/false，从不抛。 */
    fun ping(timeoutMs: Int = 4000): Boolean = try {
        capabilities(timeoutMs).apiVersion >= 1
    } catch (err: Exception) {
        false
    }

    /**
     * 读 `/api/ping`：版本、apiVersion、能力位、上限。
     *
     * 手机据此决定「哪些功能能用」，而不是假设桌面端一定是新版本。
     */
    fun capabilities(timeoutMs: Int = 6000): Capabilities {
        val json = requestJson("/api/ping", "GET", timeoutMs)
        val limitsJson = json.optJSONObject("limits")
        return Capabilities(
            serverVersion = json.optString("version"),
            port = json.optInt("port", 0),
            apiVersion = json.optInt("apiVersion", 1),
            features = run {
                val out = LinkedHashSet<String>()
                val array = json.optJSONArray("features")
                if (array != null) for (i in 0 until array.length()) {
                    val item = array.optString(i).trim()
                    if (item.isNotEmpty()) out.add(item)
                }
                out
            },
            limits = limitsJson?.let {
                Limits(
                    transfer = it.optLong("transfer", Limits().transfer),
                    chunk = it.optLong("chunk", Limits().chunk),
                    chunkBody = it.optLong("chunkBody", Limits().chunkBody),
                    image = it.optLong("image", Limits().image),
                )
            },
        )
    }

    /* ---------------- 兼容 2.5 的旧接口 ---------------- */

    /** 拉书架 + 进度 + 服务信息（`/api/state`，只为进度对齐保留）。 */
    fun fetchState(timeoutMs: Int = 8000): ServerState {
        val json = requestJson("/api/state", "GET", timeoutMs)
        val books = ArrayList<LocalBook>()
        val booksJson = json.optJSONArray("books")
        if (booksJson != null) {
            for (i in 0 until booksJson.length()) {
                val item = booksJson.optJSONObject(i) ?: continue
                LocalBook.fromJson(item, Origin.DESKTOP)?.let { books.add(it) }
            }
        }
        val progress = LinkedHashMap<String, ProgressEntry>()
        val progressJson = json.optJSONObject("progress")
        if (progressJson != null) {
            val keys = progressJson.keys()
            while (keys.hasNext()) {
                val id = keys.next()
                val entry = progressJson.optJSONObject(id) ?: continue
                ProgressEntry.fromJson(id, entry)?.let { progress[id] = it }
            }
        }
        val server = json.optJSONObject("server")
        return ServerState(
            books = books,
            progress = progress,
            serverVersion = server?.optString("version").orEmpty(),
            allowWrite = server?.optBoolean("allowWrite", true) ?: true,
            port = server?.optInt("port", 0) ?: 0,
        )
    }

    /** 本地书正文全文（旧接口，留给「没走整文件下载」的兜底路径）。 */
    fun fetchBookText(id: String, timeoutMs: Int = 20000): String {
        val json = requestJson("/api/book/${encode(id)}", "GET", timeoutMs)
        if (!json.optBoolean("ok", false)) {
            throw FolioException(json.optString("error").ifBlank { "读取正文失败" }, 500)
        }
        return json.optString("text")
    }

    /** 云端书目录。 */
    fun fetchToc(id: String, timeoutMs: Int = 15000): Pair<List<TocChapter>, String> {
        val json = requestJson("/api/toc/${encode(id)}", "GET", timeoutMs)
        if (!json.optBoolean("ok", false)) {
            throw FolioException(json.optString("error").ifBlank { "目录获取失败" }, 502)
        }
        val chapters = ArrayList<TocChapter>()
        val array = json.optJSONArray("chapters")
        if (array != null) {
            for (i in 0 until array.length()) {
                val item = array.optJSONObject(i) ?: continue
                chapters.add(
                    TocChapter(
                        index = item.optInt("i", i),
                        title = item.optString("title").ifBlank { "第 ${i + 1} 章" },
                    ),
                )
            }
        }
        return chapters to json.optString("sourceName")
    }

    /** 云端书单章正文。 */
    fun fetchChapter(id: String, index: Int, timeoutMs: Int = 20000): String {
        val json = requestJson("/api/chapter/${encode(id)}?i=$index", "GET", timeoutMs)
        if (!json.optBoolean("ok", false)) {
            throw FolioException(json.optString("error").ifBlank { "正文获取失败" }, 502)
        }
        return json.optString("text")
    }

    /** 回写进度。返回 true 表示桌面端已接受。 */
    fun postProgress(
        id: String,
        kind: String,
        entry: ProgressEntry,
        timeoutMs: Int = 8000,
    ): Boolean {
        val body = JSONObject()
        body.put("id", id)
        body.put("data", entry.toJson(kind))
        val json = requestJson("/api/progress", "POST", timeoutMs, body.toString())
        return json.optBoolean("ok", false)
    }

    /** 封面字节；拿不到返回 null。 */
    fun fetchCover(id: String, timeoutMs: Int = 8000): ByteArray? = try {
        val conn = open("/api/cover/${encode(id)}", "GET", timeoutMs)
        try {
            val code = conn.responseCode
            if (code !in 200..299) null else conn.inputStream.use { it.readBytes() }
        } finally {
            conn.disconnect()
        }
    } catch (err: Exception) {
        null
    }

    /* ---------------- 2.6.0：清单 ---------------- */

    /**
     * 全量书架清单。
     *
     * 桌面端不存「已同步」状态，这里拿到的只是客观事实，
     * 差集由 [com.folio.reader.data.SyncDiff] 在手机侧算。
     */
    fun library(timeoutMs: Int = 20000): LibrarySnapshot {
        val json = requestJson("/api/library", "GET", timeoutMs)
        if (!json.optBoolean("ok", false)) {
            throw FolioException(json.optString("error").ifBlank { "书架清单获取失败" }, 500)
        }
        val books = ArrayList<RemoteBook>()
        val array = json.optJSONArray("books")
        if (array != null) {
            for (i in 0 until array.length()) {
                val item = array.optJSONObject(i) ?: continue
                val book = LocalBook.fromJson(item, Origin.DESKTOP) ?: continue
                books.add(
                    RemoteBook(
                        book = book,
                        syncable = item.optBoolean("syncable", false),
                        syncableReason = item.optString("syncableReason")
                            .takeIf { it.isNotBlank() && it != "null" },
                    ),
                )
            }
        }
        return LibrarySnapshot(
            apiVersion = json.optInt("apiVersion", 2),
            now = json.optLong("now", System.currentTimeMillis()),
            truncated = json.optBoolean("truncated", false),
            books = books,
        )
    }

    /* ---------------- 2.6.0：整文件下载 ---------------- */

    /**
     * 下载整本正文，边写边算 sha1。
     *
     * @param dest 目标文件（通常是 `<id>.txt.part`）
     * @param offset 从第几个字节继续（0 = 从头）。服务端支持 `Range: bytes=N-`
     * @param expectedHash 期望的 sha1；不一致会删掉目标文件并抛异常
     * @param onProgress (已写字节, 总字节)；总字节未知时为 -1
     */
    fun downloadBook(
        id: String,
        dest: File,
        offset: Long = 0L,
        expectedHash: String? = null,
        onProgress: ((Long, Long) -> Unit)? = null,
        timeoutMs: Int = 90000,
    ): DownloadResult {
        dest.parentFile?.mkdirs()
        val conn = open("/api/book/${encode(id)}/download", "GET", timeoutMs)
        if (offset > 0L) conn.setRequestProperty("Range", "bytes=$offset-")
        try {
            val code = conn.responseCode
            if (code !in 200..299) throw errorOf(conn, code)
            val serverHash = conn.getHeaderField("X-Folio-Hash").orEmpty()
            val declaredSize = conn.getHeaderField("X-Folio-Size")?.toLongOrNull() ?: -1L
            // 200 表示服务端没理会 Range（或本来就没有），只能从头写
            val startingAt = if (code == 206 && offset > 0L) offset else 0L

            val digest = HashUtils.newDigest()
            if (startingAt > 0L && dest.isFile) {
                // 续传：先把已有前缀喂进 digest，增量算出来的才是整本 sha1
                dest.inputStream().use { prefix ->
                    val buffer = ByteArray(HashUtils.BUFFER_BYTES)
                    var remaining = startingAt
                    while (remaining > 0L) {
                        val take = minOf(buffer.size.toLong(), remaining).toInt()
                        val count = prefix.read(buffer, 0, take)
                        if (count <= 0) break
                        digest.update(buffer, 0, count)
                        remaining -= count
                    }
                }
            }

            var written = startingAt
            FileOutputStream(dest, startingAt > 0L).use { output ->
                conn.inputStream.use { input ->
                    val buffer = ByteArray(HashUtils.BUFFER_BYTES)
                    while (true) {
                        val count = input.read(buffer)
                        if (count <= 0) break
                        output.write(buffer, 0, count)
                        digest.update(buffer, 0, count)
                        written += count
                        onProgress?.invoke(written, if (declaredSize > 0) declaredSize else -1L)
                    }
                }
            }

            val hash = HashUtils.toHex(digest)
            val expect = expectedHash?.takeIf { it.isNotBlank() } ?: serverHash.takeIf { it.isNotBlank() }
            if (expect != null && hash != expect) {
                // 校验不过就删掉：留着半截或损坏的文件比重新下一遍更糟
                runCatching { dest.delete() }
                throw FolioException("下载的正文校验没过（sha1 不一致），已删除，请重试", 422)
            }
            return DownloadResult(
                hash = hash,
                size = if (declaredSize > 0) declaredSize else written,
                bytesWritten = written,
                fromOffset = startingAt,
            )
        } catch (err: FolioException) {
            throw err
        } catch (err: Exception) {
            throw FolioException(describe(err), 0, err)
        } finally {
            conn.disconnect()
        }
    }

    /* ---------------- 2.6.0：分块上传 ---------------- */

    /** 问服务端「这份内容已经收到多少字节 / 是不是已经有了」。 */
    fun uploadStatus(hash: String, size: Long, timeoutMs: Int = 10000): UploadStatus {
        val json = requestJson("/api/upload/status?hash=$hash&size=$size", "GET", timeoutMs)
        if (!json.optBoolean("ok", false)) {
            throw FolioException(json.optString("error").ifBlank { "查询上传进度失败" }, 500)
        }
        return UploadStatus(
            hash = json.optString("hash", hash),
            received = json.optLong("received", 0L),
            done = json.optBoolean("done", false),
        )
    }

    /**
     * 上传一块。
     *
     * 用 [HttpURLConnection.setFixedLengthStreamingMode] + [RandomAccessFile] 流式发，
     * 绝不把 4MB 分块先读进内存 —— 低端机上那样做会直接触发 GC 抖动。
     *
     * @param file 待上传的正文文件
     * @param offset 这一块在文件里的起点
     * @param length 这一块的长度
     * @throws UploadConflictException offset 不连续（带服务端已收字节数）
     */
    fun uploadChunk(
        file: File,
        offset: Long,
        length: Int,
        hash: String,
        total: Long,
        name: String,
        timeoutMs: Int = 90000,
    ): ChunkResult {
        val conn = open("/api/upload/chunk", "POST", timeoutMs)
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/octet-stream")
        conn.setRequestProperty("X-Folio-Hash", hash)
        conn.setRequestProperty("X-Folio-Offset", offset.toString())
        conn.setRequestProperty("X-Folio-Total", total.toString())
        conn.setRequestProperty("X-Folio-Name", encode(name))
        conn.setFixedLengthStreamingMode(length)
        try {
            RandomAccessFile(file, "r").use { raf ->
                raf.seek(offset)
                conn.outputStream.use { out ->
                    val buffer = ByteArray(HashUtils.BUFFER_BYTES)
                    var remaining = length
                    while (remaining > 0) {
                        val count = raf.read(buffer, 0, minOf(buffer.size, remaining))
                        if (count <= 0) break
                        out.write(buffer, 0, count)
                        remaining -= count
                    }
                }
            }
            val code = conn.responseCode
            val text = readAll(conn, code)
            val json = runCatching { JSONObject(text) }.getOrNull()
            if (code == 409) {
                throw UploadConflictException(
                    json?.optString("error").orEmpty().ifBlank { "上传位置对不上" },
                    json?.optLong("received", -1L) ?: -1L,
                )
            }
            if (code !in 200..299) {
                throw FolioException(
                    json?.optString("error").orEmpty().ifBlank { "上传失败（$code）" },
                    code,
                )
            }
            if (json == null) throw FolioException("服务端返回的数据看不懂", code)
            return ChunkResult(
                received = json.optLong("received", 0L),
                done = json.optBoolean("done", false),
                id = json.optString("id").takeIf { it.isNotBlank() && it != "null" },
                title = json.optString("title").takeIf { it.isNotBlank() && it != "null" },
                created = json.optBoolean("created", false),
            )
        } catch (err: UploadConflictException) {
            throw err
        } catch (err: FolioException) {
            throw err
        } catch (err: Exception) {
            throw FolioException(describe(err), 0, err)
        } finally {
            conn.disconnect()
        }
    }

    /** 取消一次没传完的上传（清理 `.part`）。失败不抛。 */
    fun discardUpload(hash: String, timeoutMs: Int = 8000): Boolean = try {
        val conn = open("/api/upload/$hash", "DELETE", timeoutMs)
        try {
            conn.responseCode in 200..299
        } finally {
            conn.disconnect()
        }
    } catch (err: Exception) {
        false
    }

    /* ---------------- 2.6.0：漫画 ---------------- */

    /** 某一话的总页数。返回体里没有源站地址。 */
    fun comicPages(id: String, index: Int, timeoutMs: Int = 25000): ComicPages {
        val json = requestJson("/api/comic/${encode(id)}/pages?i=$index", "GET", timeoutMs)
        if (!json.optBoolean("ok", false)) {
            throw FolioException(json.optString("error").ifBlank { "漫画清单获取失败" }, 502)
        }
        return ComicPages(
            index = json.optInt("i", index),
            total = json.optInt("total", 0),
            fromCache = json.optBoolean("fromCache", false),
        )
    }

    /**
     * 取一页漫画的字节流。
     *
     * 返回的 [PageStream] 里是**尚未读取**的输入流，可以直接交给
     * `BitmapFactory.decodeStream`；用完必须 close。
     */
    fun comicPage(id: String, index: Int, page: Int, timeoutMs: Int = 15000): PageStream {
        val conn = open("/api/comic/${encode(id)}/page?i=$index&p=$page", "GET", timeoutMs)
        var handedOff = false
        try {
            val code = conn.responseCode
            if (code !in 200..299) throw errorOf(conn, code)
            val pageHeader = conn.getHeaderField("X-Folio-Page").orEmpty()
            val total = pageHeader.substringAfter('/', "0").toIntOrNull() ?: 0
            val stream = conn.inputStream
            handedOff = true
            return PageStream(
                input = stream,
                mime = conn.contentType?.substringBefore(';') ?: "image/jpeg",
                length = conn.contentLengthLong,
                page = page,
                total = total,
                connection = conn,
            )
        } catch (err: FolioException) {
            throw err
        } catch (err: Exception) {
            throw FolioException(describe(err), 0, err)
        } finally {
            // 只有「没把流交出去」的时候才断开，否则会把正在读的连接掐掉
            if (!handedOff) conn.disconnect()
        }
    }

    /* ---------------- T07：设备管理 ---------------- */

    /**
     * 心跳：告诉桌面端「我还活着」，顺便取回排队指令数。
     *
     * 桌面端没有这条路由（404）或明确说没实现（501）时返回 [DeviceStatus.supported] = false，
     * **不抛异常** —— 设备管理是附加能力，不该因为老桌面端把它整条连接判死。
     */
    fun heartbeat(timeoutMs: Int = 8000): DeviceStatus {
        val json = deviceRequest("/api/device/heartbeat", "POST", timeoutMs, JSONObject())
            ?: return DeviceStatus(supported = false)
        if (!json.optBoolean("ok", false)) {
            return DeviceStatus(
                supported = true,
                message = json.optString("error").ifBlank { "桌面端没有接受心跳" },
            )
        }
        val deviceJson = json.optJSONObject("device")
        return DeviceStatus(
            supported = true,
            ok = true,
            device = deviceJson?.let {
                DeviceInfo(
                    id = it.optString("id"),
                    name = it.optString("name"),
                    online = it.optBoolean("online", true),
                )
            },
            pending = json.optInt("pending", 0),
            serverTime = json.optLong("serverTime", 0L),
        )
    }

    /** 取回待执行指令（桌面端已按 `createdAt` 升序）。 */
    fun fetchCommands(timeoutMs: Int = 8000): CommandFetch {
        val json = deviceRequest("/api/device/commands", "GET", timeoutMs)
            ?: return CommandFetch(supported = false)
        if (!json.optBoolean("ok", false)) {
            return CommandFetch(
                supported = true,
                message = json.optString("error").ifBlank { "拿不到指令" },
            )
        }
        val commands = ArrayList<DeviceCommand>()
        val array = json.optJSONArray("commands")
        if (array != null) {
            for (i in 0 until array.length()) {
                val item = array.optJSONObject(i) ?: continue
                val id = item.optString("id").trim()
                if (id.isEmpty()) continue
                commands.add(
                    DeviceCommand(
                        id = id,
                        type = item.optString("type").trim(),
                        payloadJson = payloadOf(item),
                        batchId = item.optString("batchId")
                            .takeIf { it.isNotBlank() && it != "null" },
                        createdAt = item.optLong("createdAt", 0L),
                        expiresAt = item.optLong("expiresAt", 0L),
                    ),
                )
            }
        }
        return CommandFetch(supported = true, ok = true, commands = commands)
    }

    /**
     * 回一条指令的回执。
     *
     * @param state `done` / `failed`
     * @param error 失败原因（`state = failed` 时给）
     * @param detail 执行细节，桌面端原样存下来给人看
     */
    fun postReceipt(
        id: String,
        state: String,
        error: String? = null,
        detail: String? = null,
        timeoutMs: Int = 8000,
    ): DeviceAck {
        val body = JSONObject().put("state", state)
        error?.let { body.put("error", it) }
        detail?.let { body.put("detail", it) }
        val json = deviceRequest(
            path = "/api/device/commands/${encode(id)}/receipt",
            method = "POST",
            timeoutMs = timeoutMs,
            body = body,
        ) ?: return DeviceAck(supported = false)
        val ok = json.optBoolean("ok", false)
        return DeviceAck(
            supported = true,
            ok = ok,
            state = json.optString("state"),
            message = if (ok) "" else json.optString("error").ifBlank { "回执没有被接受" },
        )
    }

    /** 上报一次设备快照（书架摘要 + 存储余量 + 版本）。桌面端限 256KB。 */
    fun postSnapshot(body: JSONObject, timeoutMs: Int = 15000): DeviceAck {
        val json = deviceRequest("/api/device/snapshot", "POST", timeoutMs, body)
            ?: return DeviceAck(supported = false)
        val ok = json.optBoolean("ok", false)
        return DeviceAck(
            supported = true,
            ok = ok,
            state = if (ok) "accepted" else "",
            message = if (ok) "" else json.optString("error").ifBlank { "快照没有被接受" },
        )
    }

    /**
     * 设备接口的统一入口。
     *
     * @return 响应 JSON；桌面端没有这条路由（404 / 501）时返回 null，表示「不支持」。
     *         4xx 里的参数错误（如回执 state 非法 → 400）会把 body 里的 `error` 原话
     *         包成 `{ok:false,error:…}` 返回，让调用方自己决定怎么展示，**不抛**。
     */
    private fun deviceRequest(
        path: String,
        method: String,
        timeoutMs: Int,
        body: JSONObject? = null,
    ): JSONObject? = try {
        requestJson(path, method, timeoutMs, body?.toString())
    } catch (err: FolioException) {
        when {
            err.status == 404 || err.status == 501 -> null
            // 401 是访问码问题，跟设备接口无关，必须原样冒出去
            err.status == 401 -> throw err
            err.status in 400..499 -> JSONObject()
                .put("ok", false)
                .put("error", err.message.orEmpty())
            else -> throw err
        }
    }

    /** `payload` 桌面端可能给对象也可能给字符串，一律转成字符串交给执行器。 */
    private fun payloadOf(item: JSONObject): String {
        val raw = item.opt("payload")
        return when {
            raw == null || raw == JSONObject.NULL -> "{}"
            raw is JSONObject -> raw.toString()
            else -> raw.toString()
        }
    }

    /* ---------------- T09：在线通道（SSE） ---------------- */

    /**
     * 建立 `/api/events` 长连接（服务端推送指令与设备在线态）。
     *
     * 读超时必须大于桌面端的 SSE 心跳间隔（25s）：心跳包会刷新读计时，
     * 用 45s 既能扛住一次丢包，又不会在桌面端真的消失后永远挂着。
     *
     * @throws FolioException 鉴权失败、地址不对或连不上（调用方负责重连）
     */
    fun openEvents(timeoutMs: Int = 45_000): EventStream {
        val conn = open("/api/events", "GET", timeoutMs)
        // open() 默认写 `Connection: close`（普通请求能省一次握手），
        // 但长连接必须改成 keep-alive，否则中间层会在响应结束后断开。
        conn.setRequestProperty("Connection", "keep-alive")
        conn.setRequestProperty("Accept", "text/event-stream")
        var handedOff = false
        try {
            val code = conn.responseCode
            if (code !in 200..299) throw errorOf(conn, code)
            val stream = conn.inputStream
            handedOff = true
            return EventStream(
                reader = stream.bufferedReader(Charsets.UTF_8),
                input = stream,
                connection = conn,
            )
        } catch (err: FolioException) {
            throw err
        } catch (err: Exception) {
            throw FolioException(describe(err), 0, err)
        } finally {
            if (!handedOff) conn.disconnect()
        }
    }

    /* ---------------- 内部 ---------------- */

    private fun requestJson(
        path: String,
        method: String,
        timeoutMs: Int,
        body: String? = null,
    ): JSONObject {
        val conn = open(path, method, timeoutMs)
        try {
            if (body != null) {
                val bytes = body.toByteArray(Charsets.UTF_8)
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                conn.setFixedLengthStreamingMode(bytes.size)
                conn.outputStream.use { it.write(bytes) }
            }
            val code = conn.responseCode
            val text = readAll(conn, code)
            if (code == 401) throw FolioException("访问码不对，检查设置里的访问码", 401)
            if (code !in 200..299) {
                val message = runCatching { JSONObject(text).optString("error") }.getOrNull().orEmpty()
                throw FolioException(message.ifBlank { "服务返回 $code" }, code)
            }
            if (text.isBlank()) throw FolioException("服务没有返回内容", code)
            return try {
                JSONObject(text)
            } catch (err: Exception) {
                throw FolioException("服务返回的数据看不懂", code, err)
            }
        } catch (err: FolioException) {
            throw err
        } catch (err: Exception) {
            throw FolioException(describe(err), 0, err)
        } finally {
            conn.disconnect()
        }
    }

    /** 读响应体（自动解 gzip）；失败返回空串。 */
    private fun readAll(conn: HttpURLConnection, code: Int): String {
        val raw = if (code in 200..299) runCatching { conn.inputStream }.getOrNull()
        else runCatching { conn.errorStream }.getOrNull()
        if (raw == null) return ""
        val stream = if (conn.contentEncoding?.contains("gzip") == true) {
            runCatching { GZIPInputStream(raw) as InputStream }.getOrDefault(raw)
        } else {
            raw
        }
        return stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
    }

    /** 把非 2xx 的响应变成异常。 */
    private fun errorOf(conn: HttpURLConnection, code: Int): FolioException {
        val text = readAll(conn, code)
        val message = runCatching { JSONObject(text).optString("error") }.getOrNull().orEmpty()
        return when (code) {
            401 -> FolioException("访问码不对，检查设置里的访问码", 401)
            403 -> FolioException(message.ifBlank { "桌面端关闭了「允许写入」" }, 403)
            409 -> FolioException(message.ifBlank { "这本书没有可搬运的正文" }, 409)
            413 -> FolioException(message.ifBlank { "这本超过 30MB 上限，只能在本机读" }, 413)
            416 -> FolioException(message.ifBlank { "要的起点超过了文件大小" }, 416)
            422 -> FolioException(message.ifBlank { "正文校验没过，请重新上传" }, 422)
            501 -> FolioException(message.ifBlank { "桌面端没有接入这个能力" }, 501)
            502 -> FolioException(message.ifBlank { "源站没有返回内容" }, 502)
            else -> FolioException(message.ifBlank { "服务返回 $code" }, code)
        }
    }

    private fun open(path: String, method: String, timeoutMs: Int): HttpURLConnection {
        val url = java.net.URL(root + path)
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.connectTimeout = minOf(timeoutMs, 6000)
        conn.readTimeout = timeoutMs
        conn.useCaches = false
        conn.instanceFollowRedirects = false
        if (token.isNotBlank()) conn.setRequestProperty("X-Folio-Token", token)
        conn.setRequestProperty("Accept", "*/*")
        conn.setRequestProperty("Connection", "close")
        applyDeviceHeaders(conn)
        return conn
    }

    /**
     * 设备头只在这一处追加，`open()` 是所有请求的唯一出口 ——
     * 分散到各方法里迟早漏掉一条（上传那条就特别容易漏）。
     */
    private fun applyDeviceHeaders(conn: HttpURLConnection) {
        val id = device.installId.trim()
        if (id.isEmpty()) return
        conn.setRequestProperty("X-Folio-Device", id)
        conn.setRequestProperty("X-Folio-Device-Name", encode(device.name))
        conn.setRequestProperty("X-Folio-Platform", device.platform)
        conn.setRequestProperty("X-Folio-App-Version", device.appVersion)
        conn.setRequestProperty("X-Folio-Api-Version", device.apiVersion.toString())
    }

    private fun describe(err: Exception): String {
        val raw = err.message.orEmpty()
        return when {
            raw.contains("timeout", ignoreCase = true) -> "连接超时，桌面端可能没开"
            raw.contains("refused", ignoreCase = true) -> "连不上桌面端，确认地址和端口"
            raw.contains("Unable to resolve host", ignoreCase = true) -> "地址格式不对，应形如 http://192.168.1.5:7788"
            raw.contains("Network is unreachable", ignoreCase = true) ||
                raw.contains("No route to host", ignoreCase = true) -> "连不上桌面端，确认同一 Wi-Fi"
            raw.contains("Cleartext", ignoreCase = true) -> "系统不允许明文 HTTP，检查网络安全配置"
            else -> raw.ifBlank { "网络出错" }
        }
    }

    companion object {
        /** 规范化地址：补 http://、去尾部斜杠。 */
        fun normalizeBase(url: String): String {
            var value = url.trim()
            if (value.isEmpty()) return ""
            if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://$value"
            while (value.endsWith("/")) value = value.dropLast(1)
            return value
        }

        /**
         * 地址格式校验。
         *
         * @return 合法返回 null，不合法返回给人看的文案
         */
        fun validateUrl(raw: String): String? {
            val value = raw.trim()
            if (value.isEmpty()) return "先填桌面端地址"
            val normalized = normalizeBase(value)
            val uri = runCatching { java.net.URI(normalized) }.getOrNull()
                ?: return "地址格式不对，应形如 http://192.168.1.5:7788"
            if (uri.scheme != "http" && uri.scheme != "https") {
                return "地址格式不对，应形如 http://192.168.1.5:7788"
            }
            val host = uri.host
            if (host.isNullOrBlank()) return "地址格式不对，应形如 http://192.168.1.5:7788"
            // 端口可以不写（用默认 80），但写了就必须是合法数字
            if (uri.port != -1 && uri.port !in 1..65535) {
                return "地址格式不对，应形如 http://192.168.1.5:7788"
            }
            return null
        }

        /** 与 JS 的 encodeURIComponent 对齐：空格编成 %20，其余保留 -_.!~*'()。 */
        fun encode(value: String): String {
            val sb = StringBuilder()
            for (byte in value.toByteArray(Charsets.UTF_8)) {
                val ch = byte.toInt().toChar()
                if (ch in 'A'..'Z' || ch in 'a'..'z' || ch in '0'..'9' || ch in "-_.!~*'()") {
                    sb.append(ch)
                } else {
                    sb.append('%').append("%02X".format(byte.toInt() and 0xFF))
                }
            }
            return sb.toString()
        }
    }
}
