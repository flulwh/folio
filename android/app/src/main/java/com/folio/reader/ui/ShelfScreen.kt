package com.folio.reader.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.folio.reader.core.Book
import com.folio.reader.core.Origin
import com.folio.reader.data.ConnectionState
import com.folio.reader.ui.miuix.FolioMotion
import com.folio.reader.ui.miuix.Hairline
import com.folio.reader.ui.miuix.HyperSheet
import com.folio.reader.ui.miuix.PageMargin
import com.folio.reader.ui.miuix.Reveal
import com.folio.reader.ui.miuix.pressScale
import java.util.Locale
import kotlin.math.absoluteValue
import top.yukonga.miuix.kmp.basic.Button
import top.yukonga.miuix.kmp.basic.CircularProgressIndicator
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.LinearProgressIndicator
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.basic.TextField
import top.yukonga.miuix.kmp.basic.Text as MiuixText
import top.yukonga.miuix.kmp.theme.MiuixTheme

/**
 * 书架。
 *
 * 结构只有三层：
 * 1. 顶栏：字号最大的书名级标题 + 一条工具胶囊（搜索 / 导入 / 同步 / 设置）；
 * 2. 筛选：横向胶囊，选中给朱砂底，不做下划线那套「表格感」；
 * 3. 内容：最近在读的一本放大成一张「继续阅读」卡片，其余书按封面墙三列排开。
 *
 * 封面是书架的主角：占满整格、带投影与纸色占位；书名两行、进度一条细轨。
 * 长按封面（或点右上角 ⋯）出菜单，行为与旧列表版完全一致。
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ShelfScreen(
    vm: AppViewModel,
    onOpenBook: (Book) -> Unit,
    onOpenSettings: () -> Unit,
    onOpenSyncStatus: () -> Unit,
) {
    val state by vm.shelf.collectAsState()
    val covers by vm.covers.collectAsState()
    val gridState = rememberLazyGridState()
    val scheme = MiuixTheme.colorScheme

    var searchOpen by remember { mutableStateOf(false) }
    var menuFor by remember { mutableStateOf<String?>(null) }
    var pendingDelete by remember { mutableStateOf<Book?>(null) }
    var pendingRemove by remember { mutableStateOf<Book?>(null) }
    var message by remember { mutableStateOf<String?>(null) }

    val importLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris -> vm.importDocuments(uris) }

    LaunchedEffect(state.message) {
        val text = state.message ?: return@LaunchedEffect
        message = text
        vm.dismissMessage()
    }

    // 分区要过滤 + 去重 + 排序（O(n log n)）。搜索框开关、长按菜单这些局部状态
    // 变化不该带动整份书架重算，按真正影响结果的输入做记忆。
    val sections = remember(
        state.books,
        state.progress,
        state.filter,
        state.query,
        state.hideRemoteWhenOffline,
        state.online,
    ) { state.sections }

    // 封面墙里翻到新导入的书：先按「分区标题 + 每本一格」换算成网格下标。
    LaunchedEffect(state.highlightId, sections) {
        val id = state.highlightId ?: return@LaunchedEffect
        var index = if (sections.any { it.key == "continue" }) 1 else 0
        var target = -1
        for (section in sections) {
            if (section.key == "continue") continue
            index += 1 // 分区标题占一格
            val offset = section.books.indexOfFirst { it.id == id }
            if (offset >= 0) {
                target = index + offset
                break
            }
            index += section.books.size
        }
        if (target >= 0) gridState.animateScrollToItem(target)
        vm.clearHighlight()
    }

    val importAction = { importLauncher.launch(IMPORT_MIME_TYPES) }

    Box(Modifier.fillMaxSize().background(scheme.background)) {
        Column(Modifier.fillMaxSize()) {
            ShelfHeader(
                state = state,
                searchOpen = searchOpen,
                onToggleSearch = { searchOpen = !searchOpen },
                onQuery = vm::setQuery,
                onImport = importAction,
                onSync = { vm.syncNow() },
                onOpenSettings = onOpenSettings,
                onOpenSyncStatus = onOpenSyncStatus,
            )

            AnimatedVisibility(
                visible = state.showBanner,
                enter = fadeIn(tween(FolioMotion.Normal)) + expandVertically(tween(FolioMotion.Normal)),
                exit = fadeOut(tween(FolioMotion.Instant)) + shrinkVertically(tween(FolioMotion.Normal)),
            ) {
                OfflineBanner(onConnect = onOpenSettings, onDismiss = vm::dismissBanner)
            }

            FilterChips(selected = state.filter, onSelect = vm::setFilter)

            if (state.importing) {
                ImportStrip(label = state.importLabel.ifBlank { "正在导入…" })
            }

            Box(Modifier.weight(1f)) {
                if (sections.isEmpty()) {
                    EmptyShelf(
                        hasBooks = state.books.isNotEmpty(),
                        onImport = importAction,
                        onConnect = onOpenSettings,
                    )
                } else {
                    LazyVerticalGrid(
                        columns = GridCells.Adaptive(88.dp),
                        state = gridState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            start = PageMargin,
                            end = PageMargin,
                            top = 6.dp,
                            bottom = 40.dp,
                        ),
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                        verticalArrangement = Arrangement.spacedBy(18.dp),
                    ) {
                        sections.forEach { section ->
                            if (section.key == "continue") {
                                item(
                                    key = "continue-hero",
                                    span = { GridItemSpan(maxLineSpan) },
                                ) {
                                    val featured = section.books.first()
                                    LaunchedEffect(featured.id) { vm.loadCover(featured) }
                                    ContinueCard(
                                        book = featured,
                                        state = state,
                                        cover = covers[featured.id],
                                        onOpen = { onOpenBook(featured) },
                                    )
                                }
                            } else {
                                item(
                                    key = "header-${section.key}",
                                    span = { GridItemSpan(maxLineSpan) },
                                ) {
                                    SectionLabel(
                                        title = section.title.substringBefore("（"),
                                        count = section.books.size,
                                    )
                                }
                                itemsIndexed(
                                    items = section.books,
                                    key = { _, book -> "book-${section.key}-${book.id}" },
                                ) { index, book ->
                                    val rowKey = "${section.key}-${book.id}"
                                    LaunchedEffect(section.key, book.id) { vm.loadCover(book) }
                                    Reveal(index = index) {
                                        BookCell(
                                            book = book,
                                            state = state,
                                            cover = covers[book.id],
                                            highlighted = state.highlightId == book.id,
                                            menuOpen = menuFor == rowKey,
                                            onToggleMenu = {
                                                menuFor = if (menuFor == rowKey) null else rowKey
                                            },
                                            onOpen = {
                                                menuFor = null
                                                onOpenBook(book)
                                            },
                                            onDownload = {
                                                menuFor = null
                                                vm.downloadOffline(book)
                                            },
                                            onDeleteLocal = {
                                                menuFor = null
                                                pendingDelete = book
                                            },
                                            onRemoveFromShelf = {
                                                menuFor = null
                                                pendingRemove = book
                                            },
                                            onSyncStatus = {
                                                menuFor = null
                                                onOpenSyncStatus()
                                            },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        message?.let { text ->
            Snack(text = text, onDismiss = { message = null })
        }
    }

    pendingDelete?.let { book ->
        ConfirmSheet(
            title = "删除本机副本？",
            summary = "只会删掉手机上的《${book.title}》，桌面端那份不受影响。",
            confirmText = "删除",
            onCancel = { pendingDelete = null },
            onConfirm = {
                pendingDelete = null
                vm.deleteLocalCopy(book)
            },
        )
    }

    pendingRemove?.let { book ->
        ConfirmSheet(
            title = "从手机书架移除？",
            summary = "《${book.title}》会从手机书架消失，桌面端那份不受影响；下次同步会重新出现。",
            confirmText = "移除",
            onCancel = { pendingRemove = null },
            onConfirm = {
                pendingRemove = null
                vm.removeFromShelf(book)
            },
        )
    }
}

/* ---------------- 顶栏 ---------------- */

