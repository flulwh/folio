package com.folio.reader.ui

import com.folio.reader.ui.model.ComicModel
import com.folio.reader.ui.session.SessionStore

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.request.ImageRequest
import com.folio.reader.core.Book
import com.folio.reader.core.TocChapter
import com.folio.reader.data.ComicPage
import com.folio.reader.data.SettingsStore
import me.saket.telephoto.zoomable.coil3.ZoomableAsyncImage
import me.saket.telephoto.zoomable.rememberZoomableImageState
import io.github.alexzhirkevich.cupertino.CupertinoActivityIndicator
import io.github.alexzhirkevich.cupertino.CupertinoButton
import io.github.alexzhirkevich.cupertino.CupertinoButtonDefaults
import io.github.alexzhirkevich.cupertino.CupertinoIcon
import io.github.alexzhirkevich.cupertino.CupertinoText
import io.github.alexzhirkevich.cupertino.icons.CupertinoIcons
import io.github.alexzhirkevich.cupertino.icons.outlined.ChevronBackward
import io.github.alexzhirkevich.cupertino.icons.outlined.ListBullet
import io.github.alexzhirkevich.cupertino.theme.CupertinoTheme
import kotlinx.coroutines.flow.distinctUntilChanged

/**
 * 漫画阅读器（HyperOS 版）。
 *
 * 图片区保持深色，顶 / 底栏换成浮动圆角卡片；目录用同一套底部面板。
 * 取页、预取、缩放、换话逻辑与 3.3.0 完全一致。
 */
