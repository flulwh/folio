package com.folio.reader.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folio.reader.core.Book
import com.folio.reader.core.SyncState
import java.util.Locale

/**
 * 同步报告。
 *
 * 存在的理由很朴素：同步失败时用户需要知道**是哪一本、为什么**。
 * 这一版把它排成一份报告 —— 表格式状态块、两枚操作、逐本账本、尾部诊断，
 * 而不是一串 Material 列表。数据仍然只来自 [ShelfUiState]，不在这里另算。
 */
@Composable
fun SyncStatusScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
) {
    val state by vm.shelf.collectAsState()
    val books = state.books.distinctBy { it.id }
    val hasConflicts = state.conflictCount > 0
    val booksNumber = if (hasConflicts) "02" else "01"
    val diagNumber = if (hasConflicts) "03" else "02"

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            SyncMasthead(onBack = onBack)

            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                contentPadding = PaddingValues(bottom = 32.dp),
            ) {
                item {
                    StatusTable(state)
                }
                item {
                    ActionRow(
                        syncing = state.syncing,
                        onSync = { vm.syncNow() },
                        onDetect = { vm.testConnection() },
                    )
                }

                if (books.isEmpty()) {
                    item {
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 20.dp)
                                .padding(top = 28.dp, bottom = 28.dp),
                        ) {
                            Text(
                                text = "无条目",
                                style = MaterialTheme.typography.headlineSmall,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Spacer(Modifier.height(6.dp))
                            Text(
                                text = "导入一本 txt，或连上桌面端同步一次。",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    return@LazyColumn
                }

                if (hasConflicts) {
                    item {
                        SyncSection(
                            number = "01",
                            title = "冲突",
                            trailing = "${state.conflictCount} 本",
                        )
                    }
                    item {
                        Column(Modifier.background(MaterialTheme.colorScheme.background)) {
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 20.dp)
                                    .padding(top = 10.dp, bottom = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = "CONFLICT",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.error,
                                    maxLines = 1,
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    text = "有 ${state.conflictCount} 本内容不一致，请选择保留哪一版",
                                    modifier = Modifier.weight(1f),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.error,
                                )
                            }
                            FolioListRow(
                                index = null,
                                title = "内容不一致",
                                subtitle = "两端内容不一样，需要逐本确认",
                                trailing = "${state.conflictCount} 本",
                                onClick = {},
                            )
                            FolioHairline()
                        }
                    }
                }

                item {
                    SyncSection(
                        number = booksNumber,
                        title = "逐本状态",
                        trailing = "${books.size} 项",
                    )
                }

                items(books, key = { it.id }) { book ->
                    SyncBookRow(
                        book = book,
                        state = state,
                        onRetry = { vm.retrySync(book) },
                    )
                }

                item {
                    SyncSection(
                        number = diagNumber,
                        title = "诊断",
                        trailing = null,
                    )
                }
                item {
                    Text(
                        text = diagnosticsOf(state),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp)
                            .padding(top = 10.dp, bottom = 24.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/* ---------------- 报头 ---------------- */

@Composable
private fun SyncMasthead(onBack: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding()
            .padding(horizontal = 20.dp)
            .padding(top = 4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            FolioIconAction(
                icon = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "返回",
                onClick = onBack,
                size = 36.dp,
                iconSize = 18.dp,
            )
            Spacer(Modifier.width(4.dp))
            Text(
                text = "SYNC / REPORT",
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            text = "同步",
            modifier = Modifier.padding(top = 2.dp),
            style = MaterialTheme.typography.displayMedium,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(12.dp))
        FolioRule()
    }
}

/* ---------------- 状态块 ---------------- */

/** 三列统计表，列间一条 1dp 竖线。 */
@Composable
private fun StatusTable(state: ShelfUiState) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .padding(top = 16.dp, bottom = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FolioStat(
            value = if (state.online) "在线" else "离线",
            label = "连接状态",
            modifier = Modifier.weight(1f),
        )
        VerticalHairline()
        FolioStat(
            value = state.serverVersion.ifBlank { "—" },
            label = "桌面端版本",
            modifier = Modifier
                .weight(1f)
                .padding(start = 12.dp),
        )
        VerticalHairline()
        FolioStat(
            value = lastSyncText(state.lastSyncAt),
            label = "上次同步",
            modifier = Modifier
                .weight(1f)
                .padding(start = 12.dp),
        )
    }
}

@Composable
private fun VerticalHairline() {
    Box(
        Modifier
            .width(1.dp)
            .height(38.dp)
            .background(MaterialTheme.colorScheme.outlineVariant),
    )
}

private fun lastSyncText(at: Long): String {
    if (at <= 0L) return "从未"
    val minutes = ((System.currentTimeMillis() - at) / 60000L).coerceAtLeast(0L)
    return when {
        minutes < 1L -> "刚刚"
        minutes < 60L -> "$minutes 分前"
        minutes < 24L * 60L -> "${minutes / 60} 小时前"
        else -> android.text.format.DateFormat.format("MM-dd", at).toString()
    }
}

/* ---------------- 操作行 ---------------- */

@Composable
private fun ActionRow(syncing: Boolean, onSync: () -> Unit, onDetect: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
            .padding(bottom = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .weight(1f)
                .height(44.dp)
                .background(
                    MaterialTheme.colorScheme.onSurface,
                    RoundedCornerShape(2.dp),
                )
                .clickable(enabled = !syncing, onClick = onSync),
            contentAlignment = Alignment.Center,
        ) {
            if (syncing) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(14.dp),
                        strokeWidth = 1.5.dp,
                        color = MaterialTheme.colorScheme.background,
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = "同步中",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.background,
                        maxLines = 1,
                    )
                }
            } else {
                Text(
                    text = "立即同步",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.background,
                    maxLines = 1,
                )
            }
        }
        Box(
            Modifier
                .weight(1f)
                .height(44.dp)
                .border(
                    width = 1.dp,
                    color = MaterialTheme.colorScheme.onSurface,
                    shape = RoundedCornerShape(2.dp),
                )
                .clickable(onClick = onDetect),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "重新检测",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
            )
        }
    }
}