@Composable
private fun ShelfHeader(
    state: ShelfUiState,
    searchOpen: Boolean,
    onToggleSearch: () -> Unit,
    onQuery: (String) -> Unit,
    onImport: () -> Unit,
    onSync: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenSyncStatus: () -> Unit,
) {
    val scheme = MiuixTheme.colorScheme
    Column(
        Modifier
            .fillMaxWidth()
            .background(scheme.background)
            .statusBarsPadding(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = PageMargin, end = PageMargin, top = 16.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = "书架",
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = (-0.6).sp,
                    color = scheme.onSurface,
                    maxLines = 1,
                )
                Spacer(Modifier.height(5.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable(onClick = onOpenSyncStatus)
                        .padding(vertical = 2.dp),
                ) {
                    Box(
                        Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(if (state.online) BrandGreen else scheme.primary)
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = "${state.books.size} 本 · ${mbOf(state.localBytes)} MB · " +
                            connectionTextOf(state),
                        fontSize = 11.sp,
                        letterSpacing = 0.3.sp,
                        color = scheme.onSurfaceVariantSummary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            ToolbarPill(
                syncing = state.syncing,
                searchActive = searchOpen || state.query.isNotEmpty(),
                onSearch = onToggleSearch,
                onImport = onImport,
                onSync = onSync,
                onSettings = onOpenSettings,
            )
        }

        AnimatedVisibility(
            visible = searchOpen,
            enter = fadeIn(tween(FolioMotion.Normal)) + expandVertically(tween(FolioMotion.Normal)),
            exit = fadeOut(tween(FolioMotion.Instant)) + shrinkVertically(tween(FolioMotion.Normal)),
        ) {
            Column(Modifier.padding(horizontal = PageMargin, vertical = 4.dp)) {
                TextField(
                    value = state.query,
                    onValueChange = onQuery,
                    modifier = Modifier.fillMaxWidth(),
                    label = "搜书名或作者",
                    useLabelAsPlaceholder = true,
                    singleLine = true,
                    cornerRadius = 12.dp,
                    trailingIcon = if (state.query.isNotEmpty()) {
                        {
                            MiuixText(
                                text = "清除",
                                fontSize = 12.sp,
                                color = scheme.primary,
                                modifier = Modifier
                                    .clickable { onQuery("") }
                                    .padding(horizontal = 6.dp, vertical = 4.dp),
                            )
                        }
                    } else {
                        null
                    },
                )
            }
        }
        Spacer(Modifier.height(6.dp))
    }
}

/** 顶栏右侧的四格工具胶囊：搜索 / 导入 / 同步 / 设置。 */
@Composable
private fun ToolbarPill(
    syncing: Boolean,
    searchActive: Boolean,
    onSearch: () -> Unit,
    onImport: () -> Unit,
    onSync: () -> Unit,
    onSettings: () -> Unit,
) {
    val scheme = MiuixTheme.colorScheme
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(scheme.secondary)
            .padding(2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PillIcon(Icons.Default.Search, "搜索", onSearch, active = searchActive)
        PillIcon(Icons.Default.Add, "导入 TXT", onImport)
        if (syncing) {
            Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(size = 15.dp, strokeWidth = 2.dp)
            }
        } else {
            PillIcon(Icons.Default.Refresh, "同步", onSync)
        }
        PillIcon(Icons.Default.Settings, "设置", onSettings)
    }
}

@Composable
private fun PillIcon(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    onClick: () -> Unit,
    active: Boolean = false,
) {
    val scheme = MiuixTheme.colorScheme
    val source = remember { MutableInteractionSource() }
    Box(
        modifier = Modifier
            .pressScale(source, pressedScale = 0.92f)
            .size(36.dp)
            .clip(CircleShape)
            .clickable(
                interactionSource = source,
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = description,
            modifier = Modifier.size(18.dp),
            tint = if (active) scheme.primary else scheme.onSurface,
        )
    }
}

private fun connectionTextOf(state: ShelfUiState): String = when {
    state.syncing -> "同步中…"
    state.online -> state.connectionLabel
    state.connection == ConnectionState.NEED_RECONNECT -> ConnectionState.NEED_RECONNECT.label
    state.connection == ConnectionState.UNKNOWN -> "未连接桌面端"
    else -> state.connectionLabel
}

private fun mbOf(bytes: Long): String =
    String.format(Locale.US, "%.1f", bytes / 1048576.0)

/* ---------------- 未连接横幅 ---------------- */

@Composable
private fun OfflineBanner(onConnect: () -> Unit, onDismiss: () -> Unit) {
    val scheme = MiuixTheme.colorScheme
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = PageMargin, vertical = 6.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(scheme.primaryContainer)
            .padding(start = 14.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = "未连接桌面端",
                fontSize = 12.5.sp,
                fontWeight = FontWeight.Medium,
                color = scheme.primary,
                maxLines = 1,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = "同步与下载暂停；本机书照常可读。",
                fontSize = 11.sp,
                color = scheme.onSurfaceVariantSummary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        MiuixText(
            text = "去连接",
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            color = scheme.primary,
            modifier = Modifier
                .clickable(onClick = onConnect)
                .padding(horizontal = 10.dp, vertical = 6.dp),
        )
        Box(
            Modifier
                .size(28.dp)
                .clip(CircleShape)
                .clickable(onClick = onDismiss),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Default.Close,
                "不再提示",
                Modifier.size(13.dp),
                tint = scheme.onSurfaceVariantSummary,
            )
        }
    }
}

