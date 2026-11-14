package com.folio.reader.ui.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextIndent
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.folio.reader.core.Chapter
import com.folio.reader.core.Paragraph
import com.folio.reader.ui.PageTurn
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.yield

/* ==========================================================================
   翻页阅读（左右分页）
   --------------------------------------------------------------------------
   分页只算「当前这一章」：用 TextMeasurer 逐段量高，按可视高度装页。
   超长段落按行切开，不会出现「一页塞不下就整段溢出」。
   改字号 / 行距 / 页边距 / 屏幕尺寸会立刻重分页；翻页、点按、音量键都走同一个 PageTurn。
   ========================================================================== */

private sealed interface PageBlock {
    data class Heading(val number: Int, val title: String) : PageBlock
    data class Body(val paraIndex: Int, val text: String, val indent: Boolean) : PageBlock
    data object Blank : PageBlock
}

private data class ReaderPage(
    /** 这一页从哪一段开始（上报进度用）。 */
    val startPara: Int,
    val blocks: List<PageBlock>,
)

/** 排版指纹：任何一项变了都要重新分页。 */
private data class PageLayoutKey(
    val widthPx: Int,
    val heightPx: Int,
    val fontSize: Float,
    val lineHeight: Float,
    val letterSpacing: Float,
    val paragraphGap: Float,
    val indent: Boolean,
    val family: String,
)