@Composable
fun ComicReaderScreen(
    model: ComicModel,
    onBack: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val vm = model.session
    val comic by vm.comic.collectAsState()
    val settings by vm.settingsState.collectAsState()
    val scheme = CupertinoTheme.colorScheme

    val book = comic.book
    val vertical = comic.direction != SettingsStore.COMIC_HORIZONTAL
    val needConnect = comic.error == CLOUD_NEED_CONNECT

    Box(Modifier.fillMaxSize().background(BrandInk)) {
        when {
            comic.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CupertinoActivityIndicator(size = 26.dp, color = Color.White)
            }

            comic.error != null && !needConnect && comic.total == 0 -> Column(
                modifier = Modifier.fillMaxSize().padding(32.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                CupertinoText(
                    text = "打不开这一话",
                    fontSize = 18.sp,
                    color = Color.White.copy(alpha = 0.9f),
                )
                Spacer(Modifier.height(8.dp))
                CupertinoText(
                    text = comic.error.orEmpty(),
                    fontSize = 13.sp,
                    color = Color.White.copy(alpha = 0.6f),
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(16.dp))
                CupertinoButton(
                    onClick = { vm.reloadComic() },
                    colors = CupertinoButtonDefaults.filledButtonColors(),
                ) {
                    CupertinoText(text = "重试", fontSize = 14.sp)
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
                        VerticalPages(vm = vm, comic = comic, book = book)
                    }
                } else {
                    key(comic.chapterNo) {
                        HorizontalPages(vm = vm, comic = comic, book = book)
                    }
                }
            }
        }

        // 顶栏
        AnimatedVisibility(
            visible = comic.controls,
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
                    DarkIconButton(CupertinoIcons.Outlined.ChevronBackward, "返回", onBack)
                    Column(Modifier.weight(1f).padding(horizontal = 4.dp)) {
                        CupertinoText(
                            text = book?.title.orEmpty(),
                            fontSize = 13.5.sp,
                            color = Color.White.copy(alpha = 0.92f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        CupertinoText(
                            text = "第 ${if (comic.chapterNo > 0) comic.chapterNo else comic.chapterIndex + 1} 话 · " +
                                "第 ${comic.page + 1}/${comic.total} 页",
                            fontSize = 10.5.sp,
                            color = Color.White.copy(alpha = 0.52f),
                            maxLines = 1,
                        )
                    }
                    DarkIconButton(CupertinoIcons.Outlined.ListBullet, "选择话", { vm.toggleComicToc() })
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
                CupertinoText(
                    text = comic.error.orEmpty(),
                    fontSize = 12.sp,
                    color = Color.White.copy(alpha = 0.8f),
                    modifier = Modifier.weight(1f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                CupertinoText(
                    text = "重试",
                    fontSize = 12.sp,
                    color = scheme.accent,
                    modifier = Modifier
                        .clickable { vm.reloadComic() }
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }
        }

        // 底栏
        AnimatedVisibility(
            visible = comic.controls && comic.total > 0,
            enter = fadeIn(tween(FolioMotion.Instant)) +
                slideInVertically(tween(FolioMotion.Normal, easing = FolioMotion.Easing)) { it / 12 },
            exit = fadeOut(tween(FolioMotion.Instant)) +
                slideOutVertically(tween(FolioMotion.Normal, easing = FolioMotion.Easing)) { it / 12 },
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
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(2.dp)
                        .background(Color.White.copy(alpha = 0.18f)),
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth(comic.chapterProgress.coerceIn(0f, 1f))
                            .height(2.dp)
                            .background(scheme.accent)
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    DarkTextAction("上一话", comic.hasPrevChapter) { vm.prevComicChapter() }
                    Spacer(Modifier.weight(1f))
                    CupertinoText(
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
                        CupertinoText(text = "目录", modifier = Modifier.weight(1f), fontSize = 13.sp, color = Color.White.copy(alpha = 0.9f))
                        CupertinoText(
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
        val scheme2 = CupertinoTheme.colorScheme
        FolioSheet(onDismiss = onBack) {
            Column(Modifier.padding(horizontal = 20.dp)) {
                Spacer(Modifier.height(4.dp))
                CupertinoText(text = "需要连接桌面端", fontSize = 19.sp, color = scheme2.label)
                Spacer(Modifier.height(8.dp))
                CupertinoText(
                    text = CLOUD_NEED_CONNECT + "。",
                    fontSize = 13.sp,
                    color = scheme2.secondaryLabel,
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

@Composable
private fun ComicTocSheet(
    chapters: List<TocChapter>,
    currentIndex: Int,
    onSelect: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    val scheme = CupertinoTheme.colorScheme
    val listState = rememberLazyListState()
    LaunchedEffect(currentIndex) {
        if (currentIndex in chapters.indices) listState.scrollToItem(currentIndex)
    }

    FolioSheet(
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
                        .background(
                            if (selected) scheme.accent.copy(alpha = 0.12f)
                            else scheme.secondarySystemGroupedBackground
                        )
                        .clickable { onSelect(index) }
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CupertinoText(
                        text = (index + 1).toString().padStart(3, '0'),
                        fontSize = 11.sp,
                        color = if (selected) scheme.accent else scheme.secondaryLabel,
                    )
                    Spacer(Modifier.width(12.dp))
                    CupertinoText(
                        text = chapter.title.ifBlank { "第 ${chapter.index} 话" },
                        modifier = Modifier.weight(1f),
                        fontSize = 15.sp,
                        color = if (selected) scheme.accent else scheme.label,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (selected) {
                        CupertinoText(text = "读到这里", fontSize = 11.sp, color = scheme.accent)
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
        CupertinoIcon(
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
        CupertinoText(
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
    vm: SessionStore,
    comic: ComicUiState,
    book: Book,
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
    vm: SessionStore,
    comic: ComicUiState,
    book: Book,
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
    modifier: Modifier,
) {
    val context = LocalContext.current
    var error by remember(book.id, chapterNo, page) { mutableStateOf<String?>(null) }
    var reload by remember(book.id, chapterNo, page) { mutableIntStateOf(0) }
    val zoomState = rememberZoomableImageState()

    // 请求交给 Coil：采样、并发、去重、内存上限都在 ImageLoader 里。
    val request = remember(book.id, chapterNo, page, reload) {
        ImageRequest.Builder(context)
            .data(ComicPage.of(book.id, chapterNo, page))
            .listener(
                onSuccess = { _, _ -> error = null },
                onError = { _, result ->
                    error = result.throwable.message?.takeIf { it.isNotBlank() } ?: "这一页没取到"
                },
            )
            .build()
    }

    Box(
        modifier = modifier.background(Color(0xFF1F1E1C)),
        contentAlignment = Alignment.Center,
    ) {
        if (error != null) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .clip(RoundedCornerShape(16.dp))
                    .background(Color.White.copy(alpha = 0.05f))
                    .padding(20.dp),
            ) {
                CupertinoText(
                    text = error.orEmpty(),
                    fontSize = 12.5.sp,
                    color = Color.White.copy(alpha = 0.8f),
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(10.dp))
                CupertinoText(
                    text = "重试",
                    fontSize = 12.5.sp,
                    color = Color.White.copy(alpha = 0.85f),
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color.White.copy(alpha = 0.10f))
                        .clickable {
                            error = null
                            reload += 1
                        }
                        .padding(horizontal = 14.dp, vertical = 6.dp),
                )
            }
        } else {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                CupertinoActivityIndicator(size = 28.dp, color = Color.White)
                Spacer(Modifier.height(8.dp))
                CupertinoText(
                    text = "第 ${page + 1}/$total 页",
                    fontSize = 11.sp,
                    color = Color.White.copy(alpha = 0.45f),
                )
            }
            // 图片画上来就盖住上面的加载提示；缩放 / 双击放大由 Telephoto 负责。
            ZoomableAsyncImage(
                model = request,
                contentDescription = null,
                state = zoomState,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

/** 占位页的宽高比：0.7 ≈ 常见漫画单页，避免加载时列表高度跳变。 */
private const val PAGE_ASPECT_RATIO = 0.7f
