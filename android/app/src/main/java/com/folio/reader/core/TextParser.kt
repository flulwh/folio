package com.folio.reader.core

/** 段落。blank 表示空行，渲染成呼吸间距。 */
data class Paragraph(val text: String, val blank: Boolean)

/** 章节标题与其首段序号。 */
data class Chapter(val title: String, val paraIndex: Int)

/** 解析结果。 */
data class ParsedBook(
    val paragraphs: List<Paragraph>,
    val chapters: List<Chapter>,
    val hasHeadings: Boolean,
    val charCount: Int,
    val wordCount: Int,
    /** 规范化后的原文，缓存到本地时按它落盘。 */
    val rawText: String = "",
)

/**
 * 正文解析：切段 + 认章节。
 * 规则与桌面端 src/utils/chapters.js 一致，
 * 这样同一本书在两端切出来的段落序号可以对齐，进度才能互认。
 */
object TextParser {

    val AUTO_CHAPTER_REGEX: Regex = Regex(
        "^\\s*(?:" +
            "第[0-9零一二三四五六七八九十百千万两〇]+[章节節回卷部集篇话話]" +
            "|(?:Chapter|CHAPTER|Part|PART|Section|SECTION)\\s+[0-9IVXLCDMivxlcdm]+\\b" +
            "|(?:序章|序言|楔子|引子|前言|后记|後記|尾声|尾聲|终章|終章|番外|附录|附錄)" +
            "|(?:[0-9]{1,4}[、.．:：]\\s*\\S)" +
            "|(?:【[^】]{1,24}】)" +
            ")\\s*.{0,48}$",
        RegexOption.MULTILINE,
    )

    private const val SENTENCE_END_CHARS = "。！？…」』”’）)"
    private const val OPENING_CHARS = "「『“（(【["
    private const val HEADING_PUNCT_CHARS = "。！？!?；;"
    private const val HEADING_CLOSE_CHARS = "】」』”"

    /** 去掉 BOM、统一换行、nbsp 与制表符。 */
    fun normalizeText(raw: String): String {
        if (raw.isEmpty()) return ""
        val sb = StringBuilder(raw.length)
        var index = 0
        if (raw.startsWith("\uFEFF")) index = 1
        while (index < raw.length) {
            val ch = raw[index]
            when {
                ch == '\r' -> {
                    sb.append('\n')
                    if (index + 1 < raw.length && raw[index + 1] == '\n') index++
                }
                ch == '\u00a0' -> sb.append(' ')
                ch == '\t' -> sb.append("  ")
                else -> sb.append(ch)
            }
            index++
        }
        return sb.toString()
    }

    private fun endsWithAny(value: String, chars: String): Boolean {
        if (value.isEmpty()) return false
        return chars.indexOf(value[value.length - 1]) >= 0
    }

    private fun startsWithAny(value: String, chars: String): Boolean {
        if (value.isEmpty()) return false
        return chars.indexOf(value[0]) >= 0
    }

    private fun headingCore(line: String, regex: Regex): Boolean {
        if (endsWithAny(line, HEADING_PUNCT_CHARS) && !endsWithAny(line, HEADING_CLOSE_CHARS)) return false
        return regex.containsMatchIn(line)
    }

