package com.folio.reader.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folio.reader.core.Book
import com.folio.reader.core.PageKey
import com.folio.reader.core.TocChapter
import com.folio.reader.data.SettingsStore
import com.folio.reader.ui.reader.ZoomableImage
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * 漫画阅读器。
 *
 * 与小说阅读器的关键差别：**页面高度是预置的**。
 * 漫画图片尺寸千奇百怪，如果等图片解码完再撑开，滚动条会一路跳；
 * 所以每页先按屏宽的固定比例占位，图到了往里填。
 *
 * 其它约定：
 *  - 逐页经 `ImageLoader` 取（`Semaphore(3)`、同 key 去重、内存 LRU）；
 *  - 单页失败只影响那一页，占位给原因 + 重试；
 *  - 读到本话 80% 预取下一话的页清单与前两张（VM 里做，失败静默）；
 *  - 离开时 `ImageLoader.clear()` + `ChapterMemoryCache.clear()`，内存归零。
 *
 * 视觉上只有顶栏、底栏与目录抽屉换了皮：纸底墨字、发丝线、等宽页码，
 * 图片区、手势、缩放、预取与所有回调保持原样。
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

    val book = comic.book
    val vertical = comic.direction != SettingsStore.COMIC_HORIZONTAL
    val needConnect = comic.error == CLOUD_NEED_CONNECT

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF121316)),
    ) {
        when {
            comic.loading -> Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator(color = Color.White) }

            // 一页都没有才整屏报错；翻话失败时下面挂一条提示，
            // 上一话已经加载出来的页留在这里，不把人踢回空白。
            comic.error != null && !needConnect && comic.total == 0 -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(32.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .border(1.dp, Color.White.copy(alpha = 0.18f))
                        .padding(20.dp),
                ) {
                    Text(
                        text = "ERROR",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White.copy(alpha = 0.55f),
                    )
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = comic.error.orEmpty(),
                        color = Color.White.copy(alpha = 0.86f),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Spacer(Modifier.height(14.dp))
                    DarkOutlineAction(text = "重试", onClick = { vm.reloadComic() })
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
                    // 换话时重建列表，让滚动位置回到本话首页
                    key(comic.chapterNo) {
                        VerticalPages(vm = vm, comic = comic, book = book, pictures = pictures)
                    }
                } else {
                    // 换话时重建 pager，让页码回到第 0 页
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
            ComicTopBar(
                bookTitle = book?.title.orEmpty(),
                chapterNo = if (comic.chapterNo > 0) comic.chapterNo else comic.chapterIndex + 1,
                page = comic.page,
                total = comic.total,
                onBack = onBack,
                onOpenToc = { vm.toggleComicToc() },
            )
        }

        // 翻话失败：上一话的图留着，底下提示 + 重试
        if (comic.error != null && comic.total > 0 && !needConnect) {
            Row(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(bottom = if (comic.controls) 96.dp else 12.dp)
                    .padding(horizontal = 16.dp)
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.background.copy(alpha = 0.94f))
                    .border(1.dp, MaterialTheme.colorScheme.outlineVariant)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FolioKicker("ERROR", color = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(10.dp))
                Text(
                    text = comic.error.orEmpty(),
                    color = MaterialTheme.colorScheme.onSurface,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(1f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.width(8.dp))
                ChromeTextAction(text = "重试", onClick = { vm.reloadComic() })
            }
        }

        // 底栏
        AnimatedVisibility(
            visible = comic.controls && comic.total > 0,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            ComicBottomBar(
                page = comic.page,
                total = comic.total,
                progress = comic.chapterProgress,
                hasPrevChapter = comic.hasPrevChapter,
                hasNextChapter = comic.hasNextChapter,
                chapterCount = comic.toc.size,
                onPrevChapter = { vm.prevComicChapter() },
                onNextChapter = { vm.nextComicChapter() },
                onOpenToc = { vm.toggleComicToc() },
            )
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
        AlertDialog(
            onDismissRequest = onBack,
            title = { Text("需要连接桌面端") },
            text = { Text(CLOUD_NEED_CONNECT + "。") },
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

/* ---------------- 顶栏 / 底栏 / 目录 ---------------- */

@Composable
private fun ComicTopBar(
    bookTitle: String,
    chapterNo: Int,
    page: Int,
    total: Int,
    onBack: () -> Unit,
    onOpenToc: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background.copy(alpha = 0.94f)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FolioIconAction(
                icon = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "返回",
                onClick = onBack,
            )
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 4.dp),
            ) {
                Text(
                    text = bookTitle,
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = "第 $chapterNo 话 · 第 $page/$total 页",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            FolioIconAction(
                icon = Icons.AutoMirrored.Filled.List,
                contentDescription = "选择话",
                onClick = onOpenToc,
            )
        }
        FolioRule()
    }
}

@Composable
private fun ComicBottomBar(
    page: Int,
    total: Int,
    progress: Float,
    hasPrevChapter: Boolean,
    hasNextChapter: Boolean,
    chapterCount: Int,
    onPrevChapter: () -> Unit,
    onNextChapter: () -> Unit,
    onOpenToc: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background.copy(alpha = 0.94f))
            .navigationBarsPadding(),
    ) {
        FolioProgressRail(progress = progress)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ChromeTextAction(
                text = "上一话",
                onClick = onPrevChapter,
                enabled = hasPrevChapter,
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = "${page + 1} / $total",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.weight(1f))
            ChromeTextAction(
                text = "下一话",
                onClick = onNextChapter,
                enabled = hasNextChapter,
            )
        }
        FolioHairline()
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onOpenToc,
                )
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FolioKicker("INDEX", color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(10.dp))
            Text(
                text = "目录",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f),
            )
            FolioKicker("$chapterCount 话 →")
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
    FolioSheet(
        onDismiss = onDismiss,
        kicker = "INDEX / ${chapters.size} 话",
        title = "话",
    ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 460.dp),
        ) {
            itemsIndexed(chapters) { index, chapter ->
                val selected = index == currentIndex
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onSelect(index) }
                        .padding(horizontal = 20.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .width(2.dp)
                            .height(18.dp)
                            .background(
                                if (selected) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    Color.Transparent
                                }
                            )
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(
                        text = (index + 1).toString().padStart(3, '0'),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (selected) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                    Spacer(Modifier.width(14.dp))
                    Text(
                        text = chapter.title.ifBlank { "第 ${chapter.index} 话" },
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (selected) {
                        FolioKicker("读到这里", color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
        }
    }
}

/* ---------------- 栏内的小操作 ---------------- */

/** 无涟漪文字操作，底栏的上一话 / 下一话与错误条的「重试」共用。 */
@Composable
private fun ChromeTextAction(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Box(
        modifier = modifier
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
            style = MaterialTheme.typography.labelMedium,
            color = if (enabled) {
                MaterialTheme.colorScheme.onSurface
            } else {
                MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f)
            },
            maxLines = 1,
        )
    }
}

