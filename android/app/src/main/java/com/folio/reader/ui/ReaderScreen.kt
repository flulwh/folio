package com.folio.reader.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextIndent
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.folio.reader.data.SettingsStore
import com.folio.reader.ui.reader.MarksSheet
import com.folio.reader.ui.reader.ReaderStyleSheet
import com.folio.reader.ui.reader.SearchSheet
import com.folio.reader.ui.reader.TocSheet
import java.util.Locale
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * 小说阅读器（现代主义网格版）。
 *
 * 三个要点：
 *  1. 正文是 [LazyColumn]，只组合可见段落 —— 一千章的长篇也不会一次性布局十万个 Text；
 *  2. 顶栏 / 底栏点正文中央显隐，沉浸阅读时屏幕上只有字；
 *  3. 云端书零缓存：正文由 `CloudChapterSource` 按章取，最近 3 章留内存，
 *     断网翻章直接提示「连接已断开 · 重试」，不假装还能读。
 *
 * 视觉上只保留三样东西：纸底、墨字、一点正红；层级全部交给 1dp 发丝线，
 * 不用阴影、不用圆角胶囊。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReaderScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val reader by vm.reader.collectAsState()
    val settings by vm.settingsState.collectAsState()
    val listState = rememberLazyListState()
    val scrollTarget by vm.scrollTarget.collectAsState()
    val pageTurn by vm.pageTurn.collectAsState()

    var scrubbing by remember { mutableStateOf(false) }
    var sliderValue by remember { mutableFloatStateOf(0f) }

    val book = reader.book
    val density = LocalDensity.current
    val view = LocalView.current

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

    // 云端书的痕迹只锚定到「当前这一章」：段落号是章内下标，
    // 不按章号过滤的话，别的章的书签会落在这一章同号的段落上。
    val visibleMarks = remember(reader.marks, reader.isCloud, reader.toc, reader.chapterIndex) {
        if (!reader.isCloud) {
            reader.marks
        } else {
            val chapterNo = reader.toc.getOrNull(reader.chapterIndex)?.index ?: -1
            reader.marks.filter { it.chapterNo == chapterNo }
        }
    }
    // 痕迹集合只随 marks 变化重算一次，item 里只做 O(1) 查询。
    val bookmarkedParas = remember(visibleMarks) {
        visibleMarks.asSequence().filter { it.isBookmark }.map { it.paraIndex }.toSet()
    }
    val highlightedParas = remember(visibleMarks) {
        visibleMarks.asSequence().filterNot { it.isBookmark }.map { it.paraIndex }.toSet()
    }
    // 章节首发段落 → (章序号, 标题)，用于正文里的标题块。
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
        textIndent = if (settings.firstLineIndent) {
            TextIndent(firstLine = 2.em)
        } else {
            TextIndent.None
        },
    )

    // 打开 / 换章时回到该读的位置
    LaunchedEffect(book?.id, reader.chapterIndex, reader.paragraphs.size) {
        val index = reader.paraIndex
        if (index > 0 && reader.paragraphs.isNotEmpty() && !scrubbing) {
            listState.scrollToItem(index.coerceIn(0, reader.paragraphs.size - 1))
        }
    }

    // 目录 / 痕迹 / 搜索跳转：ViewModel 只发目标位置，滚动交给列表
    LaunchedEffect(scrollTarget) {
        if (scrollTarget >= 0) {
            listState.scrollToItem(scrollTarget.coerceAtLeast(0))
            vm.clearScrollTarget()
        }
    }

    // 翻页：一屏的 88%，刚好让上一屏的最后一行留在视野里当锚点。
    // 已经到头 / 到顶就顺势换章 —— 翻页手势在章节末尾不该「什么都点不动」。
    LaunchedEffect(pageTurn.seq) {
        if (pageTurn.seq == 0L) return@LaunchedEffect
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

    LaunchedEffect(listState, book?.id) {
        snapshotFlow { listState.firstVisibleItemIndex }
            .distinctUntilChanged()
            .collect { index -> if (!scrubbing) vm.updatePosition(index) }
    }

    // 自动滚动：按帧累加像素，走到末尾就自己停。
    LaunchedEffect(reader.autoScroll, settings.autoScrollSpeed) {
        if (!reader.autoScroll) return@LaunchedEffect
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

    // 阅读时常亮；离开阅读器立刻恢复。
    DisposableEffect(view, settings.keepScreenOn, book?.id) {
        view.keepScreenOn = settings.keepScreenOn && book != null
        onDispose { view.keepScreenOn = false }
    }

    val needConnect = reader.error == CLOUD_NEED_CONNECT
    val shownPercent = if (scrubbing) sliderValue * 100f else reader.percent.toFloat()
    val percentLabel = String.format(Locale.US, "%.1f%%", shownPercent)
    val remainingLabel = remainderLabel(reader.minutesLeft(reader.paraIndex))
    val chapterLabel = if (reader.chapterCount > 0) {
        buildString {
            append("第 ")
            append(reader.chapterIndex + 1)
            append(" / ")
            append(reader.chapterCount)
            append(" 章")
            if (reader.isCloud) append(" · 仅在线")
        }
    } else {
        "—"
    }

    val bottomContentPadding = when {
        reader.controls -> 208.dp
        reader.error != null -> 76.dp
        else -> 104.dp
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        // 正文：左 30% 上一页 / 右 30% 下一页 / 中间切换顶底栏
        Column(
            modifier = Modifier
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
            when {
                reader.loading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text(
                            text = "正在排版…",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onBackground,
                        )
                        Spacer(Modifier.height(8.dp))
                        FolioKicker("正在切分章节")
                        Spacer(Modifier.height(16.dp))
                        LinearProgressIndicator(
                            modifier = Modifier
                                .width(88.dp)
                                .height(2.dp),
                            color = MaterialTheme.colorScheme.primary,
                            trackColor = MaterialTheme.colorScheme.outlineVariant,
                        )
                    }
                }

                // 只有「一个字都没有」才整屏报错；翻章失败时下面单独挂一条提示，
                // 已经读到的正文不能被抢走。
                reader.error != null && reader.paragraphs.isEmpty() && !needConnect -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(horizontal = 32.dp),
                    ) {
                        Text(
                            text = "ERROR",
                            style = MaterialTheme.typography.labelMedium.copy(letterSpacing = 2.sp),
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Spacer(Modifier.height(10.dp))
                        Text(
                            text = reader.error.orEmpty(),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                        )
                        Spacer(Modifier.height(22.dp))
                        Box(
                            modifier = Modifier
                                .border(
                                    width = 1.dp,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    shape = RoundedCornerShape(2.dp),
                                )
                                .clickable(
                                    interactionSource = remember { MutableInteractionSource() },
                                    indication = null,
                                    onClick = { vm.retryChapter() },
                                )
                                .padding(horizontal = 24.dp, vertical = 10.dp),
                        ) {
                            Text(
                                text = "重试",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                        }
                    }
                }

                else -> LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(
                        start = settings.pagePadding.dp,
                        end = settings.pagePadding.dp,
                        top = 96.dp,
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

        // 顶栏
        AnimatedVisibility(
            visible = reader.controls,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.TopCenter),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.background.copy(alpha = 0.97f)),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .statusBarsPadding()
                        .height(56.dp)
                        .padding(horizontal = 20.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    FolioIconAction(
                        icon = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "返回",
                        onClick = onBack,
                        size = 40.dp,
                        iconSize = 18.dp,
                    )
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 6.dp),
                    ) {
                        Text(
                            text = book?.title.orEmpty(),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Spacer(Modifier.height(1.dp))
                        Text(
                            text = reader.chapterTitle.ifBlank { "—" },
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    val bookmarked = reader.paraIndex in bookmarkedParas
                    FolioIconAction(
                        icon = if (bookmarked) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder,
                        contentDescription = if (bookmarked) "取消书签" else "加书签",
                        onClick = { vm.toggleBookmark() },
                        tint = if (bookmarked) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        },
                        size = 42.dp,
                        iconSize = 19.dp,
                    )
                    FolioIconAction(
                        icon = Icons.Default.Search,
                        contentDescription = "搜索",
                        onClick = { vm.toggleSearch() },
                        size = 42.dp,
                        iconSize = 19.dp,
                    )
                }
                FolioRule()
            }
        }

        // 翻章失败：正文留着，底下挂一条提示 + 重试
        if (reader.error != null && reader.paragraphs.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(horizontal = 16.dp)
                    .padding(bottom = if (reader.controls) 208.dp else 14.dp)
                    .fillMaxWidth()
                    .border(
                        width = 1.dp,
                        color = MaterialTheme.colorScheme.outline,
                        shape = RoundedCornerShape(2.dp),
                    )
                    .background(MaterialTheme.colorScheme.background.copy(alpha = 0.98f))
                    .padding(start = 12.dp, end = 4.dp, top = 2.dp, bottom = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = reader.error.orEmpty(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Box(
                    modifier = Modifier
                        .height(38.dp)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClick = { vm.retryChapter() },
                        )
                        .padding(horizontal = 12.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "重试",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }

        // 底栏
        AnimatedVisibility(
            visible = reader.controls && reader.paragraphs.isNotEmpty(),
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.background.copy(alpha = 0.97f))
                    .navigationBarsPadding(),
            ) {
                FolioHairline()
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp)
                        .padding(top = 10.dp),
                ) {
                    // 进度元信息
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = percentLabel,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                            maxLines = 1,
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            text = remainingLabel,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                        )
                    }
                    Spacer(Modifier.height(4.dp))

                    // 2dp 轨道 / 12dp 滑块；拖动只改本地值，松手才 seek。
                    Slider(
                        value = shownPercent / 100f,
                        onValueChange = {
                            scrubbing = true
                            sliderValue = it
                        },
                        onValueChangeFinished = {
                            scrubbing = false
                            vm.seekToPercent((sliderValue * 100f).toDouble())
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(26.dp),
                        colors = SliderDefaults.colors(
                            thumbColor = MaterialTheme.colorScheme.primary,
                            activeTrackColor = MaterialTheme.colorScheme.primary,
                            inactiveTrackColor = MaterialTheme.colorScheme.outlineVariant,
                        ),
                        thumb = {
                            Box(
                                Modifier
                                    .size(12.dp)
                                    .background(MaterialTheme.colorScheme.primary, CircleShape),
                            )
                        },
                        track = {
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .height(2.dp)
                                    .background(MaterialTheme.colorScheme.outlineVariant),
                            ) {
                                Box(
                                    Modifier
                                        .fillMaxWidth(shownPercent.coerceIn(0f, 100f) / 100f)
                                        .height(2.dp)
                                        .background(MaterialTheme.colorScheme.primary),
                                )
                            }
                        },
                    )
                    Spacer(Modifier.height(2.dp))

                    // 章导航
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(40.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        ChapterNavAction(
                            label = "上一章",
                            enabled = reader.hasPrevChapter,
                            onClick = { vm.prevChapter() },
                        )
                        Text(
                            text = chapterLabel,
                            modifier = Modifier.weight(1f),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        ChapterNavAction(
                            label = "下一章",
                            enabled = reader.hasNextChapter,
                            onClick = { vm.nextChapter() },
                        )
                    }

                    FolioHairline()
                    Spacer(Modifier.height(8.dp))

                    // 5 格动作条
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                    ) {
                        val cells = listOf(
                            ReaderAction(
                                label = "目录",
                                status = if (reader.chapterCount > 0) reader.chapterCount.toString() else "—",
                                active = reader.showToc,
                                onClick = { vm.toggleToc() },
                            ),
                            ReaderAction(
                                label = "痕迹",
                                status = reader.marks.size.toString(),
                                active = reader.showMarks,
                                onClick = { vm.toggleMarks() },
                            ),
                            ReaderAction(
                                label = "搜索",
                                status = if (reader.search.open) "开" else "关",
                                active = reader.search.open,
                                onClick = { vm.toggleSearch() },
                            ),
                            ReaderAction(
                                label = "排版",
                                status = "${settings.fontSizeSp.toInt()} 号",
                                active = reader.showStyle,
                                onClick = { vm.toggleStyle() },
                            ),
                            ReaderAction(
                                label = "自动",
                                status = if (reader.autoScroll) "开" else "关",
                                active = reader.autoScroll,
                                onClick = { vm.toggleAutoScroll() },
                            ),
                        )
                        cells.forEachIndexed { index, cell ->
                            if (index > 0) {
                                Box(
                                    Modifier
                                        .width(1.dp)
                                        .height(28.dp)
                                        .align(Alignment.CenterVertically)
                                        .background(MaterialTheme.colorScheme.outlineVariant),
                                )
                            }
                            ReaderActionCell(
                                label = cell.label,
                                status = cell.status,
                                active = cell.active,
                                modifier = Modifier.weight(1f),
                                onClick = cell.onClick,
                            )
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                }
            }
        }

        // 自动滚动时的角落标签
        if (reader.autoScroll && !reader.controls) {
            val speed = SettingsStore.AUTO_SCROLL_SPEEDS[
                settings.autoScrollSpeed.coerceIn(0, SettingsStore.AUTO_SCROLL_SPEEDS.lastIndex)
            ]
            Row(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .navigationBarsPadding()
                    .padding(end = 16.dp, bottom = 20.dp)
                    .background(MaterialTheme.colorScheme.background.copy(alpha = 0.92f))
                    .border(
                        width = 1.dp,
                        color = MaterialTheme.colorScheme.onSurface,
                        shape = RoundedCornerShape(2.dp),
                    )
                    .padding(horizontal = 8.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "AUTO $speed",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                )
                Spacer(Modifier.width(6.dp))
                Box(
                    Modifier
                        .size(5.dp)
                        .background(MaterialTheme.colorScheme.primary),
                )
            }
        }
    }

    if (reader.showToc) {
        val labels = if (reader.isCloud) {
            reader.toc.map { it.title }
        } else {
            reader.chapters.map { it.title }
        }
        TocSheet(
            labels = labels,
            currentIndex = reader.chapterIndex,
            onSelect = { index ->
                vm.switchChapter(index)
                vm.toggleToc()
            },
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
        AlertDialog(
            onDismissRequest = onBack,
            title = { Text("需要连接桌面端") },
            text = { Text("云端书需要连接桌面端才能阅读。") },
            confirmButton = {
                Button(onClick = {
                    onBack()
                    onOpenSettings()
                }) { Text("去连接") }
            },
            dismissButton = {
                TextButton(onClick = onBack) { Text("返回") }
            },
        )
    }
}

