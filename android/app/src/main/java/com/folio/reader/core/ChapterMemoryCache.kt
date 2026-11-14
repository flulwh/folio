package com.folio.reader.core

/**
 * 云端章节的内存 LRU：只留最近读过的 3 章。
 *
 * 3.0 的零缓存红线（架构文档 §8）：任何缓存都必须是**内存对象**，
 * 禁止写 `cacheDir` / `filesDir`。所以这个类故意：
 *  - 不接 Context（拿不到文件系统，从类型上就写不出磁盘缓存）；
 *  - 不引第三方库（`LinkedHashMap(accessOrder=true)` 自己做 LRU，40 行够用）；
 *  - 提供可断言的 [size] / [keys] / [clear]，单测能直接验证「没有外部副作用」。
 *
 * 为什么是 3 章：翻页回看（上一章结尾 → 下一章开头）几乎覆盖全部重复读取，
 * 3 章足够覆盖「上下章浏览」这个最高频的动作，再多只是白占内存。
 */
class ChapterMemoryCache(
    /** 容量（章数）。默认 3，见架构文档 §8 `CHAPTER_CACHE`。 */
    private val capacity: Int = CHAPTER_CACHE,
) {

    /** 一章的身份：书 + 章号。章号是「真实章号」（目录里的 `i`），不是列表下标。 */
    data class Key(val bookId: String, val index: Int)

    /** accessOrder = true → 每次 [get] 都把条目挪到队尾，队头就是最久未用。 */
    private val entries = object : LinkedHashMap<Key, String>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Key, String>): Boolean =
            size > capacity
    }

    /** 读一章；不在缓存里返回 null（**不会**顺手统计命中率，省一次同步）。 */
    @Synchronized
    fun get(bookId: String, index: Int): String? = entries[Key(bookId, index)]

    /** 写一章。超出容量时自动淘汰最久未用的那一章。 */
    @Synchronized
    fun put(bookId: String, index: Int, text: String) {
        if (text.isEmpty()) return
        entries[Key(bookId, index)] = text
    }

    @Synchronized
    fun has(bookId: String, index: Int): Boolean = entries.containsKey(Key(bookId, index))

    /** 当前缓存的章数（单测断言用）。 */
    @Synchronized
    fun size(): Int = entries.size

    /** 当前缓存的章号集合（按最近使用顺序，最久在前）。 */
    @Synchronized
    fun keys(bookId: String): List<Int> =
        entries.keys.filter { it.bookId == bookId }.map { it.index }

    /** 清空。离开阅读器、退出 App 时调用，单测也靠它复位。 */
    @Synchronized
    fun clear() {
        entries.clear()
    }

    /** 丢掉某一本的全部缓存（删书时用）。 */
    @Synchronized
    fun clear(bookId: String) {
        entries.keys.removeAll { it.bookId == bookId }
    }

    /** 估算占用字节数（UTF-16 内存字符串按 2 字节/字符算）。 */
    @Synchronized
    fun bytes(): Long {
        var total = 0L
        for (text in entries.values) total += text.length.toLong() * 2L
        return total
    }

    companion object {
        /** 缓存章数：3（架构文档 §8 `CHAPTER_CACHE`）。 */
        const val CHAPTER_CACHE = 3
    }
}
