package com.folio.reader.ui

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 目录项必须真的可点。
 *
 * 这个测试看着「不优雅」，但它防的是一类编译器完全帮不上忙的 bug：
 * Composable 声明了 `onSelect: (Int) -> Unit`，调用方也传了 `vm.switchChapter(index)`，
 * 下游 `SessionStore.switchChapter()` 实现完整 —— 但列表项忘了加 `.clickable`。
 * 结果整条链路一个编译错误都没有，用户点章节却毫无反应（2026-11-27 就是这个故障）。
 *
 * 漫画目录 `ComicTocSheet` 有 `.clickable`，小说目录 `TocSheet` 漏了，所以这里钉死它。
 */
class TocSheetWiringTest {

    private fun source(): String {
        val relative = "src/main/java/com/folio/reader/ui/reader/TocSheet.kt"
        val candidates = ArrayList<File>()
        candidates.add(File(relative))
        var dir = File(System.getProperty("user.dir") ?: ".")
        repeat(5) {
            candidates.add(File(dir, relative))
            candidates.add(File(dir, "app/$relative"))
            dir = dir.parentFile ?: return@repeat
        }
        val found = candidates.firstOrNull { it.isFile }
            ?: throw AssertionError("找不到 TocSheet.kt，工作目录=${System.getProperty("user.dir")}")
        return found.readText(Charsets.UTF_8)
    }

    @Test
    fun 目录项绑定了章节点击() {
        val src = source()
        val wired = Regex("""\.clickable\s*\{[^}]*onSelect\s*\(\s*chapterIndex\s*\)""")
        assertTrue(
            "TocSheet 的章节 Row 必须 .clickable { onSelect(chapterIndex) }，" +
                "否则目录只是能看不能点",
            wired.containsMatchIn(src),
        )
    }

    @Test
    fun onSelect不能只是个没用的形参() {
        val src = source()
        val hits = Regex("""onSelect""").findAll(src).count()
        assertTrue(
            "onSelect 出现了 $hits 次；只有 1 次说明它光声明没被调用",
            hits >= 2,
        )
    }
}
