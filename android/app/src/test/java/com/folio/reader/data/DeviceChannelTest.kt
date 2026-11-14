package com.folio.reader.data

import com.folio.reader.net.FolioClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.BufferedReader
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * 前台在线通道（T09）。
 *
 * 用一个真的本地 HTTP 服务当桌面端：它按 `lan.js` 的协议回心跳 / 指令，
 * 并在 `/api/events` 上真的开一条 SSE 流。这样验的是「Lifecycle 翻转 →
 * 连接数 0→1→0」这件事本身，而不是某个 mock 的调用次数。
 *
 * 为什么不用 `com.sun.net.httpserver`：Android 单元测试的编译类路径里没有
 * `jdk.httpserver` 模块（`Unresolved reference 'sun'`），用裸 [ServerSocket]
 * 手写这几十行 HTTP 反而没有依赖。
 */
class DeviceChannelTest {

    private lateinit var server: ServerSocket
    private var port = 0
    private var acceptThread: Thread? = null

    /** 桌面端看到的 SSE 连接数（打开 / 关闭各计一次）。 */
    private val eventsOpened = AtomicInteger()
    private val eventsClosed = AtomicInteger()
    private val heartbeatHits = AtomicInteger()

    @Volatile
    private var sseOut: OutputStream? = null

    /** 心跳里报的积压条数，用例可改。 */
    @Volatile
    private var pending = 0

    /** false 时心跳回 404 —— 模拟「老桌面端没有设备接口」。 */
    @Volatile
    private var heartbeatSupported = true

    @Before
    fun setUp() {
        server = ServerSocket(0, 20, InetAddress.getByName("127.0.0.1"))
        port = server.localPort
        acceptThread = Thread {
            while (true) {
                val socket = try {
                    server.accept()
                } catch (err: Exception) {
                    break // 服务关闭
                }
                Thread { handle(socket) }.apply { isDaemon = true }.start()
            }
        }.apply {
            isDaemon = true
            start()
        }
    }

    @After
    fun tearDown() {
        runCatching { server.close() }
    }

    /* ---------------- 用例 ---------------- */

    @Test
    fun 前台开后台关_连接数从0到1再回0() {
        val channel = DeviceChannel(
            clientProvider = { client() },
            retryMs = 100L,
        )
        try {
            channel.start { }
            assertTrue("SSE 应该连上", await(4000) { channel.online.value })
            assertEquals(1, eventsOpened.get())

            channel.stop()
            assertTrue("stop 后应立刻离线", await(4000) { !channel.online.value })
            assertTrue("桌面端应看到连接关闭", await(4000) { eventsClosed.get() == 1 })
        } finally {
            channel.stop()
        }
    }

    @Test
    fun 收到command事件就执行排队指令() {
        val hits = AtomicInteger()
        val first = CountDownLatch(1)
        val channel = DeviceChannel(
            clientProvider = { client() },
            retryMs = 100L,
        )
        try {
            channel.start {
                hits.incrementAndGet()
                first.countDown()
            }
            assertTrue("SSE 应该连上", await(4000) { channel.online.value })
            // 连上时 pending=0，不该抢跑
            assertEquals(0, hits.get())

            pushEvent("command", "{}")
            assertTrue("应被 command 事件触发", first.await(4, TimeUnit.SECONDS))
            Thread.sleep(300)
            assertEquals("同一轮不应重复执行", 1, hits.get())
        } finally {
            channel.stop()
        }
    }

    @Test
    fun 连上时心跳报有积压_立刻执行一轮() {
        pending = 2
        val hits = AtomicInteger()
        val latch = CountDownLatch(1)
        val channel = DeviceChannel(
            clientProvider = { client() },
            retryMs = 100L,
        )
        try {
            channel.start {
                hits.incrementAndGet()
                pending = 0
                latch.countDown()
            }
            assertTrue("应立刻执行积压指令", latch.await(4, TimeUnit.SECONDS))
        } finally {
            channel.stop()
        }
    }

    @Test
    fun 老桌面端没有设备接口_整条通道静默关闭() {
        heartbeatSupported = false
        val channel = DeviceChannel(
            clientProvider = { client() },
            retryMs = 100L,
        )
        try {
            channel.start { }
            assertTrue("应至少问过一次心跳", await(3000) { heartbeatHits.get() >= 1 })
            Thread.sleep(400)
            assertFalse("不支持时不许报在线", channel.online.value)
            assertEquals("不该去开 SSE", 0, eventsOpened.get())
            assertEquals("静默退出，不重试", 1, heartbeatHits.get())
        } finally {
            channel.stop()
        }
    }

