package com.folio.reader.data

import com.folio.reader.net.Capabilities
import com.folio.reader.net.DeviceIdentity
import com.folio.reader.net.FolioClient
import com.folio.reader.net.FolioException

/**
 * 与桌面端的连接到底处在哪个状态。
 *
 * 之所以做成状态机而不是「一个 boolean + 一句 message」：UI 要按状态决定
 * 书架怎么显示（未连接时把在线书灰掉）、设置页要不要高亮「访问码」输入框、
 * 同步按钮能不能点。布尔值表达不了这些区别。
 *
 * [wire] 会落进 SharedPreferences，重启后能直接显示上次的结论。
 */
enum class ConnectionState(val wire: String, val label: String) {
    /** 还没检查过（刚安装、刚清数据）。 */
    UNKNOWN("unknown", "未连接"),

    /** 正在检查。 */
    CONNECTING("connecting", "正在连接…"),

    /** 连着，且桌面端够新。 */
    CONNECTED("connected", "已连接"),

    /** 上次连着，但地址或访问码改过了 —— 必须重新查一次，不能沿用旧结论。 */
    NEED_RECONNECT("needReconnect", "需要重新连接"),

    /** 401：访问码不对。 */
    UNAUTHORIZED("unauthorized", "访问码不对"),

    /** 连不上：没开、不同网、防火墙挡了。 */
    UNREACHABLE("unreachable", "连不上桌面端，确认同一 Wi-Fi"),

    /** 地址本身写错了。 */
    BAD_ADDRESS("badAddress", "地址格式不对，应形如 http://192.168.1.5:7788"),

    /** 桌面端低于 2.6.0，没有 apiVersion 2 的接口。 */
    TOO_OLD("tooOld", "桌面端太旧，请升级到 2.6.0");

    /** 只有这个状态才允许发起同步。 */
    val healthy: Boolean get() = this == CONNECTED

    /** 需要用户去改设置（地址或访问码）。 */
    val needsSettings: Boolean get() = this == BAD_ADDRESS || this == UNAUTHORIZED

    companion object {
        fun fromWire(raw: String?): ConnectionState =
            entries.firstOrNull { it.wire == raw?.trim() } ?: UNKNOWN
    }
}

/**
 * 连接管理：造客户端、判错误、做健康检查、缓存结论。
 *
 * 三分类错误文案（架构文档 §8，逐字复用，别各写一套）：
 *  - 401 → `访问码不对`
 *  - 网络层失败 → `连不上桌面端，确认同一 Wi-Fi`
 *  - 地址写错 → `地址格式不对，应形如 http://192.168.1.5:7788`
 * 另外 `apiVersion < 2` 一律 `桌面端太旧，请升级到 2.6.0`。
 *
 * 所有 `check` 都是**阻塞**的（内部走 HttpURLConnection），调用方要放到
 * `Dispatchers.IO` 上；UI 侧请用带缓存的 [onForeground]。
 */
