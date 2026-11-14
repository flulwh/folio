package com.folio.reader.core

/**
 * 双端痕迹（书签 / 划线 / 笔记）的合并规则。
 *
 * 为什么需要「上次同步快照」：
 *  - 两端各存一份 `marks.json`，id 是各自生成的 UUID，同一处痕迹的 id 必然不同，
 *    所以只能按 [ReaderMark.syncKey]（类型 + 章号 + 段落）对齐；
 *  - 只做并集的话，桌面端删掉的书签下一次同步又会被手机推回来。因此合并必须知道
 *    「上次同步时这条还在不在」—— [base] 就是那份快照（key → 内容指纹）。
 *    本地有、远端没有、且本地没动过 → 判定为远端删除；反向同理。
 *
 * 纯函数，不碰文件也不发网络请求，单测直接调 [merge]。
 */
object MarkSync {

    /** 合并结果。[push] / [removeRemote] 非空时需要回写桌面端。 */
    data class Plan(
        val merged: List<ReaderMark>,
        val push: List<ReaderMark>,
        val removeRemote: List<String>,
        val removedLocal: Int,
        val pulled: Int,
    ) {
        val needsPush: Boolean get() = push.isNotEmpty() || removeRemote.isNotEmpty()
    }

    /** 内容指纹：时间戳 + 正文 + 笔记。id 不参与（两端 id 天然不同）。 */
    fun tagOf(mark: ReaderMark): String =
        "${stampOf(mark)}|${mark.kind}|${mark.excerpt}|${mark.note}"

    /**
     * 合并一本书的两端痕迹。
     *
     * @param local 本机当前痕迹
     * @param remote 桌面端当前痕迹
     * @param base 上次同步成功的快照（key → [tagOf]）；没有快照就传空 map
     */
    fun merge(
        local: List<ReaderMark>,
        remote: List<ReaderMark>,
        base: Map<String, String>,
    ): Plan {
        val localByKey = local.associateBy { it.syncKey }
        val remoteByKey = remote.associateBy { it.syncKey }
        val keys = (localByKey.keys + remoteByKey.keys).sorted()

        val merged = ArrayList<ReaderMark>(keys.size)
        val push = ArrayList<ReaderMark>()
        val removeRemote = ArrayList<String>()
        var removedLocal = 0
        var pulled = 0

        for (key in keys) {
            val mine = localByKey[key]
            val theirs = remoteByKey[key]
            when {
                mine != null && theirs != null -> {
                    if (tagOf(mine) == tagOf(theirs)) {
                        merged += mine
                    } else if (stampOf(mine) >= stampOf(theirs)) {
                        // 本机更新（或同毫秒）：以本机为准，推给桌面端
                        merged += mine
                        push += mine
                    } else {
                        merged += theirs
                        pulled++
                    }
                }

                mine != null -> {
                    val known = base[key]
                    if (known != null && known == tagOf(mine)) {
                        // 上次同步时还在，现在远端没了，本机也没动过 → 远端删了
                        removedLocal++
                    } else {
                        // 新增，或删掉之后又改过 → 保留并推给桌面端
                        merged += mine
                        push += mine
                    }
                }

                theirs != null -> {
                    val known = base[key]
                    if (known != null && known == tagOf(theirs)) {
                        // 上次同步时还在，远端没动过，本机删了 → 让桌面端也删
                        removeRemote += key
                    } else {
                        merged += theirs
                        pulled++
                    }
                }
            }
        }

        return Plan(
            merged = merged,
            push = push,
            removeRemote = removeRemote,
            removedLocal = removedLocal,
            pulled = pulled,
        )
    }

    private fun stampOf(mark: ReaderMark): Long =
        if (mark.updatedAt > 0L) mark.updatedAt else mark.createdAt
}
