package com.folio.reader.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.folio.reader.core.Book
import com.folio.reader.core.PageKey
import com.folio.reader.core.TocChapter
import com.folio.reader.data.SettingsStore
import com.folio.reader.ui.miuix.HyperSheet
import com.folio.reader.ui.reader.ZoomableImage
import kotlinx.coroutines.flow.distinctUntilChanged
import top.yukonga.miuix.kmp.basic.Button
import top.yukonga.miuix.kmp.basic.CircularProgressIndicator
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.LinearProgressIndicator
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.theme.MiuixTheme

/**
 * 漫画阅读器（HyperOS 版）。
 *
 * 图片区保持深色，顶 / 底栏换成浮动圆角卡片；目录用同一套底部面板。
 * 取页、预取、缩放、换话逻辑与 3.3.0 完全一致。
 */
@Composable
fun ComicReaderScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val comic by vm.comic.collectAsState()
    val pictures by vm.comicPictures.collectAsState()
    val settings by vm.settingsState.collectAsState()
    val scheme = MiuixTheme.colorScheme

    val book = comic.book
    val vertical = comic.direction != SettingsStore.COMIC_HORIZONTAL
    val needConnect = comic.error == CLOUD_NEED_CONNECT

    Box(Modifier.fillMaxSize().background(Color(0xFF121316))) {
        when {
            comic.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }

            comic.error != null && !needConnect && comic.total == 0 -> Column(
                modifier = Modifier.fillMaxSize().padding(32.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = "打不开这一话",
                    fontSize = 18.sp,
                    color = Color.White.copy(alpha = 0.9f),
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = comic.error.orEmpty(),
                    fontSize = 13.sp,
                    color = Color.White.copy(alpha = 0.6f),
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(16.dp))
                Button(onClick = { vm.reloadComic() }, cornerRadius = 14.dp) {
                    Text(text = "重试", fontSize = 14.sp, color = scheme.onPrimary)
                }
            }

            book != null && comic.total > 0 -> Box(
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(book.id) {
                        detectTapGestures(onTap = { vm.toggleComicControls() })
                    },
            ) {
                if (vertical) {
                    key(comic.chapterNo) {
                        VerticalPages(vm = vm, comic = comic, book = book, pictures = pictures)
                    }
                } else {
                    key(comic.chapterNo) {
                        HorizontalPages(vm = vm, comic = comic, book = book, pictures = pictures)
                    }
                }
            }
        }

        // 顶栏
        AnimatedVisibility(
            visible = comic.controls,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.TopCenter),
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .background(
                        androidx.compose.ui.graphics.Brush.verticalGradient(
                            listOf(Color(0xE6000000), Color(0x00000000))
                        )
                    ),
            ) {
                Row(
                    modifier = Modifier
                        .statusBarsPadding()
                        .padding(start = 6.dp, end = 6.dp, bottom = 12.dp)
                        .fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    DarkIconButton(Icons.AutoMirrored.Filled.ArrowBack, "返回", onBack)
                    Column(Modifier.weight(1f).padding(horizontal = 4.dp)) {
                        Text(
                            text = book?.title.orEmpty(),
                            fontSize = 13.5.sp,
                            color = Color.White.copy(alpha = 0.92f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = "第 ${if (comic.chapterNo > 0) comic.chapterNo else comic.chapterIndex + 1} 话 · " +
                                "第 ${comic.page + 1}/${comic.total} 页",
                            fontSize = 10.5.sp,
                            color = Color.White.copy(alpha = 0.52f),
                            maxLines = 1,
                        )
                    }
                    DarkIconButton(Icons.AutoMirrored.Filled.List, "选择话", { vm.toggleComicToc() })
                }
            }
        }

        // 翻话失败提示
        if (comic.error != null && comic.total > 0 && !needConnect) {
            Row(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(bottom = if (comic.controls) 150.dp else 18.dp)
                    .fillMaxWidth()
                    .background(Color(0xCC000000))
                    .padding(start = 16.dp, end = 6.dp, top = 10.dp, bottom = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = comic.error.orEmpty(),
                    fontSize = 12.sp,
                    color = Color.White.copy(alpha = 0.8f),
                    modifier = Modifier.weight(1f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "重试",
                    fontSize = 12.sp,
                    color = scheme.primary,
                    modifier = Modifier
                        .clickable { vm.reloadComic() }
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
        }

        // 底栏
        AnimatedVisibility(
            visible = comic.controls && comic.total > 0,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            Column(
                modifier = Modifier
                    .navigationBarsPadding()
                    .fillMaxWidth()
                    .background(
                        androidx.compose.ui.graphics.Brush.verticalGradient(
                            listOf(Color(0x00000000), Color(0xF2000000))
                        )
                    )
                    .padding(horizontal = 20.dp)
                    .padding(top = 24.dp, bottom = 4.dp),
            ) {
                LinearProgressIndicator(
                    progress = comic.chapterProgress.coerceIn(0f, 1f),
                    modifier = Modifier.fillMaxWidth().height(2.dp),
                )
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    DarkTextAction("上一话", comic.hasPrevChapter) { vm.prevComicChapter() }
                    Spacer(Modifier.weight(1f))
                    Text(
                        text = "${comic.page + 1} / ${comic.total}",
                        fontSize = 11.5.sp,
                        color = Color.White.copy(alpha = 0.86f),
                    )
                    Spacer(Modifier.weight(1f))
                    DarkTextAction("下一话", comic.hasNextChapter) { vm.nextComicChapter() }
                }
                Box(Modifier.fillMaxWidth().height(0.6.dp).background(Color.White.copy(alpha = 0.12f)))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clickable { vm.toggleComicToc() }
                        .padding(vertical = 10.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(text = "目录", modifier = Modifier.weight(1f), fontSize = 13.sp, color = Color.White.copy(alpha = 0.9f))
                        Text(
                            text = "${comic.toc.size} 话 →",
                            fontSize = 11.sp,
                            color = Color.White.copy(alpha = 0.52f),
                        )
                    }
                }
            }
        }
    }

    if (comic.showToc) {
        ComicTocSheet(
            chapters = comic.toc,
            currentIndex = comic.chapterIndex,
            onSelect = { index ->
                vm.toggleComicToc()
                vm.switchComicChapter(index)
            },
            onDismiss = { vm.toggleComicToc() },
        )
    }

    if (needConnect) {
        val scheme2 = MiuixTheme.colorScheme
        HyperSheet(onDismiss = onBack) {
            Column(Modifier.padding(horizontal = 20.dp)) {
                Spacer(Modifier.height(4.dp))
                Text(text = "需要连接桌面端", fontSize = 19.sp, color = scheme2.onSurface)
                Spacer(Modifier.height(8.dp))
                Text(
                    text = CLOUD_NEED_CONNECT + "。",
                    fontSize = 13.sp,
                    color = scheme2.onSurfaceVariantSummary,
                )
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    TextButton(text = "返回", onClick = onBack, modifier = Modifier.weight(1f))
                    Button(
                        onClick = {
                            onBack()
                            onOpenSettings()
                        },
                        modifier = Modifier.weight(1f),
                        cornerRadius = 16.dp,
                    ) {
                        Text(text = "去连接", fontSize = 14.sp, color = scheme2.onPrimary)
                    }
                }
            }
        }
    }
}

