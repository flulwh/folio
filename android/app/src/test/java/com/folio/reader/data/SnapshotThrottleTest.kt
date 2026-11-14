package com.folio.reader.data

import com.folio.reader.BuildConfig
import com.folio.reader.core.BookKind
import com.folio.reader.core.LocalBook
import com.folio.reader.core.Origin
import com.folio.reader.net.DeviceIdentity
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 快照上报（T10）：60s 节流 + 快照体构建。
 *
 * 两件事必须钉死：
 *  1. 节流**只靠内存时间戳**，时钟回拨不能让快照永久停摆；
 *  2. 快照体只带摘要（hash/title/size/hasLocalFile + 存储三项 + 版本），
 *     体积上限 200KB 是硬约束 —— 超了宁可截断并标 `truncated`，也不能让桌面端 400。
 */
class SnapshotThrottleTest {

    private val now = 1_800_000_000_000L

    /* ---------------- 节流 ---------------- */

    @Test
    fun 本次进程还没发过时直接放行() {
        assertTrue(SnapshotThrottle.shouldSend(lastAt = 0L, now = now))
    }

    @Test
    fun 间隔不到60秒时挡掉() {
        assertFalse(SnapshotThrottle.shouldSend(lastAt = now - 1_000L, now = now))
        assertFalse(
            "59.999 秒也不行，边界必须是闭区间",
            SnapshotThrottle.shouldSend(lastAt = now - (SnapshotThrottle.INTERVAL_MS - 1), now = now),
        )
    }

    @Test
    fun 刚好60秒放行() {
        assertTrue(SnapshotThrottle.shouldSend(lastAt = now - SnapshotThrottle.INTERVAL_MS, now = now))
        assertTrue(SnapshotThrottle.shouldSend(lastAt = now - SnapshotThrottle.INTERVAL_MS * 3, now = now))
    }

    @Test
    fun 系统时间被调早也不能把快照堵死() {
        // 用户手动把时间改回去：now < lastAt，死守差值会永远不发
        assertTrue(SnapshotThrottle.shouldSend(lastAt = now + 60 * 60 * 1000L, now = now))
    }

    /* ---------------- 快照体 ---------------- */

    private fun book(
        seed: Int,
        title: String = "书 $seed",
        size: Long = 1024L,
        hasLocalFile: Boolean = true,
        addedAt: Long = seed.toLong(),
        hash: String? = null,
    ) = LocalBook(
        id = "id-$seed",
        title = title,
        origin = Origin.LOCAL,
        remoteKind = BookKind.LOCAL,
        contentHash = hash ?: hashOf(seed),
        size = size,
        hasLocalFile = hasLocalFile,
        addedAt = addedAt,
    )

    // 拼成 40 位十六进制。注意 padStart 必须够宽：原来写的是 padStart(2,'0')，
    // seed >= 256 时十六进制是 3 位，拼出来 60 位，会被 build 里的
    // `filter { contentHash.length == 40 }` 全部滤掉 —— 于是 400 本书只剩 1..255，
    // 「最新的那本」永远进不来，看着像生产代码没排序，其实是夹具自己丢了数据。
    private fun hashOf(seed: Int): String = seed.toString(16).padStart(8, '0').repeat(5)

    private fun build(books: List<LocalBook>, maxBytes: Int = SnapshotBuilder.MAX_BYTES) =
        SnapshotBuilder.build(
            books = books,
            storageTotal = 64L * 1024 * 1024 * 1024,
            storageFree = 12L * 1024 * 1024 * 1024,
            booksBytes = 3L * 1024 * 1024,
            appVersion = DeviceIdentity.APP_VERSION,
            apiVersion = 2,
            maxBytes = maxBytes,
        )

    @Test
    fun 快照体只带摘要和存储三项() {
        val built = build(listOf(book(1, title = "三体", size = 2048L)))
        val body = built.body

        assertEquals(1, built.count)
        assertFalse(built.truncated)
        assertEquals(64L * 1024 * 1024 * 1024, body.getLong("storageTotal"))
        assertEquals(12L * 1024 * 1024 * 1024, body.getLong("storageFree"))
        assertEquals(3L * 1024 * 1024, body.getLong("booksBytes"))
        assertEquals("版本号必须来自打包配置", BuildConfig.VERSION_NAME, body.getString("appVersion"))
        assertEquals(2, body.getInt("apiVersion"))

        val item = body.getJSONArray("books").getJSONObject(0)
        assertEquals(hashOf(1), item.getString("hash"))
        assertEquals("三体", item.getString("title"))
        assertEquals(2048L, item.getLong("size"))
        assertTrue(item.getBoolean("hasLocalFile"))
        // 正文、手机路径这类东西一个都不许出现在快照里
        assertFalse("快照不许带正文", body.toString().contains("正文"))
        assertFalse("快照不许带手机路径", body.toString().contains("/data/"))
    }

    @Test
    fun 没有40位hash的书不进快照() {
        val built = build(
            listOf(
                book(1),
                book(2, hash = ""),
                book(3, hash = "abc"),
            ),
        )

        assertEquals("只有真 hash 能参与双端对账", 1, built.count)
    }

    @Test
    fun 超过上限时截断并标记truncated() {
        val many = (1..400).map { book(it, title = "一本名字中等长度的书 $it") }

        val built = build(many, maxBytes = 4 * 1024)

        assertTrue("超上限必须标 truncated，否则桌面端以为这就是全部", built.truncated)
        assertTrue("实际字节数不能超过上限：${built.bytes}", built.bytes <= 4 * 1024)
        assertTrue("至少要留下几条", built.count in 1 until many.size)
    }

    @Test
    fun 截断时优先留下新书() {
        // addedAt 与 seed 同向：seed 越大越新
        val many = (1..400).map { book(it, title = "书 $it") }

        val built = build(many, maxBytes = 2 * 1024)
        val kept = ArrayList<String>()
        val array = built.body.getJSONArray("books")
        for (i in 0 until array.length()) kept.add(array.getJSONObject(i).getString("title"))

        assertFalse("截断不能一条不剩", kept.isEmpty())
        assertTrue("最新那本必须在里面：$kept", kept.contains("书 400"))
        assertFalse("最旧那本应该被削掉：$kept", kept.contains("书 1"))
    }

    @Test
    fun 默认上限是200KB且正常书架不会被截断() {
        assertEquals(200 * 1024, SnapshotBuilder.MAX_BYTES)

        // 50 本普通书 ≈ 几 KB，远低于上限
        val built = build((1..50).map { book(it) })
        assertFalse(built.truncated)
        assertEquals(50, built.count)
        assertTrue(built.bytes < SnapshotBuilder.MAX_BYTES)
    }

    @Test
    fun 书籍数量与hash字段永远对得上桌面端的四字段契约() {
        val built = build((1..3).map { book(it) })
        val array = built.body.getJSONArray("books")

        for (i in 0 until array.length()) {
            val item: JSONObject = array.getJSONObject(i)
            assertEquals("桌面端只认这四个字段", 4, item.length())
            assertEquals(40, item.getString("hash").length)
            assertEquals(item.getString("hash").lowercase(), item.getString("hash"))
        }
    }
}
