package com.folio.reader.net

import com.folio.reader.core.Book
import com.folio.reader.core.ProgressEntry
import com.folio.reader.core.ServerState
import com.folio.reader.core.TocChapter
import org.json.JSONObject

/** 与桌面端通信失败时抛出，消息直接给人看。 */
class FolioException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * Folio 桌面端局域网服务客户端。
 *
 * 只用系统自带的 HttpURLConnection：不引第三方网络库，APK 更小、
 * 后台也没有额外的常驻线程，省电。
 */
class FolioClient(
    baseUrl: String,
    private val token: String,
) {
    private val root: String = normalizeBase(baseUrl)

    val baseUrl: String get() = root

    /** 服务是否可达。 */
    fun ping(timeoutMs: Int = 4000): Boolean {
        return try {
            val conn = open("/api/ping", "GET", timeoutMs)
            val code = conn.responseCode
            drain(conn)
            conn.disconnect()
            code in 200..299
        } catch (err: Exception) {
            false
        }
    }

    /** 拉书架 + 进度 + 服务信息。 */
    fun fetchState(timeoutMs: Int = 8000): ServerState {
        val json = requestJson("/api/state", "GET", timeoutMs)
        val books = ArrayList<Book>()
        val booksJson = json.optJSONArray("books")
        if (booksJson != null) {
            for (i in 0 until booksJson.length()) {
                val item = booksJson.optJSONObject(i) ?: continue
                Book.fromJson(item)?.let { books.add(it) }
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

    /** 本地书正文全文。 */
    fun fetchBookText(id: String, timeoutMs: Int = 20000): String {
        val json = requestJson("/api/book/${encode(id)}", "GET", timeoutMs)
        if (!json.optBoolean("ok", false)) {
            throw FolioException(json.optString("error").ifBlank { "读取正文失败" })
        }
        return json.optString("text")
    }

    /** 云端书目录。 */
    fun fetchToc(id: String, timeoutMs: Int = 15000): Pair<List<TocChapter>, String> {
        val json = requestJson("/api/toc/${encode(id)}", "GET", timeoutMs)
        if (!json.optBoolean("ok", false)) {
            throw FolioException(json.optString("error").ifBlank { "目录获取失败" })
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
            throw FolioException(json.optString("error").ifBlank { "正文获取失败" })
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
    fun fetchCover(id: String, timeoutMs: Int = 8000): ByteArray? {
        return try {
            val conn = open("/api/cover/${encode(id)}", "GET", timeoutMs)
            if (conn.responseCode !in 200..299) {
                drain(conn)
                conn.disconnect()
                return null
            }
            val bytes = conn.inputStream.use { it.readBytes() }
            conn.disconnect()
            bytes
        } catch (err: Exception) {
            null
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
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (code == 401) throw FolioException("访问码不对，检查设置里的访问码")
            if (code !in 200..299) {
                val message = runCatching { JSONObject(text).optString("error") }.getOrNull().orEmpty()
                throw FolioException(message.ifBlank { "服务返回 $code" })
            }
            if (text.isBlank()) throw FolioException("服务没有返回内容")
            return try {
                JSONObject(text)
            } catch (err: Exception) {
                throw FolioException("服务返回的数据看不懂", err)
            }
        } catch (err: FolioException) {
            throw err
        } catch (err: Exception) {
            throw FolioException(describe(err), err)
        } finally {
            conn.disconnect()
        }
    }

    private fun open(path: String, method: String, timeoutMs: Int): java.net.HttpURLConnection {
        val url = java.net.URL(root + path)
        val conn = url.openConnection() as java.net.HttpURLConnection
        conn.requestMethod = method
        conn.connectTimeout = timeoutMs.coerceAtMost(5000)
        conn.readTimeout = timeoutMs
        conn.useCaches = false
        conn.instanceFollowRedirects = false
        if (token.isNotBlank()) conn.setRequestProperty("X-Folio-Token", token)
        conn.setRequestProperty("Accept", "application/json")
        conn.setRequestProperty("Connection", "close")
        return conn
    }

    private fun drain(conn: java.net.HttpURLConnection) {
        runCatching {
            conn.inputStream.use { it.readBytes() }
        }
        runCatching {
            conn.errorStream?.use { it.readBytes() }
        }
    }

    private fun describe(err: Exception): String {
        val raw = err.message.orEmpty()
        return when {
            raw.contains("timeout") -> "连接超时，桌面端可能没开"
            raw.contains("refused") -> "连不上桌面端，确认地址和端口"
            raw.contains("Unable to resolve host") -> "地址写错了"
            raw.contains("Network is unreachable") || raw.contains("No route to host") ->
                "不在同一个 Wi-Fi，或被防火墙挡住"
            else -> raw.ifBlank { "网络出错" }
        }
    }

    companion object {
        fun normalizeBase(url: String): String {
            var value = url.trim()
            if (value.isEmpty()) return ""
            if (!value.startsWith("http://") && !value.startsWith("https://")) value = "http://$value"
            while (value.endsWith("/")) value = value.dropLast(1)
            return value
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