/* ---------------- 筛选 ---------------- */

@Composable
private fun FilterChips(selected: String, onSelect: (String) -> Unit) {
    val scheme = MiuixTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = PageMargin, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ShelfUiState.FILTERS.forEach { (key, label) ->
            val active = selected == key
            val bg by animateColorAsState(
                targetValue = if (active) scheme.primary else scheme.secondary,
                animationSpec = tween(FolioMotion.Instant, easing = FolioMotion.Easing),
                label = "chip-bg",
            )
            val fg by animateColorAsState(
                targetValue = if (active) scheme.onPrimary else scheme.onSurfaceVariantSummary,
                animationSpec = tween(FolioMotion.Instant, easing = FolioMotion.Easing),
                label = "chip-fg",
            )
            Box(
                modifier = Modifier
                    .height(32.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(bg)
                    .clickable { onSelect(key) }
                    .padding(horizontal = 14.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = label,
                    fontSize = 12.5.sp,
                    fontWeight = if (active) FontWeight.Medium else FontWeight.Normal,
                    color = fg,
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
private fun ImportStrip(label: String) {
    val scheme = MiuixTheme.colorScheme
    Column(Modifier.fillMaxWidth().padding(horizontal = PageMargin, vertical = 4.dp)) {
        Text(
            text = label,
            fontSize = 11.sp,
            color = scheme.primary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(6.dp))
        LinearProgressIndicator(
            progress = null,
            modifier = Modifier.fillMaxWidth().height(2.dp),
        )
    }
}

/* ---------------- 分区标题 ---------------- */

@Composable
private fun SectionLabel(title: String, count: Int) {
    val scheme = MiuixTheme.colorScheme
    Column(Modifier.fillMaxWidth().padding(top = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = title,
                modifier = Modifier.weight(1f),
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                letterSpacing = 0.3.sp,
                color = scheme.onSurface,
                maxLines = 1,
            )
            Text(
                text = "$count 本",
                fontSize = 10.5.sp,
                letterSpacing = 0.6.sp,
                color = scheme.onSurfaceVariantSummary,
                maxLines = 1,
            )
        }
        Spacer(Modifier.height(10.dp))
        Hairline()
    }
}

/* ---------------- 空状态 ---------------- */

@Composable
private fun EmptyShelf(hasBooks: Boolean, onImport: () -> Unit, onConnect: () -> Unit) {
    val scheme = MiuixTheme.colorScheme
    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 32.dp)
            .padding(bottom = 60.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .size(96.dp)
                .clip(CircleShape)
                .background(scheme.secondary),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.AutoMirrored.Filled.MenuBook,
                null,
                Modifier.size(38.dp),
                tint = scheme.onSurfaceVariantSummary,
            )
        }
        Spacer(Modifier.height(22.dp))
        Text(
            text = if (hasBooks) "没有符合条件的书" else "书架是空的",
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
            color = scheme.onSurface,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = if (hasBooks) {
                "换个筛选条件，或清掉搜索词再看看。"
            } else {
                "从手机里导入 TXT，或连接桌面端把书架搬过来。"
            },
            fontSize = 12.5.sp,
            color = scheme.onSurfaceVariantSummary,
        )
        Spacer(Modifier.height(26.dp))
        Button(
            onClick = onImport,
            modifier = Modifier.width(200.dp),
            cornerRadius = 22.dp,
            minHeight = 44.dp,
        ) {
            MiuixText(text = "从文件导入 TXT", fontSize = 14.sp, color = scheme.onPrimary)
        }
        Spacer(Modifier.height(6.dp))
        TextButton(text = "连接桌面端", onClick = onConnect, modifier = Modifier.width(200.dp))
    }
}

/* ---------------- 继续阅读 ---------------- */

@Composable
private fun ContinueCard(
    book: Book,
    state: ShelfUiState,
    cover: ImageBitmap?,
    onOpen: () -> Unit,
) {
    val scheme = MiuixTheme.colorScheme
    val summary = state.progressSummaryOf(book)
    val percent = state.progressPercentOf(book)
    val source = remember { MutableInteractionSource() }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 6.dp)
            .pressScale(source, pressedScale = 0.985f)
            .clip(RoundedCornerShape(20.dp))
            .background(scheme.surface)
            .border(0.5.dp, scheme.dividerLine, RoundedCornerShape(20.dp))
            .clickable(
                interactionSource = source,
                indication = null,
                onClick = onOpen,
            )
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CoverArt(
            book = book,
            cover = cover,
            dimmed = false,
            modifier = Modifier.width(62.dp).aspectRatio(0.68f),
            radius = 8.dp,
            initialSize = 24.sp,
        )
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .size(5.dp)
                        .clip(CircleShape)
                        .background(scheme.primary)
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = "继续阅读",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Medium,
                    letterSpacing = 1.4.sp,
                    color = scheme.primary,
                    maxLines = 1,
                )
            }
            Spacer(Modifier.height(6.dp))
            Text(
                text = book.title,
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                lineHeight = 22.sp,
                color = scheme.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = buildString {
                    val chapter = summary.chapterText
                    if (chapter.isNotBlank()) {
                        append(chapter)
                    } else {
                        append(state.sourceLabelOf(book))
                        book.author?.takeIf { it.isNotBlank() }?.let { append(" · ").append(it) }
                    }
                },
                fontSize = 11.sp,
                color = scheme.onSurfaceVariantSummary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                ProgressRail(
                    progress = (percent / 100.0).toFloat(),
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(10.dp))
                MiuixText(
                    text = summary.percentText.ifBlank { "已开始" },
                    fontSize = 10.5.sp,
                    color = scheme.primary,
                    maxLines = 1,
                )
            }
        }
        Spacer(Modifier.width(12.dp))
        Box(
            Modifier
                .size(38.dp)
                .clip(CircleShape)
                .background(scheme.primary),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowForward,
                "继续阅读",
                Modifier.size(17.dp),
                tint = scheme.onPrimary,
            )
        }
    }
}

