package com.folio.reader.ui

import com.folio.reader.ui.model.ReaderModel

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
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
import com.folio.reader.ui.reader.MarksSheet
import com.folio.reader.ui.reader.ReaderPager
import com.folio.reader.ui.reader.ReaderStyleSheet
import com.folio.reader.ui.reader.SearchSheet
import com.folio.reader.ui.reader.TocSheet
import io.github.alexzhirkevich.cupertino.CupertinoActivityIndicator
import io.github.alexzhirkevich.cupertino.CupertinoButton
import io.github.alexzhirkevich.cupertino.CupertinoButtonDefaults
import io.github.alexzhirkevich.cupertino.CupertinoIcon
import io.github.alexzhirkevich.cupertino.CupertinoSlider
import io.github.alexzhirkevich.cupertino.CupertinoText
import io.github.alexzhirkevich.cupertino.icons.CupertinoIcons
import io.github.alexzhirkevich.cupertino.icons.filled.Bookmark
import io.github.alexzhirkevich.cupertino.icons.filled.Pause
import io.github.alexzhirkevich.cupertino.icons.filled.Play
import io.github.alexzhirkevich.cupertino.icons.outlined.Book
import io.github.alexzhirkevich.cupertino.icons.outlined.ChevronBackward
import io.github.alexzhirkevich.cupertino.icons.outlined.MagnifyingGlass
import io.github.alexzhirkevich.cupertino.icons.outlined.SliderHorizontal3
import io.github.alexzhirkevich.cupertino.theme.CupertinoTheme
import java.util.Locale
import kotlinx.coroutines.flow.distinctUntilChanged

/** 章节号 / 页码这类小字标签。 */
private val KickerStyle = TextStyle(fontSize = 11.sp, letterSpacing = 1.sp, fontWeight = FontWeight.Medium)
/** 章标题。 */
private val HeadingStyle = TextStyle(fontSize = 22.sp, lineHeight = 30.sp, fontWeight = FontWeight.SemiBold)
private val BodySmallStyle = TextStyle(fontSize = 12.5.sp, lineHeight = 19.sp)
private val TitleSmallStyle = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.Medium)
private val TitleMediumStyle = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.SemiBold)

/**
 * 小说阅读器（Cupertino）。
 *
 * - **双阅读模式**：上下滚动（LazyColumn）/ 左右翻页（[ReaderPager]，按章分页）；
 * - **沉浸 HUD**：点正文中央显隐，顶栏与底栏都是浮动圆角卡片，不挤压正文；
 * - **一套手势**：点按左右 30% 翻页、中间切换 HUD，音量键同一个入口；翻页模式带触感反馈；
 * - **零缓存**：云端书正文只进内存，断网翻章提示「连接已断开 · 重试」。
 */
