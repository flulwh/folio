package com.folio.reader.net

import com.folio.reader.core.BookKind
import com.folio.reader.core.HashUtils
import com.folio.reader.core.LocalBook
import com.folio.reader.core.Origin
import com.folio.reader.core.ProgressEntry
import com.folio.reader.data.BookFileStore
import com.folio.reader.data.BookStore
import com.folio.reader.data.BookTransfer
import com.folio.reader.data.CommandExecutor
import com.folio.reader.data.DeleteConfirmer
import com.folio.reader.data.ProgressStore
import com.folio.reader.data.SyncEngine
import com.folio.reader.data.SyncStateStore
import com.folio.reader.data.TransferResult
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.net.InetAddress
import java.nio.file.Files
import kotlin.random.Random

/**
 * 端到端：真的起一个桌面端局域网服务（`tools/_lan-fixture.mjs`），
 * 用手机端那套客户端代码去连。
 *
 * `FolioClient` 只依赖 `java.net`，所以能在 JVM 里原样跑 ——
 * 这里验证的是 2.6.0 的**新接口**真的对得上：
 * `/api/ping` 的能力位、`/api/library` 的清单、整文件下载（含断点续传）、
 * 分块上传（含「已经有了」的短路）、以及漫画按页取图。
 *
 * 夹具用 `--comic` 启动，所以漫画用例跑得通；不带 flag 时它只造两本书。
 */
class LanIntegrationTest {

    private var process: Process? = null
    private var dataDir: File? = null
    private var port: Int = 0
    private val token = "TEST123"

    @Before
    fun setUp() {
        assumeTrue("本机没有 node，跳过端到端测试", findNode() != null)
        val dir = Files.createTempDirectory("folio-lan-test").toFile()
        dataDir = dir
        val node = findNode()!!
        val script = locateFixture()
        assertTrue("找不到测试夹具 $script", script.exists())
        // 端口随机避开并行任务与上次残留
        val startPort = 21000 + Random.nextInt(2900)
        val builder = ProcessBuilder(
            node,
            script.absolutePath,
            dir.absolutePath,
            startPort.toString(),
            "--comic",
        )
        builder.redirectErrorStream(false)
        process = builder.start()
        val reader = BufferedReader(InputStreamReader(process!!.inputStream, Charsets.UTF_8))
        val line = reader.readLine() ?: error("夹具没有输出端口")
        port = Regex("\"port\":(\\d+)").find(line)?.groupValues?.get(1)?.toInt()
            ?: error("夹具输出里没有端口：$line")
    }

