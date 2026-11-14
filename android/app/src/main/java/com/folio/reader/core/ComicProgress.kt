package com.folio.reader.core

/**
 * 漫画进度的百分比计算 —— 对齐到「话」级。
 *
 * 漫画不像小说有稳定的段落序号：同一话的页数会变，跨版本还可能被重新切图。
 * 所以两端的口径统一成「话」，话内只留一个粗粒度比例：
 *
 * ```
 * percent = (话下标 + 话内页比例) / 话总数 × 100
 * ```
 *
 * 话内页比例用 `pageIndex / pageCount`（当前页「已翻到」的位置），
 * 与小说 `paraIndex / paraCount` 的算法保持一致 —— 两边对「读到哪」的理解相同，
 * 换到桌面端进度条上不会跳。
 *
 * 边界一律**夹住不抛异常**：这些数来自网络响应与本地缓存，
 * 拿到脏值（负数、比总数还大）时宁可显示 0% 或 100%，也不要让阅读器崩。
 *
 * | 输入 | 输出 |
 * | --- | --- |
 * | 第一话第一页 | `0.0` |
 * | 最后一话最后一页 | `< 100.0`，且贴近 100 |
 * | `chapterCount <= 0`（目录还没拿到） | `0.0` |
 * | `pageCount <= 0`（页数还没拿到） | 只按话位置算 |
 * | `chapterIndex` / `pageIndex` 越界 | 夹到最近的一端 |
 *
 * @param chapterIndex 当前话在目录里的下标（0 基），不是话号
 * @param pageIndex 当前页在本话里的下标（0 基）
 * @param pageCount 本话总页数
 * @param chapterCount 目录总话数
 * @return 0.0–100.0 之间的百分比
 */
fun comicPercent(
    chapterIndex: Int,
    pageIndex: Int,
    pageCount: Int,
    chapterCount: Int,
): Double {
    if (chapterCount <= 0) return 0.0
    val chapter = chapterIndex.coerceIn(0, chapterCount - 1)
    val inner = if (pageCount <= 0) {
        0.0
    } else {
        pageIndex.coerceIn(0, pageCount - 1).toDouble() / pageCount
    }
    return ((chapter + inner) / chapterCount * 100.0).coerceIn(0.0, 100.0)
}
