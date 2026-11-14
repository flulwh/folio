package com.folio.reader.data

import com.folio.reader.net.EventStream
import com.folio.reader.net.FolioClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex

/**
 * 前台在线通道（T09）：App 在前台时挂一根 `/api/events` 长连接。
 *
 * 它解决的是一条真实的断链：以前手机只在「跑完整同步」时才拉指令，用户在桌面端
 * 点「发送到手机」，只要不手动点同步就永远不执行。现在桌面端一入队就会
 * `publish('command')`，这里收到就立刻拉一遍队列。
 *
 * 四条纪律（PRD §6 / 架构文档 §1.3）：
 *  1. **不是后台任务**。不加 WorkManager、不加前台服务、不加轮询；
 *     [stop] 一调连接就断，桌面端「离线」自然出现。这是产品红线。
 *  2. **旧桌面端静默降级**。先发一次心跳：没设备接口（`supported=false`）
 *     就整条通道静默关闭，绝不把 [ConnectionManager] 判成连接失败。
 *  3. **重连不烧 CPU**。掉线后从 [retryMs] 起逐步退避（最长 [MAX_BACKOFF] 倍），
 *     桌面端没开时不会每 3 秒把网卡唤醒一次；也没有忙等，前台会话结束整个作用域一起取消。
 *  4. **指令串行**。收到命令事件时若已经有一轮在跑就直接跳过 ——
 *     那一轮拉的是整份队列，不会有漏。
 */
class DeviceChannel(
    private val clientProvider: () -> FolioClient,
    /** 配置齐不齐（地址 + 访问码）。不齐时静默退出，不做无意义的 3 秒重试。 */
    private val isConfigured: () -> Boolean = { true },
    private val retryMs: Long = RETRY_MS,
    /** 一轮执行完再问一次心跳，队列还有就继续；上限防死循环。 */
    private val maxDrainRounds: Int = MAX_DRAIN_ROUNDS,
) {

    private val _online = MutableStateFlow(false)

    /** SSE 是否真的连上了（桌面端设备页看到的在线态以它为准）。 */
    val online: StateFlow<Boolean> = _online.asStateFlow()

    private val lock = Any()
    private var scope: CoroutineScope? = null
    private var loop: Job? = null
    private var onCommands: (suspend () -> Unit)? = null
    private val commandMutex = Mutex()

    /** 当前连接。stop() 要能在读阻塞时把它掐断。 */
    @Volatile
    private var stream: EventStream? = null

    /** 前台开始：开 SSE。重复调用是幂等的。 */
    fun start(onCommands: suspend () -> Unit) {
        this.onCommands = onCommands
        synchronized(lock) {
            if (loop?.isActive == true) return
            val created = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            scope = created
            loop = created.launch { runLoop() }
        }
    }

    /** 退到后台：立刻断开。桌面端会在 1→0 时收到 `device` 离线事件。 */
    fun stop() {
        val closedStream: EventStream?
        synchronized(lock) {
            loop?.cancel()
            loop = null
            scope?.cancel()
            scope = null
            onCommands = null
            closedStream = stream
            stream = null
        }
        // 先关流再等：HttpURLConnection 的 read 是阻塞的，不关就取消不掉。
        runCatching { closedStream?.close() }
        _online.value = false
    }

    /* ---------------- 主循环 ---------------- */

    private suspend fun runLoop() {
        if (!isConfigured()) return
        // 连续失败次数：成功连上就清零，用来做退避
        var failures = 0
        while (currentCoroutineContext().isActive) {
            val client = try {
                clientProvider()
            } catch (err: CancellationException) {
                throw err
            } catch (err: Exception) {
                // 地址/访问码不合法：等用户改完再从前台重新进来
                return
            }

            // 心跳先行：既证明「这台桌面端认识设备接口」，又顺便拿到积压条数。
            val status = try {
                client.heartbeat()
            } catch (err: CancellationException) {
                throw err
            } catch (err: Exception) {
                failures += 1
                pause(failures)
                continue
            }
            if (!status.supported) return // 旧桌面端：整条通道静默关闭
            if (status.pending > 0) triggerCommands()

            try {
                val opened = client.openEvents()
                stream = opened
                _online.value = true
                failures = 0
                readEvents(opened)
            } catch (err: CancellationException) {
                throw err
            } catch (err: Exception) {
                // 掉线/读超时：下面统一重连
            } finally {
                val closing = stream
                stream = null
                runCatching { closing?.close() }
                _online.value = false
            }
            // 连上过又断了：下一次按基础间隔重连；一直连不上则逐次拉长
            failures += 1
            pause(failures)
        }
    }

    /** 读 SSE 帧。只关心事件名，`data` 里的内容由执行器重新拉队列取。 */
    private suspend fun readEvents(stream: EventStream) {
        val reader = stream.reader
        var event = ""
        while (currentCoroutineContext().isActive) {
            val line = try {
                reader.readLine()
            } catch (err: Exception) {
                break // 被 stop() 关掉或网络断开
            } ?: break
            when {
                line.isEmpty() -> {
                    if (event == EVENT_COMMAND) triggerCommands()
                    event = ""
                }
                line.startsWith(":") -> Unit // 注释行（服务端心跳）
                line.startsWith("event:") -> event = line.removePrefix("event:").trim()
                else -> Unit // data / id / retry：本通道不消费
            }
        }
    }

    /** 收一条指令事件：串行跑一轮「拉队列 + 执行 + 回执」。 */
    private fun triggerCommands() {
        val runner = onCommands ?: return
        val created = scope ?: return
        // 已经有一轮在跑：它拉的是整份队列，这一条肯定在里面，不必排队
        if (!commandMutex.tryLock()) return
        created.launch {
            try {
                var round = 0
                while (true) {
                    runner()
                    round += 1
                    val pending = runCatching { clientProvider().heartbeat().pending }
                        .getOrDefault(0)
                    if (pending <= 0 || round >= maxDrainRounds) break
                }
            } catch (err: CancellationException) {
                throw err
            } catch (err: Exception) {
                // 执行失败已经由每条指令自己的回执表达，通道继续收事件
            } finally {
                commandMutex.unlock()
            }
        }
    }

    /**
     * 断线等待：第 n 次连续失败等 `retryMs × n`（最多 [MAX_BACKOFF] 倍）。
     *
     * 桌面端关机时 3 秒一次的重试纯属白耗电，拉到 27 秒既不影响恢复速度
     * （用户通常还在看当前页面），也能让网卡歇下来。
     */
    private suspend fun pause(failures: Int = 1) {
        if (retryMs <= 0L) return
        val factor = failures.coerceIn(1, MAX_BACKOFF).toLong()
        delay(retryMs * factor)
    }

    companion object {
        /** 掉线重连的基础间隔：服务端 `retry: 3000`，两边保持一致。 */
        const val RETRY_MS = 3_000L

        /** 退避上限倍数：3s × 9 = 27s。 */
        const val MAX_BACKOFF = 9

        /** 收到一条事件后最多连拉几轮（防止对端一直报 pending 卡死这里）。 */
        const val MAX_DRAIN_ROUNDS = 5

        /** 桌面端推送的「有指令入队」事件名。 */
        const val EVENT_COMMAND = "command"
    }
}