@Composable
fun ReaderPager(
    paragraphs: List<Paragraph>,
    chapters: List<Chapter>,
    chapterIndex: Int,
    chapterTitle: String,
    bodyStyle: TextStyle,
    kickerStyle: TextStyle,
    headingStyle: TextStyle,
    paragraphGap: Dp,
    blankGap: Dp,
    pagePadding: Int,
    bookmarkedParas: Set<Int>,
    highlightedParas: Set<Int>,
    startPara: Int,
    pageTurn: PageTurn,
    tapToTurn: Boolean,
    jumpPara: Int,
    onJumpHandled: () -> Unit,
    onTapCenter: () -> Unit,
    onPosition: (Int) -> Unit,
    onPrevChapter: () -> Unit,
    onNextChapter: () -> Unit,
) {
    val measurer = rememberTextMeasurer(cacheSize = 256)
    val density = LocalDensity.current
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    val range = remember(chapters, chapterIndex, paragraphs.size) {
        if (chapters.isEmpty()) {
            0 to paragraphs.size
        } else {
            val start = chapters.getOrNull(chapterIndex)?.paraIndex ?: 0
            val end = chapters.getOrNull(chapterIndex + 1)?.paraIndex ?: paragraphs.size
            start.coerceIn(0, paragraphs.size) to end.coerceIn(start.coerceAtLeast(0), paragraphs.size)
        }
    }

    var layoutKey by remember { mutableStateOf<PageLayoutKey?>(null) }
    val pages by produceState(
        initialValue = emptyList<ReaderPage>(),
        range,
        layoutKey,
    ) {
        val key = layoutKey
        if (key == null || key.widthPx <= 0 || key.heightPx <= 0 || range.second <= range.first) {
            value = emptyList()
            return@produceState
        }
        value = paginateChapter(
            paragraphs = paragraphs,
            startIndex = range.first,
            endIndex = range.second,
            chapterNumber = chapterIndex + 1,
            chapterTitle = chapterTitle,
            measurer = measurer,
            bodyStyle = bodyStyle,
            kickerStyle = kickerStyle,
            headingStyle = headingStyle,
            paragraphGapPx = with(density) { paragraphGap.toPx() },
            blankGapPx = with(density) { blankGap.toPx() },
            headingInnerGapPx = with(density) { 6.dp.toPx() },
            widthPx = key.widthPx,
            heightPx = key.heightPx,
            indent = key.indent,
        )
    }

    val pagerState = rememberPagerState(pageCount = { pages.size })

    // 当前段落变化（打开书、跳章、搜索命中）时，落到对应的那一页
    LaunchedEffect(pages, startPara) {
        if (pages.isEmpty()) return@LaunchedEffect
        val target = pageIndexOf(pages, startPara)
        if (pagerState.currentPage != target) pagerState.scrollToPage(target)
    }

    // 翻页后上报当前页首段，进度条与「继续阅读」都用它
    LaunchedEffect(pagerState, pages) {
        var lastReported = -1
        snapshotFlow { pagerState.settledPage }
            .distinctUntilChanged()
            .collect { page ->
                pages.getOrNull(page)?.let {
                    // 打开书 / 换章的第一页不震，只有真正翻页才给触感
                    if (lastReported >= 0 && page != lastReported) {
                        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    }
                    lastReported = page
                    onPosition(it.startPara)
                }
            }
    }

    // 点按 / 音量键统一走 PageTurn
    LaunchedEffect(pageTurn.seq, pages) {
        if (pageTurn.seq == 0L || pages.isEmpty()) return@LaunchedEffect
        if (pageTurn.direction > 0) {
            if (pagerState.currentPage < pages.lastIndex) {
                pagerState.animateScrollToPage(pagerState.currentPage + 1)
            } else {
                onNextChapter()
            }
        } else {
            if (pagerState.currentPage > 0) {
                pagerState.animateScrollToPage(pagerState.currentPage - 1)
            } else {
                onPrevChapter()
            }
        }
    }

    // 目录 / 搜索 / 痕迹跳转
    LaunchedEffect(jumpPara, pages) {
        if (jumpPara < 0 || pages.isEmpty()) return@LaunchedEffect
        pagerState.scrollToPage(pageIndexOf(pages, jumpPara))
        onJumpHandled()
    }

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        // 预留给顶栏：翻页模式下正文不钻到 HUD 底下，页面顶部保持一条纸边
        Spacer(Modifier.height(36.dp))
        BoxWithConstraints(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) {
            val widthPx = with(density) { (maxWidth - pagePadding.dp * 2).roundToPx() }
            // 页内容上下各 4dp 内边距，测量时先扣掉，避免最后一行压到页脚
            val heightPx = with(density) { (maxHeight - 8.dp).roundToPx() }
            val key = PageLayoutKey(
                widthPx = widthPx,
                heightPx = heightPx,
                fontSize = bodyStyle.fontSize.value,
                lineHeight = (if (bodyStyle.lineHeight != TextUnit.Unspecified) {
                    bodyStyle.lineHeight
                } else {
                    bodyStyle.fontSize
                }).value,
                letterSpacing = bodyStyle.letterSpacing.value,
                paragraphGap = paragraphGap.value,
                indent = bodyStyle.textIndent != TextIndent.None,
                family = bodyStyle.fontFamily?.toString().orEmpty(),
            )
            LaunchedEffect(key) { layoutKey = key }

            HorizontalPager(
                state = pagerState,
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(tapToTurn, pages.size) {
                        detectTapGestures(onTap = { offset ->
                            if (!tapToTurn) {
                                onTapCenter()
                                return@detectTapGestures
                            }
                            val edge = size.width * 0.3f
                            when {
                                offset.x < edge -> {
                                    if (pagerState.currentPage > 0) {
                                        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                        scope.launch { pagerState.animateScrollToPage(pagerState.currentPage - 1) }
                                    } else {
                                        onPrevChapter()
                                    }
                                }

                                offset.x > size.width - edge -> {
                                    if (pagerState.currentPage < pages.lastIndex) {
                                        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                        scope.launch { pagerState.animateScrollToPage(pagerState.currentPage + 1) }
                                    } else {
                                        onNextChapter()
                                    }
                                }

                                else -> onTapCenter()
                            }
                        })
                    },
            ) { pageIndex ->
                val page = pages.getOrNull(pageIndex) ?: return@HorizontalPager
                PageView(
                    page = page,
                    bodyStyle = bodyStyle,
                    kickerStyle = kickerStyle,
                    headingStyle = headingStyle,
                    pagePadding = pagePadding,
                    paragraphGap = paragraphGap,
                    blankGap = blankGap,
                    bookmarkedParas = bookmarkedParas,
                    highlightedParas = highlightedParas,
                )
            }
        }

        // 页脚：HUD 收起时也只留这一行，不打断阅读
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = (pagePadding + 2).dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = chapterTitle.ifBlank { "—" },
                modifier = Modifier.weight(1f),
                style = kickerStyle,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = if (pages.isEmpty()) "—" else "${pagerState.currentPage + 1} / ${pages.size}",
                style = kickerStyle,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun PageView(
    page: ReaderPage,
    bodyStyle: TextStyle,
    kickerStyle: TextStyle,
    headingStyle: TextStyle,
    pagePadding: Int,
    paragraphGap: Dp,
    blankGap: Dp,
    bookmarkedParas: Set<Int>,
    highlightedParas: Set<Int>,
) {
    val palette = MaterialTheme.colorScheme
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = pagePadding.dp, vertical = 4.dp),
    ) {
        page.blocks.forEach { block ->
            when (block) {
                is PageBlock.Heading -> {
                    Column(Modifier.fillMaxWidth()) {
                        Text(
                            text = "第 ${block.number.toString().padStart(2, '0')} 章",
                            style = kickerStyle,
                            color = palette.primary,
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(text = block.title, style = headingStyle, color = palette.onBackground)
                        Spacer(Modifier.height(paragraphGap))
                    }
                }

                is PageBlock.Body -> {
                    val marked = block.paraIndex in bookmarkedParas
                    val highlighted = block.paraIndex in highlightedParas
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(IntrinsicSize.Min)
                            .then(
                                if (highlighted) {
                                    Modifier.background(palette.primary.copy(alpha = 0.09f))
                                } else {
                                    Modifier
                                }
                            ),
                    ) {
                        if (marked) {
                            Box(
                                Modifier
                                    .width(2.dp)
                                    .fillMaxHeight()
                                    .background(palette.primary)
                            )
                            Spacer(Modifier.width(6.dp))
                        }
                        Text(
                            text = block.text,
                            modifier = Modifier.weight(1f),
                            style = bodyStyle.copy(
                                textIndent = if (block.indent) {
                                    TextIndent(firstLine = 2.em)
                                } else {
                                    TextIndent.None
                                }
                            ),
                            color = palette.onBackground,
                        )
                    }
                    Spacer(Modifier.height(paragraphGap))
                }

                PageBlock.Blank -> Spacer(Modifier.height(blankGap))
            }
        }
    }
}