class ConnectionManager(
    private val settings: SettingsStore,
    /**
     * 造客户端。默认实现顺手带上设备身份（T07）——
     * 设备头在 [FolioClient.open] 里统一追加，这里只要把身份递进去。
     */
    private val factory: (String, String) -> FolioClient = { url, token ->
        FolioClient(
            baseUrl = url,
            token = token,
            device = DeviceIdentity(
                installId = settings.installId,
                name = settings.deviceName,
            ),
        )
    },
) {

    /** 一次健康检查的结论。 */
    data class Health(
        val state: ConnectionState,
        /** 直接给人看的文案。 */
        val message: String,
        val serverVersion: String = "",
        val apiVersion: Int = 0,
        val port: Int = 0,
        val features: Set<String> = emptySet(),
        /** 往返耗时（毫秒）；没测到为 -1。 */
        val rttMs: Long = -1L,
        val at: Long = 0L,
    ) {
        val ok: Boolean get() = state.healthy

        /** 设置页「关于」里的一行诊断。 */
        val detail: String
            get() {
                if (!ok) return message
                val version = if (serverVersion.isBlank()) "?" else serverVersion
                val rtt = if (rttMs >= 0) " · ${rttMs}ms" else ""
                return "桌面端 $version · api ${apiVersion} · 端口 $port$rtt"
            }
    }

    /** 最近一次结论（可能来自上一次进程，见构造时读的持久化状态）。 */
    @Volatile
    private var last: Health? = null

    /** 上次判定成功时用的访问码：改了它就说明结论过期了。 */
    @Volatile
    private var checkedToken: String = ""

    @Volatile
    private var checkedUrl: String = ""

    /**
     * 前台在线通道（T09）。
     *
     * 挂在 ConnectionManager 上而不是容器里：它每次连接都要用当前的地址与访问码，
     * 而这两项的真相就在这里。生命周期由 ViewModel 按 ON_START / ON_STOP 驱动，
     * 这里只负责「怎么造客户端」。
     */
    val channel: DeviceChannel = DeviceChannel(
        clientProvider = { client() },
        isConfigured = { ready() },
    )

    init {
        // 上次进程的结论先顶上，UI 不用空着等一次网络往返
        val wire = settings.connectionState
        if (wire.isNotBlank()) {
            val state = ConnectionState.fromWire(wire)
            last = Health(state = state, message = state.label, at = settings.lastHealthAt)
        }
        if (last?.ok == true) {
            checkedToken = settings.token
            checkedUrl = settings.serverUrl
        }
    }

    /* ---------------- 客户端 ---------------- */

    /**
     * 造一个客户端。
     *
     * @throws FolioException 没填地址/访问码，或地址格式不对（[FolioException.network] 为 true）
     */
    fun client(): FolioClient {
        val url = settings.serverUrl
        val token = settings.token
        if (url.isBlank()) throw FolioException("先填桌面端地址", 0)
        if (token.isBlank()) throw FolioException("先填访问码", 0)
        FolioClient.validateUrl(url)?.let { throw FolioException(it, 0) }
        return factory(FolioClient.normalizeBase(url), token)
    }

    /** 配置齐全且格式没问题，可以发起请求。 */
    fun ready(): Boolean = settings.hasServer && FolioClient.validateUrl(settings.serverUrl) == null

    /* ---------------- 健康检查 ---------------- */

    /** 上次的结论，不发起请求。 */
    fun cachedHealth(): Health = last ?: Health(ConnectionState.UNKNOWN, ConnectionState.UNKNOWN.label)

    /**
     * 地址或访问码被改过 → 上次的结论作废。
     *
     * 这一步很关键：只改访问码而不清结论的话，书架会一直显示「已连接」，
     * 用户点同步才报 401，看起来像是「同步坏了」而不是「访问码填错了」。
     */
    fun noteConfigChanged() {
        val previous = last
        if (previous == null) return
        if (settings.token == checkedToken && settings.serverUrl == checkedUrl) return
        last = Health(
            state = ConnectionState.NEED_RECONNECT,
            message = ConnectionState.NEED_RECONNECT.label,
            serverVersion = previous.serverVersion,
            apiVersion = previous.apiVersion,
            port = previous.port,
            features = previous.features,
            at = System.currentTimeMillis(),
        )
        persist(last!!)
    }

    /** 结论是否已因配置变化而作废。 */
    fun needsReconnect(): Boolean {
        val previous = last ?: return false
        if (!previous.ok) return false
        return settings.token != checkedToken || settings.serverUrl != checkedUrl
    }

    /**
     * 回前台时最多查一次。
     *
     * 频繁切前后台不该把网络打满，所以 [FOREGROUND_MS] 内的结论直接复用；
     * 过了这个窗口才真去问一次 `/api/ping`。
     */
    fun onForeground(): Health {
        val previous = last
        val now = System.currentTimeMillis()
        if (previous != null && previous.ok && now - previous.at < FOREGROUND_MS) return previous
        return check(force = false)
    }

    /**
     * 跑一次健康检查。
     *
     * @param force true 时忽略缓存窗口（用户点了「测试连接」）
     */
    fun check(force: Boolean = false): Health {
        val now = System.currentTimeMillis()
        val previous = last

        // 1. 配置被改过：先判需要重连，不做无意义的请求
        if (previous != null && previous.ok &&
            (settings.token != checkedToken || settings.serverUrl != checkedUrl)
        ) {
            val stale = Health(
                state = ConnectionState.NEED_RECONNECT,
                message = ConnectionState.NEED_RECONNECT.label,
                serverVersion = previous.serverVersion,
                apiVersion = previous.apiVersion,
                port = previous.port,
                features = previous.features,
                at = now,
            )
            persist(stale)
            if (!force) return stale
        }

        // 2. 缓存窗口内直接复用（除非用户要求强制检查）
        if (!force && previous != null && previous.ok && now - previous.at < REUSE_MS) {
            return previous
        }

        // 3. 地址与访问码的本地校验：不合格就别发请求了
        val url = settings.serverUrl
        val token = settings.token
        if (url.isBlank()) {
            return publish(
                Health(ConnectionState.BAD_ADDRESS, "先填桌面端地址", at = now),
            )
        }
        if (token.isBlank()) {
            return publish(
                Health(ConnectionState.UNAUTHORIZED, "先填访问码", at = now),
            )
        }
        FolioClient.validateUrl(url)?.let { reason ->
            return publish(Health(ConnectionState.BAD_ADDRESS, reason, at = now))
        }

        // 4. 真去问一次
        val started = System.nanoTime()
        return try {
            val caps = client().capabilities()
            val rtt = (System.nanoTime() - started) / 1_000_000L
            when {
                caps.apiVersion < Capabilities.REQUIRED_API_VERSION -> publish(
                    Health(
                        state = ConnectionState.TOO_OLD,
                        message = "桌面端太旧，请升级到 2.6.0",
                        serverVersion = caps.serverVersion,
                        apiVersion = caps.apiVersion,
                        port = caps.port,
                        features = caps.features,
                        rttMs = rtt,
                        at = System.currentTimeMillis(),
                    ),
                )

                else -> {
                    checkedToken = token
                    checkedUrl = url
                    publish(
                        Health(
                            state = ConnectionState.CONNECTED,
                            message = "已连接",
                            serverVersion = caps.serverVersion,
                            apiVersion = caps.apiVersion,
                            port = caps.port,
                            features = caps.features,
                            rttMs = rtt,
                            at = System.currentTimeMillis(),
                        ),
                    )
                }
            }
        } catch (err: FolioException) {
            val rtt = (System.nanoTime() - started) / 1_000_000L
            publish(
                Health(
                    state = stateOf(err),
                    message = messageOf(err),
                    serverVersion = previous?.serverVersion.orEmpty(),
                    apiVersion = previous?.apiVersion ?: 0,
                    port = previous?.port ?: 0,
                    features = previous?.features ?: emptySet(),
                    rttMs = rtt,
                    at = System.currentTimeMillis(),
                ),
            )
        } catch (err: Exception) {
            val rtt = (System.nanoTime() - started) / 1_000_000L
            publish(
                Health(
                    state = ConnectionState.UNREACHABLE,
                    message = "连不上桌面端，确认同一 Wi-Fi",
                    rttMs = rtt,
                    at = System.currentTimeMillis(),
                ),
            )
        }
    }

    /**
     * 把任意一次请求的失败也翻译成连接状态。
     *
     * 同步过程中报的错和健康检查报的错必须是同一套文案，
     * 否则用户会看到「访问码不对」和「服务返回 401」两种说法。
     */
    fun failureOf(err: Throwable): Health = Health(
        state = if (err is FolioException) stateOf(err) else ConnectionState.UNREACHABLE,
        message = if (err is FolioException) messageOf(err) else "连不上桌面端，确认同一 Wi-Fi",
        serverVersion = last?.serverVersion.orEmpty(),
        apiVersion = last?.apiVersion ?: 0,
        port = last?.port ?: 0,
        features = last?.features ?: emptySet(),
        at = System.currentTimeMillis(),
    )

    /** 忘掉结论（断开连接、清空设置时用）。 */
    fun reset() {
        last = null
        checkedToken = ""
        checkedUrl = ""
        settings.connectionState = ""
        settings.lastHealthAt = 0L
    }

    /* ---------------- 内部 ---------------- */

    private fun publish(health: Health): Health {
        last = health
        persist(health)
        return health
    }

    private fun persist(health: Health) {
        settings.connectionState = health.state.wire
        if (health.ok) settings.lastHealthAt = health.at
    }

    /** 三分类：401 / 网络 / 地址格式，其余都按「连不上」兜底。 */
    private fun stateOf(err: FolioException): ConnectionState = when {
        err.unauthorized -> ConnectionState.UNAUTHORIZED
        err.message?.contains("地址格式不对") == true -> ConnectionState.BAD_ADDRESS
        err.network -> ConnectionState.UNREACHABLE
        err.status == 403 -> ConnectionState.UNREACHABLE
        else -> ConnectionState.UNREACHABLE
    }

    private fun messageOf(err: FolioException): String = when (stateOf(err)) {
        ConnectionState.UNAUTHORIZED -> "访问码不对"
        ConnectionState.BAD_ADDRESS -> "地址格式不对，应形如 http://192.168.1.5:7788"
        else -> "连不上桌面端，确认同一 Wi-Fi"
    }

    companion object {
        /** 缓存窗口：20 秒内的结论直接复用，避免快速来回切页把网卡打满。 */
        private const val REUSE_MS = 20_000L

        /** 回前台的健康检查窗口：1 分钟。 */
        private const val FOREGROUND_MS = 60_000L
    }
}