/** 深色图片区上的方框操作，避免纸色按钮在暗底上消失。 */
@Composable
private fun DarkOutlineAction(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .height(40.dp)
            .border(1.dp, Color.White.copy(alpha = 0.55f))
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            )
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            color = Color.White,
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

    // 换话后回到保存的页
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
    val pagerState = rememberPagerState(initialPage = comic.page.coerceIn(0, (comic.total - 1).coerceAtLeast(0))) {
        comic.total
    }

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
                    .padding(24.dp)
                    .border(1.dp, Color.White.copy(alpha = 0.18f))
                    .padding(18.dp),
            ) {
                Text(
                    text = "ERROR",
                    style = MaterialTheme.typography.labelSmall,
                    color = Color.White.copy(alpha = 0.55f),
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = error,
                    color = Color.White.copy(alpha = 0.8f),
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(10.dp))
                DarkOutlineAction(text = "重试", onClick = onRetry)
            }

            else -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator(
                    color = Color.White.copy(alpha = 0.6f),
                    modifier = Modifier.size(28.dp),
                    strokeWidth = 2.dp,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "第 ${page + 1}/$total 页",
                    color = Color.White.copy(alpha = 0.45f),
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        }
    }
}

/** 占位页的宽高比：0.7 ≈ 常见漫画单页，避免加载时列表高度跳变。 */
private const val PAGE_ASPECT_RATIO = 0.7f
