package com.folio.reader.data

import com.folio.reader.core.LocalBook
import com.folio.reader.net.DeviceCommand
import com.folio.reader.net.FolioClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * 指令失败原因（架构文档 §8，wire 值与桌面端红点文案逐字对应）。
 *
 * 这张表是双端契约：**只许新增，不许改名**。桌面端拿 `error` 去查文案，
 * 多出来的未知值它只会显示一个通用兜底，等于用户看不到原因。
 */
enum class CommandError(val wire: String, private val label: String) {

    /** 空间不够，文案里的 `{X}` 由 [text] 按实际缺口填。 */
    INSUFFICIENT_SPACE("insufficient_space", "手机空间不足，需要腾出 %d MB"),
    TOO_LARGE("too_large", "超过 30MiB 上限，这本书只能留在本机"),
    HASH_MISMATCH("hash_mismatch", "内容校验失败，传输不完整，已丢弃"),
    NETWORK_INTERRUPTED("network_interrupted", "传输中断，可重试"),
    USER_REJECTED("user_rejected", "你在手机上拒绝了这次操作"),
    SOURCE_GONE("source_gone", "对端已没有这本书的副本"),
    UNSUPPORTED("unsupported", "手机端版本太旧，不支持这条指令"),
    ;

    /**
     * 给人看的一句话。
     *
     * @param needBytes 空间不足时还差多少字节（其余原因忽略）
     */
    fun text(needBytes: Long = 0L): String {
        if (this != INSUFFICIENT_SPACE) return label
        val mb = ((needBytes + MB - 1) / MB).coerceAtLeast(1L)
        return String.format(label, mb)
    }

    companion object {
        private const val MB = 1024L * 1024L

        /** 从 wire 值反查；未知值返回 null（桌面端可能比手机新）。 */
        fun fromWire(raw: String): CommandError? = entries.firstOrNull { it.wire == raw.trim() }
    }
}

/**
 * 一次搬运的结果。
 *
 * 指令层只认「成没成、为什么没成」，字节怎么走它一概不管 ——
 * 这正是架构文档 §3 那条「指令只携带做什么，不携带字节」的落点。
 */
sealed class TransferResult {

    object Done : TransferResult()

    /**
     * @param code 失败原因枚举
     * @param detail 补充说明（桌面端原话优先），空则用枚举文案
     * @param needBytes 空间不足时还差多少字节
     */
    data class Failed(
        val code: CommandError,
        val detail: String = "",
        val needBytes: Long = 0L,
    ) : TransferResult()
}

/**
 * 指令真正要做的两件搬运。实现是 [SyncEngine]。
 *
 * 为什么不直接在这里调 `FolioClient`：`push-book` 要的是「清单反查 id → Range 续传 →
 * sha1 校验 → `.part` 原子改名 → 入库」这一整条既有路径，重写一遍就是第二份实现，
 * 两份实现的差异迟早变成「同步能下、指令下不来」这种查不出来的 bug。
 */
interface BookTransfer {

    /** `push-book`：把桌面端的书拉到手机（按内容哈希，payload 里没有桌面 id）。 */
    suspend fun pullByHash(hash: String): TransferResult

    /** `pull-book`：把手机的书推到桌面端（按内容哈希，桌面端按 hash 幂等收）。 */
    suspend fun pushByHash(hash: String): TransferResult
}

/**
 * 删「独有副本」前的二次确认。
 *
 * 默认实现**一律拒绝**：没接 UI 的时候宁可少删一本书，也不能凭一条网络指令
 * 把用户手机上唯一的一份正文抹掉 —— 抹掉之后两端都没有了，找不回来。
 */
fun interface DeleteConfirmer {

    /** @return true 才允许删 */
    suspend fun confirm(book: LocalBook): Boolean

    companion object {
        /** 没接 UI 时的默认实现：拒绝。 */
        val REJECT: DeleteConfirmer = object : DeleteConfirmer {
            override suspend fun confirm(book: LocalBook): Boolean = false
        }
    }
}

/**
 * 一条指令的执行结果，直接对应桌面端回执的 `{state, error, detail}`。
 *
 * @param state 只有 `done` / `failed` 两个值（桌面端 400 挡掉其余）
 * @param error [CommandError.wire]；`done` 时为空串
 * @param detail 给人看的一句话
 */