@Composable
private fun ComicTocSheet(
    chapters: List<TocChapter>,
    currentIndex: Int,
    onSelect: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    val scheme = MiuixTheme.colorScheme
    val listState = rememberLazyListState()
    LaunchedEffect(currentIndex) {
        if (currentIndex in chapters.indices) listState.scrollToItem(currentIndex)
    }

    HyperSheet(
        onDismiss = onDismiss,
        title = "目录",
        subtitle = "${chapters.size} 话",
    ) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxWidth().weight(1f, fill = false),
        ) {
            itemsIndexed(chapters, key = { _, chapter -> chapter.index }) { index, chapter ->
                val selected = index == currentIndex
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 2.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(if (selected) scheme.primaryContainer else scheme.surface)
                        .clickable { onSelect(index) }
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = (index + 1).toString().padStart(3, '0'),
                        fontSize = 11.sp,
                        color = if (selected) scheme.primary else scheme.onSurfaceVariantSummary,
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(
                        text = chapter.title.ifBlank { "第 ${chapter.index} 话" },
                        modifier = Modifier.weight(1f),
                        fontSize = 15.sp,
                        color = if (selected) scheme.primary else scheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (selected) {
                        Text(text = "读到这里", fontSize = 11.sp, color = scheme.primary)
                    }
                }
            }
        }
    }
}

