package com.folio.reader.net

import com.folio.reader.core.BookKind
import com.folio.reader.core.ProgressEntry
import org.junit.After
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

/**
 * 端到端：真的起一个桌面端局域网服务，用手机端那套客户端代码去连。
 *
 * FolioClient 只依赖 java.net，所以能在 JVM 里原样跑；
 * 这里验证的是协议真的对得上，而不是两边各写一套假设。
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
        val builder = ProcessBuilder(node, script.absolutePath, dir.absolutePath, "21300")
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

    @Test
    fun 能拿到桌面端书架() {
        val state = client().fetchState()
        assertEquals(2, state.books.size)
        assertTrue(state.books.any { it.id == "local-1" && it.title == "本地测试书" })
        assertTrue(state.books.any { it.id == "cloud-1" && it.isCloud })
    }

    @Test
    fun 能拿到桌面端已有的进度() {
        val state = client().fetchState()
        val entry = state.progress["local-1"]
        assertNotNull(entry)
        assertEquals(1, entry!!.paraIndex)
        assertEquals(12.5, entry.percent!!, 0.001)
    }

    @Test
    fun 能读本地书正文() {
        val text = client().fetchBookText("local-1")
        assertTrue(text.contains("第一章 起风了"))
        assertTrue(text.contains("雨点敲在窗上"))
    }

    @Test
    fun 访问码不对时会被挡住() {
        val wrong = FolioClient("http://127.0.0.1:$port", "WRONG1")
        val failed = runCatching { wrong.fetchState() }.exceptionOrNull()
        assertNotNull("错误访问码应该失败", failed)
        assertTrue(failed!!.message?.contains("访问码") == true)
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
    fun 旧的进度不会覆盖新的() {
        val client = client()
        val now = System.currentTimeMillis()
        // 先写一条新的
        client.postProgress(
            "local-1",
            BookKind.LOCAL,
            ProgressEntry("local-1", paraIndex = 88, percent = 90.0, updatedAt = now),
        )
        // 再写一条旧的
        client.postProgress(
            "local-1",
            BookKind.LOCAL,
            ProgressEntry("local-1", paraIndex = 1, percent = 5.0, updatedAt = now - 5000),
        )
        val state = client.fetchState()
        val saved = state.progress["local-1"]
        assertEquals(88, saved!!.paraIndex)
        assertEquals(90.0, saved.percent!!, 0.001)
    }

    @Test
    fun 书架上没有的书不接收进度() {
        val client = client()
        val failed = runCatching {
            client.postProgress(
                "not-in-shelf",
                BookKind.LOCAL,
                ProgressEntry("not-in-shelf", paraIndex = 1, percent = 1.0, updatedAt = System.currentTimeMillis()),
            )
        }.exceptionOrNull()
        assertNotNull(failed)
    }

    @Test
    fun 桌面端能被发现() {
        val found = LanDiscovery.probe(listOf(InetAddress.getByName("127.0.0.1")), 2000)
        assertTrue("没收到发现回应", found.isNotEmpty())
        val url = found.keys.first()
        assertTrue(url.startsWith("http://"))
        assertTrue(url.endsWith(":$port"))
        assertFalse(found.values.first().isBlank())
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
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        repeat(4) {
            val current: File = dir ?: error("找不到 tools/_lan-fixture.mjs")
            val candidate = File(current, "tools/_lan-fixture.mjs")
            if (candidate.exists()) return candidate
            dir = current.parentFile
        }
        error("找不到 tools/_lan-fixture.mjs")
    }
}
