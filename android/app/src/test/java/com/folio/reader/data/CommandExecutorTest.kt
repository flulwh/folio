package com.folio.reader.data

import com.folio.reader.core.LocalBook
import com.folio.reader.core.Origin
import com.folio.reader.core.ProgressEntry
import com.folio.reader.net.DeviceCommand
import com.folio.reader.net.FolioClient
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * 指令执行器（T08）：三类指令 + 幂等 + 失败原因枚举。
 *
 * 传输层用 [FakeTransfer] 替身：这一层要验的是**指令层自己做的事**（payload 解析、
 * 方向对不对、删除顺序、确认分支、回执内容），字节怎么走属于 `SyncEngine` 的测试范围。
 * 回执用真的 [FolioClient] 打一个必然连不上的端口 —— 正好顺带验「回执发不出去不算失败」。
 */
class CommandExecutorTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private lateinit var libraryDir: File
    private lateinit var books: BookStore
    private lateinit var progress: ProgressStore
    private lateinit var syncState: SyncStateStore
    private lateinit var files: BookFileStore
    private lateinit var transfer: FakeTransfer

    /** 谁来确认删除：默认拒绝，和线上没接 UI 时一致。 */
    private var confirmer: DeleteConfirmer = DeleteConfirmer.REJECT

    private var confirmCount = 0

    @Before
    fun setUp() {
        libraryDir = File(tmp.root, "library").apply { mkdirs() }
        books = BookStore(libraryDir)
        progress = ProgressStore(libraryDir)
        syncState = SyncStateStore(libraryDir)
        files = BookFileStore(tmp.root)
        transfer = FakeTransfer()
        confirmCount = 0
        confirmer = DeleteConfirmer.REJECT
    }

    private fun executor(): CommandExecutor = CommandExecutor(
        books = books,
        progress = progress,
        syncState = syncState,
        files = files,
        transfer = transfer,
        confirmer = confirmer,
    )

    /**
     * 回执必然失败的 client（127.0.0.1:1 没人监听）。
     *
     * 这是故意的：执行结果必须与回执解耦，回执发不出去只是桌面端的显示问题。
     */
    private fun deadClient(): FolioClient = FolioClient(baseUrl = "http://127.0.0.1:1", token = "T")

    /* ---------------- 造数据 ---------------- */

    /** 40 位十六进制 hash。 */
    private fun hashOf(seed: Int): String = seed.toString(16).padStart(2, '0').repeat(20)

    private fun command(
        id: String,
        type: String,
        hash: String,
        unique: Boolean = false,
        expiresAt: Long = 0L,
    ): DeviceCommand = DeviceCommand(
        id = id,
        type = type,
        payloadJson = """{"hash":"${hash.uppercase()}","title":"测试书","size":100,"unique":$unique}""",
        createdAt = 1_700_000_000_000L,
        expiresAt = expiresAt,
    )

    private fun seedBook(hash: String, title: String): LocalBook {
        val book = LocalBook(
            id = "sha1-$hash",
            title = title,
            origin = Origin.LOCAL,
            contentHash = hash,
            size = 11L,
            hasLocalFile = true,
            addedAt = 1_700_000_000_000L,
        )
        books.upsert(book)
        files.writeText(book.id, "这是一本测试书的正文")
        progress.put(ProgressEntry(id = book.id, chapter = 1, updatedAt = 9L))
        syncState.markSynced(book.id)
        return book
    }

    /* ---------------- 一、方向：push 是拉、pull 是推 ---------------- */

    @Test
    fun pushBook走拉取路径且hash统一小写() = runBlocking {
        val hash = hashOf(0x1a)
        val outcome = executor().run(command("c1", CommandExecutor.TYPE_PUSH_BOOK, hash))

        assertTrue("push-book 要回 done，实际 ${outcome.state}/${outcome.error}", outcome.ok)
        assertEquals("push-book = 桌面推到手机 = 手机拉下来", listOf(hash), transfer.pulls)
        assertTrue("push-book 绝不能走上传", transfer.pushes.isEmpty())
    }

    @Test
    fun pullBook走上传路径() = runBlocking {
        val hash = hashOf(0x2b)
        val outcome = executor().run(command("c2", CommandExecutor.TYPE_PULL_BOOK, hash))

        assertTrue(outcome.ok)
        assertEquals("pull-book = 桌面上来取 = 手机上传", listOf(hash), transfer.pushes)
        assertTrue("pull-book 绝不能走下载", transfer.pulls.isEmpty())
    }

    /* ---------------- 二、remove-book ---------------- */

    @Test
    fun removeBook连文件带库带进度一起删() = runBlocking {
        val hash = hashOf(0x3c)
        val book = seedBook(hash, "要被删掉的书")
        assertTrue(files.exists(book.id))

        val outcome = executor().run(command("c3", CommandExecutor.TYPE_REMOVE_BOOK, hash))

        assertTrue(outcome.ok)
        assertFalse("正文文件必须删掉", files.exists(book.id))
        assertNull("书架条目必须删掉", books.findById(book.id))
        assertNull("进度必须删掉，否则下次同名书会读到陌生进度", progress.get(book.id))
        assertNull("同步态必须删掉", syncState.get(book.id))
    }

    @Test
    fun removeBook手机上本来就没有时回done() = runBlocking {
        val outcome = executor().run(command("c4", CommandExecutor.TYPE_REMOVE_BOOK, hashOf(0x4d)))

        assertTrue("幂等：没这本书也算 done，不然桌面端会一直亮红点", outcome.ok)
        assertEquals(0, confirmCount)
    }

    @Test
    fun removeBook独有副本被拒绝时回userRejected且文件还在() = runBlocking {
        val hash = hashOf(0x5e)
        val book = seedBook(hash, "唯一的一份")
        confirmer = object : DeleteConfirmer {
            override suspend fun confirm(book: LocalBook): Boolean {
                confirmCount += 1
                return false
            }
        }

        val outcome = executor().run(command("c5", CommandExecutor.TYPE_REMOVE_BOOK, hash, unique = true))

        assertFalse(outcome.ok)
        assertEquals("user_rejected", outcome.error)
        assertEquals(1, confirmCount)
        assertTrue("用户拒绝后一个字节都不许动", files.exists(book.id))
        assertNotNull(books.findById(book.id))
    }

    @Test
    fun removeBook独有副本确认后才删() = runBlocking {
        val hash = hashOf(0x6f)
        val book = seedBook(hash, "唯一的一份")
        confirmer = object : DeleteConfirmer {
            override suspend fun confirm(book: LocalBook): Boolean {
                confirmCount += 1
                return true
            }
        }

        val outcome = executor().run(command("c6", CommandExecutor.TYPE_REMOVE_BOOK, hash, unique = true))

        assertTrue(outcome.ok)
        assertEquals(1, confirmCount)
        assertFalse(files.exists(book.id))
    }

    @Test
    fun 非独有副本不问用户() = runBlocking {
        val hash = hashOf(0x7a)
        seedBook(hash, "桌面端还有一份")
        confirmer = object : DeleteConfirmer {
            override suspend fun confirm(book: LocalBook): Boolean {
                confirmCount += 1
                return false
            }
        }

        val outcome = executor().run(command("c7", CommandExecutor.TYPE_REMOVE_BOOK, hash, unique = false))

        assertTrue("unique=false 不该拦人", outcome.ok)
        assertEquals("unique=false 不该弹确认", 0, confirmCount)
    }

    /* ---------------- 三、脏数据与未知类型 ---------------- */

    @Test
    fun 未知指令类型回unsupported而不是崩() = runBlocking {
        val outcome = executor().run(command("c8", "rename-device", hashOf(0x8b)))

        assertEquals("unsupported", outcome.error)
        assertFalse(outcome.ok)
    }

    @Test
    fun payload没有合法hash时回unsupported() = runBlocking {
        val bad = DeviceCommand(id = "c9", type = CommandExecutor.TYPE_PUSH_BOOK, payloadJson = """{"hash":"xyz"}""")
        val broken = DeviceCommand(id = "c10", type = CommandExecutor.TYPE_PUSH_BOOK, payloadJson = "not-json")

        assertEquals("unsupported", executor().run(bad).error)
        assertEquals("payload 不是 JSON 也不能崩", "unsupported", executor().run(broken).error)
        assertTrue("一条都不该真的去搬", transfer.pulls.isEmpty())
    }

    /* ---------------- 四、失败原因枚举 ---------------- */

    @Test
    fun 七种失败原因的wire值与桌面端逐字一致() {
        // 这张表是双端契约，改一个字桌面端就显示不出原因
        assertEquals("insufficient_space", CommandError.INSUFFICIENT_SPACE.wire)
        assertEquals("too_large", CommandError.TOO_LARGE.wire)
        assertEquals("hash_mismatch", CommandError.HASH_MISMATCH.wire)
        assertEquals("network_interrupted", CommandError.NETWORK_INTERRUPTED.wire)
        assertEquals("user_rejected", CommandError.USER_REJECTED.wire)
        assertEquals("source_gone", CommandError.SOURCE_GONE.wire)
        assertEquals("unsupported", CommandError.UNSUPPORTED.wire)
        assertEquals(7, CommandError.entries.size)
    }

    @Test
    fun 五种搬运失败原因会原样进回执() = runBlocking {
        val codes = listOf(
            CommandError.INSUFFICIENT_SPACE,
            CommandError.TOO_LARGE,
            CommandError.HASH_MISMATCH,
            CommandError.NETWORK_INTERRUPTED,
            CommandError.SOURCE_GONE,
        )
        for (code in codes) {
            transfer = FakeTransfer()
            transfer.pullResult = TransferResult.Failed(code, detail = "模拟失败")
            val outcome = executor().run(command("c-${code.wire}", CommandExecutor.TYPE_PUSH_BOOK, hashOf(0x9c)))

            assertFalse("$code 应该是失败", outcome.ok)
            assertEquals("失败原因必须原样上报", code.wire, outcome.error)
            assertEquals("模拟失败", outcome.detail)
        }
    }

    @Test
    fun 空间不足的文案会填进缺口MB数() {
        assertEquals(
            "手机空间不足，需要腾出 300 MB",
            CommandError.INSUFFICIENT_SPACE.text(300L * 1024 * 1024),
        )
        // 缺口不到 1MB 也要说「1 MB」，不能出现「需要腾出 0 MB」
        assertEquals("手机空间不足，需要腾出 1 MB", CommandError.INSUFFICIENT_SPACE.text(1L))
    }

    /* ---------------- 五、批量执行 ---------------- */

    @Test
    fun runAll同批重复id只执行一次() = runBlocking {
        val hash = hashOf(0xad)
        val command = command("c11", CommandExecutor.TYPE_PUSH_BOOK, hash)

        val outcomes = executor().runAll(deadClient(), listOf(command, command))

        assertEquals("同一条指令不能跑两遍", 1, outcomes.size)
        assertEquals(listOf(hash), transfer.pulls)
    }

    @Test
    fun runAll跳过过期指令() = runBlocking {
        val now = 1_800_000_000_000L
        val expired = command("c12", CommandExecutor.TYPE_PUSH_BOOK, hashOf(0xbe), expiresAt = now - 1_000L)
        val alive = command("c13", CommandExecutor.TYPE_PUSH_BOOK, hashOf(0xcf), expiresAt = now + 60_000L)

        val outcomes = executor().runAll(deadClient(), listOf(expired, alive), now = now)

        assertEquals("过期的不该动磁盘", 1, outcomes.size)
        assertEquals("c13", outcomes.first().commandId)
        assertEquals(1, transfer.pulls.size)
    }

    @Test
    fun 一条指令抛异常不连坐后面的() = runBlocking {
        val boom = hashOf(0xd1)
        transfer.onPull = { hash -> if (hash == boom) error("模拟崩溃") else TransferResult.Done }

        val outcomes = executor().runAll(
            deadClient(),
            listOf(
                command("c14", CommandExecutor.TYPE_PUSH_BOOK, boom),
                command("c15", CommandExecutor.TYPE_PUSH_BOOK, hashOf(0xd2)),
            ),
        )

        assertEquals("两条都要有回执", 2, outcomes.size)
        assertEquals("network_interrupted", outcomes[0].error)
        assertTrue("后面那条照跑", outcomes[1].ok)
    }

    @Test
    fun 回执发不出去也不影响执行结果() = runBlocking {
        val hash = hashOf(0xd3)
        val outcomes = executor().runAll(
            deadClient(),
            listOf(command("c16", CommandExecutor.TYPE_PUSH_BOOK, hash)),
        )

        assertEquals(1, outcomes.size)
        assertTrue("回执是「告诉桌面端」这一步，不能反过来把已完成判成失败", outcomes.first().ok)
    }

    /** 传输替身：记录被要求搬哪些 hash，并按预设返回结果。 */
    private class FakeTransfer : BookTransfer {

        val pulls = ArrayList<String>()
        val pushes = ArrayList<String>()

        var pullResult: TransferResult = TransferResult.Done
        var pushResult: TransferResult = TransferResult.Done

        /** 需要模拟「中途崩了」时替换。 */
        var onPull: ((String) -> TransferResult)? = null

        override suspend fun pullByHash(hash: String): TransferResult {
            pulls.add(hash)
            return onPull?.invoke(hash) ?: pullResult
        }

        override suspend fun pushByHash(hash: String): TransferResult {
            pushes.add(hash)
            return pushResult
        }
    }
}
