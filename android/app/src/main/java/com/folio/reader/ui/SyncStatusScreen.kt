package com.folio.reader.ui

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folio.reader.core.Book
import com.folio.reader.core.SyncState

/**
 * 同步状态页。
 *
 * 存在的理由很朴素：同步失败时用户需要知道**是哪一本、为什么**。
 * 书架只给一个角标，这里是逐本的账本 —— 状态、原因、进度、单条重试。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SyncStatusScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
) {
    val state by vm.shelf.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                title = { Text("同步状态") },
                actions = {
                    if (state.syncing) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                        )
                        Spacer(Modifier.width(12.dp))
                    } else {
                        TextButton(onClick = { vm.syncNow() }) { Text("立即同步全部") }
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            HeaderLine(state)
            if (state.books.isEmpty()) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(32.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("书架里还没有书", style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = "导入一本 txt，或连上桌面端同步一次。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                return@Column
            }
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                // 以 id 作 key，所以先按 id 去重：books.json 里若有重复条目，
                // 这一页会跟书架一样抛「Key was already used」。
                items(state.books.distinctBy { it.id }, key = { it.id }) { book ->
                    SyncRow(
                        book = book,
                        state = state,
                        onRetry = { vm.retrySync(book) },
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f))
                }
            }
        }
    }
}

@Composable
private fun HeaderLine(state: ShelfUiState) {
    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text(
            text = when {
                state.syncing -> "正在同步…"
                state.online -> "已连接 · ${state.connectionLabel}"
                else -> state.connectionLabel
            },
            style = MaterialTheme.typography.labelMedium,
            color = if (state.online) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
        if (state.lastSyncAt > 0L) {
            Text(
                text = "上次同步 " + android.text.format.DateFormat.format(
                    "MM-dd HH:mm",
                    state.lastSyncAt,
                ),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (state.conflictCount > 0) {
            Spacer(Modifier.height(4.dp))
            Text(
                text = "有 ${state.conflictCount} 本内容不一致：两端内容不一致，请选择保留哪一版",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

@Composable
private fun SyncRow(book: Book, state: ShelfUiState, onRetry: () -> Unit) {
    val syncState = state.stateOf(book)
    val reason = state.reasonOf(book)
    val percent = state.transferPercent(book)

    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = book.title,
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = labelOf(syncState),
                style = MaterialTheme.typography.labelMedium,
                color = colorOf(syncState),
                fontWeight = FontWeight.Medium,
            )
            if (syncState == SyncState.FAILED || syncState == SyncState.NOT_SYNCED) {
                TextButton(onClick = onRetry) { Text("重试") }
            }
        }
        Text(
            text = buildString {
                append(state.sourceLabelOf(book))
                append(" · ")
                append(if (book.hasLocalFile) sizeLabel(book.size) else "未下载")
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (!reason.isNullOrBlank()) {
            Spacer(Modifier.height(4.dp))
            Text(
                text = reason,
                style = MaterialTheme.typography.labelSmall,
                color = colorOf(syncState),
            )
        }
        if (syncState == SyncState.TRANSFERRING) {
            Spacer(Modifier.height(6.dp))
            LinearProgressIndicator(
                progress = { (percent / 100f).coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                text = "$percent%",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private fun labelOf(state: SyncState): String = when (state) {
    SyncState.SYNCED -> "已同步"
    SyncState.NOT_SYNCED -> "待同步"
    SyncState.TRANSFERRING -> "传输中"
    SyncState.FAILED -> "失败"
    SyncState.CONTENT_MISMATCH -> "内容不一致"
    SyncState.EXCLUDED -> "仅本机"
}

@Composable
private fun colorOf(state: SyncState): Color = when (state) {
    SyncState.SYNCED -> Color(0xFF2E7D32)
    SyncState.NOT_SYNCED, SyncState.TRANSFERRING -> Color(0xFFB26A00)
    SyncState.FAILED, SyncState.CONTENT_MISMATCH -> MaterialTheme.colorScheme.error
    SyncState.EXCLUDED -> MaterialTheme.colorScheme.onSurfaceVariant
}

private fun sizeLabel(bytes: Long): String {
    if (bytes <= 0L) return "未知大小"
    val kb = bytes / 1024.0
    if (kb < 1024) return String.format("%.0f KB", kb)
    return String.format("%.1f MB", kb / 1024.0)
}