/** 找到包含某一段的页。 */
private fun pageIndexOf(pages: List<ReaderPage>, paraIndex: Int): Int {
    if (pages.isEmpty()) return 0
    var low = 0
    var high = pages.lastIndex
    var answer = 0
    while (low <= high) {
        val mid = (low + high) ushr 1
        if (pages[mid].startPara <= paraIndex) {
            answer = mid
            low = mid + 1
        } else {
            high = mid - 1
        }
    }
    return answer
}

/**
 * 把一章切成页。
 *
 * 逐段量高（[TextMeasurer]），按页高装填；单段超过一页时按行切开。
 * 每 16 段让一次主线程，避免大章一次性卡住首帧。
 */
private suspend fun paginateChapter(
    paragraphs: List<Paragraph>,
    startIndex: Int,
    endIndex: Int,
    chapterNumber: Int,
    chapterTitle: String,
    measurer: TextMeasurer,
    bodyStyle: TextStyle,
    kickerStyle: TextStyle,
    headingStyle: TextStyle,
    paragraphGapPx: Float,
    blankGapPx: Float,
    headingInnerGapPx: Float,
    widthPx: Int,
    heightPx: Int,
    indent: Boolean,
): List<ReaderPage> {
    val pages = ArrayList<ReaderPage>()
    var blocks = ArrayList<PageBlock>()
    var used = 0f
    var pageStart = startIndex

    fun flush() {
        if (blocks.isNotEmpty()) {
            pages.add(ReaderPage(pageStart, blocks))
            blocks = ArrayList()
            used = 0f
        }
    }

    fun push(block: PageBlock, height: Float, paraIndex: Int) {
        if (blocks.isEmpty()) pageStart = paraIndex
        if (used + height > heightPx && blocks.isNotEmpty()) {
            flush()
            pageStart = paraIndex
        }
        blocks.add(block)
        used += height
    }

    // 本章标题块
    if (chapterTitle.isNotBlank()) {
        val kickerH = measurer.measure(
            AnnotatedString("第 ${chapterNumber.toString().padStart(2, '0')} 章"),
            kickerStyle,
            constraints = Constraints(maxWidth = widthPx),
        ).size.height.toFloat()
        val titleH = measurer.measure(
            AnnotatedString(chapterTitle),
            headingStyle,
            constraints = Constraints(maxWidth = widthPx),
        ).size.height.toFloat()
        val headingH = kickerH + headingInnerGapPx + titleH + paragraphGapPx
        if (headingH < heightPx * 0.6f) {
            blocks.add(PageBlock.Heading(chapterNumber, chapterTitle))
            used += headingH
        }
    }

    for (index in startIndex until endIndex) {
        if ((index - startIndex) % 16 == 0) yield()
        val paragraph = paragraphs[index]
        if (paragraph.blank) {
            push(PageBlock.Blank, blankGapPx, index)
            continue
        }
        val text = paragraph.text
        if (text.isBlank()) continue
        val layout = measurer.measure(
            AnnotatedString(text),
            bodyStyle,
            constraints = Constraints(maxWidth = widthPx),
        )
        val paragraphH = layout.size.height.toFloat() + paragraphGapPx
        if (paragraphH <= heightPx) {
            push(PageBlock.Body(index, text, indent), paragraphH, index)
            continue
        }
        // 超长段落：按行切，每页能放几行就放几行
        val lineHeightPx = layout.size.height.toFloat() / layout.lineCount.coerceAtLeast(1)
        val linesPerPage = ((heightPx - paragraphGapPx) / lineHeightPx).toInt().coerceAtLeast(1)
        var line = 0
        while (line < layout.lineCount) {
            val nextLine = (line + linesPerPage).coerceAtMost(layout.lineCount)
            val startOffset = layout.getLineStart(line)
            val endOffset = layout.getLineEnd(nextLine - 1, visibleEnd = true)
            val chunk = text.substring(startOffset.coerceAtLeast(0), endOffset.coerceAtLeast(startOffset))
            if (chunk.isNotBlank()) {
                val chunkStyle = if (indent && line == 0) bodyStyle else bodyStyle.copy(textIndent = TextIndent.None)
                val chunkH = measurer.measure(
                    AnnotatedString(chunk),
                    chunkStyle,
                    constraints = Constraints(maxWidth = widthPx),
                ).size.height.toFloat() + paragraphGapPx
                push(PageBlock.Body(index, chunk, indent && line == 0), chunkH, index)
            }
            line = nextLine
            if (line < layout.lineCount) flush()
        }
    }
    flush()
    if (pages.isEmpty()) pages.add(ReaderPage(startIndex, emptyList()))
    return pages
}