/** 一章的标题块：16dp 留白 + 2dp 实墨线 + 等宽章号 + 标题。 */
@Composable
private fun ChapterHeadingBlock(
    number: Int,
    title: String,
    bottomGap: Dp,
) {
    Column(Modifier.fillMaxWidth()) {
        Spacer(Modifier.height(16.dp))
        FolioRule()
        Spacer(Modifier.height(12.dp))
        FolioKicker(
            text = "第 ${number.toString().padStart(2, '0')} 章",
            color = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = title,
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.height(bottomGap))
    }
}

/**
 * 一个正文段：书签是左侧 2dp 正红竖条，高亮是 9% 正红底，两者可同时存在。
 * 竖条用 Row + fillMaxHeight，不用 drawBehind 阴影。
 */
@Composable
private fun ParagraphBlock(
    text: String,
    style: TextStyle,
    bookmarked: Boolean,
    highlighted: Boolean,
    bottomGap: Dp,
) {
    Column(Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(IntrinsicSize.Min)
                .then(
                    if (highlighted) {
                        Modifier.background(MaterialTheme.colorScheme.primary.copy(alpha = 0.09f))
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
                        .background(MaterialTheme.colorScheme.primary),
                )
                Spacer(Modifier.width(6.dp))
            }
            Text(
                text = text,
                style = style,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.weight(1f),
            )
        }
        Spacer(Modifier.height(bottomGap))
    }
}

/** 一章导航的左右触摸区；不可用时 32% 透明度。 */
@Composable
private fun ChapterNavAction(
    label: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .width(60.dp)
            .height(40.dp)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                enabled = enabled,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = if (enabled) {
                MaterialTheme.colorScheme.onSurface
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.32f)
            },
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** 动作条的一格数据。 */
private data class ReaderAction(
    val label: String,
    val status: String,
    val active: Boolean,
    val onClick: () -> Unit,
)

/** 动作条的一格：等宽标签 + 当前状态小字；选中或开启时正红。 */
@Composable
private fun ReaderActionCell(
    label: String,
    status: String,
    active: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val ink = if (active) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.onSurface
    }
    val soft = if (active) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }
    Column(
        modifier = modifier
            .height(48.dp)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = status,
            style = MaterialTheme.typography.labelSmall,
            color = soft,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
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

/** 云端书未连接时的固定文案（与架构 §8 一致）。 */
internal const val CLOUD_NEED_CONNECT = "云端书需要连接桌面端才能阅读"
