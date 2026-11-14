package com.folio.reader.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.folio.reader.data.SettingsStore
import com.folio.reader.ui.reader.ReaderStyleSheet
import com.folio.reader.ui.reader.TocSheet
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * 小说阅读器。
 *
 * 三个要点：
 *  1. 正文是 [LazyColumn]，只组合可见段落 —— 一千章的长篇也不会一次性布局十万个 Text；
 *  2. 顶栏 / 底栏点正文中央显隐，沉浸阅读时屏幕上只有字；
 *  3. 云端书零缓存：正文由 `CloudChapterSource` 按章取，最近 3 章留内存，
 *     断网翻章直接提示「连接已断开 · 重试」，不假装还能读。
 */
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

    var scrubbing by remember { mutableStateOf(false) }
    var sliderValue by remember { mutableFloatStateOf(0f) }

    val book = reader.book
    val fontSize = settings.fontSizeSp.sp
    val lineHeight = (settings.fontSizeSp * settings.lineHeight).sp
    val fontFamily = if (settings.fontFamily == SettingsStore.FONT_SANS) {
        FontFamily.SansSerif
    } else {
        FontFamily.Serif
    }

    // 打开 / 换章时回到该读的位置
    LaunchedEffect(book?.id, reader.chapterIndex, reader.paragraphs.size) {
        val index = reader.paraIndex
        if (index > 0 && reader.paragraphs.isNotEmpty() && !scrubbing) {
            listState.scrollToItem(index.coerceIn(0, reader.paragraphs.size - 1))
        }
    }

    // 目录跳章：ViewModel 只发目标位置，滚动交给列表
    LaunchedEffect(scrollTarget) {
        if (scrollTarget >= 0) {
            listState.scrollToItem(scrollTarget.coerceAtLeast(0))
            vm.clearScrollTarget()
        }
    }

    LaunchedEffect(listState, book?.id) {
        snapshotFlow { listState.firstVisibleItemIndex }
            .distinctUntilChanged()
            .collect { index -> if (!scrubbing) vm.updatePosition(index) }
    }

    val needConnect = reader.error == CLOUD_NEED_CONNECT

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        // 正文（点击切换顶/底栏显隐）
        Column(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(book?.id) {
                    detectTapGestures(onTap = { vm.toggleControls() })
                },
        ) {
            when {
                reader.loading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) { CircularProgressIndicator() }

                // 只有「一个字都没有」才整屏报错；翻章失败时下面单独挂一条提示，
                // 已经读到的正文不能被抢走。
                reader.error != null && reader.paragraphs.isEmpty() && !needConnect -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = reader.error.orEmpty(),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 32.dp),
                        )
                        Spacer(Modifier.height(12.dp))
                        Button(onClick = { vm.retryChapter() }) { Text("重试") }
                    }
                }

                else -> LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(
                        start = settings.pagePadding.dp,
                        end = settings.pagePadding.dp,
                        top = 72.dp,
                        bottom = 96.dp,
                    ),
                ) {
                    itemsIndexed(reader.paragraphs) { _, paragraph ->
                        if (paragraph.blank) {
                            Spacer(Modifier.height((fontSize.value * 0.6f).dp))
                        } else {
                            Text(
                                text = paragraph.text,
                                fontSize = fontSize,
                                lineHeight = lineHeight,
                                fontFamily = fontFamily,
                                color = MaterialTheme.colorScheme.onBackground,
                                modifier = Modifier.padding(bottom = 8.dp),
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
            Surface(
                color = MaterialTheme.colorScheme.background.copy(alpha = 0.96f),
                tonalElevation = 2.dp,
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .statusBarsPadding()
                        .padding(horizontal = 4.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = book?.title.orEmpty(),
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (reader.chapterTitle.isNotBlank()) {
                            Text(
                                text = reader.chapterTitle,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                    IconButton(onClick = { vm.toggleToc() }) {
                        Icon(Icons.AutoMirrored.Filled.List, contentDescription = "目录")
                    }
                    IconButton(onClick = { vm.toggleStyle() }) {
                        Icon(Icons.Default.MoreVert, contentDescription = "排版")
                    }
                }
            }
        }

        // 翻章失败：正文留着，底下挂一条提示 + 重试
        if (reader.error != null && reader.paragraphs.isNotEmpty()) {
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(bottom = if (reader.controls) 112.dp else 12.dp)
                    .padding(horizontal = 16.dp),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = reader.error.orEmpty(),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = { vm.retryChapter() }) { Text("重试") }
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
            Surface(
                color = MaterialTheme.colorScheme.background.copy(alpha = 0.96f),
                tonalElevation = 2.dp,
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(horizontal = 16.dp, vertical = 6.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Slider(
                            value = if (scrubbing) sliderValue else reader.percent.toFloat(),
                            onValueChange = {
                                scrubbing = true
                                sliderValue = it
                            },
                            onValueChangeFinished = {
                                scrubbing = false
                                vm.seekToPercent(sliderValue.toDouble())
                            },
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            text = "${reader.percent.toInt()}%",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TextButton(
                            onClick = { vm.prevChapter() },
                            enabled = reader.hasPrevChapter,
                        ) { Text("上一章") }
                        Text(
                            text = buildString {
                                if (reader.chapterCount > 0) {
                                    append("第 ${reader.chapterIndex + 1}/${reader.chapterCount} 章")
                                }
                                // 来源标记只看书本身，不看 `reader.offline`（那个字段是「这章
                                // 命中了内存缓存」，本机书根本不存在缓存这回事）。
                                // 本机书正文在 books/<id>.txt，什么都不用标；云端书才需要说明
                                // 「这一章是从桌面端现取的，没有本地副本」。
                                if (book?.isCloud == true) append(" · 仅在线读取")
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        TextButton(
                            onClick = { vm.nextChapter() },
                            enabled = reader.hasNextChapter,
                        ) { Text("下一章") }
                    }
                }
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
            onFontFamily = vm::updateFontFamily,
            onThemePreset = vm::updateThemePreset,
            onPagePadding = vm::updatePagePadding,
            onDismiss = { vm.toggleStyle() },
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

/** 云端书未连接时的固定文案（与架构 §8 一致）。 */
internal const val CLOUD_NEED_CONNECT = "云端书需要连接桌面端才能阅读"
