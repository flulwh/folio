package com.folio.reader.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextIndent
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.folio.reader.data.SettingsStore
import com.folio.reader.ui.miuix.FolioMotion
import com.folio.reader.ui.miuix.HyperActionCell
import com.folio.reader.ui.miuix.HyperMeta
import com.folio.reader.ui.miuix.HyperRoundIcon
import com.folio.reader.ui.reader.MarksSheet
import com.folio.reader.ui.reader.ReaderPager
import com.folio.reader.ui.reader.ReaderStyleSheet
import com.folio.reader.ui.reader.SearchSheet
import com.folio.reader.ui.reader.TocSheet
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import top.yukonga.miuix.kmp.basic.Button
import top.yukonga.miuix.kmp.basic.CircularProgressIndicator
import top.yukonga.miuix.kmp.basic.Slider
import top.yukonga.miuix.kmp.basic.Text as MiuixText
import top.yukonga.miuix.kmp.theme.MiuixTheme

/**
 * 小说阅读器（HyperOS 版）。
 *
 * - **双阅读模式**：上下滚动（LazyColumn）/ 左右翻页（[ReaderPager]，按章分页）；
 * - **沉浸 HUD**：点正文中央显隐，顶栏与底栏都是浮动圆角卡片，不挤压正文；
 * - **一套手势**：点按左右 30% 翻页、中间切换 HUD，音量键同一个入口；翻页模式带触感反馈；
 * - **零缓存**：云端书正文只进内存，断网翻章提示「连接已断开 · 重试」。
 */