    /** 切段：连续空行压成一个 blank 标记；硬换行的句子会被粘回上一段。 */
    fun splitParagraphs(text: String, headingRegex: Regex? = null): List<Paragraph> {
        val paragraphs = ArrayList<Paragraph>()
        val buffer = ArrayList<String>()

        fun flush() {
            if (buffer.isEmpty()) return
            val joined = buffer.joinToString("").trim()
            if (joined.isNotEmpty()) paragraphs.add(Paragraph(joined, false))
            buffer.clear()
        }

        for (line in text.split("\n")) {
            val trimmed = line.trim()
            if (trimmed.isEmpty()) {
                flush()
                if (paragraphs.isNotEmpty() && !paragraphs[paragraphs.lastIndex].blank) {
                    paragraphs.add(Paragraph("", true))
                }
                continue
            }
            val looksLikeHeading = trimmed.length <= 60 && headingRegex != null && headingCore(trimmed, headingRegex)
            val prev = if (buffer.isEmpty()) null else buffer[buffer.lastIndex]
            if (
                prev != null &&
                !looksLikeHeading &&
                !endsWithAny(prev, SENTENCE_END_CHARS) &&
                !startsWithAny(trimmed, OPENING_CHARS) &&
                prev.length > 24
            ) {
                val glue = if (endsWithAny(prev, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789,;)") &&
                    startsWithAny(trimmed, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz(")
                ) " " else ""
                buffer[buffer.lastIndex] = prev + glue + trimmed
            } else {
                flush()
                buffer.add(trimmed)
            }
        }
        flush()

        while (paragraphs.isNotEmpty() && paragraphs[paragraphs.lastIndex].blank) {
            paragraphs.removeAt(paragraphs.lastIndex)
        }
        return paragraphs
    }

    private fun cleanTitle(text: String): String {
        var value = text.trim()
        if (value.startsWith("【") || value.startsWith("[")) value = value.substring(1)
        if (value.endsWith("】") || value.endsWith("]")) value = value.substring(0, value.length - 1)
        return if (value.length > 60) value.substring(0, 60) else value
    }

    /** 认章节。 */
    fun buildChapters(paragraphs: List<Paragraph>, regex: Regex): Pair<List<Chapter>, Boolean> {
        val chapters = ArrayList<Chapter>()
        for (i in paragraphs.indices) {
            val p = paragraphs[i]
            if (p.blank) continue
            if (p.text.length <= 60 && headingCore(p.text, regex)) {
                chapters.add(Chapter(cleanTitle(p.text), i))
            }
        }
        if (chapters.isEmpty()) return listOf(Chapter("全文", 0)) to false

        val first = chapters.first()
        if (first.paraIndex > 0) {
            var hasRealText = false
            for (i in 0 until first.paraIndex) {
                if (!paragraphs[i].blank) {
                    hasRealText = true
                    break
                }
            }
            if (hasRealText) chapters.add(0, Chapter("开篇", 0))
        }
        return chapters to true
    }

    /** 完整解析。 */
    fun parseBook(content: String, customRegex: String = ""): ParsedBook {
        val text = normalizeText(content)
        val regex = if (customRegex.isBlank()) AUTO_CHAPTER_REGEX else runCatching {
            Regex(customRegex, RegexOption.MULTILINE)
        }.getOrDefault(AUTO_CHAPTER_REGEX)
        val paragraphs = splitParagraphs(text, regex)
        val (chapters, hasHeadings) = buildChapters(paragraphs, regex)
        return ParsedBook(
            paragraphs = paragraphs,
            chapters = chapters,
            hasHeadings = hasHeadings,
            charCount = text.length,
            wordCount = countWords(text),
            rawText = text,
        )
    }

    /** 中文按字算，西文按词算。 */
    fun countWords(text: String): Int {
        var cjk = 0
        var latin = 0
        var inWord = false
        for (ch in text) {
            val code = ch.code
            if (code in 0x3400..0x4DBF || code in 0x4E00..0x9FFF) {
                cjk++
                inWord = false
                continue
            }
            val isLatin = code in 0x41..0x5A || code in 0x61..0x7A || code in 0x30..0x39 || code == 0x27
            if (isLatin) {
                if (!inWord) {
                    latin++
                    inWord = true
                }
            } else {
                inWord = false
            }
        }
        return cjk + latin
    }

    /** 找到某个段落序号所在的章节下标。 */
    fun chapterIndexForPara(chapters: List<Chapter>, paraIndex: Int): Int {
        if (chapters.isEmpty()) return 0
        // 第一个 paraIndex 大于目标的下标，其前一个就是所属章节
        var upper = chapters.size
        for (i in chapters.indices) {
            if (chapters[i].paraIndex > paraIndex) {
                upper = i
                break
            }
        }
        return if (upper > 0) upper - 1 else 0
    }
}