/* ---------------- 区块 / 逐本 ---------------- */

@Composable
private fun SyncSection(number: String, title: String, trailing: String?) {
    Box(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 20.dp)
            .padding(top = 18.dp, bottom = 8.dp),
    ) {
        FolioSectionHeader(number = number, title = title, trailing = trailing)
    }
}

@Composable
private fun SyncBookRow(book: Book, state: ShelfUiState, onRetry: () -> Unit) {
    val syncState = state.stateOf(book)
    val reason = state.reasonOf(book)
    val percent = state.transferPercent(book)
    val retryable = syncState == SyncState.FAILED || syncState == SyncState.NOT_SYNCED

    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background)) {
        FolioListRow(
            index = null,
            title = book.title,
            subtitle = buildString {
                append(state.sourceLabelOf(book))
                append(" · ")
                append(if (book.hasLocalFile) sizeLabel(book.size) else "未下载")
                if (!reason.isNullOrBlank()) append(" · ").append(reason)
            },
            trailing = labelOf(syncState),
            onClick = { if (retryable) onRetry() },
        )
        if (syncState == SyncState.TRANSFERRING) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 20.dp, end = 20.dp)
                    .padding(bottom = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FolioProgressRail(
                    progress = (percent / 100f).coerceIn(0f, 1f),
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    text = "$percent%",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
        }
        if (retryable) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
            ) {
                Text(
                    text = "重试",
                    modifier = Modifier
                        .clickable(onClick = onRetry)
                        .padding(horizontal = 20.dp, vertical = 6.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                    maxLines = 1,
                )
            }
        }
        FolioHairline()
    }
}

/* ---------------- 尾部诊断 ---------------- */

private fun diagnosticsOf(state: ShelfUiState): String {
    val last = if (state.lastSyncAt > 0L) {
        android.text.format.DateFormat.format("MM-dd HH:mm:ss", state.lastSyncAt).toString()
    } else {
        "—"
    }
    return buildString {
        appendLine("CONNECTION  ${state.connectionLabel}")
        appendLine("SERVER      ${state.serverVersion.ifBlank { "—" }}")
        appendLine("LAST SYNC   $last")
        appendLine("BOOKS       ${state.books.size}")
        appendLine("LOCAL       ${mbText(state.localBytes)} MB")
        append("CONFLICTS   ${state.conflictCount}")
    }
}

private fun mbText(bytes: Long): String =
    String.format(Locale.US, "%.1f", bytes / 1048576.0)

private fun labelOf(state: SyncState): String = when (state) {
    SyncState.SYNCED -> "已同步"
    SyncState.NOT_SYNCED -> "待同步"
    SyncState.TRANSFERRING -> "传输中"
    SyncState.FAILED -> "失败"
    SyncState.CONTENT_MISMATCH -> "内容不一致"
    SyncState.EXCLUDED -> "仅本机"
}

private fun sizeLabel(bytes: Long): String {
    if (bytes <= 0L) return "未知大小"
    val kb = bytes / 1024.0
    if (kb < 1024) return String.format(Locale.US, "%.0f KB", kb)
    return String.format(Locale.US, "%.1f MB", kb / 1024.0)
}