@Composable
fun ReaderScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val reader by vm.reader.collectAsState()
    val settings by vm.settingsState.collectAsState()
    val scrollTarget by vm.scrollTarget.collectAsState()
    val pageTurn by vm.pageTurn.collectAsState()
    val listState = rememberLazyListState()

    var scrubbing by remember { mutableStateOf(false) }
    var sliderValue by remember { mutableFloatStateOf(0f) }

    val book = reader.book
    val density = LocalDensity.current
    val view = LocalView.current
    val palette = MiuixTheme.colorScheme

    val fontSize = settings.fontSizeSp.sp
    val lineHeight = (settings.fontSizeSp * settings.lineHeight).sp
    val letterSpacing = settings.letterSpacingEm.em
    val fontFamily = if (settings.fontFamily == SettingsStore.FONT_SANS) {
        FontFamily.SansSerif
    } else {
        FontFamily.Serif
    }
    val paragraphGap = (settings.fontSizeSp * settings.paragraphSpacing).dp
    val blankGap = (settings.fontSizeSp * 0.5f).dp
    val paged = settings.readingMode == SettingsStore.MODE_PAGED

    // 云端书的痕迹只锚定到「当前这一章」
    val visibleMarks = remember(reader.marks, reader.isCloud, reader.toc, reader.chapterIndex) {
        if (!reader.isCloud) {
            reader.marks
        } else {
            val chapterNo = reader.toc.getOrNull(reader.chapterIndex)?.index ?: -1
            reader.marks.filter { it.chapterNo == chapterNo }
        }
    }
    val bookmarkedParas = remember(visibleMarks) {
        visibleMarks.asSequence().filter { it.isBookmark }.map { it.paraIndex }.toSet()
    }
    val highlightedParas = remember(visibleMarks) {
        visibleMarks.asSequence().filterNot { it.isBookmark }.map { it.paraIndex }.toSet()
    }
    val chapterHeads = remember(reader.chapters) {
        reader.chapters
            .mapIndexed { index, chapter -> chapter.paraIndex to (index to chapter.title) }
            .toMap()
    }

    val bodyStyle = TextStyle(
        fontFamily = fontFamily,
        fontSize = fontSize,
        lineHeight = lineHeight,
        letterSpacing = letterSpacing,
        textIndent = if (settings.firstLineIndent) TextIndent(firstLine = 2.em) else TextIndent.None,
    )

    // ---------- 滚动模式的位置同步 ----------
    LaunchedEffect(book?.id, reader.chapterIndex, reader.paragraphs.size, paged) {
        if (paged) return@LaunchedEffect
        val index = reader.paraIndex
        if (index > 0 && reader.paragraphs.isNotEmpty() && !scrubbing) {
            listState.scrollToItem(index.coerceIn(0, reader.paragraphs.size - 1))
        }
    }
    LaunchedEffect(scrollTarget, paged) {
        if (scrollTarget >= 0 && !paged) {
            listState.scrollToItem(scrollTarget.coerceAtLeast(0))
            // 落地后再解锁，让跳转期间产生的旧位置上报全部作废
            withFrameNanos { }
            vm.clearScrollTarget()
        }
    }
    LaunchedEffect(pageTurn.seq, paged) {
        if (paged || pageTurn.seq == 0L) return@LaunchedEffect
        val info = listState.layoutInfo
        val viewport = info.viewportEndOffset - info.viewportStartOffset
        if (viewport <= 0) return@LaunchedEffect
        val step = viewport * 0.88f
        if (pageTurn.direction > 0) {
            val consumed = listState.scrollBy(step)
            if (consumed < step * 0.1f && reader.hasNextChapter) vm.nextChapter()
        } else {
            val consumed = listState.scrollBy(-step)
            if (consumed > -step * 0.1f && reader.hasPrevChapter) vm.prevChapter()
        }
    }
    LaunchedEffect(listState, book?.id, paged) {
        if (paged) return@LaunchedEffect
        snapshotFlow { listState.firstVisibleItemIndex }
            .distinctUntilChanged()
            .collect { index -> if (!scrubbing) vm.updatePosition(index) }
    }

    // 自动滚动只在滚动模式有意义
    LaunchedEffect(reader.autoScroll, settings.autoScrollSpeed, paged) {
        if (!reader.autoScroll || paged) return@LaunchedEffect
        val speed = SettingsStore.AUTO_SCROLL_SPEEDS[
            settings.autoScrollSpeed.coerceIn(0, SettingsStore.AUTO_SCROLL_SPEEDS.lastIndex)
        ]
        val pxPerSecond = with(density) { speed.dp.toPx() }
        var lastFrame = 0L
        while (true) {
            val step = withFrameNanos { now ->
                val seconds = if (lastFrame == 0L) 0f else (now - lastFrame) / 1_000_000_000f
                lastFrame = now
                pxPerSecond * seconds
            }
            if (step > 0f) listState.scrollBy(step)
            if (!listState.canScrollForward) {
                vm.stopAutoScroll()
                break
            }
        }
    }

    DisposableEffect(view, settings.keepScreenOn, book?.id) {
        view.keepScreenOn = settings.keepScreenOn && book != null
        onDispose { view.keepScreenOn = false }
    }

    // 进度条：拖动时先改本地值，停手 280ms 再真正 seek（Miuix Slider 没有 finished 回调）
    LaunchedEffect(reader.percent, scrubbing) {
        if (!scrubbing) sliderValue = reader.percent.toFloat() / 100f
    }
    LaunchedEffect(scrubbing, sliderValue) {
        if (!scrubbing) return@LaunchedEffect
        delay(280)
        scrubbing = false
        vm.seekToPercent((sliderValue * 100f).toDouble())
    }

    val needConnect = reader.error == CLOUD_NEED_CONNECT
    val shownPercent = if (scrubbing) sliderValue * 100f else reader.percent.toFloat()
    val percentLabel = String.format(Locale.US, "%.1f%%", shownPercent)
    val remainingLabel = remainderLabel(reader.minutesLeft(reader.paraIndex))
    val chapterLabel = if (reader.chapterCount > 0) {
        "第 ${reader.chapterIndex + 1} / ${reader.chapterCount} 章"
    } else {
        "—"
    }

    val bottomContentPadding = when {
        reader.controls -> 150.dp
        reader.error != null -> 76.dp
        else -> 44.dp
    }

    Box(Modifier.fillMaxSize().background(palette.background)) {
        when {
            reader.loading -> LoadingState()

            reader.error != null && reader.paragraphs.isEmpty() && !needConnect -> ErrorState(
                message = reader.error.orEmpty(),
                onRetry = vm::retryChapter,
            )

            paged -> ReaderPager(
                paragraphs = reader.paragraphs,
                chapters = reader.chapters,
                chapterIndex = reader.chapterIndex,
                chapterTitle = reader.chapterTitle,
                bodyStyle = bodyStyle,
                kickerStyle = MaterialTheme.typography.labelSmall,
                headingStyle = MaterialTheme.typography.headlineMedium,
                paragraphGap = paragraphGap,
                blankGap = blankGap,
                pagePadding = settings.pagePadding,
                bookmarkedParas = bookmarkedParas,
                highlightedParas = highlightedParas,
                startPara = reader.paraIndex,
                pageTurn = pageTurn,
                tapToTurn = settings.tapToTurn,
                jumpPara = scrollTarget,
                onJumpHandled = vm::clearScrollTarget,
                onTapCenter = vm::toggleControls,
                onPosition = vm::updatePosition,
                onPrevChapter = vm::prevChapter,
                onNextChapter = vm::nextChapter,
            )

            else -> Column(
                Modifier
                    .fillMaxSize()
                    .pointerInput(book?.id, settings.tapToTurn) {
                        detectTapGestures(onTap = { offset ->
                            if (!settings.tapToTurn) {
                                vm.toggleControls()
                            } else {
                                val edge = size.width * 0.3f
                                when {
                                    offset.x < edge -> vm.requestPageTurn(-1)
                                    offset.x > size.width - edge -> vm.requestPageTurn(1)
                                    else -> vm.toggleControls()
                                }
                            }
                        })
                    },
            ) {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(
                        start = settings.pagePadding.dp,
                        end = settings.pagePadding.dp,
                        top = 80.dp,
                        bottom = bottomContentPadding,
                    ),
                ) {
                    itemsIndexed(reader.paragraphs) { index, paragraph ->
                        val head = chapterHeads[index]
                        when {
                            head != null -> ChapterHeadingBlock(
                                number = head.first + 1,
                                title = head.second,
                                bottomGap = paragraphGap,
                            )

                            paragraph.blank -> Spacer(Modifier.height(blankGap))

                            else -> ParagraphBlock(
                                text = paragraph.text,
                                style = bodyStyle,
                                bookmarked = index in bookmarkedParas,
                                highlighted = index in highlightedParas,
                                bottomGap = paragraphGap,
                            )
                        }
                    }
                }
            }
        }

        // ---------------- 顶栏（渐变遮罩，不占正文高度） ----------------
        AnimatedVisibility(
            visible = reader.controls,
            enter = fadeIn(tween(FolioMotion.Instant)) +
                slideInVertically(tween(FolioMotion.Normal, easing = FolioMotion.Easing)) { -it / 12 },
            exit = fadeOut(tween(FolioMotion.Instant)) +
                slideOutVertically(tween(FolioMotion.Normal, easing = FolioMotion.Easing)) { -it / 12 },
            modifier = Modifier.align(Alignment.TopCenter),
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(
                        androidx.compose.ui.graphics.Brush.verticalGradient(
                            listOf(palette.background.copy(alpha = 0.96f), palette.background.copy(alpha = 0f))
                        )
                    ),
            ) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .statusBarsPadding()
                        .height(52.dp)
                        .padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    HyperRoundIcon(Icons.AutoMirrored.Filled.ArrowBack, "返回", onBack)
                    Column(Modifier.weight(1f).padding(horizontal = 4.dp)) {
                        Text(
                            text = reader.chapterTitle.ifBlank { book?.title.orEmpty() },
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium,
                            color = palette.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (reader.chapterTitle.isNotBlank()) {
                            Text(
                                text = book?.title.orEmpty(),
                                fontSize = 10.5.sp,
                                color = palette.onSurfaceVariantSummary,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                    val bookmarked = reader.paraIndex in bookmarkedParas
                    HyperRoundIcon(
                        icon = if (bookmarked) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder,
                        contentDescription = if (bookmarked) "取消书签" else "加书签",
                        onClick = { vm.toggleBookmark() },
                        tint = if (bookmarked) palette.primary else palette.onSurface,
                    )
                }
            }
        }

        // 翻章失败：正文留着，底部一条提示
        AnimatedVisibility(
            visible = reader.error != null && reader.paragraphs.isNotEmpty(),
            enter = fadeIn(tween(FolioMotion.Normal)) +
                slideInVertically(tween(FolioMotion.Normal, easing = FolioMotion.Easing)) { it / 2 },
            exit = fadeOut(tween(FolioMotion.Instant)) +
                slideOutVertically(tween(FolioMotion.Normal, easing = FolioMotion.Easing)) { it / 2 },
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            Row(
                modifier = Modifier
                    .navigationBarsPadding()
                    .padding(bottom = if (reader.controls) 156.dp else 16.dp)
                    .fillMaxWidth()
                    .background(palette.surface)
                    .padding(start = 20.dp, end = 6.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = reader.error.orEmpty(),
                    style = MaterialTheme.typography.bodySmall,
                    color = palette.onSurfaceVariantSummary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                MiuixText(
                    text = "重试",
                    modifier = Modifier
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClick = { vm.retryChapter() },
                        )
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    color = palette.primary,
                )
            }
        }

        // ---------------- 底栏 ----------------
        AnimatedVisibility(
            visible = reader.controls && reader.paragraphs.isNotEmpty(),
            enter = fadeIn(tween(FolioMotion.Instant)) +
                slideInVertically(tween(FolioMotion.Normal, easing = FolioMotion.Easing)) { it / 12 },
            exit = fadeOut(tween(FolioMotion.Instant)) +
                slideOutVertically(tween(FolioMotion.Normal, easing = FolioMotion.Easing)) { it / 12 },
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        androidx.compose.ui.graphics.Brush.verticalGradient(
                            listOf(palette.background.copy(alpha = 0f), palette.background.copy(alpha = 0.97f))
                        )
                    )
                    .navigationBarsPadding()
                    .padding(horizontal = 20.dp)
                    .padding(top = 20.dp, bottom = 2.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Chevron("‹", reader.hasPrevChapter) { vm.prevChapter() }
                    Text(
                        text = percentLabel,
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Medium,
                        color = palette.primary,
                        maxLines = 1,
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = chapterLabel,
                        fontSize = 11.sp,
                        color = palette.onSurfaceVariantSummary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.weight(1f))
                    HyperMeta(remainingLabel)
                    Chevron("›", reader.hasNextChapter) { vm.nextChapter() }
                }
                Slider(
                    progress = shownPercent.coerceIn(0f, 100f) / 100f,
                    onProgressChange = {
                        scrubbing = true
                        sliderValue = it
                    },
                    modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
                    height = 22.dp,
                    decimalPlaces = 3,
                )
                Row(
                    Modifier.fillMaxWidth().height(44.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    HyperActionCell(
                        label = "目录",
                        icon = { androidx.compose.material3.Icon(Icons.AutoMirrored.Filled.MenuBook, null, modifier = Modifier.size(19.dp)) },
                        active = reader.showToc,
                        onClick = { vm.toggleToc() },
                        modifier = Modifier.weight(1f),
                    )
                    HyperActionCell(
                        label = "痕迹",
                        icon = {
                            androidx.compose.material3.Icon(
                                if (reader.paraIndex in bookmarkedParas) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder,
                                null,
                                modifier = Modifier.size(19.dp),
                            )
                        },
                        active = reader.showMarks,
                        onClick = { vm.toggleMarks() },
                        modifier = Modifier.weight(1f),
                    )
                    HyperActionCell(
                        label = "搜索",
                        icon = { androidx.compose.material3.Icon(Icons.Default.Search, null, modifier = Modifier.size(19.dp)) },
                        active = reader.search.open,
                        onClick = { vm.toggleSearch() },
                        modifier = Modifier.weight(1f),
                    )
                    HyperActionCell(
                        label = "排版",
                        icon = { androidx.compose.material3.Icon(Icons.Default.Tune, null, modifier = Modifier.size(19.dp)) },
                        active = reader.showStyle,
                        onClick = { vm.toggleStyle() },
                        modifier = Modifier.weight(1f),
                    )
                    HyperActionCell(
                        label = "自动",
                        icon = {
                            androidx.compose.material3.Icon(
                                if (reader.autoScroll) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                                null,
                                modifier = Modifier.size(19.dp),
                            )
                        },
                        active = reader.autoScroll,
                        onClick = { vm.toggleAutoScroll() },
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }

        // 自动滚动时的角落标签
        AnimatedVisibility(
            visible = reader.autoScroll && !reader.controls,
            enter = fadeIn(tween(FolioMotion.Normal)) +
                slideInVertically(tween(FolioMotion.Normal, easing = FolioMotion.Easing)) { it / 2 },
            exit = fadeOut(tween(FolioMotion.Instant)) +
                slideOutVertically(tween(FolioMotion.Normal, easing = FolioMotion.Easing)) { it / 2 },
            modifier = Modifier.align(Alignment.BottomEnd),
        ) {
            val speed = SettingsStore.AUTO_SCROLL_SPEEDS[
                settings.autoScrollSpeed.coerceIn(0, SettingsStore.AUTO_SCROLL_SPEEDS.lastIndex)
            ]
            Row(
                modifier = Modifier
                    .navigationBarsPadding()
                    .padding(end = 16.dp, bottom = 20.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(palette.surface.copy(alpha = 0.92f))
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "自动 $speed",
                    style = MaterialTheme.typography.labelSmall,
                    color = palette.onSurface,
                )
                Spacer(Modifier.width(6.dp))
                Box(Modifier.size(5.dp).background(palette.primary))
            }
        }
    }

    if (reader.showToc) {
        val labels = if (reader.isCloud) reader.toc.map { it.title } else reader.chapters.map { it.title }
        TocSheet(
            labels = labels,
            currentIndex = reader.chapterIndex,
            onSelect = { index -> vm.switchChapter(index) },
            onDismiss = { vm.toggleToc() },
        )
    }

    if (reader.showStyle) {
        ReaderStyleSheet(
            state = settings,
            onFontSize = vm::updateFontSize,
            onLineHeight = vm::updateLineHeight,
            onLetterSpacing = vm::updateLetterSpacing,
            onParagraphSpacing = vm::updateParagraphSpacing,
            onFirstLineIndent = vm::updateFirstLineIndent,
            onFontFamily = vm::updateFontFamily,
            onThemePreset = vm::updateThemePreset,
            onPagePadding = vm::updatePagePadding,
            onAutoScrollSpeed = vm::updateAutoScrollSpeed,
            onKeepScreenOn = vm::updateKeepScreenOn,
            onTapToTurn = vm::updateTapToTurn,
            onVolumeKeysTurn = vm::updateVolumeKeysTurn,
            onReadingMode = vm::updateReadingMode,
            onDismiss = { vm.toggleStyle() },
        )
    }

    if (reader.showMarks) {
        MarksSheet(
            marks = reader.marks,
            currentPara = reader.paraIndex,
            isBookmarked = reader.paraIndex in bookmarkedParas,
            onToggleBookmark = { vm.toggleBookmark() },
            onJump = { mark -> vm.jumpToMark(mark) },
            onRemove = { id -> vm.removeMark(id) },
            onUpdateNote = { id, note -> vm.updateMarkNote(id, note) },
            onDismiss = { vm.toggleMarks() },
        )
    }

    if (reader.search.open) {
        SearchSheet(
            state = reader.search,
            onQueryChange = vm::updateSearchQuery,
            onJump = vm::jumpToSearchHit,
            onStep = vm::stepSearchHit,
            onDismiss = vm::closeSearch,
        )
    }

    if (needConnect) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = onBack,
            title = { Text("需要连接桌面端") },
            text = { Text("云端书需要连接桌面端才能阅读。") },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    onBack()
                    onOpenSettings()
                }) { Text("去连接") }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = onBack) { Text("返回") }
            },
        )
    }
}

