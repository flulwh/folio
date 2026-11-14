package com.folio.reader.data

import com.folio.reader.core.BookKind
import com.folio.reader.core.LocalBook
import com.folio.reader.core.Origin
import com.folio.reader.core.SyncOutcome
import com.folio.reader.core.SyncState
import com.folio.reader.net.DeviceIdentity
import com.folio.reader.net.FolioClient
import com.folio.reader.net.FolioException
import com.folio.reader.net.RemoteBook
import com.folio.reader.net.UploadConflictException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 差集规划：**纯函数**，不碰磁盘也不碰网络。
 *
 * 桌面端不存任何「已同步」状态，所以两端状态不可能漂移 ——
 * 唯一的真相是「内容哈希集合」，差集完全在手机侧算出来：
 *
 * | 分类 | 条件 | 处理 |
 * | --- | --- | --- |
 * | toPull | 桌面有、手机没有 | 下载整文件 |
 * | toPush | 手机有、桌面没有 | 上传分块 |
 * | both | 两边都有同一份内容 | 只换元数据（不传字节） |
 * | conflict | `titleKey` 相同但 hash 不同 | **不传**，标 CONTENT_MISMATCH 等用户选 |
 */
object SyncDiff {

    /** 一次规划的完整结果。 */
    data class Plan(
        val toPull: List<RemoteBook> = emptyList(),
        val toPush: List<LocalBook> = emptyList(),
        val both: List<Pair<LocalBook, RemoteBook>> = emptyList(),
        val conflicts: List<Conflict> = emptyList(),
        val excluded: List<LocalBook> = emptyList(),
    ) {
        /** 有正文但什么都没得做的书（用来喂「已同步」状态）。 */
        val untouched: List<LocalBook>
            get() = both.map { it.first }
    }

    /** 同名不同内容。默认不传，等用户选保留哪一版。 */
    data class Conflict(
        val local: LocalBook,
        val remote: RemoteBook,
        val reason: String,
    )

    /**
     * 算差集。
     *
     * @param local 手机上的书（只认 `hasLocalFile=true` 且有 contentHash 的参与搬运）
     * @param remote 桌面端清单（只认 `syncable=true` 且有 contentHash 的参与搬运）
     */
    fun plan(local: List<LocalBook>, remote: List<RemoteBook>): Plan {
        // 1. 双方各自建 hash → 对象 的索引
        val localByHash = LinkedHashMap<String, LocalBook>()
        val localExcluded = ArrayList<LocalBook>()
        for (book in local) {
            val hash = book.contentHash
            if (!book.hasLocalFile || hash.isNullOrBlank()) continue
            if (hash.length != 40) continue
            if (!book.syncableSize) {
                localExcluded.add(book)
                continue
            }
            localByHash.putIfAbsent(hash, book)
        }

        val remoteByHash = LinkedHashMap<String, RemoteBook>()
        for (item in remote) {
            // 云端书正文只在书源那边，本地永远不留副本，所以绝不进搬运索引。
            // 现在靠桌面端 syncable=false 兜着，但这条不能只依赖对端 —— 万一哪天桌面端
            // 把云端书标成 syncable，手机就会去下一份并不存在的正文。
            if (item.book.isCloud) continue
            val hash = item.book.contentHash
            if (!item.syncable || hash.isNullOrBlank() || hash.length != 40) continue
            remoteByHash.putIfAbsent(hash, item)
        }

        // 2. 只有一方有的，先按 titleKey 找同名不同内容（冲突优先于传输）
        val conflictLocalIds = HashSet<String>()
        val conflictRemoteHashes = HashSet<String>()
        val conflicts = ArrayList<Conflict>()
        for ((hash, localBook) in localByHash) {
            if (remoteByHash.containsKey(hash)) continue
            val twin = remoteByHash.values.firstOrNull {
                it.book.titleKey.isNotEmpty() && it.book.titleKey == localBook.titleKey
            } ?: continue
            conflicts.add(
                Conflict(
                    local = localBook,
                    remote = twin,
                    reason = "两端内容不一致，请选择保留哪一版",
                ),
            )
            conflictLocalIds.add(localBook.id)
            conflictRemoteHashes.add(twin.book.contentHash.orEmpty())
        }
        for ((hash, remoteItem) in remoteByHash) {
            if (localByHash.containsKey(hash)) continue
            val twin = localByHash.values.firstOrNull {
                it.titleKey.isNotEmpty() && it.titleKey == remoteItem.book.titleKey
            } ?: continue
            if (conflicts.any { it.remote.book.contentHash == hash }) continue
            conflicts.add(
                Conflict(
                    local = twin,
                    remote = remoteItem,
                    reason = "两端内容不一致，请选择保留哪一版",
                ),
            )
            conflictLocalIds.add(twin.id)
            conflictRemoteHashes.add(hash)
        }

        // 3. 四分类
        val toPull = remoteByHash
            .filterKeys { hash ->
                !localByHash.containsKey(hash) && !conflictRemoteHashes.contains(hash)
            }
            .values.toList()

        val toPush = localByHash
            .filterKeys { hash ->
                !remoteByHash.containsKey(hash) && !conflictLocalIds.contains(localByHash[hash]?.id)
            }
            .values.filter { !conflictLocalIds.contains(it.id) }

        val both = localByHash.entries
            .filter { remoteByHash.containsKey(it.key) }
            .map { it.value to remoteByHash.getValue(it.key) }

        return Plan(
            toPull = toPull,
            toPush = toPush,
            both = both,
            conflicts = conflicts,
            excluded = localExcluded,
        )
    }
}

