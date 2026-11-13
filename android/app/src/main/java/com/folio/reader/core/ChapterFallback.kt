package com.folio.reader.core

/**
 * 离线时的章节选择。
 *
 * 云端书只缓存了读过的部分，断网后用户想看的章可能不在里面。
 * 这时候退到「离目标最近」的已缓存章节，比直接报错有用得多；
 * 距离相同则取更靠前的那章，翻回去比跳过去更符合直觉。
 */
object ChapterFallback {

    /** 在已缓存章号里找离 [target] 最近的一章；没有缓存返回 null。 */
    fun nearest(cached: Set<Int>, target: Int): Int? {
        if (cached.isEmpty()) return null
        var best: Int? = null
        var bestDistance = Int.MAX_VALUE
        for (index in cached) {
            val distance = kotlin.math.abs(index - target)
            if (distance < bestDistance || (distance == bestDistance && best != null && index < best)) {
                best = index
                bestDistance = distance
            }
        }
        return best
    }

    /** 是否值得退让：目标章本身没缓存，但有别的章可读。 */
    fun shouldFallback(cached: Set<Int>, target: Int): Boolean =
        cached.isNotEmpty() && !cached.contains(target)
}