/* ---------------- 单本书（封面墙一格） ---------------- */

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun BookCell(
    book: Book,
    state: ShelfUiState,
    cover: ImageBitmap?,
    highlighted: Boolean,
    menuOpen: Boolean,
    onToggleMenu: () -> Unit,
    onOpen: () -> Unit,
    onDownload: () -> Unit,
    onDeleteLocal: () -> Unit,
    onRemoveFromShelf: () -> Unit,
    onSyncStatus: () -> Unit,
) {
    val scheme = MiuixTheme.colorScheme
    val badge = state.badgeOf(book)
    val percent = state.progressPercentOf(book)
    val summary = state.progressSummaryOf(book)
    val readable = state.readable(book)
    val dimmed = !readable

    Column(
        Modifier
            .fillMaxWidth()
            .combinedClickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onOpen,
                onLongClick = onToggleMenu,
            ),
    ) {
        Box {
            CoverArt(
                book = book,
                cover = cover,
                dimmed = dimmed,
                modifier = Modifier.fillMaxWidth().aspectRatio(0.68f),
            )
            if (badge != BookBadge.NONE) {
                Row(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(6.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(scheme.surface.copy(alpha = 0.92f))
                        .padding(horizontal = 5.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .size(4.dp)
                            .clip(CircleShape)
                            .background(badgeColor(badge))
                    )
                    Spacer(Modifier.width(4.dp))
                    Text(
                        text = badgeLabel(badge, state.transferPercent(book)),
                        fontSize = 9.sp,
                        color = badgeColor(badge),
                        maxLines = 1,
                    )
                }
            }
            if (summary.read) {
                Text(
                    text = summary.percentText,
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(6.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color.Black.copy(alpha = 0.46f))
                        .padding(horizontal = 5.dp, vertical = 2.dp),
                    fontSize = 9.sp,
                    color = Color.White,
                    maxLines = 1,
                )
            }
            // ⋯：封面右上角常驻，点一下就是旧版列表里的那套菜单。
            Box(Modifier.align(Alignment.TopEnd).padding(4.dp)) {
                Box(
                    Modifier
                        .size(24.dp)
                        .clip(CircleShape)
                        .background(scheme.surface.copy(alpha = 0.82f))
                        .clickable(onClick = onToggleMenu),
                    contentAlignment = Alignment.Center,
                ) {
                    MiuixText(
                        text = "⋯",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = scheme.onSurfaceVariantSummary,
                    )
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = onToggleMenu) {
                    if (!book.isCloud && !book.hasLocalFile) {
                        DropdownMenuItem(text = { Text("下载到手机") }, onClick = onDownload)
                    }
                    if (book.hasLocalFile) {
                        DropdownMenuItem(text = { Text("删除本机副本") }, onClick = onDeleteLocal)
                    }
                    if (book.origin == Origin.DESKTOP) {
                        DropdownMenuItem(text = { Text("从手机书架移除") }, onClick = onRemoveFromShelf)
                    }
                    DropdownMenuItem(text = { Text("查看同步状态") }, onClick = onSyncStatus)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(
            text = book.title,
            fontSize = 13.sp,
            lineHeight = 17.sp,
            fontWeight = FontWeight.Medium,
            color = when {
                highlighted -> scheme.primary
                dimmed -> scheme.disabledOnSurface
                else -> scheme.onSurface
            },
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(5.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            ProgressRail(
                progress = (percent / 100.0).toFloat(),
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            MiuixText(
                text = when {
                    summary.read -> summary.percentText
                    !readable -> "未下载"
                    else -> "未读"
                },
                fontSize = 9.5.sp,
                color = scheme.onSurfaceVariantSummary,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun ProgressRail(progress: Float, modifier: Modifier = Modifier) {
    val scheme = MiuixTheme.colorScheme
    val filled by animateFloatAsState(
        targetValue = progress.coerceIn(0f, 1f),
        animationSpec = tween(FolioMotion.Normal, easing = FolioMotion.Easing),
        label = "rail-progress",
    )
    Box(
        modifier
            .fillMaxWidth()
            .height(2.dp)
            .clip(CircleShape)
            .background(scheme.dividerLine),
    ) {
        Box(
            Modifier
                .fillMaxWidth(filled)
                .fillMaxHeight()
                .clip(CircleShape)
                .background(scheme.primary)
        )
    }
}

private fun badgeLabel(badge: BookBadge, percent: Int): String =
    if (badge == BookBadge.TRANSFERRING && percent in 1..99) {
        "传输中 $percent%"
    } else {
        badge.label
    }

@Composable
private fun badgeColor(badge: BookBadge): Color {
    val scheme = MiuixTheme.colorScheme
    return when (badge) {
        BookBadge.MISMATCH, BookBadge.FAILED -> scheme.primary
        BookBadge.NOT_SYNCED, BookBadge.TRANSFERRING -> BrandBlue
        BookBadge.NEED_CONNECT, BookBadge.LOCAL_ONLY -> scheme.onSurfaceVariantSummary
        BookBadge.NONE -> scheme.onSurfaceVariantSummary
    }
}

/**
 * 封面。
 *
 * 有图就铺满；没图用书名哈希出一组低饱和纸色做竖向渐变，左侧一道书脊，
 * 中间放书名首字——空封面也像一本真书，而不是一块灰方块。
 */
@Composable
private fun CoverArt(
    book: Book,
    cover: ImageBitmap?,
    dimmed: Boolean,
    modifier: Modifier = Modifier,
    radius: Dp = 10.dp,
    initialSize: TextUnit = 22.sp,
) {
    val hue = (book.title.hashCode().absoluteValue % 360).toFloat()
    val paperTop = Color.hsl(hue, 0.18f, 0.87f)
    val paperBottom = Color.hsl(hue, 0.24f, 0.74f)
    val inkTone = Color.hsl(hue, 0.34f, 0.24f)
    val shape = RoundedCornerShape(radius)
    Box(
        modifier
            .shadow(elevation = if (dimmed) 0.dp else 7.dp, shape = shape, clip = false)
            .clip(shape)
            .background(Brush.verticalGradient(listOf(paperTop, paperBottom)))
            .border(0.5.dp, Color.Black.copy(alpha = 0.06f), shape)
            .alpha(if (dimmed) 0.55f else 1f),
    ) {
        if (cover != null) {
            Image(
                bitmap = cover,
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
        } else {
            Box(
                Modifier
                    .fillMaxHeight()
                    .width(4.dp)
                    .background(inkTone.copy(alpha = 0.12f))
            )
            Text(
                text = book.title.take(1).ifBlank { "书" },
                modifier = Modifier.align(Alignment.Center),
                fontSize = initialSize,
                fontWeight = FontWeight.SemiBold,
                color = inkTone.copy(alpha = 0.78f),
            )
        }
    }
}

/* ---------------- 提示 / 确认 ---------------- */

@Composable
private fun Snack(text: String, onDismiss: () -> Unit) {
    LaunchedEffect(text) {
        kotlinx.coroutines.delay(2600)
        onDismiss()
    }
    val scheme = MiuixTheme.colorScheme
    Box(
        Modifier
            .fillMaxSize()
            .navigationBarsPadding(),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Reveal {
            MiuixText(
                text = text,
                modifier = Modifier
                    .padding(bottom = 26.dp, start = 24.dp, end = 24.dp)
                    .shadow(10.dp, RoundedCornerShape(14.dp))
                    .clip(RoundedCornerShape(14.dp))
                    .background(scheme.onSurface.copy(alpha = 0.94f))
                    .padding(horizontal = 16.dp, vertical = 11.dp),
                fontSize = 12.5.sp,
                color = scheme.surface,
            )
        }
    }
}

@Composable
private fun ConfirmSheet(
    title: String,
    summary: String,
    confirmText: String,
    onCancel: () -> Unit,
    onConfirm: () -> Unit,
) {
    val scheme = MiuixTheme.colorScheme
    HyperSheet(onDismiss = onCancel) {
        Column(Modifier.padding(horizontal = 20.dp)) {
            Spacer(Modifier.height(6.dp))
            Text(text = title, fontSize = 19.sp, fontWeight = FontWeight.Medium, color = scheme.onSurface)
            Spacer(Modifier.height(8.dp))
            Text(text = summary, fontSize = 13.sp, color = scheme.onSurfaceVariantSummary)
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TextButton(text = "取消", onClick = onCancel, modifier = Modifier.weight(1f))
                Button(onClick = onConfirm, modifier = Modifier.weight(1f), cornerRadius = 10.dp) {
                    MiuixText(text = confirmText, fontSize = 14.sp, color = scheme.onPrimary)
                }
            }
        }
    }
}

/** SAF 允许的类型：纯文本为主，兜底给一个二进制流。 */
private val IMPORT_MIME_TYPES = arrayOf("text/plain", "text/*", "application/octet-stream")
