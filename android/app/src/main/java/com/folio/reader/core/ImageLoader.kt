package com.folio.reader.core

import android.content.ComponentCallbacks2
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import com.folio.reader.net.PageStream
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.io.ByteArrayOutputStream
import java.io.InputStream

/**
 * 一页漫画的身份：**按 `(书, 话, 页)` 索引**，不按 URL。
 *
 * 这是 3.0 的刻意选择（架构文档 §1.3）：桌面端只暴露「第几话第几页」，
 * 源站地址永远不下到手机，缓存键自然也只能是页索引。
 * 好处是同一个 key 永远不会因为源站换 CDN 而失效，也不用担心把 URL 拼错。
 */
data class PageKey(
    val bookId: String,
    /** 话序号（真实章号，不是列表下标）。 */
    val chapter: Int,
    /** 页序号，0 基。 */
    val page: Int,
) {
    companion object {
        /** 容忍脏输入：书 id 去空白，话号/页号负数归零。 */
        fun of(bookId: String, chapter: Int, page: Int): PageKey =
            PageKey(bookId.trim(), chapter.coerceAtLeast(0), page.coerceAtLeast(0))
    }
}

/**
 * 漫画页的**内存**图片加载器（不引 Coil，架构文档 §1.4）。
 *
 * 组成：
 *  - `LruCache<PageKey, Bitmap>` 按**字节**计容量（`min(96MB, maxMemory/8)`），
 *    一页 1080×1600 的 ARGB_8888 ≈ 6.9MB，所以按条数计根本没意义；
 *  - `inJustDecodeBounds` 先量尺寸，再用 [SampleSize] 算 `inSampleSize`；
 *  - `Semaphore(3)` 限并发：局域网单连接本来就不宽，3 个并行正好掩盖解码耗时；
 *  - 同一个 key 的并发请求共享一个 [Deferred]，不会重复下载同一页；
 *  - [clear] / [onTrimMemory] / [sizeBytes] 让「零磁盘缓存」可自证 ——
 *    设置页读的就是 [sizeBytes]，它一定落在内存里。
 *
 * 红线：这里**没有**任何 File / DiskLruCache / cacheDir 的引用，从类型上就写不出磁盘缓存。
 */