    @After
    fun tearDown() {
        process?.destroy()
        process?.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)
        dataDir?.deleteRecursively()
    }

    private fun client(): FolioClient = FolioClient("http://127.0.0.1:$port", token)

    private fun workDir(): File = File(dataDir, "work").apply { mkdirs() }

    /* ---------------- 能力位 ---------------- */

    @Test
    fun ping里带apiVersion与能力位() {
        val caps = client().capabilities()
        assertEquals(2, caps.apiVersion)
        assertTrue("版本号应该以 2.6.0 开头：${caps.serverVersion}", caps.serverVersion.startsWith("2.6.0"))
        assertTrue(caps.supportsLibrary)
        assertTrue(caps.supportsUpload)
        assertTrue(caps.supportsRange)
        assertTrue(caps.supportsComic)
        assertNotNull("limits 要带上，客户端别硬编码上限", caps.limits)
        assertEquals(30L * 1024 * 1024, caps.limits!!.transfer)
        assertEquals(4L * 1024 * 1024, caps.limits!!.chunk)
    }

    /* ---------------- 清单 ---------------- */

    @Test
    fun 清单里有内容哈希与可搬运标记() {
        val snapshot = client().library()
        assertEquals(2, snapshot.apiVersion)
        val local = snapshot.books.first { it.book.id == "local-1" }
        assertTrue("local-1 应该可整本搬运", local.syncable)
        assertNotNull(local.book.contentHash)
        assertEquals(40, local.book.contentHash!!.length)
        assertEquals("本地测试书", local.book.title)

        val cloud = snapshot.books.first { it.book.id == "cloud-1" }
        assertFalse("云端书没有正文副本，不能搬", cloud.syncable)
        assertNotNull(cloud.syncableReason)
    }

    /* ---------------- 整文件下载 ---------------- */

    @Test
    fun 能整本下载并校验哈希() {
        val snapshot = client().library()
        val hash = snapshot.books.first { it.book.id == "local-1" }.book.contentHash!!
        val dest = File(workDir(), "local-1.txt")
        val result = client().downloadBook("local-1", dest, expectedHash = hash)
        assertEquals(hash, result.hash)
        assertEquals(0L, result.fromOffset)
        assertTrue(dest.isFile)
        val text = dest.readText(Charsets.UTF_8)
        assertTrue(text.contains("第一章 起风了"))
        assertTrue(text.contains("雨点敲在窗上"))
    }

    @Test
    fun 断点续传能拼回整本() {
        val snapshot = client().library()
        val hash = snapshot.books.first { it.book.id == "local-1" }.book.contentHash!!
        val full = File(workDir(), "full.txt")
        client().downloadBook("local-1", full, expectedHash = hash)
        val bytes = full.readBytes()
        assertTrue("夹具正文应该有几个字节", bytes.size > 40)

        // 模拟「上次传到 24 字节就断了」
        val resumeOffset = 24L
        val part = File(workDir(), "part.txt")
        part.writeBytes(bytes.copyOfRange(0, resumeOffset.toInt()))

        val resumed = client().downloadBook(
            id = "local-1",
            dest = part,
            offset = resumeOffset,
            expectedHash = hash,
        )
        assertEquals(resumeOffset, resumed.fromOffset)
        assertEquals("续传后的整本哈希必须还对得上", hash, resumed.hash)
        assertArrayEquals(bytes, part.readBytes())
    }

    @Test
    fun 起点超过文件大小会报416() {
        val error = runCatching {
            client().downloadBook("local-1", File(workDir(), "oob.txt"), offset = 99_999_999L)
        }.exceptionOrNull()
        assertTrue(error is FolioException)
        assertEquals(416, (error as FolioException).status)
    }

    /* ---------------- 分块上传 ---------------- */

    @Test
    fun 上传一本新书后清单里能查到() {
        val bytes = "上传给桌面端的测试正文\n第一章 测试\n随便写点什么。".toByteArray(Charsets.UTF_8)
        val hash = HashUtils.sha1(bytes)
        val file = File(workDir(), "upload.txt")
        file.writeBytes(bytes)

        val client = client()
        val status = client.uploadStatus(hash, bytes.size.toLong())
        assertFalse("新内容不该已经存在", status.done)
        assertEquals(0L, status.received)

        val result = client.uploadChunk(
            file = file,
            offset = 0L,
            length = bytes.size,
            hash = hash,
            total = bytes.size.toLong(),
            name = "上传测试书",
        )
        assertTrue("一次传完就该 done", result.done)
        assertNotNull("完成响应必须回 id", result.id)
        val id = result.id!!

        val snapshot = client.library()
        val uploaded = snapshot.books.firstOrNull { it.book.id == id }
        assertNotNull("上传完的书应该在清单里", uploaded)
        assertEquals("上传测试书", uploaded!!.book.title)
        assertEquals(hash, uploaded.book.contentHash)
        assertTrue(uploaded.syncable)
    }

    @Test
    fun 已经存在的内容上传时直接说完成() {
        val snapshot = client().library()
        val item = snapshot.books.first { it.book.id == "local-1" }
        val status = client().uploadStatus(item.book.contentHash!!, item.book.size)
        assertTrue("桌面端已经有这份内容", status.done)
    }

    @Test
    fun offset不连续会回409并告诉自己已收到多少() {
        val bytes = "用来测 offset 不连续".toByteArray(Charsets.UTF_8)
        val hash = HashUtils.sha1(bytes)
        val file = File(workDir(), "gap.txt")
        file.writeBytes(bytes)
        val error = runCatching {
            client().uploadChunk(
                file = file,
                offset = 8L,
                length = bytes.size - 8,
                hash = hash,
                total = bytes.size.toLong(),
                name = "断点书",
            )
        }.exceptionOrNull()
        assertTrue("应该抛冲突：$error", error is UploadConflictException)
        assertEquals(0L, (error as UploadConflictException).received)
    }

    /* ---------------- 漫画 ---------------- */

    @Test
    fun 漫画清单只有总页数没有源站地址() {
        val pages = client().comicPages("comic-1", 0)
        assertEquals(0, pages.index)
        assertEquals(3, pages.total)
    }

    @Test
    fun 能取到漫画首页的字节() {
        val client = client()
        client.comicPage("comic-1", 0, 0).use { stream ->
            val bytes = stream.input.readBytes()
            assertTrue("应该拿到真 PNG", bytes.size > 8)
            assertEquals(0x89.toByte(), bytes[0])
            assertEquals('P'.code.toByte(), bytes[1])
            assertEquals("X-Folio-Page 应该带 1/3", 3, stream.total)
        }
    }

    @Test
    fun 越界的页回400并带上总页数() {
        val error = runCatching {
            client().comicPage("comic-1", 0, 99).use { it.input.readBytes() }
        }.exceptionOrNull()
        assertTrue(error is FolioException)
        assertEquals(400, (error as FolioException).status)
    }

    @Test
    fun 源站失败时回502() {
        // 夹具第 2 话的第 0 张是「源站 500」
        val error = runCatching {
            client().comicPage("comic-1", 2, 0).use { it.input.readBytes() }
        }.exceptionOrNull()
        assertTrue("应该是 502：$error", error is FolioException)
        assertEquals(502, (error as FolioException).status)
        assertTrue(error!!.message!!.contains("源站"))
    }

    @Test
    fun 不存在的漫画话号回错误() {
        val error = runCatching { client().comicPages("comic-1", 99) }.exceptionOrNull()
        assertTrue(error is FolioException)
    }

    /* ---------------- 进度与鉴权 ---------------- */

    @Test
    fun 能拿到桌面端已有的进度() {
        val state = client().fetchState()
        val entry = state.progress["local-1"]
        assertNotNull(entry)
        assertEquals(1, entry!!.paraIndex)
        assertEquals(12.5, entry.percent!!, 0.001)
    }

    @Test
    fun 回写进度后桌面端能读回() {
        val client = client()
        val entry = ProgressEntry(
            id = "local-1",
            paraIndex = 42,
            chapterTitle = "第二章 落雨",
            percent = 66.0,
            updatedAt = System.currentTimeMillis(),
        )
        assertTrue(client.postProgress("local-1", BookKind.LOCAL, entry))

        val state = client.fetchState()
        val saved = state.progress["local-1"]
        assertNotNull(saved)
        assertEquals(42, saved!!.paraIndex)
        assertEquals(66.0, saved.percent!!, 0.001)
        assertEquals("第二章 落雨", saved.chapterTitle)
    }

    @Test
    fun 访问码不对时提示去改访问码() {
        val wrong = FolioClient("http://127.0.0.1:$port", "WRONG1")
        val error = runCatching { wrong.library() }.exceptionOrNull()
        assertNotNull("错误访问码应该失败", error)
        val failure = error as FolioException
        assertEquals(401, failure.status)
        assertTrue("文案应该点明访问码：${failure.message}", failure.message!!.contains("访问码"))
    }

    @Test
    fun 桌面端能被发现() {
        val found = LanDiscovery.probe(listOf(InetAddress.getByName("127.0.0.1")), 2000)
        assertTrue("没收到任何发现回应", found.isNotEmpty())
        // UDP 发现端口是固定的 45678：这台机器上如果真跑着一个 Folio 桌面端，
        // 它会把这个端口占住（夹具用 reuseAddr 也能绑，但收包只会给其中一方）。
        // 那种情况下这条用例没有可断言的对象，跳过而不是假装失败。
        val url = found.keys.firstOrNull { it.endsWith(":$port") }
        assumeTrue("局域网里已有真的桌面端占用 45678，夹具收不到回应", url != null)
        assertTrue(url!!.startsWith("http://"))
        assertFalse("回应里应该带版本号", found.getValue(url).isBlank())
    }

    /* ---------------- 设备管理（T09 / T11） ---------------- */

    /**
     * 心跳 → 入队 → 领取 → 下载 → sha1 校验 → 回执 → history：完整一条设备指令链。
     *
     * 执行侧用的是真的 [SyncEngine]（真下载、真校验、真入库），入队这一步没有
     * 管理接口（那是桌面端 UI 的事），所以直接改 `devices.json` —— 夹具每次都从
     * 磁盘读，效果和桌面端点按钮一样。
     */
    @Test
    fun pushBook端到端_领取下载校验回执done() {
        val deviceId = "test-device-1"
        val phone = client(deviceId)

        val hb = phone.heartbeat()
        assertTrue("桌面端应该支持设备接口", hb.supported)
        assertTrue("心跳应该成功：${hb.message}", hb.ok)
        assertEquals(0, hb.pending)
        assertNotNull(hb.device)
        assertEquals("新设备应该落盘", "测试机", readDevice(deviceId).getString("name"))

        val hash = client().library().books.first { it.book.id == "local-1" }.book.contentHash!!
        enqueueCommand(deviceId, "cmd_test_1", "push-book", hash)
        assertEquals("入队后心跳应报 1 条", 1, phone.heartbeat().pending)

        val library = File(dataDir, "phone-push").apply { mkdirs() }
        val books = BookStore(library)
        val files = BookFileStore(library)
        val sync = SyncEngine(
            books = books,
            progress = ProgressStore(library),
            syncState = SyncStateStore(library),
            files = files,
            clientProvider = { phone },
        )

        val outcomes = runBlocking { sync.runPendingCommands() }
        assertEquals(1, outcomes.size)
        assertTrue("指令应该执行成功：${outcomes[0].error}", outcomes[0].ok)

        val pulled = books.read().firstOrNull { it.contentHash == hash }
        assertNotNull("下载的书应该入库", pulled)
        assertTrue("正文文件应该落盘", files.exists(pulled!!.id))
        assertEquals(
            "下载后的字节必须与桌面端 sha1 一致",
            hash,
            HashUtils.sha1(files.fileFor(pulled.id).readBytes()),
        )

        val record = readDevice(deviceId)
        assertEquals("回执完应从未完结队列移除", 0, record.getJSONArray("commands").length())
        val history = record.getJSONArray("history")
        assertEquals(1, history.length())
        assertEquals("done", history.getJSONObject(0).getString("state"))
        assertEquals("cmd_test_1", history.getJSONObject(0).getString("id"))
        assertEquals("已下到手机", history.getJSONObject(0).getString("detail"))
    }

    @Test
    fun 过期指令不会发给手机_而是进history的expired() {
        val deviceId = "test-device-2"
        val phone = client(deviceId)
        phone.heartbeat()

        val hash = client().library().books.first { it.book.id == "local-1" }.book.contentHash!!
        enqueueCommand(
            deviceId,
            "cmd_expired",
            "push-book",
            hash,
            expiresAt = System.currentTimeMillis() - 1_000L,
        )

        val fetch = phone.fetchCommands()
        assertTrue("过期指令不该再执行", fetch.commands.isEmpty())
        val history = readDevice(deviceId).getJSONArray("history")
        assertEquals(1, history.length())
        assertEquals("expired", history.getJSONObject(0).getString("state"))

        // 迟到的回执不该把已过期指令「救活」
        assertFalse("过期后回执应被拒绝", phone.postReceipt("cmd_expired", "done").ok)
        assertEquals("history 里仍然只有那一条", 1, readDevice(deviceId).getJSONArray("history").length())
    }

    /**
     * `remove-book{unique:true}` 被用户拒绝：手机上正文一个字节都不能动，
     * 桌面端收到的回执必须是 `failed / user_rejected`。
     *
     * 这里用的是真的 [CommandExecutor] + 真的本地库（临时目录），
     * 只有搬运接口是替身 —— remove-book 本来就不搬字节。
     */
    @Test
    fun 删唯一副本被拒_回执userRejected且正文还在() {
        val deviceId = "test-device-3"
        val phone = client(deviceId)
        phone.heartbeat()

        val hash = client().library().books.first { it.book.id == "local-1" }.book.contentHash!!
        val library = File(dataDir, "phone-library").apply { mkdirs() }
        val books = BookStore(library)
        val files = BookFileStore(library)
        val book = LocalBook(
            id = "sha1-$hash",
            title = "唯一的一份",
            origin = Origin.LOCAL,
            contentHash = hash,
            size = 12L,
            hasLocalFile = true,
            addedAt = 1_700_000_000_000L,
        )
        books.upsert(book)
        files.writeText(book.id, "手机上的唯一正文")

        var asked = 0
        val executor = CommandExecutor(
            books = books,
            progress = ProgressStore(library),
            syncState = SyncStateStore(library),
            files = files,
            transfer = NoTransfer,
            confirmer = DeleteConfirmer { asked += 1; false },
        )

        enqueueCommand(deviceId, "cmd_reject", "remove-book", hash, unique = true)
        val fetch = phone.fetchCommands()
        assertEquals(1, fetch.commands.size)

        val outcomes = runBlocking { executor.runAll(phone, fetch.commands) }
        assertEquals(1, outcomes.size)
        assertEquals("user_rejected", outcomes[0].error)
        assertEquals("唯一副本必须弹确认", 1, asked)

        assertTrue("拒绝后正文必须还在", files.exists(book.id))
        assertNotNull("拒绝后书架条目必须还在", books.findById(book.id))

        val history = readDevice(deviceId).getJSONArray("history")
        assertEquals(1, history.length())
        val entry = history.getJSONObject(0)
        assertEquals("failed", entry.getString("state"))
        assertEquals("user_rejected", entry.getString("error"))
    }

    @Test
    fun 快照上报后桌面端能读到书架摘要() {
        val deviceId = "test-device-4"
        val phone = client(deviceId)
        phone.heartbeat()

        val hash = client().library().books.first { it.book.id == "local-1" }.book.contentHash!!
        val body = org.json.JSONObject()
            .put(
                "books",
                org.json.JSONArray().put(
                    org.json.JSONObject()
                        .put("hash", hash)
                        .put("title", "手机上的书")
                        .put("size", 12)
                        .put("hasLocalFile", true),
                ),
            )
            .put("storageTotal", 64L * 1024 * 1024 * 1024)
            .put("storageFree", 8L * 1024 * 1024 * 1024)
            .put("booksBytes", 12)

        val ack = phone.postSnapshot(body)
        assertTrue("快照应被接受：${ack.message}", ack.ok)
        val snapshot = readDevice(deviceId).getJSONObject("snapshot")
        val saved = snapshot.getJSONArray("books").getJSONObject(0)
        assertEquals("手机上的书", saved.getString("title"))
        assertEquals(hash, saved.getString("hash"))
        assertTrue(saved.getBoolean("hasLocalFile"))
        assertEquals(8L * 1024 * 1024 * 1024, snapshot.getLong("storageFree"))
    }

    /* ---------------- 工具 ---------------- */

    /** 带设备身份的手机端客户端：每个请求都会带 `X-Folio-Device*` 五个头。 */
    private fun client(deviceId: String): FolioClient = FolioClient(
        baseUrl = "http://127.0.0.1:$port",
        token = token,
        device = DeviceIdentity(installId = deviceId, name = "测试机"),
    )

    private fun devicesFile(): File = File(dataDir!!, "devices.json")

    private fun readDevice(deviceId: String): JSONObject {
        val root = JSONObject(devicesFile().readText(Charsets.UTF_8))
        val devices = root.getJSONArray("devices")
        for (i in 0 until devices.length()) {
            val item = devices.getJSONObject(i)
            if (item.optString("id") == deviceId) return item
        }
        error("devices.json 里没有设备 $deviceId")
    }

    /**
     * 直接往 `devices.json` 入队一条指令。
     *
     * devicestore 每次请求都从磁盘 `load()`，所以这和桌面端点「发送到手机」
     * 落在同一个文件上，只是绕过了没有对外暴露的管理接口。
     */
    private fun enqueueCommand(
        deviceId: String,
        commandId: String,
        type: String,
        hash: String,
        unique: Boolean = false,
        expiresAt: Long = System.currentTimeMillis() + 86_400_000L,
    ) {
        val file = devicesFile()
        val root = JSONObject(file.readText(Charsets.UTF_8))
        val devices = root.getJSONArray("devices")
        var target: JSONObject? = null
        for (i in 0 until devices.length()) {
            val item = devices.getJSONObject(i)
            if (item.optString("id") == deviceId) target = item
        }
        val record = target ?: error("devices.json 里没有设备 $deviceId")
        val commands = record.optJSONArray("commands") ?: JSONArray().also {
            record.put("commands", it)
        }
        commands.put(
            JSONObject()
                .put("id", commandId)
                .put("type", type)
                .put("payload", JSONObject().put("hash", hash).put("unique", unique))
                .put("createdAt", System.currentTimeMillis())
                .put("expiresAt", expiresAt)
                .put("state", "pending"),
        )
        file.writeText(root.toString(2), Charsets.UTF_8)
    }

    private fun findNode(): String? {
        val candidates = listOf("node", "node.exe")
        for (name in candidates) {
            val path = System.getenv("PATH")?.split(File.pathSeparator)?.map { File(it, name) }
            if (path != null) {
                for (item in path) {
                    if (item.isFile) return item.absolutePath
                }
            }
        }
        return null
    }

    private fun locateFixture(): File {
        val cwd = System.getProperty("user.dir") ?: "."
        var dir: File? = File(cwd).absoluteFile
        repeat(4) {
            val current: File = dir ?: error("找不到 tools/_lan-fixture.mjs")
            val candidate = File(current, "tools/_lan-fixture.mjs")
            if (candidate.exists()) return candidate
            dir = current.parentFile
        }
        error("找不到 tools/_lan-fixture.mjs")
    }
}

/** remove-book 不搬字节，给真 [CommandExecutor] 一个空搬运实现。 */
private object NoTransfer : BookTransfer {
    override suspend fun pullByHash(hash: String): TransferResult = TransferResult.Done
    override suspend fun pushByHash(hash: String): TransferResult = TransferResult.Done
}