data class CommandOutcome(
    val commandId: String,
    val state: String,
    val error: String = "",
    val detail: String = "",
) {
    val ok: Boolean get() = state == STATE_DONE

    companion object {
        const val STATE_DONE = "done"
        const val STATE_FAILED = "failed"

        fun done(commandId: String, detail: String = ""): CommandOutcome =
            CommandOutcome(commandId = commandId, state = STATE_DONE, detail = detail)

        fun failed(commandId: String, code: CommandError, needBytes: Long = 0L, detail: String = ""): CommandOutcome =
            CommandOutcome(
                commandId = commandId,
                state = STATE_FAILED,
                error = code.wire,
                detail = detail.ifBlank { code.text(needBytes) },
            )
    }
}

/**
 * 指令执行器（T08）：把桌面端排队的 `push-book` / `remove-book` / `pull-book`
 * 变成手机上的真动作，并把结果回执给桌面端。
 *
 * 四条纪律：
 *  1. **不写传输代码**。两类搬运全走 [BookTransfer]（真身是 [SyncEngine]），
 *     这里一个字节都不碰，`Range` 续传 / sha1 校验 / `.part` 原子改名全部复用既有实现。
 *  2. **幂等由 hash 保证**（架构文档 §5）：`push-book` 手机上已有同 hash 正文 → done；
 *     `remove-book` 手机上已没有这本书 → done；`pull-book` 桌面端已有同 hash →
 *     走 `upload/status` 短路，也是 done。重复执行不会产生第二份文件。
 *  3. **一条失败不连坐**。逐条串行 + 每条独立回执，中途断网时已完成的照样进 history，
 *     未完成的下次重跑（幂等）。
 *  4. **回执丢了不算失败**。结果已经落在手机上，回执发不出去只是桌面端的显示问题，
 *     它 1 小时后会让 `delivered` 重新入队，届时幂等重跑一遍即可。
 */
