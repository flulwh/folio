package com.folio.reader.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
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
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folio.reader.core.Book
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShelfScreen(
    vm: AppViewModel,
    onOpenBook: (Book) -> Unit,
    onOpenSettings: () -> Unit,
) {
    val state by vm.shelf.collectAsState()
    val covers by vm.covers.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    var query by remember { mutableStateOf("") }
    var menuFor by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(state.message) {
        val message = state.message ?: return@LaunchedEffect
        snackbar.showSnackbar(message)
        vm.dismissMessage()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Folio", fontWeight = FontWeight.SemiBold)
                        Text(
                            text = connectionLabel(state),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                actions = {
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
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                singleLine = true,
                label = { Text("搜书名或作者") },
            )

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                FilterChip(
                    selected = state.filter == ShelfUiState.FILTER_ALL,
                    onClick = { vm.setFilter(ShelfUiState.FILTER_ALL) },
                    label = { Text("全部") },
                )
                FilterChip(
                    selected = state.filter == ShelfUiState.FILTER_LOCAL,
                    onClick = { vm.setFilter(ShelfUiState.FILTER_LOCAL) },
                    label = { Text("本地") },
                )
                FilterChip(
                    selected = state.filter == ShelfUiState.FILTER_CLOUD,
                    onClick = { vm.setFilter(ShelfUiState.FILTER_CLOUD) },
                    label = { Text("云端") },
                )
                FilterChip(
                    selected = state.filter == ShelfUiState.FILTER_OFFLINE,
                    onClick = { vm.setFilter(ShelfUiState.FILTER_OFFLINE) },
                    label = { Text("可离线") },
                )
            }

            Spacer(Modifier.height(8.dp))

            val books = state.visibleBooks
            if (books.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        text = if (state.books.isEmpty()) {
                            "书架是空的。打开桌面端并连上，这里就会显示你的书。"
                        } else {
                            "没有符合条件的书"
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(32.dp),
                    )
                }
            } else {
                LazyColumn(modifier = Modifier.fillMaxSize()) {
                    items(books, key = { it.id }) { book ->
                        LaunchedEffect(book.id) { vm.loadCover(book) }
                        BookRow(
                            book = book,
                            percent = state.progress[book.id]?.safePercent ?: 0.0,
                            chapterTitle = state.progress[book.id]?.chapterTitle.orEmpty(),
                            offline = state.offlineIds.contains(book.id),
                            cover = covers[book.id],
                            menuOpen = menuFor == book.id,
                            onToggleMenu = { menuFor = if (menuFor == book.id) null else book.id },
                            onDownload = {
                                menuFor = null
                                vm.downloadOffline(book)
                            },
                            onClick = { onOpenBook(book) },
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f))
                    }
                }
            }
        }
    }
}

@Composable
private fun BookRow(
    book: Book,
    percent: Double,
    chapterTitle: String,
    offline: Boolean,
    cover: androidx.compose.ui.graphics.ImageBitmap?,
    menuOpen: Boolean,
    onToggleMenu: () -> Unit,
    onDownload: () -> Unit,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(54.dp)
                .background(
                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
                    shape = RoundedCornerShape(10.dp),
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (cover != null) {
                androidx.compose.foundation.Image(
                    bitmap = cover,
                    contentDescription = null,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                )
            } else {
                Icon(
                    imageVector = if (book.isCloud) Icons.Default.CloudDone else Icons.AutoMirrored.Filled.MenuBook,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                )
            }
        }
        Spacer(Modifier.width(14.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = book.title,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = buildString {
                    append(if (book.isCloud) "云端" else "本地")
                    book.author?.takeIf { it.isNotBlank() }?.let { append(" · ").append(it) }
                    if (offline) append(" · 可离线")
                    if (chapterTitle.isNotBlank()) append(" · ").append(chapterTitle)
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(6.dp))
            LinearProgressIndicator(
                progress = { (percent / 100.0).toFloat().coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Spacer(Modifier.width(10.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(
                text = if (percent > 0) "${percent.toInt()}%" else "未读",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Box {
                IconButton(onClick = onToggleMenu) {
                    Icon(Icons.Default.Download, contentDescription = "更多")
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = onToggleMenu) {
                    DropdownMenuItem(
                        text = { Text(if (offline) "已离线" else "下载到手机") },
                        onClick = onDownload,
                    )
                }
            }
        }
    }
}

private fun connectionLabel(state: ShelfUiState): String {
    if (!state.online) return "未连接桌面端"
    val time = state.lastSyncAt
    if (time <= 0L) return "已连接"
    val stamp = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(time))
    return "已连接 · $stamp 同步"
}
