package com.folio.reader.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folio.reader.core.Book
import com.folio.reader.core.Origin
import com.folio.reader.data.ConnectionState
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.absoluteValue

/**
 * 书架。
 *
 * 结构（PRD §5）：顶栏（标题 · 连接状态点 · 搜索 · 设置）→ 未连接横幅 →
 * 筛选 chips → 三个分区（继续阅读 / 本机书 / 桌面端书）。
 *
 * 每一行都自己回答一个问题：**这本书现在能不能读、为什么不能**。
 * 角标不是装饰 —— 它替代了 2.5 那种「点进去才报错」的体验。
 */
@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
@Composable
fun ShelfScreen(
    vm: AppViewModel,
    onOpenBook: (Book) -> Unit,
    onOpenSettings: () -> Unit,
    onOpenSyncStatus: () -> Unit,
) {
    val state by vm.shelf.collectAsState()
    val covers by vm.covers.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    val listState = rememberLazyListState()

    var searchOpen by remember { mutableStateOf(false) }
    var menuFor by remember { mutableStateOf<String?>(null) }
    var pendingDelete by remember { mutableStateOf<Book?>(null) }
    var pendingRemove by remember { mutableStateOf<Book?>(null) }

    val importLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris -> vm.importDocuments(uris) }

    LaunchedEffect(state.message) {
        val message = state.message ?: return@LaunchedEffect
        snackbar.showSnackbar(message)
        vm.dismissMessage()
    }

    // 导入成功：滚到那本书（分区结构里要自己算下标）
    LaunchedEffect(state.highlightId) {
        val id = state.highlightId ?: return@LaunchedEffect
        val sections = state.sections
        var index = 0
        var target = -1
        for (section in sections) {
            index += 1 // 分区标题占一项
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

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("书架", fontWeight = FontWeight.SemiBold)
                        ConnectionLine(state)
                    }
                },
                actions = {
                    IconButton(onClick = { searchOpen = !searchOpen }) {
                        Icon(Icons.Default.Search, contentDescription = "搜索")
                    }
                    IconButton(onClick = onOpenSyncStatus) {
                        Icon(Icons.Default.Sync, contentDescription = "同步状态")
                    }
                    IconButton(onClick = { vm.syncNow() }) {
                        if (state.syncing) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Icon(Icons.Default.Refresh, contentDescription = "同步")
                        }
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Default.Settings, contentDescription = "设置")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        floatingActionButton = {
            androidx.compose.material3.ExtendedFloatingActionButton(
                onClick = { importLauncher.launch(IMPORT_MIME_TYPES) },
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text("导入") },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            if (searchOpen) {
                OutlinedTextField(
                    value = state.query,
                    onValueChange = vm::setQuery,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                    singleLine = true,
                    label = { Text("搜书名或作者") },
                    trailingIcon = {
                        if (state.query.isNotEmpty()) {
                            IconButton(onClick = { vm.setQuery("") }) {
                                Icon(Icons.Default.Close, contentDescription = "清空")
                            }
                        }
                    },
                )
            }

            if (state.showBanner) {
                DisconnectedBanner(
                    onConnect = onOpenSettings,
                    onDismiss = vm::dismissBanner,
                )
            }

            if (state.importing) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                    Text(
                        text = state.importLabel.ifBlank { "正在导入…" },
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            // 筛选 chips
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ShelfUiState.FILTERS.forEach { (key, label) ->
                    FilterChip(
                        selected = state.filter == key,
                        onClick = { vm.setFilter(key) },
                        label = { Text(label) },
                    )
                }
            }

            Spacer(Modifier.height(4.dp))

            val sections = state.sections
            if (sections.isEmpty()) {
                EmptyShelf(
                    hasBooks = state.books.isNotEmpty(),
                    onImport = { importLauncher.launch(IMPORT_MIME_TYPES) },
                    onConnect = onOpenSettings,
                )
            } else {
                LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
                    sections.forEach { section ->
                        // key 必须带分区前缀：同一本书会在「继续阅读」和「本机书」里各出现一次，
                        // 只用 book.id 会撞 key（Compose 直接抛 IllegalArgumentException）。
                        stickyHeader(key = "header-${section.key}") {
                            SectionHeader(section.title)
                        }
                        items(
                            items = section.books,
                            key = { book -> "book-${section.key}-${book.id}" },
                        ) { book ->
                            // 同一本书可能在两个分区各有一行，菜单/高亮要按「分区 + 书」区分，
                            // 否则长按「继续阅读」里的那本，「本机书」里的同名行也会弹出菜单。
                            val rowKey = "${section.key}-${book.id}"
                            LaunchedEffect(section.key, book.id) { vm.loadCover(book) }
                            BookRow(
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
                            HorizontalDivider(
                                color = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f),
                            )
                        }
                    }
                    item { Spacer(Modifier.height(96.dp)) }
                }
            }
        }
    }

    pendingDelete?.let { book ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("删除本机副本？") },
            text = {
                Text("只会删掉手机上的《${book.title}》，桌面端那份不受影响。")
            },
            confirmButton = {
                TextButton(onClick = {
                    val target = pendingDelete
                    pendingDelete = null
                    if (target != null) vm.deleteLocalCopy(target)
                }) { Text("删除") }
            },
            dismissButton = {
                TextButton(onClick = { pendingDelete = null }) { Text("取消") }
            },
        )
    }

    pendingRemove?.let { book ->
        AlertDialog(
            onDismissRequest = { pendingRemove = null },
            title = { Text("从手机书架移除？") },
            text = {
                Text("《${book.title}》会从手机书架消失，桌面端那份不受影响；下次同步会重新出现。")
            },
            confirmButton = {
                TextButton(onClick = {
                    val target = pendingRemove
                    pendingRemove = null
                    if (target != null) vm.removeFromShelf(target)
                }) { Text("移除") }
            },
            dismissButton = {
                TextButton(onClick = { pendingRemove = null }) { Text("取消") }
            },
        )
    }
}