@Composable
fun ReaderScreen(
    model: ReaderModel,
    onBack: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val vm = model.session
    val reader by vm.reader.collectAsStateWithLifecycle()
    val settings by vm.settingsState.collectAsStateWithLifecycle()
    val scrollTarget by vm.scrollTarget.collectAsStateWithLifecycle()
    val pageTurn by vm.pageTurn.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()

    var scrubbing by remember { mutableStateOf(false) }
    var sliderValue by remember { mutableFloatStateOf(0f) }

    val book = reader.book
    val density = LocalDensity.current
    val view = LocalView.current
    val palette = CupertinoTheme.colorScheme

    val fontSize = settings.fontSizeSp.sp
    val lineHeight = (settings.fontSizeSp * settings.lineHeight).sp
    val letterSpacing = settings.letterSpacingEm.em
    // 用户选了商店字体就优先它；没选 / 文件丢了才回到系统宋体或黑体
    val fallbackFamily = if (settings.fontFamily == SettingsStore.FONT_SANS) {
        FontFamily.SansSerif
    } else {
        FontFamily.Serif
    }
    val fontFamily = FontFamilies.rememberReaderFamily(settings.userFontId, fallbackFamily)
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

    // 滚动会频繁上报位置、触发阅读页重组；样式对象只在排版参数变化时重建，
    // 否则每一帧都给每个可见段落传一个新的 TextStyle（内容相同也要走一次分配）。
    val bodyStyle = remember(fontFamily, fontSize, lineHeight, letterSpacing, settings.firstLineIndent) {
        TextStyle(
            fontFamily = fontFamily,
            fontSize = fontSize,
            lineHeight = lineHeight,
            letterSpacing = letterSpacing,
            textIndent = if (settings.firstLineIndent) TextIndent(firstLine = 2.em) else TextIndent.None,
        )
    }

    // 宽屏上把正文收进 680dp 的列，多出来的宽度均分到两侧；
    // 点按翻页的手势区仍是整屏，不跟着正文一起缩水。
    val readerGutter = maxOf(
        0.dp,
        (LocalConfiguration.current.screenWidthDp.dp - ReaderColumn) / 2,
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

    // 进度条：拖动时先改本地值，CupertinoSlider 松手回调里再真正 seek
    LaunchedEffect(reader.percent, scrubbing) {
        if (!scrubbing) sliderValue = reader.percent.toFloat() / 100f
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

    Box(Modifier.fillMaxSize().background(palette.systemBackground)) {
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
                kickerStyle = KickerStyle,
                headingStyle = HeadingStyle,
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
                        start = settings.pagePadding.dp + readerGutter,
                        end = settings.pagePadding.dp + readerGutter,
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
            Row(
                Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = 14.dp)
                    .padding(top = 4.dp)
                    .shadow(10.dp, RoundedCornerShape(14.dp))
                    .clip(RoundedCornerShape(14.dp))
                    .background(palette.secondarySystemGroupedBackground.copy(alpha = 0.96f))
                    .border(0.5.dp, palette.separator, RoundedCornerShape(14.dp))
                    .height(50.dp)
                    .padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RoundIcon(CupertinoIcons.Outlined.ChevronBackward, "返回", palette.label, onBack)
                Column(Modifier.weight(1f).padding(horizontal = 4.dp)) {
                    CupertinoText(
                        text = reader.chapterTitle.ifBlank { book?.title.orEmpty() },
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        color = palette.label,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (reader.chapterTitle.isNotBlank()) {
                        CupertinoText(
                            text = book?.title.orEmpty(),
                            fontSize = 10.5.sp,
                            color = palette.secondaryLabel,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                val bookmarked = reader.paraIndex in bookmarkedParas
                RoundIcon(
                    icon = if (bookmarked) CupertinoIcons.Filled.Bookmark else CupertinoIcons.Outlined.Book,
                    contentDescription = if (bookmarked) "取消书签" else "加书签",
                    tint = if (bookmarked) palette.accent else palette.label,
                    onClick = { vm.toggleBookmark() },
                )
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
                    .background(palette.secondarySystemGroupedBackground)
                    .padding(start = 20.dp, end = 6.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CupertinoText(
                    text = reader.error.orEmpty(),
                    style = BodySmallStyle,
                    color = palette.secondaryLabel,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                CupertinoText(
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
                    color = palette.accent,
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
                    .navigationBarsPadding()
                    .padding(horizontal = 14.dp)
                    .padding(bottom = 10.dp)
                    .shadow(12.dp, RoundedCornerShape(16.dp))
                    .clip(RoundedCornerShape(16.dp))
                    .background(palette.secondarySystemGroupedBackground.copy(alpha = 0.97f))
                    .border(0.5.dp, palette.separator, RoundedCornerShape(16.dp))
                    .padding(horizontal = 14.dp)
                    .padding(top = 10.dp, bottom = 4.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Chevron("‹", reader.hasPrevChapter) { vm.prevChapter() }
                    CupertinoText(
                        text = percentLabel,
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Medium,
                        color = palette.accent,
                        maxLines = 1,
                    )
                    Spacer(Modifier.width(8.dp))
                    CupertinoText(
                        text = chapterLabel,
                        fontSize = 11.sp,
                        color = palette.secondaryLabel,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.weight(1f))
                    CupertinoText(
                        text = remainingLabel,
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace,
                        color = palette.secondaryLabel,
                        maxLines = 1,
                    )
                    Chevron("›", reader.hasNextChapter) { vm.nextChapter() }
                }
                CupertinoSlider(
                    value = shownPercent.coerceIn(0f, 100f) / 100f,
                    onValueChange = {
                        scrubbing = true
                        sliderValue = it
                    },
                    onValueChangeFinished = {
                        scrubbing = false
                        vm.seekToPercent((sliderValue * 100f).toDouble())
                    },
                    modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
                )
                Row(
                    Modifier.fillMaxWidth().height(44.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    ActionCell("目录", reader.showToc, Modifier.weight(1f), onClick = { vm.toggleToc() }) {
                        CupertinoIcon(
                            imageVector = CupertinoIcons.Outlined.Book,
                            contentDescription = null,
                            modifier = Modifier.size(19.dp),
                        )
                    }
                    ActionCell("痕迹", reader.showMarks, Modifier.weight(1f), onClick = { vm.toggleMarks() }) {
                        CupertinoIcon(
                            imageVector = if (reader.paraIndex in bookmarkedParas) {
                                CupertinoIcons.Filled.Bookmark
                            } else {
                                CupertinoIcons.Outlined.Book
                            },
                            contentDescription = null,
                            modifier = Modifier.size(19.dp),
                        )
                    }
                    ActionCell("搜索", reader.search.open, Modifier.weight(1f), onClick = { vm.toggleSearch() }) {
                        CupertinoIcon(
                            imageVector = CupertinoIcons.Outlined.MagnifyingGlass,
                            contentDescription = null,
                            modifier = Modifier.size(19.dp),
                        )
                    }
                    ActionCell("排版", reader.showStyle, Modifier.weight(1f), onClick = { vm.toggleStyle() }) {
                        CupertinoIcon(
                            imageVector = CupertinoIcons.Outlined.SliderHorizontal3,
                            contentDescription = null,
                            modifier = Modifier.size(19.dp),
                        )
                    }
                    ActionCell("自动", reader.autoScroll, Modifier.weight(1f), onClick = { vm.toggleAutoScroll() }) {
                        CupertinoIcon(
                            imageVector = if (reader.autoScroll) {
                                CupertinoIcons.Filled.Pause
                            } else {
                                CupertinoIcons.Filled.Play
                            },
                            contentDescription = null,
                            modifier = Modifier.size(19.dp),
                        )
                    }
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
                    .clip(RoundedCornerShape(14.dp))
                    .background(palette.secondarySystemGroupedBackground.copy(alpha = 0.92f))
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CupertinoText(
                    text = "自动 $speed",
                    style = KickerStyle,
                    color = palette.label,
                )
                Spacer(Modifier.width(6.dp))
                Box(Modifier.size(5.dp).background(palette.accent))
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
        FolioSheet(onDismiss = onBack) {
            Column(Modifier.padding(horizontal = 20.dp)) {
                Spacer(Modifier.height(4.dp))
                CupertinoText(
                    text = "需要连接桌面端",
                    fontSize = 19.sp,
                    fontWeight = FontWeight.Medium,
                    color = palette.label,
                )
                Spacer(Modifier.height(8.dp))
                CupertinoText(
                    text = "云端书需要连接桌面端才能阅读。",
                    fontSize = 13.sp,
                    color = palette.secondaryLabel,
                )
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CupertinoButton(
                        onClick = onBack,
                        modifier = Modifier.weight(1f),
                        colors = CupertinoButtonDefaults.grayButtonColors(),
                    ) {
                        CupertinoText(text = "返回", fontSize = 14.sp)
                    }
                    CupertinoButton(
                        onClick = {
                            onBack()
                            onOpenSettings()
                        },
                        modifier = Modifier.weight(1f),
                        colors = CupertinoButtonDefaults.filledButtonColors(),
                    ) {
                        CupertinoText(text = "去连接", fontSize = 14.sp)
                    }
                }
            }
        }
    }
}

/** 顶栏的圆形图标按钮。 */
@Composable
private fun RoundIcon(
    icon: ImageVector,
    contentDescription: String?,
    tint: Color,
    onClick: () -> Unit,
) {
    val source = remember { MutableInteractionSource() }
    Box(
        Modifier
            .pressScale(source, pressedScale = 0.9f)
            .size(38.dp)
            .clip(CircleShape)
            .clickable(interactionSource = source, indication = null, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        CupertinoIcon(
            imageVector = icon,
            contentDescription = contentDescription,
            modifier = Modifier.size(19.dp),
            tint = tint,
        )
    }
}

/** 底栏一个「图标 + 小字」的动作位。 */
@Composable
private fun ActionCell(
    label: String,
    active: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
    icon: @Composable () -> Unit,
) {
    val scheme = CupertinoTheme.colorScheme
    val source = remember { MutableInteractionSource() }
    Column(
        modifier
            .pressScale(source, pressedScale = 0.94f)
            .clip(RoundedCornerShape(10.dp))
            .clickable(interactionSource = source, indication = null, onClick = onClick)
            .padding(vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        icon()
        Spacer(Modifier.height(2.dp))
        CupertinoText(
            text = label,
            fontSize = 10.5.sp,
            color = if (active) scheme.accent else scheme.secondaryLabel,
            maxLines = 1,
        )
    }
}

@Composable
private fun LoadingState() {
    val palette = CupertinoTheme.colorScheme
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CupertinoActivityIndicator(size = 26.dp, color = palette.accent)
            Spacer(Modifier.height(14.dp))
            CupertinoText(
                text = "正在排版…",
                style = TitleSmallStyle,
                color = palette.label,
            )
            Spacer(Modifier.height(4.dp))
            CupertinoText(
                text = "正在切分章节",
                fontSize = 11.sp,
                fontFamily = FontFamily.Monospace,
                color = palette.secondaryLabel,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun ErrorState(message: String, onRetry: () -> Unit) {
    val palette = CupertinoTheme.colorScheme
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(horizontal = 36.dp),
        ) {
            CupertinoText(
                text = "读不了这一章",
                style = TitleMediumStyle,
                color = palette.label,
            )
            Spacer(Modifier.height(8.dp))
            CupertinoText(
                text = message,
                style = BodySmallStyle,
                color = palette.secondaryLabel,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(18.dp))
            CupertinoButton(
                onClick = onRetry,
                colors = CupertinoButtonDefaults.filledButtonColors(),
            ) {
                CupertinoText(text = "重试", fontSize = 14.sp)
            }
        }
    }
}

/** 一章的标题块。 */
@Composable
private fun ChapterHeadingBlock(number: Int, title: String, bottomGap: androidx.compose.ui.unit.Dp) {
    val palette = CupertinoTheme.colorScheme
    Column(Modifier.fillMaxWidth()) {
        Spacer(Modifier.height(14.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(palette.separator)
        )
        Spacer(Modifier.height(12.dp))
        CupertinoText(
            text = "第 ${number.toString().padStart(2, '0')} 章",
            style = KickerStyle,
            color = palette.accent,
        )
        Spacer(Modifier.height(6.dp))
        CupertinoText(
            text = title,
            style = HeadingStyle,
            color = palette.label,
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
    val palette = CupertinoTheme.colorScheme
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(androidx.compose.foundation.layout.IntrinsicSize.Min)
                .then(
                    if (highlighted) {
                        Modifier.background(palette.accent.copy(alpha = 0.09f))
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
                        .background(palette.accent),
                )
                Spacer(Modifier.width(6.dp))
            }
            CupertinoText(
                text = text,
                style = style,
                color = palette.label,
                modifier = Modifier.weight(1f),
            )
        }
        Spacer(Modifier.height(bottomGap))
    }
}

/** 上一章 / 下一章的窄箭头，和进度信息挤在同一行。 */
@Composable
private fun Chevron(glyph: String, enabled: Boolean, onClick: () -> Unit) {
    val palette = CupertinoTheme.colorScheme
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
        CupertinoText(
            text = glyph,
            fontSize = 18.sp,
            color = if (enabled) palette.label else palette.tertiaryLabel,
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
