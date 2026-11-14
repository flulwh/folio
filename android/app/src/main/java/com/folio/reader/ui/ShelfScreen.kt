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
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folio.reader.core.Book
import com.folio.reader.core.Origin
import com.folio.reader.data.ConnectionState
import java.util.Locale
import kotlin.math.absoluteValue

/**
 * 书架（现代主义网格版）。
 *
 * 一页纸的结构：报头（FOLIO / LIBRARY + 大标题 + 连接状态）→ 筛选尺 →
 * 三个分区（继续阅读 / 本机书 / 桌面端书）→ 底部固定工具条。
 *
 * 视觉上只保留三层：纸、墨、朱。所有分隔都是 1dp 发丝线，所有数字都是等宽，
 * 没有卡片、没有阴影、没有圆角胶囊。行为与 3.1.0 完全一致 —— 这一版只换皮。
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

    val sections = state.sections
    val importAction = { importLauncher.launch(IMPORT_MIME_TYPES) }
    val syncAction = { if (state.online) vm.syncNow() else onOpenSettings() }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        snackbarHost = {
            // 工具条固定叠在底部，Snackbar 往上抬一层，免得被压住。
            SnackbarHost(
                hostState = snackbar,
                modifier = Modifier
                    .navigationBarsPadding()
                    .padding(bottom = 66.dp),
            )
        },
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            Column(Modifier.fillMaxSize()) {
                ShelfMasthead(
                    state = state,
                    onToggleSearch = { searchOpen = !searchOpen },
                    onSync = { vm.syncNow() },
                    onOpenSettings = onOpenSettings,
                    onOpenSyncStatus = onOpenSyncStatus,
                )

                if (searchOpen) {
                    SearchField(
                        state = state,
                        onQuery = vm::setQuery,
                    )
                }

                if (state.showBanner) {
                    OfflineBanner(
                        onConnect = onOpenSettings,
                        onDismiss = vm::dismissBanner,
                    )
                }

                FilterBlock(
                    state = state,
                    onSelectFilter = vm::setFilter,
                )

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
                            contentPadding = PaddingValues(bottom = 96.dp),
                        ) {
                            sections.forEachIndexed { number, section ->
                                // key 必须带分区前缀：同一本书会在「继续阅读」和「本机书」里各出现一次，
                                // 只用 book.id 会撞 key（Compose 直接抛 IllegalArgumentException）。
                                stickyHeader(key = "header-${section.key}") {
                                    Box(
                                        Modifier
                                            .fillMaxWidth()
                                            .background(MaterialTheme.colorScheme.background),
                                    ) {
                                        FolioSectionHeader(
                                            number = (number + 1).toString().padStart(2, '0'),
                                            title = section.title,
                                            trailing = "${section.books.size} 本",
                                            modifier = Modifier
                                                .padding(horizontal = 20.dp)
                                                .padding(top = 18.dp, bottom = 8.dp),
                                        )
                                    }
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
                                    FolioHairline()
                                }
                            }
                        }
                    }
                }
            }

            ShelfToolbar(
                modifier = Modifier.align(Alignment.BottomCenter),
                onImport = importAction,
                onSyncLabel = if (state.online) "立即同步" else "连接桌面端",
                onSync = syncAction,
            )
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

/* ---------------- 报头 ---------------- */

/**
 * 自写的顶栏：不用 Material TopAppBar（它自带 64dp 高度、阴影和滚动行为，
 * 与「表格式排版」相冲）。三行：报头行 / 大标题行 / 连接状态行。
 */
