package com.folio.reader.net

import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.BufferedInputStream
import java.io.Closeable
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket

/**
 * T07 设备身份：五个设备头 + 四条设备接口的降级行为。
 *
 * 这里起的是**真的 socket 服务器**（不是 mock、也不是 `com.sun.net.httpserver`
 * ——后者在 Android 单测的编译类路径里拿不到）。要验的正是「线缆上真正发了哪些头」，
 * 把 `HttpURLConnection` mock 掉只能验证自己那层调用。
 *
 * 头名按 HTTP 规范大小写不敏感，这里统一转小写比对。
 */
class DeviceHeadersTest {

    /** 收到的一次请求。 */
    private data class Recorded(
        val method: String,
        val path: String,
        val headers: Map<String, String>,
    )

    /** 一次响应。 */
    private data class Response(val code: Int, val body: String)

    /**
     * 极简 HTTP/1.1 服务：一次一个连接，读到 `Connection: close` 就关。
     *
     * 只实现这套测试需要的那点东西：请求行、头、按 Content-Length 丢掉请求体、回一段 JSON。
     */
    private class TinyServer(private val respond: (Recorded) -> Response) : Closeable {
        private val socket = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))

        val port: Int get() = socket.localPort

        private val worker = Thread({ loop() }, "tiny-http").apply {
            isDaemon = true
            start()
        }

        private fun loop() {
            while (!socket.isClosed) {
                val client = runCatching { socket.accept() }.getOrNull() ?: return
                runCatching { client.use { handle(it) } }
            }
        }

        private fun handle(client: Socket) {
            val input = BufferedInputStream(client.getInputStream())
            val requestLine = readLine(input) ?: return
            val parts = requestLine.split(" ")
            val headers = LinkedHashMap<String, String>()
            while (true) {
                val line = readLine(input) ?: break
                if (line.isEmpty()) break
                val colon = line.indexOf(':')
                if (colon > 0) {
                    headers[line.substring(0, colon).trim().lowercase()] =
                        line.substring(colon + 1).trim()
                }
            }
            // 请求体按 Content-Length 读掉，否则下一次握手可能读到残余字节
            val length = headers["content-length"]?.toIntOrNull() ?: 0
            var remaining = length
            val buffer = ByteArray(8192)
            while (remaining > 0) {
                val count = input.read(buffer, 0, minOf(buffer.size, remaining))
                if (count <= 0) break
                remaining -= count
            }

            val method = parts.getOrNull(0) ?: "GET"
            val path = (parts.getOrNull(1) ?: "/").substringBefore('?')
            val response = respond(Recorded(method, path, headers))
            val bytes = response.body.toByteArray(Charsets.UTF_8)
            val head = buildString {
                append("HTTP/1.1 ${response.code} ${if (response.code in 200..299) "OK" else "ERR"}\r\n")
                append("Content-Type: application/json; charset=utf-8\r\n")
                append("Content-Length: ${bytes.size}\r\n")
                append("Connection: close\r\n")
                append("\r\n")
            }
            client.getOutputStream().apply {
                write(head.toByteArray(Charsets.UTF_8))
                write(bytes)
                flush()
            }
        }

        private fun readLine(input: InputStream): String? {
            val sb = StringBuilder()
            while (true) {
                val value = input.read()
                if (value < 0) return if (sb.isEmpty()) null else sb.toString()
                if (value == '\n'.code) break
                if (value != '\r'.code) sb.append(value.toChar())
            }
            return sb.toString()
        }

        override fun close() {
            runCatching { socket.close() }
            worker.interrupt()
        }
    }

    private lateinit var server: TinyServer
    private lateinit var baseUrl: String
    private val recorded = ArrayList<Recorded>()

    /** 每个用例自己换。 */
    private var responder: (String) -> Response = { Response(200, """{"ok":true}""") }

    @Before
    fun setUp() {
        server = TinyServer { request ->
            recorded.add(request)
            responder(request.path)
        }
        baseUrl = "http://127.0.0.1:${server.port}"
    }

    @After
    fun tearDown() {
        server.close()
    }

    private fun client(
        installId: String = "8f14e45f-ceea-467f-a1a0-1d0b2b0c9f3e",
        deviceName: String = "Pixel 6",
        token: String = "TEST123",
    ): FolioClient = FolioClient(
        baseUrl = baseUrl,
        token = token,
        device = DeviceIdentity(installId = installId, name = deviceName),
    )

    private fun lastHeaders(): Map<String, String> = recorded.last().headers

    @Test
    fun 有身份时五个设备头齐全且值正确() {
        responder = {
            Response(
                200,
                """{"ok":true,"device":{"id":"8f14e45f","name":"Pixel 6","online":true},"pending":3,"serverTime":1794000000000}""",
            )
        }

        val status = client().heartbeat()

        assertTrue("心跳应成功", status.ok)
        assertEquals(3, status.pending)
        assertEquals(1794000000000L, status.serverTime)
        assertEquals("8f14e45f", status.device?.id)
        assertEquals("Pixel 6", status.device?.name)

        val headers = lastHeaders()
        assertEquals("/api/device/heartbeat", recorded.last().path)
        assertEquals("8f14e45f-ceea-467f-a1a0-1d0b2b0c9f3e", headers["x-folio-device"])
        // 设备名按 URL 编码发（桌面端会 safeDecode）
        assertEquals("Pixel%206", headers["x-folio-device-name"])
        assertEquals("android", headers["x-folio-platform"])
        // 版本号不写死在测试里：它必须等于打包配置，写死就等于允许漂
        assertEquals(com.folio.reader.BuildConfig.VERSION_NAME, headers["x-folio-app-version"])
        assertEquals("2", headers["x-folio-api-version"])
        assertEquals("TEST123", headers["x-folio-token"])
    }

    @Test
    fun 没有身份时一个设备头都不发() {
        responder = { Response(200, """{"ok":false,"error":"missing_device"}""") }

        val status = client(installId = "").heartbeat()

        assertTrue("桌面端拒绝心跳时 supported 仍为 true", status.supported)
        assertFalse(status.ok)
        assertEquals("missing_device", status.message)

        val headers = lastHeaders()
        assertNull("没身份时不许带 X-Folio-Device", headers["x-folio-device"])
        assertNull(headers["x-folio-device-name"])
        assertNull(headers["x-folio-platform"])
        assertNull(headers["x-folio-app-version"])
        assertNull(headers["x-folio-api-version"])
    }

    @Test
    fun 回执非法状态码时返回失败而不是崩() {
        responder = { Response(400, """{"ok":false,"error":"bad_state"}""") }

        val ack = client().postReceipt("cmd-1", "weird")

        assertTrue("接口是存在的", ack.supported)
        assertFalse(ack.ok)
        assertEquals("bad_state", ack.message)
        assertEquals("/api/device/commands/cmd-1/receipt", recorded.last().path)
        assertEquals("POST", recorded.last().method)
    }

    @Test
    fun 设备接口404时统一返回不支持() {
        responder = { Response(404, """{"ok":false,"error":"not_found"}""") }

        val heartbeat = client().heartbeat()
        val commands = client().fetchCommands()
        val receipt = client().postReceipt("cmd-1", "done")
        val snapshot = client().postSnapshot(JSONObject().put("books", 0))

        assertFalse("404 → 心跳不支持", heartbeat.supported)
        assertFalse("404 → 拉指令不支持", commands.supported)
        assertFalse("404 → 回执不支持", receipt.supported)
        assertFalse("404 → 快照不支持", snapshot.supported)
        assertNull(heartbeat.device)
        assertTrue(commands.commands.isEmpty())
    }

    @Test
    fun 设备接口501也算不支持() {
        responder = { Response(501, """{"ok":false,"error":"not_implemented"}""") }

        assertFalse(client().heartbeat().supported)
        assertFalse(client().fetchCommands().supported)
        assertFalse(client().postSnapshot(JSONObject()).supported)
    }

    @Test
    fun 拉指令解析出四条字段且payload转成字符串() {        responder = {
            Response(
                200,
                """
                {"ok":true,"commands":[
                  {"id":"c1","type":"push-book","payload":{"bookId":"b1","hash":"abc"},
                   "batchId":"batch-1","createdAt":1794000000000,"expiresAt":1794000600000},
                  {"id":"c2","type":"remove-book","payload":"plain-string","createdAt":1794000001000},
                  {"id":"","type":"push-book","payload":{}}
                ]}
                """.trimIndent(),
            )
        }

        val fetched = client().fetchCommands()

        assertTrue(fetched.ok)
        assertEquals("空 id 的脏数据要被丢掉", 2, fetched.commands.size)
        assertEquals("c1", fetched.commands[0].id)
        assertEquals("push-book", fetched.commands[0].type)
        assertEquals("batch-1", fetched.commands[0].batchId)
        assertEquals(1794000600000L, fetched.commands[0].expiresAt)
        // payload 是对象 → 序列化成 JSON 字符串；执行器自己解析
        assertTrue(
            "payload 应转成 JSON 字符串，实际 " + fetched.commands[0].payloadJson,
            fetched.commands[0].payloadJson.contains("\"bookId\":\"b1\""),
        )
        assertEquals("plain-string", fetched.commands[1].payloadJson)
        assertNull(fetched.commands[1].batchId)
    }
}
