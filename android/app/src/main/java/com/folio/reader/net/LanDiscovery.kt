package com.folio.reader.net

import android.util.Log
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException

/**
 * 局域网内找桌面端。
 *
 * 桌面端在 lan.js 里监听一个 UDP 端口，只有收到广播才回一条，
 * 平时不占线程、不耗电；手机这边也**只在用户点「搜索桌面端」时**广播一次。
 *
 * 3.0 的行为（架构文档 §1.5）：
 *  - **一次性广播**：不再每 300ms 补发，避免「搜不到就一直刷网卡」；
 *  - **5 秒收集窗口**（`DISCOVERY_WINDOW`）：桌面端响应通常在 100ms 内，
 *    留 5 秒是为了兜住休眠刚醒、Wi-Fi 刚重连的慢响应；
 *  - **可取消**：窗口内每 250ms 问一次 [shouldStop]，用户返回上一页立刻停。
 */
object LanDiscovery {

    /** 桌面端发现端口（与 electron/lan.js 的 DISCOVERY_PORT 一致）。 */
    const val PORT = 45678

    /** 收集窗口：5 秒（架构文档 §8 `DISCOVERY_WINDOW`）。 */
    const val WINDOW_MS = 5000

    private const val MAGIC = "folio-discover"
    private const val TAG = "FolioDiscovery"

    /** 单次接收的等待粒度：既让 [shouldStop] 及时生效，又不会空转太多。 */
    private const val SLICE_MS = 250

    /** 收到的一条回应。 */
    data class Found(
        /** 形如 `http://192.168.1.20:57321`，可以直接填进设置。 */
        val url: String,
        val version: String,
        val apiVersion: Int,
        val host: String,
    )

    /**
     * 广播一次，在 [windowMs] 内收集回应。
     *
     * **必须在后台线程调用**：会阻塞到窗口结束或用户取消。
     *
     * @param windowMs 收集窗口，默认 5 秒
     * @param shouldStop 每次轮询都问一次；返回 true 立刻结束并返回已收到的结果
     * @return 去重后的结果，按发现顺序
     */
    fun discover(
        windowMs: Int = WINDOW_MS,
        shouldStop: () -> Boolean = { false },
    ): List<Found> {
        val found = LinkedHashMap<String, Found>()
        try {
            DatagramSocket().use { socket ->
                socket.broadcast = true
                socket.soTimeout = SLICE_MS
                // 一次性广播：每个网卡各发一条，之后不再补发
                sendOnce(socket)

                val buffer = ByteArray(2048)
                val deadline = System.currentTimeMillis() + windowMs
                while (System.currentTimeMillis() < deadline) {
                    if (shouldStop()) break
                    val response = DatagramPacket(buffer, buffer.size)
                    try {
                        socket.receive(response)
                    } catch (timeout: SocketTimeoutException) {
                        continue
                    } catch (err: Exception) {
                        Log.w(TAG, "接收发现回应失败", err)
                        break
                    }
                    val item = parse(response) ?: continue
                    found.putIfAbsent(item.url, item)
                }
            }
        } catch (err: Exception) {
            Log.w(TAG, "搜索桌面端失败", err)
        }
        return found.values.toList()
    }

    /**
     * 给定目标地址发一次探测，收集回应。**只为自动化测试保留**
     * （能用 `127.0.0.1` 直连，不必依赖真实网卡广播）。
     *
     * @return 地址 → 版本号
     */
    fun probe(targets: List<InetAddress>, timeoutMs: Int = 1500): Map<String, String> {
        val found = LinkedHashMap<String, String>()
        try {
            DatagramSocket().use { socket ->
                socket.broadcast = true
                socket.soTimeout = SLICE_MS

                val payload = MAGIC.toByteArray(Charsets.UTF_8)
                for (target in targets) {
                    val packet = DatagramPacket(payload, payload.size, target, PORT)
                    runCatching { socket.send(packet) }
                }

                val buffer = ByteArray(2048)
                val deadline = System.currentTimeMillis() + timeoutMs
                while (System.currentTimeMillis() < deadline) {
                    val response = DatagramPacket(buffer, buffer.size)
                    try {
                        socket.receive(response)
                    } catch (timeout: SocketTimeoutException) {
                        continue
                    } catch (err: Exception) {
                        break
                    }
                    val item = parse(response) ?: continue
                    found.putIfAbsent(item.url, item.version)
                }
            }
        } catch (err: Exception) {
            Log.w(TAG, "搜索桌面端失败", err)
        }
        return found
    }

    /* ---------------- 内部 ---------------- */

    /** 往全局广播地址与各网卡定向广播地址各发一条（只发一次）。 */
    private fun sendOnce(socket: DatagramSocket) {
        val payload = MAGIC.toByteArray(Charsets.UTF_8)
        for (target in broadcastAddresses()) {
            val packet = DatagramPacket(payload, payload.size, target, PORT)
            runCatching { socket.send(packet) }
                .onFailure { Log.w(TAG, "广播到 $target 失败", it) }
        }
    }

    private fun parse(response: DatagramPacket): Found? {
        val text = String(response.data, 0, response.length, Charsets.UTF_8)
        val json = runCatching { JSONObject(text) }.getOrNull() ?: return null
        val host = json.optString("host")
        val port = json.optInt("port")
        if (host.isBlank() || port <= 0) return null
        return Found(
            url = "http://$host:$port",
            version = json.optString("version"),
            apiVersion = json.optInt("apiVersion", 1),
            host = host,
        )
    }

    /** 全局广播地址 + 各网卡定向广播地址。 */
    private fun broadcastAddresses(): List<InetAddress> {
        val result = LinkedHashSet<InetAddress>()
        runCatching { result.add(InetAddress.getByName("255.255.255.255")) }
        runCatching {
            NetworkInterface.getNetworkInterfaces().iterator().asSequence().forEach { network ->
                if (network.isLoopback || !network.isUp) return@forEach
                network.interfaceAddresses.iterator().asSequence().forEach { address ->
                    val broadcast = address.broadcast ?: return@forEach
                    if (broadcast is Inet4Address) result.add(broadcast)
                }
            }
        }
        return result.toList()
    }
}