class CommandExecutor(
    private val books: BookStore,
    private val progress: ProgressStore,
    private val syncState: SyncStateStore,
    private val files: BookFileStore,
    private val transfer: BookTransfer,
    private val confirmer: DeleteConfirmer = DeleteConfirmer.REJECT,
) {

    /**
     * 逐条执行并回执。
     *
     * @param client 回执走这个 client（设备头由它统一加）
     * @param commands 桌面端已按 `createdAt` 升序，这里保持原序
     * @param now 判定过期用的时刻，单测要注入
     * @return 每条指令的结果，顺序与 [commands] 一致（过期与被同批重复投递的除外）
     */
    suspend fun runAll(
        client: FolioClient,
        commands: List<DeviceCommand>,
        now: Long = System.currentTimeMillis(),
    ): List<CommandOutcome> = withContext(Dispatchers.IO) {
        val outcomes = ArrayList<CommandOutcome>(commands.size)
        val handled = HashSet<String>(commands.size)
        for (command in commands) {
            // 同一批里同 id 出现两次（SSE 重连 + 心跳抢跑）只执行一次
            if (!handled.add(command.id)) continue
            // 过期指令不动用户的磁盘：桌面端读路径会清扫，走到这里说明两边时钟差了，
            // 最安全的做法是当没收到（不回执，让它自然过期）
            if (isExpired(command, now)) continue
            val outcome = try {
                run(command)
            } catch (err: CancellationException) {
                throw err
            } catch (err: Exception) {
                CommandOutcome.failed(command.id, CommandError.NETWORK_INTERRUPTED, detail = err.message.orEmpty())
            }
            outcomes.add(outcome)
            post(client, outcome)
        }
        outcomes
    }

    /** 这条指令是不是已经过期。`expiresAt <= 0` 视为不过期（老桌面端不填）。 */
    fun isExpired(command: DeviceCommand, now: Long = System.currentTimeMillis()): Boolean =
        command.expiresAt > 0L && now > command.expiresAt

    /**
     * 执行一条指令（不回执）。
     *
     * 单独暴露出来是为了让单测能只验「做的事对不对」，不必起一个 HTTP 服务器收回执。
     */
    suspend fun run(command: DeviceCommand): CommandOutcome {
        val hash = hashOf(command)
            ?: return CommandOutcome.failed(
                commandId = command.id,
                code = CommandError.UNSUPPORTED,
                detail = "指令里没有合法的 hash",
            )
        return when (command.type) {
            TYPE_PUSH_BOOK -> pushBook(command, hash)
            TYPE_PULL_BOOK -> pullBook(command, hash)
            TYPE_REMOVE_BOOK -> removeBook(command, hash)
            else -> CommandOutcome.failed(
                commandId = command.id,
                code = CommandError.UNSUPPORTED,
                detail = "不认识的指令类型 ${command.type}",
            )
        }
    }

    /* ---------------- 三类指令 ---------------- */

    /** `push-book`：桌面端说「把这本书推到手机」→ 手机这里就是拉下来。 */
    private suspend fun pushBook(command: DeviceCommand, hash: String): CommandOutcome =
        when (val result = transfer.pullByHash(hash)) {
            is TransferResult.Done -> CommandOutcome.done(command.id, "已下到手机")
            is TransferResult.Failed -> CommandOutcome.failed(
                commandId = command.id,
                code = result.code,
                needBytes = result.needBytes,
                detail = result.detail,
            )
        }

    /** `pull-book`：桌面端说「把这本拿上来」→ 手机这里就是上传。 */
    private suspend fun pullBook(command: DeviceCommand, hash: String): CommandOutcome =
        when (val result = transfer.pushByHash(hash)) {
            is TransferResult.Done -> CommandOutcome.done(command.id, "已传到桌面端")
            is TransferResult.Failed -> CommandOutcome.failed(
                commandId = command.id,
                code = result.code,
                needBytes = result.needBytes,
                detail = result.detail,
            )
        }

    /**
     * `remove-book`：删掉手机上的这一本。
     *
     * 顺序是「先删文件、再删库、最后删进度与同步态」：反过来的话，中途崩溃会留下
     * 一条「有正文但书架上没有」的孤儿文件，谁都看不到、谁都清不掉。
     */
    private suspend fun removeBook(command: DeviceCommand, hash: String): CommandOutcome {
        val book = findByHash(hash)
            // 幂等：手机上本来就没有 → done。桌面端连点两次删除不该看到红点
            ?: return CommandOutcome.done(command.id, "手机上已经没有这本书")

        if (uniqueOf(command) && !confirmer.confirm(book)) {
            return CommandOutcome.failed(command.id, CommandError.USER_REJECTED)
        }

        files.delete(book.id)
        books.remove(book.id)
        progress.remove(book.id)
        syncState.remove(book.id)
        return CommandOutcome.done(command.id, "已删除《${book.title}》")
    }

    /* ---------------- 回执 ---------------- */

    /**
     * 发回执。
     *
     * 失败一律吞掉：桌面端还没升级（404 → `supported=false`）、网络刚断、
     * 指令刚好过期（404 not_found），这几种都不该让本地已经完成的结果看起来像失败。
     */
    private suspend fun post(client: FolioClient, outcome: CommandOutcome) {
        try {
            client.postReceipt(
                id = outcome.commandId,
                state = outcome.state,
                error = outcome.error.takeIf { it.isNotBlank() },
                detail = outcome.detail.takeIf { it.isNotBlank() },
            )
        } catch (err: CancellationException) {
            throw err
        } catch (err: Exception) {
            // 故意静默：回执只是「告诉桌面端」这一步，丢了下轮幂等重跑
        }
    }

    /* ---------------- payload ---------------- */

    /** 取 payload 里的 `hash`，统一小写；不合法（非 40 位十六进制）返回 null。 */
    private fun hashOf(command: DeviceCommand): String? {
        val raw = runCatching { JSONObject(command.payloadJson).optString("hash") }.getOrNull()
            ?: return null
        val hash = raw.trim().lowercase()
        if (hash.length != HASH_LENGTH) return null
        if (!hash.all { it in '0'..'9' || it in 'a'..'f' }) return null
        return hash
    }

    /** `remove-book` 的 `unique`：这份副本只在手机上（删了就真没了），必须先问用户。 */
    private fun uniqueOf(command: DeviceCommand): Boolean =
        runCatching { JSONObject(command.payloadJson).optBoolean("unique", false) }.getOrDefault(false)

    /** 按 hash 找书；桌面端可能给大写，本地存的是小写，这里统一小写比。 */
    private fun findByHash(hash: String): LocalBook? {
        val key = hash.trim().lowercase()
        if (key.isEmpty()) return null
        return books.read().firstOrNull { it.contentHash?.lowercase() == key }
    }

    companion object {
        const val TYPE_PUSH_BOOK = "push-book"
        const val TYPE_REMOVE_BOOK = "remove-book"
        const val TYPE_PULL_BOOK = "pull-book"

        /** sha1 十六进制长度。 */
        private const val HASH_LENGTH = 40
    }
}