    @Test
    fun 配置不齐时不发任何请求() {
        var configured = false
        val channel = DeviceChannel(
            clientProvider = { client() },
            isConfigured = { configured },
            retryMs = 100L,
        )
        try {
            channel.start { }
            Thread.sleep(400)
            assertEquals(0, heartbeatHits.get())
            assertFalse(channel.online.value)

            channel.stop()
            configured = true
            channel.start { }
            assertTrue("配置补齐后重开应能连上", await(4000) { channel.online.value })
        } finally {
            channel.stop()
        }
    }

    /* ---------------- 迷你 HTTP 服务 ---------------- */

    private fun client(): FolioClient = FolioClient("http://127.0.0.1:$port", "TEST123")

    private fun handle(socket: Socket) {
        try {
            socket.use { conn ->
                val input = conn.getInputStream().bufferedReader()
                val requestLine = input.readLine() ?: return
                val path = requestLine.split(' ').getOrNull(1).orEmpty()
                // 读完请求头（空行结束）。GET/POST 的 body 这里不消费：
                // 每条请求之后 socket 就关了，不需要保持可复用。
                while (true) {
                    val line = input.readLine() ?: break
                    if (line.isEmpty()) break
                }
                when {
                    path.startsWith("/api/events") -> serveEvents(conn, input)
                    path.startsWith("/api/device/heartbeat") -> {
                        heartbeatHits.incrementAndGet()
                        if (!heartbeatSupported) {
                            respond(conn, 404, """{"ok":false,"error":"not found"}""")
                        } else {
                            respond(
                                conn,
                                200,
                                """{"ok":true,"device":{"id":"dev-1","name":"测试机",""" +
                                    """"online":true},"pending":$pending,"serverTime":0}""",
                            )
                        }
                    }
                    path.startsWith("/api/device/commands") ->
                        respond(conn, 200, """{"ok":true,"commands":[]}""")
                    path.startsWith("/api/ping") -> respond(
                        conn,
                        200,
                        """{"ok":true,"version":"2.7.0-fixture","apiVersion":2,""" +
                            """"features":["library","devices"],"limits":{}}""",
                    )
                    else -> respond(conn, 404, """{"ok":false,"error":"not found"}""")
                }
            }
        } catch (err: Exception) {
            // 连接被打断，忽略
        }
    }

    private fun respond(conn: Socket, code: Int, body: String) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        val head = "HTTP/1.1 $code ${if (code == 200) "OK" else "Error"}\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            "Content-Length: ${bytes.size}\r\n" +
            "Connection: close\r\n\r\n"
        val out = conn.getOutputStream()
        out.write(head.toByteArray(Charsets.US_ASCII))
        out.write(bytes)
        out.flush()
    }

    /** 真的开一条 SSE：hello + 每 50ms 一个注释心跳（客户端断开时写会抛异常）。 */
    private fun serveEvents(conn: Socket, input: BufferedReader) {
        eventsOpened.incrementAndGet()
        val out = conn.getOutputStream()
        sseOut = out
        val head = "HTTP/1.1 200 OK\r\n" +
            "Content-Type: text/event-stream; charset=utf-8\r\n" +
            "Cache-Control: no-cache\r\n" +
            "Connection: keep-alive\r\n\r\n"
        synchronized(out) {
            out.write(head.toByteArray(Charsets.US_ASCII))
            out.write("retry: 100\n\nevent: hello\ndata: {}\n\n".toByteArray())
            out.flush()
        }
        // 客户端不会往这条连接写东西：read 返回 -1 就说明它已经关了。
        val watcher = Thread {
            try {
                val buffer = CharArray(128)
                while (input.read(buffer) >= 0) {
                    // 丢弃
                }
            } catch (err: Exception) {
                // 关连接
            }
            runCatching { conn.close() }
        }.apply {
            isDaemon = true
            start()
        }
        try {
            while (true) {
                Thread.sleep(50)
                synchronized(out) {
                    out.write(": ping\n\n".toByteArray())
                    out.flush()
                }
            }
        } catch (err: Exception) {
            // 客户端关了
        } finally {
            eventsClosed.incrementAndGet()
            sseOut = null
            runCatching { conn.close() }
            watcher.interrupt()
        }
    }

    private fun pushEvent(name: String, data: String) {
        val out = sseOut ?: error("SSE 还没连上")
        synchronized(out) {
            out.write("event: $name\ndata: $data\n\n".toByteArray())
            out.flush()
        }
    }

    private fun await(timeoutMs: Long, condition: () -> Boolean): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (condition()) return true
            Thread.sleep(20)
        }
        return condition()
    }
}