/* ---------------- 顶栏状态行 ---------------- */

@Composable
private fun ConnectionLine(state: ShelfUiState) {
    val dotColor = when {
        state.syncing -> MaterialTheme.colorScheme.primary
        state.online -> Color(0xFF2E7D32)
        state.connection == ConnectionState.UNKNOWN -> MaterialTheme.colorScheme.onSurfaceVariant
        else -> MaterialTheme.colorScheme.error
    }
    val label = when {
        state.syncing -> "同步中…"
        state.online -> state.connectionLabel
        state.connection == ConnectionState.NEED_RECONNECT -> ConnectionState.NEED_RECONNECT.label
        state.connection == ConnectionState.UNKNOWN -> "未连接桌面端"
        else -> state.connectionLabel
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .background(dotColor, CircleShape),
        )
        Spacer(Modifier.width(6.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/* ---------------- 横幅 / 空状态 / 分区标题 ---------------- */

@Composable
private fun DisconnectedBanner(onConnect: () -> Unit, onDismiss: () -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        shape = RoundedCornerShape(10.dp),
    ) {
        Row(
            modifier = Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Default.ErrorOutline,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = "未连接桌面端",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onConnect) { Text("连接") }
            IconButton(onClick = onDismiss, modifier = Modifier.size(32.dp)) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = "不再提示",
                    modifier = Modifier.size(16.dp),
                )
            }
        }
    }
}

@Composable
private fun EmptyShelf(hasBooks: Boolean, onImport: () -> Unit, onConnect: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(32.dp),
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.MenuBook,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(48.dp),
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = if (hasBooks) "没有符合条件的书" else "书架是空的",
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = if (hasBooks) {
                    "换个筛选条件或清掉搜索词试试。"
                } else {
                    "从手机里导入 TXT，或连接桌面端把书架搬过来。"
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(20.dp))
            Button(onClick = onImport) { Text("从文件导入 txt") }
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onConnect) { Text("连接桌面端") }
        }
    }
}

@Composable
private fun SectionHeader(title: String) {
    Surface(color = MaterialTheme.colorScheme.background) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 6.dp),
        )
    }
}

