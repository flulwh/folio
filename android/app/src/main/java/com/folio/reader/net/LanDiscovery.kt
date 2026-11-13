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
 * 平时不占线程、不耗电；手机这边也只在用户点「搜索桌面端」时才广播。
 */
object LanDiscovery {

    const val PORT = 45678
    private const val MAGIC = "folio-discover"
    private const val TAG = "FolioDiscovery"

    /** 广播并收集回应，返回形如 http://192.168.1.20:57321 的地址列表。 */
    fun discover(timeoutMs: Int = 1500): List<String> {
        return probe(broadcastAddresses(), timeoutMs).keys.toList()
    }

    /**
     * 给定目标地址发一次探测，收集回应。
     * 拆出来是为了能直连 127.0.0.1 做自动化测试。
     */
    fun probe(targets: List<InetAddress>, timeoutMs: Int = 1500): Map<String, String> {
        val found = LinkedHashMap<String, String>()
        try {
            DatagramSocket().use { socket ->
                socket.broadcast = true
                socket.soTimeout = 300

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
                    val text = String(response.data, 0, response.length, Charsets.UTF_8)
                    val json = runCatching { JSONObject(text) }.getOrNull() ?: continue
                    val host = json.optString("host")
                    val port = json.optInt("port")
                    if (host.isBlank() || port <= 0) continue
                    found["http://$host:$port"] = json.optString("version")
                }
            }
        } catch (err: Exception) {
            Log.w(TAG, "搜索桌面端失败", err)
        }
        return found
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