class ImageLoader(
    /** 打开一页的字节流（通常转给 `FolioClient.comicPage`）。返回 null 表示这页拿不到。 */
    private val openPage: (PageKey) -> PageStream?,
    /** 屏幕宽（像素）。做成函数是为了跟随旋转/分屏变化。 */
    private val screenWidthPx: () -> Int,
    /** 缓存容量（字节）。默认见 [defaultCacheBytes]。 */
    private val cacheBytes: Int = defaultCacheBytes(),
) {

    private val cache = object : android.util.LruCache<PageKey, Bitmap>(cacheBytes) {
        override fun sizeOf(key: PageKey, value: Bitmap): Int = value.byteCount
    }

    /** 并发闸门：3（架构文档 §8 `IMAGE_CONCURRENCY`）。 */
    private val gate = Semaphore(IMAGE_CONCURRENCY)

    /** 正在下载/解码的页。同一个 key 只跑一次。 */
    private val inflight = HashMap<PageKey, Deferred<Bitmap?>>()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /* ---------------- 读取 ---------------- */

    /** 已经在内存里的页；没有返回 null（同步、不阻塞）。 */
    fun cached(key: PageKey): Bitmap? = runCatching { cache.get(key) }.getOrNull()

    /**
     * 取一页。
     *
     * 命中缓存立刻返回；否则发起（或复用）一个后台任务。
     * 失败一律返回 null（这一页显示「重试」即可，不抛）。
     */
    fun load(key: PageKey): Deferred<Bitmap?> {
        cached(key)?.let { return CompletableDeferred(it) }
        synchronized(inflight) {
            val running = inflight[key]
            if (running != null && running.isActive) return running
            val job = scope.async { decodeAndCache(key) }
            inflight[key] = job
            job.invokeOnCompletion { synchronized(inflight) { inflight.remove(key) } }
            return job
        }
    }

    /**
     * 预取一批页（翻到某话时把下一话首两页先拉起来）。
     *
     * 不返回结果：预取失败不该影响任何 UI。
     */
    fun prefetch(keys: List<PageKey>) {
        for (key in keys) {
            if (cached(key) != null) continue
            load(key)
        }
    }

    /* ---------------- 生命周期 ---------------- */

    /** 取消某一页的加载（用户快速划过时用）。 */
    fun cancel(key: PageKey) {
        val job = synchronized(inflight) { inflight.remove(key) }
        job?.cancel()
    }

    /** 取消全部在途加载，保留已解码的缓存。 */
    fun cancelAll() {
        scope.coroutineContext[Job]?.cancelChildren()
        synchronized(inflight) { inflight.clear() }
    }

    /** 清空内存（离开阅读器）。清完之后 [sizeBytes] 必须是 0。 */
    fun clear() {
        cancelAll()
        runCatching { cache.evictAll() }
    }

    /**
     * 响应系统内存压力。
     *
     * @param level 来自 `ComponentCallbacks2.onTrimMemory` 的常量
     */
    fun onTrimMemory(level: Int) {
        when {
            level >= ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN -> clear()
            level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW ->
                runCatching { cache.trimToSize(cacheBytes / 2) }
        }
    }

    /** 彻底关闭（进程退出前）。 */
    fun shutdown() {
        clear()
        scope.coroutineContext[Job]?.cancel()
    }

    /* ---------------- 自证 ---------------- */

    /** 当前缓存占用（字节）。设置页「缓存占用恒 0」读的就是它之外的磁盘统计。 */
    fun sizeBytes(): Long = runCatching { cache.size().toLong() }.getOrDefault(0L)

    /** 当前缓存里的页数。 */
    fun count(): Int = runCatching { cache.snapshot().size }.getOrDefault(0)

    /** 缓存上限（字节），诊断用。 */
    fun capacityBytes(): Int = cacheBytes

    /* ---------------- 内部 ---------------- */

    private suspend fun decodeAndCache(key: PageKey): Bitmap? {
        val bitmap = try {
            gate.withPermit { decode(key) }
        } catch (err: CancellationException) {
            throw err
        } catch (err: Exception) {
            Log.w(TAG, "取图失败 ${key.bookId}#${key.chapter}:${key.page}", err)
            return null
        } ?: return null
        runCatching { cache.put(key, bitmap) }
        return bitmap
    }

    /**
     * 下载 + 采样解码。
     *
     * 为什么先把字节读进内存再解：`inJustDecodeBounds` 会把流读一遍，
     * 而网络流不可回退，只能落地成一次性的 `ByteArray` 才能解第二次。
     * 单页上限 [MAX_IMAGE_BYTES]（6MB，与桌面端一致），超了直接放弃这一页。
     */
    private fun decode(key: PageKey): Bitmap? {
        val stream: PageStream = try {
            openPage(key)
        } catch (err: Exception) {
            Log.w(TAG, "取图失败 ${key.bookId}#${key.chapter}:${key.page}", err)
            return null
        } ?: return null

        val bytes = stream.use { page -> readLimited(page.input, MAX_IMAGE_BYTES) } ?: return null
        if (bytes.isEmpty()) return null

        // 第一遍：只量尺寸，不分配像素内存
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        val screen = screenWidthPx()
        val sample = SampleSize.forScreen(bounds.outWidth, bounds.outHeight, screen)
        val options = BitmapFactory.Options().apply {
            inSampleSize = sample
            inScaled = false
        }
        return runCatching {
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        }.getOrNull()
    }

    /** 读流并限长；超过 [limit] 返回 null（宁可这一页空白，也不要 OOM）。 */
    private fun readLimited(input: InputStream, limit: Long): ByteArray? {
        val out = ByteArrayOutputStream(READ_BUFFER * 2)
        val buffer = ByteArray(READ_BUFFER)
        var total = 0L
        while (true) {
            val count = input.read(buffer)
            if (count <= 0) break
            total += count
            if (total > limit) return null
            out.write(buffer, 0, count)
        }
        return out.toByteArray()
    }

    companion object {
        private const val TAG = "FolioImageLoader"

        /** 并发上限：3（架构文档 §8 `IMAGE_CONCURRENCY`）。 */
        const val IMAGE_CONCURRENCY = 3

        /** 单页上限 6MiB，与桌面端 `MAX_IMAGE` 一致。 */
        const val MAX_IMAGE_BYTES = 6L * 1024 * 1024

        /** 缓存上限不会超过 96MiB。 */
        const val MAX_CACHE_BYTES = 96L * 1024 * 1024

        private const val READ_BUFFER = 32 * 1024

        /**
         * 默认缓存容量：`min(96MB, maxMemory / 8)`（架构文档 §1.4）。
         *
         * 下限 16MB：低端机 maxMemory 可能只有 192MB，除以 8 只剩 24MB，
         * 再除下去连 3 页都放不下，翻页会一直重新下载。
         */
        fun defaultCacheBytes(): Int {
            val maxHeap = Runtime.getRuntime().maxMemory()
            val eighth = maxHeap / 8
            val chosen = minOf(eighth, MAX_CACHE_BYTES)
            return chosen.coerceIn(16L * 1024 * 1024, MAX_CACHE_BYTES).toInt()
        }
    }
}
