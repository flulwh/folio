package com.folio.reader.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
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
import androidx.compose.foundation.layout.offset
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
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
 * 没有卡片：顶栏只留一行标题和三个图标，筛选是带下划线的文字标签，
 * 书按「封面 + 一行文字 + 一条细进度」开架排下来，靠发丝线分区。
 * 阅读中的书在第一段放大封面，直接给「继续」。
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
    val listState = rememberLazyListState()
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

    LaunchedEffect(state.highlightId) {
        val id = state.highlightId ?: return@LaunchedEffect
        val sections = state.sections
        var index = 0
        var target = -1
        for (section in sections) {
            index += 1
            val offset = section.books.indexOfFirst { it.id == id }
            if (offset >= 0) {
                target = index + offset
                break
            }
            index += section.books.size
        }
        if (target >= 0) listState.animateScrollToItem(target)
        vm.clearHighlight()
    }

    val sections = state.sections
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

            FilterTabs(selected = state.filter, onSelect = vm::setFilter)

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
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(bottom = 28.dp),
                    ) {
                        sections.forEach { section ->
                            stickyHeader(key = "header-${section.key}") {
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
                                    BookRow(
                                        book = book,
                                        state = state,
                                        cover = covers[book.id],
                                        featured = section.key == "continue",
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
            .statusBarsPadding()
            .padding(horizontal = PageMargin - 10.dp)
            .padding(top = 4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "书架",
                modifier = Modifier.weight(1f).padding(start = 10.dp),
                fontSize = 24.sp,
                fontWeight = FontWeight.SemiBold,
                color = scheme.onSurface,
                maxLines = 1,
            )
            RoundIconButton(
                icon = Icons.Default.Search,
                description = "搜索",
                active = state.query.isNotEmpty() || searchOpen,
                onClick = onToggleSearch,
            )
            RoundIconButton(
                icon = Icons.Default.Add,
                description = "导入 TXT",
                onClick = onImport,
            )
            if (state.syncing) {
                Box(Modifier.size(38.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(size = 16.dp, strokeWidth = 2.dp)
                }
            } else {
                RoundIconButton(icon = Icons.Default.Refresh, description = "同步", onClick = onSync)
            }
            RoundIconButton(
                icon = Icons.Default.Settings,
                description = "设置",
                onClick = onOpenSettings,
            )
        }

        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = 10.dp, end = 4.dp)
                .clickable(onClick = onOpenSyncStatus)
                .padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MiuixText(
                text = buildString {
                    append("${state.books.size} 本")
                    append(" · ")
                    append(mbOf(state.localBytes))
                    append(" MB")
                    append(" · ")
                    append(connectionTextOf(state))
                },
                fontSize = 11.sp,
                color = scheme.onSurfaceVariantSummary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            MiuixText(
                text = "  ›",
                fontSize = 11.sp,
                color = scheme.onSurfaceVariantSummary,
                maxLines = 1,
            )
        }

        AnimatedVisibility(
            visible = searchOpen,
            enter = fadeIn(tween(FolioMotion.Normal)) + expandVertically(tween(FolioMotion.Normal)),
            exit = fadeOut(tween(FolioMotion.Instant)) + shrinkVertically(tween(FolioMotion.Normal)),
        ) {
            Column {
                Spacer(Modifier.height(4.dp))
                TextField(
                    value = state.query,
                    onValueChange = onQuery,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp),
                    label = "搜书名或作者",
                    useLabelAsPlaceholder = true,
                    singleLine = true,
                    cornerRadius = 10.dp,
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

@Composable
private fun RoundIconButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    onClick: () -> Unit,
    active: Boolean = false,
) {
    val scheme = MiuixTheme.colorScheme
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val pressBg by animateColorAsState(
        targetValue = if (pressed) scheme.secondary else Color.Transparent,
        animationSpec = tween(FolioMotion.Instant, easing = FolioMotion.Easing),
        label = "icon-press-bg",
    )
    Box(
        modifier = Modifier
            .pressScale(source)
            .size(38.dp)
            .clip(CircleShape)
            .background(pressBg)
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
            modifier = Modifier.size(19.dp),
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
            .background(scheme.primaryContainer),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(2.dp).height(38.dp).background(scheme.primary))
        Row(
            Modifier.weight(1f).padding(start = 18.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
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
}

/* ---------------- 筛选 ---------------- */

@Composable
private fun FilterTabs(selected: String, onSelect: (String) -> Unit) {
    val scheme = MiuixTheme.colorScheme
    val density = LocalDensity.current
    // 下划线位置由当前选中项自己量出来，切换时从旧位置滑过去
    var indicatorX by remember { mutableStateOf(0.dp) }
    var indicatorWidth by remember { mutableStateOf(0.dp) }
    val x by animateDpAsState(
        targetValue = indicatorX,
        animationSpec = tween(FolioMotion.Normal, easing = FolioMotion.Easing),
        label = "filter-x",
    )
    val width by animateDpAsState(
        targetValue = indicatorWidth,
        animationSpec = tween(FolioMotion.Normal, easing = FolioMotion.Easing),
        label = "filter-width",
    )
    Column(Modifier.fillMaxWidth().background(scheme.background)) {
        Box {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = PageMargin),
                horizontalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                ShelfUiState.FILTERS.forEach { (key, label) ->
                    val active = selected == key
                    val textColor by animateColorAsState(
                        targetValue = if (active) scheme.onSurface else scheme.onSurfaceVariantSummary,
                        animationSpec = tween(FolioMotion.Instant, easing = FolioMotion.Easing),
                        label = "filter-color",
                    )
                    Box(
                        modifier = Modifier
                            .then(
                                if (active) {
                                    Modifier.onGloballyPositioned { coords ->
                                        val newX = with(density) { coords.positionInParent().x.toDp() }
                                        val newWidth = with(density) { coords.size.width.toDp() }
                                        if (newX != indicatorX) indicatorX = newX
                                        if (newWidth != indicatorWidth) indicatorWidth = newWidth
                                    }
                                } else {
                                    Modifier
                                }
                            )
                            .clickable { onSelect(key) }
                            .padding(top = 7.dp),
                    ) {
                        Text(
                            text = label,
                            modifier = Modifier.padding(bottom = 7.dp),
                            fontSize = 13.sp,
                            fontWeight = if (active) FontWeight.Medium else FontWeight.Normal,
                            color = textColor,
                            maxLines = 1,
                        )
                    }
                }
            }
            Box(
                Modifier
                    .align(Alignment.BottomStart)
                    .offset(x = x)
                    .width(width)
                    .height(2.dp)
                    .background(scheme.primary)
            )
        }
        Hairline(inset = PageMargin)
    }
}

@Composable
private fun ImportStrip(label: String) {
    val scheme = MiuixTheme.colorScheme
    Column(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = PageMargin),
            fontSize = 11.sp,
            color = scheme.primary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(5.dp))
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
    Column(Modifier.fillMaxWidth().background(scheme.background)) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = PageMargin)
                .padding(top = 20.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MiuixText(
                text = title,
                modifier = Modifier.weight(1f),
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                color = scheme.onSurfaceVariantSummary,
            )
            MiuixText(
                text = count.toString(),
                fontSize = 10.sp,
                color = scheme.onSurfaceVariantSummary,
            )
        }
        Hairline(inset = PageMargin)
    }
}

/* ---------------- 空状态 ---------------- */

@Composable
private fun EmptyShelf(hasBooks: Boolean, onImport: () -> Unit, onConnect: () -> Unit) {
    val scheme = MiuixTheme.colorScheme
    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp)
            .padding(bottom = 60.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = if (hasBooks) "没有符合条件的书" else "书架是空的",
            fontSize = 19.sp,
            fontWeight = FontWeight.Medium,
            color = scheme.onSurface,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = if (hasBooks) {
                "换个筛选条件，或清掉搜索词再看看。"
            } else {
                "从手机里导入 TXT，或连接桌面端把书架搬过来。"
            },
            fontSize = 12.5.sp,
            color = scheme.onSurfaceVariantSummary,
        )
        Spacer(Modifier.height(22.dp))
        Button(onClick = onImport, modifier = Modifier.fillMaxWidth(), cornerRadius = 10.dp) {
            MiuixText(text = "从文件导入 TXT", fontSize = 14.sp, color = scheme.onPrimary)
        }
        Spacer(Modifier.height(4.dp))
        TextButton(text = "连接桌面端", onClick = onConnect, modifier = Modifier.fillMaxWidth())
    }
}

