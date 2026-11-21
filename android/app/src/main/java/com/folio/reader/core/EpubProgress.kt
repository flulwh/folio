package com.folio.reader.core

/**
 * EPUB 阅读位置的百分比换算（双端同步口径：0–100）。
 *
 * Readium 的 `totalProgression` 是全书 0–1；书里没有总进度时退回章内
 * `progression`（单章 EPUB 两者等价）。桌面的 EPUB 进度条用同一口径，
 * 手机写上去的位置才能在桌面端落到大致相同的地方。
 *
 * 脏值一律夹住，不抛异常：这些数字来自解析结果与网络缓存。
 */
fun epubPercent(totalProgression: Double?, progression: Double?): Double? {
    val raw = totalProgression ?: progression ?: return null
    if (!raw.isFinite()) return null
    return (raw * 100.0).coerceIn(0.0, 100.0)
}

/**
 * [epubPercent] 的反向换算：0–100 → Readium 的 0–1 比例。
 *
 * 桌面端更新过进度、手机本机又没有对应 locator 时，用这个比例
 * 让 `Publication.locate` 找回最接近的位置。越界与 NaN 归 0。
 */
fun epubFraction(percent: Double?): Double {
    val value = percent ?: return 0.0
    if (!value.isFinite()) return 0.0
    return (value / 100.0).coerceIn(0.0, 1.0)
}