/**
 * 同步编排：连接 → 清单 → 差集 → 串行搬运 → 落状态。
 *
 * 三条硬规矩：
 *  1. **串行单块**。局域网单连接已接近带宽上限，并发只会让代码多一半状态；
 *     串行也保证了 offset 单调递增，续传逻辑简单到不会错。
 *  2. **先校验再改名**。下载一律落 `.part`，sha1 对得上才 rename 成正式文件，
 *     否则删掉重来 —— 绝不让半本正文进书架。
 *  3. **id 归并**。上传成功后桌面端可能回一个不同的 id（它早就有一模一样的书），
 *     这时必须把 books.json 与 progress.json 的键一起迁过去，漏了就是同书两条 + 进度分裂。
 *
 * 3.1 起它同时是 [BookTransfer] 的实现（T08）：设备指令要搬字节时也走这里，
 * 「同步能下、指令下不来」这种双实现分叉因此不可能发生。
 */
class SyncEngine(
    private val books: BookStore,
    private val progress: ProgressStore,
    private val syncState: SyncStateStore,
    private val files: BookFileStore,
    private val clientProvider: () -> FolioClient,
) : BookTransfer {

    /**
     * 最近一次清单里的 `contentHash → 桌面端 id`。
     *
     * 上传完成后桌面端会把最终 id 放在响应里，但「这本书早就有了」的短路路径
     * （`upload/status` 直接说 done）不会再回 id，只能从清单里查 ——
     * 查不到就只能沿用本地 id，而本地 id 与桌面 id 不同就会多出一条重复书。
     */
    @Volatile
    private var lastRemoteHashes: Map<String, String> = emptyMap()

    /**
     * 上次快照「发出请求」的时刻（T10，**只在内存里**）。
     *
     * 不落盘的理由：进程被杀就清零，宁可多报一次快照，也不要留一个
     * 「上次是 3 天前」的假时间把上报永久堵死。
     */
    @Volatile
    private var lastSnapshotAt: Long = 0L

    /**
     * 完整同步一次。
     *
     * @param downloadOnly true 时只拉不推（「仅 Wi-Fi 上传」或用户只想补齐书架）
     * @param autoTransferUnder20MB true 时只自动上传 20MB 以内的书，
     *        更大的留给用户手动点（架构文档 §8 `AUTO_TRANSFER`）
     */
    suspend fun sync(
        downloadOnly: Boolean = false,
        autoTransferUnder20MB: Boolean = true,
    ): SyncOutcome = withContext(Dispatchers.IO) {
        var pulled = 0
        var pushed = 0
        var conflicts = 0
        var skipped = 0

        val client = clientProvider()
        try {
            // 1. 先确认桌面端够新
            val caps = client.capabilities()
            if (caps.apiVersion < com.folio.reader.net.Capabilities.REQUIRED_API_VERSION) {
                return@withContext SyncOutcome(
                    ok = false,
                    message = "桌面端太旧，请升级到 2.6.0",
                )
            }
            if (!caps.supportsLibrary) {
                return@withContext SyncOutcome(false, "桌面端没有开启书架清单接口")
            }

            // 2. 清单。顺手记下 hash → 桌面 id，上传成功后要按它归并本地键
            val snapshot = client.library()
            lastRemoteHashes = snapshot.books.mapNotNull { item ->
                val hash = item.book.contentHash
                if (hash.isNullOrBlank()) null else hash to item.book.id
            }.toMap()
            val stored = books.read()
            val local = reconcileLocalFiles(stored)
            // 校正过的 hasLocalFile 要落盘，否则每次启动都白算一遍
            val stale = local.filterIndexed { index, book ->
                index < stored.size && book.hasLocalFile != stored[index].hasLocalFile
            }
            if (stale.isNotEmpty()) books.upsertAll(stale)
            val plan = SyncDiff.plan(local, snapshot.books)

            // 2.5 云端书的元数据落地。云端书正文只能连桌面端在线读，永远不参与整文件搬运，
            // 但书本身必须出现在手机书架上 —— 否则用户根本点不进去，阅读器里的
            // isCloud 分支（CloudChapterSource / ComicReaderScreen 在线取图）全是死代码。
            reconcileCloudBooks(snapshot.books, stored)

            // 3. 冲突与不可同步的先落状态，别让用户以为它们在传
            for (conflict in plan.conflicts) {
                conflicts += 1
                books.updateSyncState(conflict.local.id, SyncState.CONTENT_MISMATCH)
                syncState.markMismatch(conflict.local.id, conflict.reason)
            }
            for (book in plan.excluded) {
                skipped += 1
                books.updateSyncState(book.id, SyncState.EXCLUDED)
                syncState.markExcluded(book.id, excludedReason(book))
            }

            // 4. both：只换元数据，不传字节
            for ((localBook, remoteItem) in plan.both) {
                // 桌面端清单里没有 remoteId 字段（只有 id），所以这里一律以它回填 ——
                // 漏了这一步，「两边都有」的书永远不知道自己在桌面端的 id，
                // 后续回写进度会用错键
                books.upsert(
                    localBook.copy(
                        remoteId = remoteItem.book.id,
                        remoteKind = remoteItem.book.kind,
                        contentHash = localBook.contentHash ?: remoteItem.book.contentHash,
                        syncState = SyncState.SYNCED,
                    ),
                )
                syncState.markSynced(localBook.id)
            }

            // 5. 拉：桌面有、手机没有
            for (item in plan.toPull) {
                val result = pullOne(client, item)
                when (result) {
                    is PullResult.Done -> pulled += 1
                    is PullResult.Skipped -> skipped += 1
                    is PullResult.Failed -> skipped += 1
                }
            }

            // 6. 推：手机有、桌面没有
            if (!downloadOnly) {
                for (book in plan.toPush) {
                    // 超过「自动传」阈值的书不自动搬：30MB 的书在弱 Wi-Fi 上能传几分钟，
                    // 用户没点之前不该替他占网络
                    if (autoTransferUnder20MB && book.size > SettingsStore.AUTO_TRANSFER_BYTES) {
                        skipped += 1
                        continue
                    }
                    val id = pushOne(client, book)
                    if (id != null) pushed += 1 else skipped += 1
                }
            }

            syncState.setLastSyncAt(System.currentTimeMillis())
            // T10：快照串在同步收尾的同一次调用里（同一个协程、短连接，绝不与搬运并发）。
            // 它自己吞异常且 60s 节流，所以这里既不用 try，也不会改变本次同步的结论。
            reportSnapshot()
            SyncOutcome(
                ok = true,
                message = buildMessage(pulled, pushed, conflicts),
                pulled = pulled,
                pushed = pushed,
                conflicts = conflicts,
                skipped = skipped,
            )
        } catch (err: FolioException) {
            SyncOutcome(false, err.message ?: "同步失败")
        } catch (err: UploadConflictException) {
            SyncOutcome(false, err.message ?: "上传位置对不上")
        } catch (err: Exception) {
            SyncOutcome(false, err.message ?: "同步失败")
        }
    }

    /**
     * 只拉一本（书架里长按「下载到手机」）。
     *
     * 与整体 [sync] 的区别：不推、不判冲突、不动别的书，
     * 只把桌面端这一本的正文搬到 `books/<id>.txt`。
     */
    suspend fun pullBook(bookId: String): SyncOutcome = withContext(Dispatchers.IO) {
        val client = clientProvider()
        try {
            val caps = client.capabilities()
            if (caps.apiVersion < com.folio.reader.net.Capabilities.REQUIRED_API_VERSION) {
                return@withContext SyncOutcome(false, "桌面端太旧，请升级到 2.6.0")
            }
            val snapshot = client.library()
            lastRemoteHashes = snapshot.books.mapNotNull { item ->
                val hash = item.book.contentHash
                if (hash.isNullOrBlank()) null else hash to item.book.id
            }.toMap()
            val localHash = books.findById(bookId)?.contentHash
            val item = snapshot.books.firstOrNull { it.book.id == bookId }
                ?: snapshot.books.firstOrNull { item ->
                    val hash = item.book.contentHash
                    !hash.isNullOrBlank() && hash == localHash
                }
                ?: return@withContext SyncOutcome(false, "桌面端书架上没有这本书")
            if (!item.syncable) {
                return@withContext SyncOutcome(false, item.syncableReason ?: "这本书不能整本搬过来")
            }
            return@withContext when (val result = pullOne(client, item)) {
                is PullResult.Done ->
                    SyncOutcome(true, "《${item.book.title}》已下到手机，断网也能读", pulled = 1)
                is PullResult.Skipped -> SyncOutcome(false, result.reason)
                is PullResult.Failed -> SyncOutcome(false, result.reason)
            }
        } catch (err: FolioException) {
            SyncOutcome(false, err.message ?: "下载失败")
        } catch (err: Exception) {
            SyncOutcome(false, err.message ?: "下载失败")
        }
    }

    /* ---------------- T08：设备指令的搬运入口 ---------------- */

    /**
     * `push-book`：按内容哈希把桌面端的书拉到手机。
     *
     * payload 里只有 `hash`，而下载接口要的是桌面端 `book.id`，所以先拉一次清单反查
     * （架构文档 §2.2 明确不给 payload 加 id 字段，一次清单比双端协议分叉便宜得多）。
     * 查不到就是 [`CommandError.SOURCE_GONE`] —— 桌面端确实已经没有这份副本了。
     *
     * 幂等：手机上已经有同 hash 的正文就直接 done，连清单都不拉。
     */
    override suspend fun pullByHash(hash: String): TransferResult = withContext(Dispatchers.IO) {
        val key = hash.trim().lowercase()
        val existing = books.read().firstOrNull { it.contentHash?.lowercase() == key }
        if (existing != null && files.exists(existing.id)) return@withContext TransferResult.Done

        val client = clientProvider()
        try {
            val caps = client.capabilities()
            if (caps.apiVersion < com.folio.reader.net.Capabilities.REQUIRED_API_VERSION) {
                return@withContext unsupported("桌面端太旧，请升级到 2.6.0")
            }
            val snapshot = client.library()
            lastRemoteHashes = snapshot.books.mapNotNull { item ->
                val itemHash = item.book.contentHash
                if (itemHash.isNullOrBlank()) null else itemHash to item.book.id
            }.toMap()

            val item = snapshot.books.firstOrNull { it.book.contentHash?.lowercase() == key }
                ?: return@withContext TransferResult.Failed(
                    CommandError.SOURCE_GONE,
                    "桌面端书架上已经没有这份内容的副本",
                )
            if (item.book.isCloud) return@withContext unsupported("云端书只能连桌面端在线读")
            if (!item.syncable) {
                return@withContext unsupported(item.syncableReason ?: "这本书不能整本搬过来")
            }
            val size = item.book.size
            if (size <= 0L) {
                return@withContext TransferResult.Failed(CommandError.SOURCE_GONE, "桌面端说这本书是空的")
            }
            if (size > LocalBook.MAX_SYNC_BYTES) {
                return@withContext TransferResult.Failed(CommandError.TOO_LARGE)
            }
            // 空间预检放在指令层做一次（pullOne 里也有），为的是能报出「还差多少 MB」：
            // 已经下到一半的 .part 也算作自己的可用余量，否则断点续传会被自己挡在门外
            val need = (size * LocalBook.SPACE_HEADROOM).toLong()
            val free = files.freeBytes()
            val partial = files.partSizeOf(item.book.id)
            if (free > 0L && free + partial < need) {
                return@withContext TransferResult.Failed(
                    code = CommandError.INSUFFICIENT_SPACE,
                    needBytes = need - free - partial,
                )
            }

            when (val result = pullOne(client, item)) {
                is PullResult.Done -> TransferResult.Done
                // 反查到了却说「没什么可下」：正文为空或没有 hash，等价于对端没有这份副本
                is PullResult.Skipped -> TransferResult.Failed(CommandError.SOURCE_GONE, result.reason)
                is PullResult.Failed -> TransferResult.Failed(result.code, result.reason)
            }
        } catch (err: CancellationException) {
            throw err
        } catch (err: FolioException) {
            TransferResult.Failed(failureCodeOf(err), err.message ?: "下载失败")
        } catch (err: Exception) {
            TransferResult.Failed(CommandError.NETWORK_INTERRUPTED, err.message ?: "下载失败")
        }
    }

    /**
     * `pull-book`：按内容哈希把手机的书推到桌面端。
     *
     * 复用 [pushOne]：`upload/status` 先问一句，桌面端已经有同 hash 就直接短路成 done ——
     * 这就是架构文档 §5 里 `pull-book` 的幂等来源，不需要额外判断。
     */
    override suspend fun pushByHash(hash: String): TransferResult = withContext(Dispatchers.IO) {
        val key = hash.trim().lowercase()
        val book = books.read().firstOrNull { it.contentHash?.lowercase() == key }
            ?: return@withContext TransferResult.Failed(CommandError.SOURCE_GONE, "手机上已经没有这本书")
        val file = files.fileFor(book.id)
        if (!file.isFile || file.length() <= 0L) {
            // 元数据还在但正文不在：桌面端要的是字节，这里只能算「对端没有副本」
            return@withContext TransferResult.Failed(CommandError.SOURCE_GONE, "手机上没有这本书的正文")
        }
        if (file.length() > LocalBook.MAX_SYNC_BYTES) {
            return@withContext TransferResult.Failed(CommandError.TOO_LARGE)
        }

        val client = clientProvider()
        try {
            val caps = client.capabilities()
            if (caps.apiVersion < com.folio.reader.net.Capabilities.REQUIRED_API_VERSION) {
                return@withContext unsupported("桌面端太旧，请升级到 2.6.0")
            }
            if (!caps.supportsUpload) {
                return@withContext unsupported("桌面端没有开启上传接口")
            }
            val remoteId = pushOne(client, book)
                ?: return@withContext TransferResult.Failed(
                    CommandError.NETWORK_INTERRUPTED,
                    // pushOne 已经把「桌面端关闭了允许写入」这类原话写进 sync-state，
                    // 用户打开开关再重试即可，归到「可重试」不会误导人
                    "上传没走完，可重试",
                )
            if (remoteId.isBlank()) {
                return@withContext TransferResult.Failed(CommandError.NETWORK_INTERRUPTED, "桌面端没有回传 id")
            }
            TransferResult.Done
        } catch (err: CancellationException) {
            throw err
        } catch (err: FolioException) {
            TransferResult.Failed(failureCodeOf(err), err.message ?: "上传失败")
        } catch (err: Exception) {
            TransferResult.Failed(CommandError.NETWORK_INTERRUPTED, err.message ?: "上传失败")
        }
    }

    /**
     * 拉一次排队指令并逐条执行（同步收尾时调用）。
     *
     * @return 执行结果；对端没有设备接口（2.5 / 2.6 早期）时返回空列表，**不报错**
     */
    suspend fun runPendingCommands(
        confirmer: DeleteConfirmer = DeleteConfirmer.REJECT,
    ): List<CommandOutcome> = withContext(Dispatchers.IO) {
        val client = clientProvider()
        val fetched = try {
            client.fetchCommands()
        } catch (err: CancellationException) {
            throw err
        } catch (err: Exception) {
            return@withContext emptyList()
        }
        if (!fetched.supported || !fetched.ok || fetched.commands.isEmpty()) {
            return@withContext emptyList()
        }
        CommandExecutor(
            books = books,
            progress = progress,
            syncState = syncState,
            files = files,
            transfer = this@SyncEngine,
            confirmer = confirmer,
        ).runAll(client, fetched.commands)
    }

    /* ---------------- T10：快照上报 ---------------- */

    /**
     * 上报一次设备快照：书架摘要 + 存储余量 + 版本号。
     *
     * @param force true 时跳过 60s 节流（用户手动点「刷新设备」用）
     * @return true 真的发出去并被接受；false 表示被节流、对端不支持或请求失败
     */
    suspend fun reportSnapshot(force: Boolean = false): Boolean = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        if (!force && !SnapshotThrottle.shouldSend(lastSnapshotAt, now)) return@withContext false
        // 先记时刻再发请求：失败也算用掉这次机会，弱网下才不会每个事件都重打一遍
        lastSnapshotAt = now

        try {
            val local = books.read()
            val built = SnapshotBuilder.build(
                books = local,
                storageTotal = files.root().totalSpace,
                storageFree = files.freeBytes(),
                booksBytes = local.filter { it.hasLocalFile }.sumOf { files.sizeOf(it.id) },
                appVersion = DeviceIdentity.APP_VERSION,
                apiVersion = com.folio.reader.net.Capabilities.REQUIRED_API_VERSION,
            )
            val ack = clientProvider().postSnapshot(built.body)
            ack.supported && ack.ok
        } catch (err: CancellationException) {
            throw err
        } catch (err: Exception) {
            // 快照是「顺便告诉桌面端」的附加能力，绝不能让它影响同步结果
            false
        }
    }

    /** 桌面端版本不够时的统一答复。 */
    private fun unsupported(reason: String): TransferResult.Failed =
        TransferResult.Failed(CommandError.UNSUPPORTED, reason)

    /**
     * HTTP 状态 → 指令失败原因。
     *
     * 422 是 `FolioClient.downloadBook` 校验 sha1 不过时抛的（它已经删掉半截文件），
     * 404 是对端没有这份副本。其余一律「可重试」—— 网络类失败占绝大多数。
     */
    private fun failureCodeOf(err: FolioException): CommandError = when (err.status) {
        422 -> CommandError.HASH_MISMATCH
        404 -> CommandError.SOURCE_GONE
        else -> CommandError.NETWORK_INTERRUPTED
    }

    /* ---------------- 单个书架条目 ---------------- */

    private sealed class PullResult {
        object Done : PullResult()
        class Skipped(val reason: String) : PullResult()

        /**
         * @param code 失败原因（指令回执要用）；走 [sync] 时没人看它，
         *        但**必须给准** —— 「空间不足」和「传输中断」在设备页上是两种完全不同的处置
         */
        class Failed(
            val reason: String,
            val code: CommandError = CommandError.NETWORK_INTERRUPTED,
        ) : PullResult()
    }

    /** 拉一本：空间预检 → `.part` → 校验 → 改名 → 元数据。 */
    private fun pullOne(client: FolioClient, item: RemoteBook): PullResult {
        val remote = item.book
        val hash = remote.contentHash ?: return PullResult.Skipped("没有内容哈希")
        val size = remote.size
        if (size <= 0L) return PullResult.Skipped("远端说这本书是空的")

        // 空间预检：剩余空间必须放得下 size × 1.2
        val need = (size * LocalBook.SPACE_HEADROOM).toLong()
        val free = files.freeBytes()
        if (free > 0L && free < need) {
            val msg = "需要腾出 ${formatMb(need - free)} 空间"
            syncState.markFailed(remote.id, msg, 0L, size)
            return PullResult.Failed(msg, CommandError.INSUFFICIENT_SPACE)
        }

        // 断点：上一轮留下的 .part 有多大就从哪继续
        val part = files.partFor(remote.id)
        var offset = if (part.isFile) part.length() else 0L
        if (offset >= size) {
            // 尺寸已经够了但没提交：从头来，免得把一个可疑文件当成品
            offset = 0L
            files.resetPart(remote.id)
        }

        syncState.markTransferring(remote.id, size)
        books.upsert(
            books.findById(remote.id)?.copy(syncState = SyncState.TRANSFERRING)
                ?: LocalBook(
                    id = remote.id,
                    title = remote.title,
                    author = remote.author,
                    origin = Origin.DESKTOP,
                    remoteKind = remote.kind,
                    type = remote.type,
                    contentHash = hash,
                    size = size,
                    hasLocalFile = false,
                    cover = remote.cover,
                    remoteId = remote.id,
                    addedAt = System.currentTimeMillis(),
                    syncState = SyncState.TRANSFERRING,
                ),
        )

        return try {
            var lastReported = offset
            val result = client.downloadBook(
                id = remote.id,
                dest = part,
                offset = offset,
                expectedHash = hash,
                onProgress = { written, total ->
                    // 每 2MB 记一次进度，别让 sync-state.json 变成写热点
                    if (written - lastReported >= PROGRESS_STEP) {
                        lastReported = written
                        syncState.markProgress(remote.id, written, if (total > 0) total else size)
                    }
                },
            )
            val target = files.commitPart(remote.id)
                ?: return PullResult.Failed("正文改名失败")
            if (!target.isFile) return PullResult.Failed("正文没有落盘")

            books.upsert(
                (books.findById(remote.id) ?: LocalBook(
                    id = remote.id,
                    title = remote.title,
                    author = remote.author,
                    origin = Origin.DESKTOP,
                    remoteKind = remote.kind,
                    type = remote.type,
                    contentHash = hash,
                    size = result.size,
                    hasLocalFile = true,
                    cover = remote.cover,
                    remoteId = remote.id,
                    addedAt = System.currentTimeMillis(),
                    syncState = SyncState.SYNCED,
                )).copy(
                    hasLocalFile = true,
                    size = result.size,
                    contentHash = result.hash,
                    encoding = com.folio.reader.core.TextDecoder.ENCODING_UTF8,
                    remoteId = remote.id,
                    remoteKind = remote.kind,
                    syncState = SyncState.SYNCED,
                ),
            )
            syncState.markSynced(remote.id)
            PullResult.Done
        } catch (err: FolioException) {
            // 网络断在中间：留着 .part 与 bytesDone，下次接着传
            val done = files.partSizeOf(remote.id)
            books.updateSyncState(remote.id, SyncState.FAILED)
            syncState.markFailed(remote.id, err.message ?: "下载失败", done, size)
            PullResult.Failed(err.message ?: "下载失败", failureCodeOf(err))
        }
    }

    /**
     * 推一本：先问 status 决定要不要传，再分块串行传，最后按回传 id 归并键。
     *
     * @return 桌面端上的 id；失败返回 null
     */
    private fun pushOne(client: FolioClient, book: LocalBook): String? {
        val hash = book.contentHash ?: return null
        val file = files.fileFor(book.id)
        if (!file.isFile) return null
        val total = file.length()
        if (total <= 0L) return null
        if (total > LocalBook.MAX_SYNC_BYTES) {
            books.updateSyncState(book.id, SyncState.EXCLUDED)
            syncState.markExcluded(book.id, excludedReason(book))
            return null
        }

        return try {
            // 1. 已经有了？桌面端按 contentHash 判断，天然幂等
            val status = client.uploadStatus(hash, total)
            if (status.done) {
                val remoteId = findRemoteId(hash) ?: book.id
                finishPush(book, remoteId)
                return remoteId
            }

            // 2. 串行传，从服务端说已经收到的位置继续
            var offset = status.received.coerceIn(0L, total)
            var serverId: String? = null
            syncState.markTransferring(book.id, total)
            books.updateSyncState(book.id, SyncState.TRANSFERRING)
            while (offset < total) {
                val length = minOf(LocalBook.CHUNK_BYTES.toLong(), total - offset).toInt()
                val result = try {
                    client.uploadChunk(
                        file = file,
                        offset = offset,
                        length = length,
                        hash = hash,
                        total = total,
                        name = book.title,
                    )
                } catch (conflict: UploadConflictException) {
                    // 服务端说位置不对：以它为准，重算一次再继续
                    if (conflict.received < 0 || conflict.received >= total) throw conflict
                    offset = conflict.received
                    continue
                }
                // 完成的那一块响应里带 id（可能是桌面端既有的 id，与本地不同）
                if (!result.id.isNullOrBlank()) serverId = result.id
                offset = if (result.done) total else maxOf(result.received, offset + length)
                syncState.markProgress(book.id, offset, total)
            }

            // 3. 定 id：响应优先 → 清单里的同 hash 项 → 沿用本地 id
            val remoteId = serverId ?: findRemoteId(hash) ?: book.id
            finishPush(book, remoteId)
            remoteId
        } catch (err: FolioException) {
            books.updateSyncState(book.id, SyncState.FAILED)
            syncState.markFailed(book.id, err.message ?: "上传失败", 0L, total)
            null
        } catch (err: Exception) {
            books.updateSyncState(book.id, SyncState.FAILED)
            syncState.markFailed(book.id, err.message ?: "上传失败", 0L, total)
            null
        }
    }

    /**
     * 上传成功后的收尾：桌面端回传的 id 与本地 id 不同就迁移键。
     *
     * 这是 T11 最容易漏的一步 —— 漏了用户会看到「同一本书两条」，
     * 而且点开哪一条进度都是从头开始。
     */
    private fun finishPush(book: LocalBook, remoteId: String) {
        var current = book
        if (remoteId != book.id) {
            val renamed = books.renameKey(book.id, remoteId)
            if (renamed != null) {
                progress.renameKey(book.id, remoteId)
                // 正文文件也换个名字，免得旧 id 的文件永远没人引用
                files.fileFor(book.id).takeIf { it.isFile }?.let { old ->
                    runCatching { old.renameTo(files.fileFor(remoteId)) }
                }
                current = renamed
            }
        }
        books.upsert(
            (books.findById(current.id) ?: current).copy(
                origin = Origin.LOCAL,
                remoteId = remoteId,
                syncState = SyncState.SYNCED,
                hasLocalFile = true,
            ),
        )
        syncState.markSynced(current.id)
    }

    /** 在最近一次清单里按 contentHash 找桌面端 id。 */
    private fun findRemoteId(hash: String): String? = lastRemoteHashes[hash]

    /* ---------------- 工具 ---------------- */

    /** 用磁盘实际情况校正 `hasLocalFile`，避免书籍条目与文件脱节。 */
    private fun reconcileLocalFiles(list: List<LocalBook>): List<LocalBook> =
        list.map { book ->
            val exists = files.exists(book.id)
            if (book.hasLocalFile == exists) book else book.copy(hasLocalFile = exists)
        }

    /**
     * 云端书元数据落地：**只搬元数据，不搬字节**。
     *
     * 桌面端书架上的云端书（`kind == "cloud"`）正文留在书源那边，手机只能连上时在线读，
     * 本地一个字节都不留。但「不留正文」不等于「不出现在书架上」——清单里的云端书必须
     * 变成 [BookStore] 里的条目，否则手机书架没有云端分区，[com.folio.reader.ui.AppViewModel]
     * 里 openBook 的 isCloud 分支永远走不到。
     *
     * 两件事：
     *  1. 快照里的云端书合并进书库，**保住本机状态**（读到第几页、上次读、入库时间、同步态）。
     *     漫画的 `comicPage` 是纯本地偏好，被桌面端的 0 覆盖就是回归。
     *  2. 桌面端已经删掉的云端书，本地连进度、同步态一起清掉 —— 留着就是点不开的幽灵条目。
     *
     * @param remote 本次 `/api/library` 快照
     * @param stored 快照到达时本地已有的书（用于取旧值和判幽灵，调用方在 upsert 之前读）
     */
    // internal 而非 private：单测要直接验这一步，走 sync() 会把网络和串行搬运一起拖进来。
    internal fun reconcileCloudBooks(remote: List<RemoteBook>, stored: List<LocalBook>) {
        val byId = stored.associateBy { it.id }
        val cloudItems = remote.filter { it.book.isCloud }

        val merged = cloudItems.map { item ->
            val book = item.book
            val old = byId[book.id]
            book.copy(
                origin = Origin.DESKTOP,
                remoteKind = BookKind.CLOUD,
                remoteId = book.remoteId ?: book.id,
                hasLocalFile = false,
                // 以下四项桌面端不知道，也没有资格覆盖
                addedAt = old?.addedAt ?: book.addedAt,
                lastReadAt = old?.lastReadAt ?: 0L,
                comicPage = old?.comicPage,
                syncState = old?.syncState ?: SyncState.NOT_SYNCED,
            )
        }
        if (merged.isNotEmpty()) books.upsertAll(merged)

        val alive = cloudItems.mapTo(HashSet()) { it.book.id }
        for (book in stored) {
            if (!book.isCloud || book.id in alive) continue
            books.remove(book.id)
            progress.remove(book.id)
            syncState.remove(book.id)
        }
    }

    private fun excludedReason(book: LocalBook): String = when {
        book.isCloud -> "云端书只能连桌面端在线读"
        book.size > LocalBook.MAX_SYNC_BYTES ->
            "这本 ${formatMb(book.size)}，超过 30MB 上限，只能在本机读"
        else -> "不参与同步"
    }

    private fun buildMessage(pulled: Int, pushed: Int, conflicts: Int): String {
        val parts = ArrayList<String>(3)
        if (pulled > 0) parts.add("新增 $pulled")
        if (pushed > 0) parts.add("上传 $pushed")
        if (conflicts > 0) parts.add("冲突 $conflicts")
        return if (parts.isEmpty()) "已是最新" else parts.joinToString(" · ")
    }

    private fun formatMb(bytes: Long): String {
        val mb = bytes / 1024.0 / 1024.0
        return if (mb >= 10) "${Math.round(mb)}MB" else String.format("%.1fMB", mb)
    }

    companion object {
        /** 进度上报的步长：2MB。 */
        private const val PROGRESS_STEP = 2L * 1024 * 1024
    }
}
