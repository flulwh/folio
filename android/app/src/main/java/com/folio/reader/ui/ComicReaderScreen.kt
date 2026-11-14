package com.folio.reader.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folio.reader.core.Book
import com.folio.reader.core.PageKey
import com.folio.reader.data.SettingsStore
import com.folio.reader.ui.reader.TocSheet
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
                Text(
                    text = comic.error.orEmpty(),
                    color = Color.White.copy(alpha = 0.86f),
                    style = androidx.compose.material3.MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(12.dp))
                Button(onClick = { vm.reloadComic() }) { Text("重试") }
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
            Surface(color = Color.Black.copy(alpha = 0.72f)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .statusBarsPadding()
                        .padding(horizontal = 4.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "返回",
                            tint = Color.White,
                        )
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = book?.title.orEmpty(),
                            style = androidx.compose.material3.MaterialTheme.typography.titleSmall,
                            color = Color.White,
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = comic.chapterTitle,
                            style = androidx.compose.material3.MaterialTheme.typography.labelSmall,
                            color = Color.White.copy(alpha = 0.7f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    IconButton(onClick = { vm.toggleComicToc() }) {
                        Icon(
                            Icons.AutoMirrored.Filled.List,
                            contentDescription = "选择话",
                            tint = Color.White,
                        )
                    }
                }
            }
        }

        // 翻话失败：上一话的图留着，底下提示 + 重试
        if (comic.error != null && comic.total > 0 && !needConnect) {
            Surface(
                color = Color.Black.copy(alpha = 0.78f),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(bottom = if (comic.controls) 56.dp else 8.dp)
                    .padding(horizontal = 12.dp),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = comic.error.orEmpty(),
                        color = Color.White.copy(alpha = 0.86f),
                        style = androidx.compose.material3.MaterialTheme.typography.labelMedium,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = { vm.reloadComic() }) {
                        Text("重试", color = Color.White)
                    }
                }
            }
        }

        // 底栏
        AnimatedVisibility(
            visible = comic.controls && comic.total > 0,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            Surface(color = Color.Black.copy(alpha = 0.72f)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .navigationBarsPadding()
                        .padding(horizontal = 12.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(
                        onClick = { vm.prevComicChapter() },
                        enabled = comic.hasPrevChapter,
                    ) {
                        Text(
                            text = "上一话",
                            color = if (comic.hasPrevChapter) Color.White else Color.White.copy(alpha = 0.35f),
                        )
                    }
                    Text(
                        text = "第 ${comic.page + 1}/${comic.total} 页",
                        style = androidx.compose.material3.MaterialTheme.typography.labelMedium,
                        color = Color.White.copy(alpha = 0.8f),
                    )
                    TextButton(
                        onClick = { vm.nextComicChapter() },
                        enabled = comic.hasNextChapter,
                    ) {
                        Text(
                            text = "下一话",
                            color = if (comic.hasNextChapter) Color.White else Color.White.copy(alpha = 0.35f),
                        )
                    }
                }
            }
        }
    }

    if (comic.showToc) {
        TocSheet(
            labels = comic.toc.map { it.title },
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
                modifier = Modifier.padding(24.dp),
            ) {
                Text(
                    text = error,
                    color = Color.White.copy(alpha = 0.8f),
                    style = androidx.compose.material3.MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(8.dp))
                TextButton(onClick = onRetry) { Text("重试", color = Color.White) }
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
                    style = androidx.compose.material3.MaterialTheme.typography.labelSmall,
                )
            }
        }
    }
}

/** 占位页的宽高比：0.7 ≈ 常见漫画单页，避免加载时列表高度跳变。 */
private const val PAGE_ASPECT_RATIO = 0.7f