@Composable
private fun ShelfMasthead(
    state: ShelfUiState,
    onToggleSearch: () -> Unit,
    onSync: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenSyncStatus: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding()
            .padding(horizontal = 20.dp)
            .padding(top = 8.dp),
    ) {
        // 第一行：报头 + 三个图标
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "FOLIO / LIBRARY",
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
                maxLines = 1,
            )
            FolioIconAction(
                icon = Icons.Default.Search,
                contentDescription = "搜索",
                onClick = onToggleSearch,
                size = 36.dp,
                iconSize = 18.dp,
                tint = if (state.query.isNotEmpty()) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
            )
            Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) {
                if (state.syncing) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(14.dp),
                        strokeWidth = 1.5.dp,
                        color = MaterialTheme.colorScheme.primary,
                    )
                } else {
                    FolioIconAction(
                        icon = Icons.Default.Refresh,
                        contentDescription = "同步",
                        onClick = onSync,
                        size = 36.dp,
                        iconSize = 18.dp,
                    )
                }
            }
            FolioIconAction(
                icon = Icons.Default.Settings,
                contentDescription = "设置",
                onClick = onOpenSettings,
                size = 36.dp,
                iconSize = 18.dp,
            )
        }

        // 第二行：大标题 + 右侧等宽统计
        Row(
            modifier = Modifier.padding(top = 2.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            Text(
                text = "书架",
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.displayMedium,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = "${state.books.size} 本",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                )
                Text(
                    text = "${mbOf(state.localBytes)} MB",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
        }

        Spacer(Modifier.height(8.dp))
        FolioRule()

        // 第三行：状态点 + 连接文案 + 入口
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ConnectionDot(state)
            Spacer(Modifier.width(8.dp))
            Text(
                text = connectionTextOf(state),
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "同步状态 →",
                modifier = Modifier
                    .clickable(onClick = onOpenSyncStatus)
                    .padding(start = 8.dp, top = 4.dp, bottom = 4.dp),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun ConnectionDot(state: ShelfUiState) {
    val color = when {
        state.syncing -> MaterialTheme.colorScheme.primary
        state.online -> Color(0xFF2E7D32)
        state.connection == ConnectionState.UNKNOWN -> MaterialTheme.colorScheme.onSurfaceVariant
        else -> MaterialTheme.colorScheme.error
    }
    // 同步中正红闪动；其余状态常亮，不空转动画。
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
    Box(
        Modifier
            .size(6.dp)
            .background(color.copy(alpha = alpha)),
    )
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

/* ---------------- 搜索 ---------------- */

@Composable
private fun SearchField(
    state: ShelfUiState,
    onQuery: (String) -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(top = 10.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "FIND",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.width(10.dp))
            BasicTextField(
                value = state.query,
                onValueChange = onQuery,
                modifier = Modifier.weight(1f),
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge.copy(
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                decorationBox = { inner ->
                    Box {
                        if (state.query.isEmpty()) {
                            Text(
                                text = "书名或作者",
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                    .copy(alpha = 0.55f),
                            )
                        }
                        inner()
                    }
                },
            )
            if (state.query.isNotEmpty()) {
                Spacer(Modifier.width(6.dp))
                FolioIconAction(
                    icon = Icons.Default.Close,
                    contentDescription = "清空",
                    onClick = { onQuery("") },
                    size = 32.dp,
                    iconSize = 16.dp,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (state.query.isNotBlank()) {
            Text(
                text = "${state.visibleBooks.size} 条结果",
                modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 8.dp),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        FolioHairline(Modifier.padding(horizontal = 20.dp))
    }
}

/* ---------------- 未连接横幅 ---------------- */

/**
 * 未连接横幅：左侧 2dp 正红竖条 + 1dp 外框，不用圆角 Surface。
 * 文案保留原意，只把「连接」按钮降级成文字按钮，避免和底部工具条抢视觉重量。
 */
@Composable
private fun OfflineBanner(onConnect: () -> Unit, onDismiss: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .padding(top = 12.dp)
            .height(IntrinsicSize.Min)
            .border(
                width = 1.dp,
                color = MaterialTheme.colorScheme.outline,
                shape = RoundedCornerShape(2.dp),
            ),
    ) {
        Box(
            Modifier
                .width(2.dp)
                .fillMaxHeight()
                .background(MaterialTheme.colorScheme.primary),
        )
        Column(
            Modifier
                .weight(1f)
                .padding(start = 12.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
        ) {
            Text(
                text = "OFFLINE",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
                maxLines = 1,
            )
            Spacer(Modifier.height(3.dp))
            Text(
                text = "未连接桌面端，同步与下载暂停；本机书照常可读。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            text = "连接",
            modifier = Modifier
                .clickable(onClick = onConnect)
                .padding(horizontal = 8.dp, vertical = 10.dp),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.primary,
            maxLines = 1,
        )
        FolioIconAction(
            icon = Icons.Default.Close,
            contentDescription = "不再提示",
            onClick = onDismiss,
            size = 32.dp,
            iconSize = 14.dp,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/* ---------------- 筛选 / 导入进度 ---------------- */

@Composable
private fun FilterBlock(state: ShelfUiState, onSelectFilter: (String) -> Unit) {
    val selectedIndex = ShelfUiState.FILTERS
        .indexOfFirst { it.first == state.filter }
        .coerceAtLeast(0)
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .padding(top = 14.dp),
    ) {
        FolioSegmented(
            options = ShelfUiState.FILTERS.map { it.second },
            selectedIndex = selectedIndex,
            onSelect = { index ->
                ShelfUiState.FILTERS.getOrNull(index)?.let { onSelectFilter(it.first) }
            },
        )
        if (state.importing) {
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "IMPORT",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                    maxLines = 1,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = state.importLabel.ifBlank { "正在导入…" },
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.height(6.dp))
            LinearProgressIndicator(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(2.dp),
                color = MaterialTheme.colorScheme.primary,
                trackColor = MaterialTheme.colorScheme.outlineVariant,
            )
        }
    }
}

/* ---------------- 空状态 ---------------- */

@Composable
private fun EmptyShelf(hasBooks: Boolean, onImport: () -> Unit, onConnect: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp)
            .padding(bottom = 88.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.Start,
    ) {
        Text(
            text = "00",
            style = MaterialTheme.typography.displayLarge.copy(
                fontFamily = FontFamily.Monospace,
            ),
            color = MaterialTheme.colorScheme.outline,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = if (hasBooks) "没有符合条件的书" else "书架是空的",
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = if (hasBooks) {
                "换个筛选条件，或清掉搜索词再看看。"
            } else {
                "从手机里导入 TXT，或连接桌面端把书架搬过来。"
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .height(48.dp)
                .background(
                    MaterialTheme.colorScheme.onSurface,
                    RoundedCornerShape(2.dp),
                )
                .clickable(onClick = onImport),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "从文件导入 TXT",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.background,
                maxLines = 1,
            )
        }
        Spacer(Modifier.height(4.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .height(44.dp)
                .clickable(onClick = onConnect),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "连接桌面端",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
    }
}

/* ---------------- 底部工具条 ---------------- */

/**
 * 固定工具条：2dp 上墨线 + 64dp 行高。
 * 左侧反白块是唯一的「主动作」（导入），右侧是次要的同步入口。
 */
@Composable
private fun ShelfToolbar(
    onImport: () -> Unit,
    onSyncLabel: String,
    onSync: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .navigationBarsPadding(),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(2.dp)
                .background(MaterialTheme.colorScheme.onSurface),
        )
        Row(
            Modifier
                .fillMaxWidth()
                .height(64.dp)
                .padding(horizontal = 20.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .weight(0.55f)
                    .height(44.dp)
                    .background(
                        MaterialTheme.colorScheme.onSurface,
                        RoundedCornerShape(2.dp),
                    )
                    .clickable(onClick = onImport),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "＋ 导入 TXT",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.background,
                    maxLines = 1,
                )
            }
            Spacer(Modifier.width(12.dp))
            Box(
                Modifier
                    .weight(0.45f)
                    .height(44.dp)
                    .clickable(onClick = onSync),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Text(
                    text = onSyncLabel,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/* ---------------- 单个条目 ---------------- */

/**
 * 书目行：48×68 封面 · 书名/角标 · 等宽元信息 · 2dp 进度轨 · 40dp 菜单区。
 * 行高约 96dp，行间一条 1dp 发丝线，左右 20dp 对齐报头。
 */
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
    val readable = state.readable(book)
    val dimmed = !readable

    Row(
        Modifier
            .fillMaxWidth()
            .background(
                if (highlighted) {
                    MaterialTheme.colorScheme.primary.copy(alpha = 0.06f)
                } else {
                    Color.Transparent
                },
            )
            .combinedClickable(onClick = onOpen, onLongClick = onToggleMenu)
            .padding(start = 20.dp, end = 4.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CoverBox(book = book, cover = cover, dimmed = dimmed)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = book.title,
                    modifier = Modifier.weight(1f, fill = false),
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = if (dimmed) {
                        MaterialTheme.colorScheme.onSurface.copy(alpha = 0.45f)
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                )
                if (badge != BookBadge.NONE) {
                    Spacer(Modifier.width(8.dp))
                    FolioTag(
                        text = badgeLabel(badge, state.transferPercent(book)),
                        color = badgeColor(badge),
                    )
                }
            }
            Spacer(Modifier.height(4.dp))
            Text(
                text = buildString {
                    append(state.sourceLabelOf(book))
                    book.author?.takeIf { it.isNotBlank() }?.let { append(" · ").append(it) }
                    val chapter = summary.chapterText
                    if (chapter.isNotBlank()) append(" · ").append(chapter)
                },
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                FolioProgressRail(
                    progress = (percent / 100.0).toFloat().coerceIn(0f, 1f),
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    text = when {
                        summary.read -> summary.percentText
                        !readable -> "未下载"
                        else -> "未读"
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
        }
        Spacer(Modifier.width(2.dp))
        Box {
            Box(
                Modifier
                    .size(40.dp)
                    .clickable(onClick = onToggleMenu),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "⋮",
                    style = MaterialTheme.typography.headlineSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
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

private fun badgeLabel(badge: BookBadge, percent: Int): String =
    if (badge == BookBadge.TRANSFERRING && percent in 1..99) {
        "传输中 $percent%"
    } else {
        badge.label
    }

@Composable
private fun badgeColor(badge: BookBadge): Color = when (badge) {
    BookBadge.MISMATCH, BookBadge.FAILED -> MaterialTheme.colorScheme.error
    BookBadge.NOT_SYNCED, BookBadge.TRANSFERRING -> Color(0xFFB26A00)
    BookBadge.NEED_CONNECT, BookBadge.LOCAL_ONLY -> MaterialTheme.colorScheme.onSurfaceVariant
    BookBadge.NONE -> MaterialTheme.colorScheme.onSurfaceVariant
}

/**
 * 封面：有图用图；没图用纸色底 + 1dp 墨框 + 书名首字。
 * 色相仍由书名哈希决定（同一本书永远同一个色），但饱和压到接近纸墨。
 */
@Composable
private fun CoverBox(book: Book, cover: ImageBitmap?, dimmed: Boolean) {
    val hue = (book.title.hashCode().absoluteValue % 360).toFloat()
    val paperTone = Color.hsl(hue, 0.16f, 0.90f)
    val inkTone = Color.hsl(hue, 0.30f, 0.30f)
    val shape = RoundedCornerShape(2.dp)
    Box(
        Modifier
            .size(48.dp, 68.dp)
            .background(paperTone, shape)
            .border(1.dp, inkTone.copy(alpha = 0.35f), shape)
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
                style = MaterialTheme.typography.headlineMedium,
                color = inkTone.copy(alpha = if (dimmed) 0.4f else 1f),
            )
        }
    }
}

/** SAF 允许的类型：纯文本为主，兜底给一个二进制流（有些文件管理器把 .txt 报成 octet-stream）。 */
private val IMPORT_MIME_TYPES = arrayOf("text/plain", "text/*", "application/octet-stream")
