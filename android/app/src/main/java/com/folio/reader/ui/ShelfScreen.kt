package com.folio.reader.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.folio.reader.core.Book
import com.folio.reader.core.Origin
import com.folio.reader.data.ConnectionState
import com.folio.reader.ui.miuix.HyperChip
import com.folio.reader.ui.miuix.HyperSheet
import com.folio.reader.ui.miuix.PageMargin
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
 * 书架（HyperOS 版）。
 *
 * 大标题 + 状态行 + 胶囊筛选；书是圆角卡片，封面 / 书名 / 来源 / 进度都在一行里。
 * 底部固定「导入 TXT / 立即同步」两个主操作，其余动作收进长按菜单。
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
                onSync = { vm.syncNow() },
                onOpenSettings = onOpenSettings,
                onOpenSyncStatus = onOpenSyncStatus,
            )

            if (state.showBanner) {
                OfflineBanner(onConnect = onOpenSettings, onDismiss = vm::dismissBanner)
            }

            FilterBlock(state = state, onSelectFilter = vm::setFilter)

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
                        contentPadding = PaddingValues(bottom = 104.dp),
                    ) {
                        sections.forEachIndexed { number, section ->
                            stickyHeader(key = "header-${section.key}") {
                                SectionHeader(
                                    number = number + 1,
                                    title = section.title,
                                    count = section.books.size,
                                )
                            }
                            items(
                                items = section.books,
                                key = { book -> "book-${section.key}-${book.id}" },
                            ) { book ->
                                val rowKey = "${section.key}-${book.id}"
                                LaunchedEffect(section.key, book.id) { vm.loadCover(book) }
                                BookCard(
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

        ShelfToolbar(
            modifier = Modifier.align(Alignment.BottomCenter),
            online = state.online,
            syncing = state.syncing,
            onImport = importAction,
            onSync = { if (state.online) vm.syncNow() else onOpenSettings() },
        )

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
            .padding(horizontal = PageMargin)
            .padding(top = 8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = "书架",
                    fontSize = 26.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = scheme.onSurface,
                    maxLines = 1,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = "${state.books.size} 本 · ${mbOf(state.localBytes)} MB · ${
                        connectionTextOf(state)
                    } · 同步状态 ›",
                    modifier = Modifier.clickable(onClick = onOpenSyncStatus),
                    fontSize = 11.sp,
                    color = scheme.onSurfaceVariantSummary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            RoundIconButton(
                icon = Icons.Default.Search,
                description = "搜索",
                active = state.query.isNotEmpty() || searchOpen,
                onClick = onToggleSearch,
            )
            if (state.syncing) {
                Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(size = 18.dp, strokeWidth = 2.dp)
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

        if (searchOpen) {
            Spacer(Modifier.height(8.dp))
            TextField(
                value = state.query,
                onValueChange = onQuery,
                modifier = Modifier.fillMaxWidth(),
                label = "搜书名或作者",
                useLabelAsPlaceholder = true,
                singleLine = true,
                cornerRadius = 16.dp,
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
        Spacer(Modifier.height(10.dp))
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
    Box(
        modifier = Modifier
            .size(40.dp)
            .clip(CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = description,
            modifier = Modifier.size(20.dp),
            tint = if (active) scheme.primary else scheme.onSurface,
        )
    }
}

@Composable
private fun ConnectionDot(state: ShelfUiState) {
    val scheme = MiuixTheme.colorScheme
    val color = when {
        state.syncing -> scheme.primary
        state.online -> Color(0xFF2E7D32)
        state.connection == ConnectionState.UNKNOWN -> scheme.onSurfaceVariantSummary
        else -> scheme.primary
    }
    val alpha = if (state.syncing) {
        val transition = rememberInfiniteTransition(label = "connection")
        val pulse by transition.animateFloat(
            initialValue = 1f,
            targetValue = 0.25f,
            animationSpec = infiniteRepeatable(
                animation = tween(durationMillis = 620),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "connectionAlpha",
        )
        pulse
    } else {
        1f
    }
    Box(Modifier.size(7.dp).clip(CircleShape).background(color.copy(alpha = alpha)))
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
            .padding(horizontal = 18.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(scheme.primaryContainer)
            .padding(start = 14.dp, end = 6.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = "未连接桌面端",
                fontSize = 13.5.sp,
                fontWeight = FontWeight.Medium,
                color = scheme.primary,
                maxLines = 1,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = "同步与下载暂停；本机书照常可读。",
                fontSize = 11.5.sp,
                color = scheme.onSurfaceVariantSummary,
                maxLines = 2,
            )
        }
        MiuixText(
            text = "去连接",
            fontSize = 12.5.sp,
            color = scheme.primary,
            modifier = Modifier
                .clickable(onClick = onConnect)
                .padding(horizontal = 10.dp, vertical = 6.dp),
        )
        Box(
            Modifier
                .size(30.dp)
                .clip(CircleShape)
                .clickable(onClick = onDismiss),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Default.Close, "不再提示", Modifier.size(14.dp), tint = scheme.onSurfaceVariantSummary)
        }
    }
}

/* ---------------- 筛选 / 导入进度 ---------------- */

@Composable
private fun FilterBlock(state: ShelfUiState, onSelectFilter: (String) -> Unit) {
    val scheme = MiuixTheme.colorScheme
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = PageMargin)
            .padding(bottom = 4.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ShelfUiState.FILTERS.forEach { (key, label) ->
                HyperChip(
                    text = label,
                    selected = state.filter == key,
                    onClick = { onSelectFilter(key) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
        if (state.importing) {
            Spacer(Modifier.height(10.dp))
            MiuixText(
                text = state.importLabel.ifBlank { "正在导入…" },
                modifier = Modifier.fillMaxWidth(),
                fontSize = 11.5.sp,
                color = scheme.primary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(6.dp))
            LinearProgressIndicator(
                progress = null,
                modifier = Modifier.fillMaxWidth().height(3.dp),
            )
        }
    }
}

/* ---------------- 分区标题 ---------------- */

@Composable
private fun SectionHeader(number: Int, title: String, count: Int) {
    val scheme = MiuixTheme.colorScheme
    Row(
        Modifier
            .fillMaxWidth()
            .background(scheme.background)
            .padding(horizontal = PageMargin)
            .padding(top = 16.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MiuixText(
            text = number.toString().padStart(2, '0'),
            fontSize = 10.5.sp,
            color = scheme.primary,
        )
        Spacer(Modifier.width(8.dp))
        MiuixText(
            text = title,
            modifier = Modifier.weight(1f),
            fontSize = 12.5.sp,
            fontWeight = FontWeight.Medium,
            color = scheme.onSurface,
        )
        MiuixText(text = "$count 本", fontSize = 10.5.sp, color = scheme.onSurfaceVariantSummary)
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
            .padding(bottom = 100.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = if (hasBooks) "没有符合条件的书" else "书架是空的",
            fontSize = 20.sp,
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
        Button(onClick = onImport, modifier = Modifier.fillMaxWidth(), cornerRadius = 16.dp) {
            MiuixText(text = "从文件导入 TXT", fontSize = 15.sp, color = scheme.onPrimary)
        }
        Spacer(Modifier.height(4.dp))
        TextButton(text = "连接桌面端", onClick = onConnect, modifier = Modifier.fillMaxWidth())
    }
}

/* ---------------- 底部工具条 ---------------- */

@Composable
private fun ShelfToolbar(
    online: Boolean,
    syncing: Boolean,
    onImport: () -> Unit,
    onSync: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val scheme = MiuixTheme.colorScheme
    Row(
        modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = PageMargin, vertical = 8.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(scheme.surface)
            .padding(4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Button(
            onClick = onImport,
            modifier = Modifier.weight(1f),
            cornerRadius = 14.dp,
            minHeight = 40.dp,
        ) {
            MiuixText(text = "＋ 导入 TXT", fontSize = 13.5.sp, color = scheme.onPrimary)
        }
        TextButton(
            text = if (syncing) "同步中…" else if (online) "立即同步" else "连接桌面端",
            onClick = onSync,
            modifier = Modifier.weight(1f),
            enabled = !syncing,
            cornerRadius = 14.dp,
            minHeight = 40.dp,
        )
    }
}

/* ---------------- 单本书 ---------------- */

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun BookCard(
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

    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = PageMargin, vertical = 3.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(if (highlighted) scheme.primaryContainer else scheme.surface)
            .combinedClickable(onClick = onOpen, onLongClick = onToggleMenu)
            .padding(start = 10.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CoverBox(book = book, cover = cover, dimmed = dimmed)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = book.title,
                    modifier = Modifier.weight(1f, fill = false),
                    fontSize = 14.5.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = if (dimmed) scheme.disabledOnSurface else scheme.onSurface,
                )
                if (badge != BookBadge.NONE) {
                    Spacer(Modifier.width(8.dp))
                    BadgePill(
                        text = badgeLabel(badge, state.transferPercent(book)),
                        color = badgeColor(badge),
                    )
                }
            }
            Spacer(Modifier.height(3.dp))
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
            Spacer(Modifier.height(7.dp))
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
                    fontSize = 10.5.sp,
                    color = scheme.onSurfaceVariantSummary,
                    maxLines = 1,
                )
            }
        }
        Spacer(Modifier.width(2.dp))
        Box {
            Box(
                Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .clickable(onClick = onToggleMenu),
                contentAlignment = Alignment.Center,
            ) {
                MiuixText(
                    text = "⋮",
                    fontSize = 17.sp,
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

@Composable
private fun BadgePill(text: String, color: Color) {
    Box(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    ) {
        MiuixText(text = text, fontSize = 10.sp, color = color, maxLines = 1)
    }
}

@Composable
private fun ProgressRail(progress: Float, modifier: Modifier = Modifier) {
    val scheme = MiuixTheme.colorScheme
    val safe = progress.coerceIn(0f, 1f)
    Box(
        modifier
            .fillMaxWidth()
            .height(3.dp)
            .clip(RoundedCornerShape(2.dp))
            .background(scheme.dividerLine),
    ) {
        Box(
            Modifier
                .fillMaxWidth(safe)
                .height(3.dp)
                .clip(RoundedCornerShape(2.dp))
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
        BookBadge.NOT_SYNCED, BookBadge.TRANSFERRING -> Color(0xFFB26A00)
        BookBadge.NEED_CONNECT, BookBadge.LOCAL_ONLY -> scheme.onSurfaceVariantSummary
        BookBadge.NONE -> scheme.onSurfaceVariantSummary
    }
}

/** 封面：有图用图；没图用纸色底 + 书名首字，圆角 10dp。 */
@Composable
private fun CoverBox(book: Book, cover: ImageBitmap?, dimmed: Boolean) {
    val hue = (book.title.hashCode().absoluteValue % 360).toFloat()
    val paperTone = Color.hsl(hue, 0.16f, 0.90f)
    val inkTone = Color.hsl(hue, 0.30f, 0.30f)
    val shape = RoundedCornerShape(8.dp)
    Box(
        Modifier
            .size(42.dp, 58.dp)
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
                fontSize = 18.sp,
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
        MiuixText(
            text = text,
            modifier = Modifier
                .padding(bottom = 92.dp, start = 24.dp, end = 24.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(scheme.onSurface.copy(alpha = 0.9f))
                .padding(horizontal = 16.dp, vertical = 10.dp),
            fontSize = 12.5.sp,
            color = scheme.surface,
        )
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
                Button(onClick = onConfirm, modifier = Modifier.weight(1f), cornerRadius = 16.dp) {
                    MiuixText(text = confirmText, fontSize = 14.sp, color = scheme.onPrimary)
                }
            }
        }
    }
}

/** SAF 允许的类型：纯文本为主，兜底给一个二进制流。 */
private val IMPORT_MIME_TYPES = arrayOf("text/plain", "text/*", "application/octet-stream")