/* ---------------- 单个条目 ---------------- */

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun BookRow(
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
    val badge = state.badgeOf(book)
    val percent = state.progressPercentOf(book)
    // 右侧百分比与第二行章节名同源，避免「未读」和「第一章」同时出现
    val summary = state.progressSummaryOf(book)
    val dimmed = !state.readable(book)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                if (highlighted) {
                    MaterialTheme.colorScheme.primary.copy(alpha = 0.08f)
                } else {
                    Color.Transparent
                },
            )
            .combinedClickable(onClick = onOpen, onLongClick = onToggleMenu)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CoverBox(book = book, cover = cover, dimmed = dimmed)
        Spacer(Modifier.width(14.dp))
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = book.title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = if (dimmed) {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    } else {
                        MaterialTheme.colorScheme.onBackground
                    },
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (badge != BookBadge.NONE) {
                    Spacer(Modifier.width(8.dp))
                    BadgeChip(badge, percent = state.transferPercent(book))
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
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (percent > 0.0 || book.hasLocalFile) {
                Spacer(Modifier.height(6.dp))
                LinearProgressIndicator(
                    progress = { (percent / 100.0).toFloat().coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        Spacer(Modifier.width(10.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(
                text = when {
                    summary.read -> summary.percentText
                    !state.readable(book) -> "未下载"
                    else -> "未读"
                },
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Box {
                IconButton(onClick = onToggleMenu) {
                    Icon(
                        Icons.Default.Refresh,
                        contentDescription = "更多",
                        modifier = Modifier.size(18.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = onToggleMenu) {
                    if (!book.isCloud && !book.hasLocalFile) {
                        DropdownMenuItem(
                            text = { Text("下载到手机") },
                            onClick = onDownload,
                        )
                    }
                    if (book.hasLocalFile) {
                        DropdownMenuItem(
                            text = { Text("删除本机副本") },
                            onClick = onDeleteLocal,
                        )
                    }
                    if (book.origin == Origin.DESKTOP) {
                        DropdownMenuItem(
                            text = { Text("从手机书架移除") },
                            onClick = onRemoveFromShelf,
                        )
                    }
                    DropdownMenuItem(
                        text = { Text("查看同步状态") },
                        onClick = onSyncStatus,
                    )
                }
            }
        }
    }
}

@Composable
private fun BadgeChip(badge: BookBadge, percent: Int) {
    val color = when (badge) {
        BookBadge.MISMATCH, BookBadge.FAILED -> MaterialTheme.colorScheme.error
        BookBadge.NOT_SYNCED, BookBadge.TRANSFERRING -> Color(0xFFB26A00)
        BookBadge.NEED_CONNECT -> MaterialTheme.colorScheme.onSurfaceVariant
        BookBadge.LOCAL_ONLY -> Color(0xFF00696E)
        BookBadge.NONE -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val label = if (badge == BookBadge.TRANSFERRING && percent in 1..99) {
        "传输中 $percent%"
    } else {
        badge.label
    }
    Surface(
        color = color.copy(alpha = 0.12f),
        shape = RoundedCornerShape(6.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = color,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}

/** 封面：有图用图，没图用书名首字 + 由书名决定的色相（同一本书永远同一个颜色）。 */
@Composable
private fun CoverBox(book: Book, cover: ImageBitmap?, dimmed: Boolean) {
    val hue = (book.title.hashCode().absoluteValue % 360).toFloat()
    val background = Color.hsl(hue, 0.42f, 0.78f)
    val foreground = Color.hsl(hue, 0.55f, 0.32f)
    Box(
        modifier = Modifier
            .size(48.dp)
            .background(background, RoundedCornerShape(8.dp)),
        contentAlignment = Alignment.Center,
    ) {
        when {
            cover != null -> androidx.compose.foundation.Image(
                bitmap = cover,
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )

            // 没有封面就用书名首字 + 由书名哈希出来的色相，
            // 同一本书每次进来颜色都一样，扫书架时能靠颜色认书。
            else -> Text(
                text = book.title.take(1).ifBlank { "书" },
                style = MaterialTheme.typography.titleMedium,
                color = foreground.copy(alpha = if (dimmed) 0.4f else 1f),
                fontWeight = FontWeight.SemiBold,
            )
        }
    }
}

/** SAF 允许的类型：纯文本为主，兜底给一个二进制流（有些文件管理器把 .txt 报成 octet-stream）。 */
private val IMPORT_MIME_TYPES = arrayOf("text/plain", "text/*", "application/octet-stream")