@Composable
private fun LoadingState() {
    val palette = MiuixTheme.colorScheme
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator()
            Spacer(Modifier.height(14.dp))
            Text(
                text = "正在排版…",
                style = MaterialTheme.typography.titleSmall,
                color = palette.onSurface,
            )
            Spacer(Modifier.height(4.dp))
            HyperMeta("正在切分章节")
        }
    }
}

@Composable
private fun ErrorState(message: String, onRetry: () -> Unit) {
    val palette = MiuixTheme.colorScheme
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(horizontal = 36.dp),
        ) {
            Text(
                text = "读不了这一章",
                style = MaterialTheme.typography.titleMedium,
                color = palette.onSurface,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = message,
                style = MaterialTheme.typography.bodySmall,
                color = palette.onSurfaceVariantSummary,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(18.dp))
            Button(onClick = onRetry, cornerRadius = 14.dp) {
                MiuixText(text = "重试", fontSize = 14.sp, color = palette.onPrimary)
            }
        }
    }
}

/** 一章的标题块。 */
@Composable
private fun ChapterHeadingBlock(number: Int, title: String, bottomGap: androidx.compose.ui.unit.Dp) {
    val palette = MiuixTheme.colorScheme
    Column(Modifier.fillMaxWidth()) {
        Spacer(Modifier.height(14.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(palette.dividerLine)
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = "第 ${number.toString().padStart(2, '0')} 章",
            style = MaterialTheme.typography.labelSmall,
            color = palette.primary,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = title,
            style = MaterialTheme.typography.headlineMedium,
            color = palette.onSurface,
        )
        Spacer(Modifier.height(bottomGap))
    }
}

/** 一个正文段：书签是左侧 2dp 朱砂竖条，高亮是 9% 朱砂底。 */
@Composable
private fun ParagraphBlock(
    text: String,
    style: TextStyle,
    bookmarked: Boolean,
    highlighted: Boolean,
    bottomGap: androidx.compose.ui.unit.Dp,
) {
    val palette = MiuixTheme.colorScheme
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(androidx.compose.foundation.layout.IntrinsicSize.Min)
                .then(
                    if (highlighted) {
                        Modifier.background(palette.primary.copy(alpha = 0.09f))
                    } else {
                        Modifier
                    },
                ),
        ) {
            if (bookmarked) {
                Box(
                    Modifier
                        .width(2.dp)
                        .fillMaxHeight()
                        .background(palette.primary),
                )
                Spacer(Modifier.width(6.dp))
            }
            Text(
                text = text,
                style = style,
                color = palette.onBackground,
                modifier = Modifier.weight(1f),
            )
        }
        Spacer(Modifier.height(bottomGap))
    }
}

/** 上一章 / 下一章的窄箭头，和进度信息挤在同一行。 */
@Composable
private fun Chevron(glyph: String, enabled: Boolean, onClick: () -> Unit) {
    val palette = MiuixTheme.colorScheme
    Box(
        Modifier
            .size(30.dp)
            .clip(androidx.compose.foundation.shape.CircleShape)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                enabled = enabled,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = glyph,
            fontSize = 18.sp,
            color = if (enabled) palette.onSurface else palette.disabledOnSurface,
            maxLines = 1,
        )
    }
}

/** 剩余阅读时间：`剩 3 小时 12 分`。 */
private fun remainderLabel(minutes: Int): String {
    if (minutes <= 0) return "剩 0 分"
    val hours = minutes / 60
    val mins = minutes % 60
    return when {
        hours <= 0 -> "剩 $mins 分"
        mins == 0 -> "剩 $hours 小时"
        else -> "剩 $hours 小时 $mins 分"
    }
}

internal const val CLOUD_NEED_CONNECT = "云端书需要连接桌面端才能阅读"