/* ---------------- 单本书 ---------------- */

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun BookRow(
    book: Book,
    state: ShelfUiState,
    cover: ImageBitmap?,
    featured: Boolean,
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
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val pressBg by animateColorAsState(
        targetValue = if (pressed) scheme.onSurface.copy(alpha = 0.045f) else Color.Transparent,
        animationSpec = tween(FolioMotion.Instant, easing = FolioMotion.Easing),
        label = "row-press",
    )

    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(pressBg)
                .combinedClickable(
                    interactionSource = source,
                    indication = null,
                    onClick = onOpen,
                    onLongClick = onToggleMenu,
                )
                .padding(horizontal = PageMargin)
                .padding(top = if (featured) 14.dp else 10.dp, bottom = if (featured) 14.dp else 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CoverBox(
                book = book,
                cover = cover,
                dimmed = dimmed,
                width = if (featured) 72.dp else 40.dp,
                height = if (featured) 96.dp else 54.dp,
            )
            Spacer(Modifier.width(if (featured) 14.dp else 12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = book.title,
                        modifier = Modifier.weight(1f, fill = false),
                        fontSize = if (featured) 16.sp else 14.5.sp,
                        fontWeight = if (featured) FontWeight.SemiBold else FontWeight.Medium,
                        maxLines = if (featured) 2 else 1,
                        overflow = TextOverflow.Ellipsis,
                        color = when {
                            highlighted -> scheme.primary
                            dimmed -> scheme.disabledOnSurface
                            else -> scheme.onSurface
                        },
                    )
                    if (badge != BookBadge.NONE) {
                        Spacer(Modifier.width(8.dp))
                        MiuixText(
                            text = badgeLabel(badge, state.transferPercent(book)),
                            fontSize = 10.sp,
                            color = badgeColor(badge),
                            maxLines = 1,
                        )
                    }
                }
                Spacer(Modifier.height(if (featured) 4.dp else 3.dp))
                Text(
                    text = buildString {
                        append(state.sourceLabelOf(book))
                        book.author?.takeIf { it.isNotBlank() }?.let { append(" · ").append(it) }
                        val chapter = summary.chapterText
                        if (chapter.isNotBlank()) append(" · ").append(chapter)
                    },
                    fontSize = 11.sp,
                    color = scheme.onSurfaceVariantSummary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(if (featured) 10.dp else 7.dp))
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
                        fontSize = 10.sp,
                        color = if (featured && summary.read) {
                            scheme.primary
                        } else {
                            scheme.onSurfaceVariantSummary
                        },
                        maxLines = 1,
                    )
                }
            }
            if (featured) {
                Spacer(Modifier.width(10.dp))
                MiuixText(
                    text = "继续",
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable(onClick = onOpen)
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = scheme.primary,
                    maxLines = 1,
                )
            } else {
                Box {
                    Box(
                        Modifier
                            .size(32.dp)
                            .clip(CircleShape)
                            .clickable(onClick = onToggleMenu),
                        contentAlignment = Alignment.Center,
                    ) {
                        MiuixText(
                            text = "⋮",
                            fontSize = 16.sp,
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
        }
        Hairline(inset = PageMargin)
    }
}

@Composable
private fun ProgressRail(progress: Float, modifier: Modifier = Modifier) {
    val scheme = MiuixTheme.colorScheme
    val safe = progress.coerceIn(0f, 1f)
    val filled by animateFloatAsState(
        targetValue = safe,
        animationSpec = tween(FolioMotion.Normal, easing = FolioMotion.Easing),
        label = "rail-progress",
    )
    Box(
        modifier
            .fillMaxWidth()
            .height(2.dp)
            .background(scheme.dividerLine),
    ) {
        Box(
            Modifier
                .fillMaxWidth(filled)
                .height(2.dp)
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

/** 封面：有图用图；没图用纸色底 + 书名首字。圆角压到 4dp，像书而不是像卡片。 */
@Composable
private fun CoverBox(
    book: Book,
    cover: ImageBitmap?,
    dimmed: Boolean,
    width: androidx.compose.ui.unit.Dp,
    height: androidx.compose.ui.unit.Dp,
) {
    val hue = (book.title.hashCode().absoluteValue % 360).toFloat()
    val paperTone = Color.hsl(hue, 0.12f, 0.88f)
    val inkTone = Color.hsl(hue, 0.24f, 0.28f)
    val shape = RoundedCornerShape(4.dp)
    Box(
        Modifier
            .size(width, height)
            .background(paperTone, shape)
            .clip(shape),
        contentAlignment = Alignment.Center,
    ) {
        if (cover != null) {
            Image(
                bitmap = cover,
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
        } else {
            Text(
                text = book.title.take(1).ifBlank { "书" },
                fontSize = if (height > 70.dp) 26.sp else 17.sp,
                color = inkTone.copy(alpha = if (dimmed) 0.4f else 1f),
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
                    .padding(bottom = 24.dp, start = 24.dp, end = 24.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(scheme.onSurface.copy(alpha = 0.9f))
                    .padding(horizontal = 14.dp, vertical = 9.dp),
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