@Composable
private fun DarkIconButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .size(38.dp)
            .clip(CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = description,
            modifier = Modifier.size(20.dp),
            tint = Color.White.copy(alpha = 0.9f),
        )
    }
}

@Composable
private fun DarkTextAction(text: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .height(36.dp)
            .clickable(
                enabled = enabled,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            )
            .padding(horizontal = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            fontSize = 12.sp,
            color = if (enabled) Color.White.copy(alpha = 0.88f) else Color.White.copy(alpha = 0.3f),
            maxLines = 1,
        )
    }
}

/* ---------------- 竖向连续（默认） ---------------- */

@Composable
private fun VerticalPages(
    vm: AppViewModel,
    comic: ComicUiState,
    book: Book,
    pictures: Map<PageKey, ImageBitmap>,
) {
    val listState = rememberLazyListState()

    LaunchedEffect(comic.chapterNo) {
        if (comic.page > 0 && comic.total > comic.page) {
            listState.scrollToItem(comic.page)
        }
    }

    LaunchedEffect(listState, comic.chapterNo) {
        snapshotFlow { listState.firstVisibleItemIndex }
            .distinctUntilChanged()
            .collect { index -> vm.onComicPageChanged(index) }
    }

    LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
        items(comic.total) { page ->
            ComicPageBox(
                book = book,
                chapterNo = comic.chapterNo,
                page = page,
                total = comic.total,
                bitmap = pictures[PageKey.of(book.id, comic.chapterNo, page)],
                error = comic.pageErrors[page],
                onRequest = vm::requestComicPage,
                onRetry = { vm.retryComicPage(page) },
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(PAGE_ASPECT_RATIO),
            )
        }
    }
}

/* ---------------- 横向逐页 ---------------- */

@Composable
private fun HorizontalPages(
    vm: AppViewModel,
    comic: ComicUiState,
    book: Book,
    pictures: Map<PageKey, ImageBitmap>,
) {
    val pagerState = rememberPagerState(
        initialPage = comic.page.coerceIn(0, (comic.total - 1).coerceAtLeast(0))
    ) { comic.total }

    LaunchedEffect(pagerState, comic.chapterNo) {
        snapshotFlow { pagerState.currentPage }
            .distinctUntilChanged()
            .collect { index -> vm.onComicPageChanged(index) }
    }

    HorizontalPager(state = pagerState, modifier = Modifier.fillMaxSize()) { page ->
        ComicPageBox(
            book = book,
            chapterNo = comic.chapterNo,
            page = page,
            total = comic.total,
            bitmap = pictures[PageKey.of(book.id, comic.chapterNo, page)],
            error = comic.pageErrors[page],
            onRequest = vm::requestComicPage,
            onRetry = { vm.retryComicPage(page) },
            modifier = Modifier.fillMaxSize(),
        )
    }
}

/* ---------------- 单页 ---------------- */

@Composable
private fun ComicPageBox(
    book: Book,
    chapterNo: Int,
    page: Int,
    total: Int,
    bitmap: ImageBitmap?,
    error: String?,
    onRequest: (Int) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    LaunchedEffect(book.id, chapterNo, page) { onRequest(page) }

    Box(
        modifier = modifier.background(Color(0xFF17181C)),
        contentAlignment = Alignment.Center,
    ) {
        when {
            bitmap != null -> ZoomableImage(bitmap = bitmap, modifier = Modifier.fillMaxSize())

            error != null -> Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color.White.copy(alpha = 0.05f))
                    .padding(20.dp),
            ) {
                Text(
                    text = error,
                    fontSize = 12.5.sp,
                    color = Color.White.copy(alpha = 0.8f),
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    text = "重试",
                    fontSize = 12.5.sp,
                    color = Color.White.copy(alpha = 0.85f),
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color.White.copy(alpha = 0.10f))
                        .clickable(onClick = onRetry)
                        .padding(horizontal = 14.dp, vertical = 6.dp),
                )
            }

            else -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator(size = 28.dp, strokeWidth = 2.dp)
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "第 ${page + 1}/$total 页",
                    fontSize = 11.sp,
                    color = Color.White.copy(alpha = 0.45f),
                )
            }
        }
    }
}

/** 占位页的宽高比：0.7 ≈ 常见漫画单页，避免加载时列表高度跳变。 */
private const val PAGE_ASPECT_RATIO = 0.7f
