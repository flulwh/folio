package com.folio.reader.ui

import com.folio.reader.ui.model.SyncModel

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.folio.reader.core.Book
import com.folio.reader.core.SyncState
import io.github.alexzhirkevich.cupertino.CupertinoButton
import io.github.alexzhirkevich.cupertino.CupertinoButtonDefaults
import io.github.alexzhirkevich.cupertino.CupertinoHorizontalDivider
import io.github.alexzhirkevich.cupertino.CupertinoIcon
import io.github.alexzhirkevich.cupertino.CupertinoText
import io.github.alexzhirkevich.cupertino.icons.CupertinoIcons
import io.github.alexzhirkevich.cupertino.icons.outlined.ChevronBackward
import io.github.alexzhirkevich.cupertino.theme.CupertinoTheme
import java.util.Locale

/**
 * 同步报告。
 *
 * 三个数字横排当表头，下面一条发丝线；逐本状态就是普通列表行，
 * 传输中在行下补一条 2dp 进度线，失败行直接给「重试」。没有卡片。
 */
@Composable
fun SyncStatusScreen(
    model: SyncModel,
    onBack: () -> Unit,
) {
    val vm = model.session
    val state by vm.shelf.collectAsState()
    val books = state.books.distinctBy { it.id }
    val scheme = CupertinoTheme.colorScheme

    Column(Modifier.fillMaxSize().background(scheme.systemBackground)) {
        SyncHeader(onBack = onBack)

        LazyColumn(
            modifier = Modifier.fillMaxWidth().weight(1f).navigationBarsPadding(),
            contentPadding = PaddingValues(bottom = 32.dp),
        ) {
            item("stats") {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = PageMargin),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Stat(value = if (state.online) "在线" else "离线", label = "连接", Modifier.weight(1f))
                    StatDivider()
                    Stat(
                        value = state.serverVersion.ifBlank { "—" },
                        label = "桌面端",
                        modifier = Modifier.weight(1f),
                    )
                    StatDivider()
                    Stat(value = lastSyncText(state.lastSyncAt), label = "上次同步", Modifier.weight(1f))
                }
                CupertinoHorizontalDivider(
                    modifier = Modifier.fillMaxWidth().padding(start = PageMargin),
                    color = scheme.separator,
                )
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = PageMargin, vertical = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    CupertinoButton(
                        onClick = { vm.syncNow() },
                        enabled = !state.syncing,
                        modifier = Modifier.weight(1f),
                        colors = CupertinoButtonDefaults.filledButtonColors(),
                    ) {
                        CupertinoText(
                            text = if (state.syncing) "同步中…" else "立即同步",
                            fontSize = 13.5.sp,
                        )
                    }
                    CupertinoButton(
                        onClick = { vm.testConnection() },
                        modifier = Modifier.weight(1f),
                        colors = CupertinoButtonDefaults.grayButtonColors(),
                    ) {
                        CupertinoText(text = "重新检测", fontSize = 13.5.sp)
                    }
                }
            }

            if (state.conflictCount > 0) {
                item("conflicts") {
                    Row(
                        Modifier.fillMaxWidth().background(scheme.accent.copy(alpha = 0.12f)),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.width(2.dp).height(34.dp).background(scheme.accent))
                        CupertinoText(
                            text = "${state.conflictCount} 本内容不一致，请选择保留哪一版",
                            modifier = Modifier.padding(horizontal = 18.dp, vertical = 8.dp),
                            fontSize = 12.5.sp,
                            color = scheme.accent,
                            maxLines = 2,
                        )
                    }
                }
            }

            item("books-label") {
                GroupLabel(
                    text = "逐本状态",
                    trailing = if (books.isEmpty()) "0" else "${books.size}",
                    inset = PageMargin,
                )
                CupertinoHorizontalDivider(
                    modifier = Modifier.fillMaxWidth().padding(start = PageMargin),
                    color = scheme.separator,
                )
            }

            if (books.isEmpty()) {
                item("books-empty") {
                    CupertinoText(
                        text = "导入一本 txt，或连上桌面端同步一次。",
                        modifier = Modifier.padding(horizontal = PageMargin, vertical = 16.dp),
                        fontSize = 12.5.sp,
                        color = scheme.secondaryLabel,
                    )
                }
            } else {
                items(count = books.size, key = { books[it].id }) { index ->
                    Reveal(index = index) {
                        SyncBookRow(
                            book = books[index],
                            state = state,
                            onRetry = { vm.retrySync(books[index]) },
                        )
                    }
                }
            }

            item("diagnostics") {
                GroupLabel(text = "诊断", inset = PageMargin)
                CupertinoHorizontalDivider(
                    modifier = Modifier.fillMaxWidth().padding(start = PageMargin),
                    color = scheme.separator,
                )
                CupertinoText(
                    text = diagnosticsOf(state),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = PageMargin, vertical = 14.dp),
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    color = scheme.secondaryLabel,
                )
                CupertinoHorizontalDivider(
                    modifier = Modifier.fillMaxWidth().padding(start = PageMargin),
                    color = scheme.separator,
                )
            }
        }
    }
}

@Composable
private fun SyncHeader(onBack: () -> Unit) {
    val scheme = CupertinoTheme.colorScheme
    Column(
        Modifier
            .fillMaxWidth()
            .background(scheme.systemBackground)
            .statusBarsPadding()
            .padding(horizontal = PageMargin),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(top = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val source = remember { MutableInteractionSource() }
            Box(
                Modifier
                    .pressScale(source)
                    .size(40.dp)
                    .clip(CircleShape)
                    .clickable(interactionSource = source, indication = null, onClick = onBack),
                contentAlignment = Alignment.Center,
            ) {
                CupertinoIcon(
                    imageVector = CupertinoIcons.Outlined.ChevronBackward,
                    contentDescription = "返回",
                    modifier = Modifier.size(19.dp),
                    tint = scheme.label,
                )
            }
        }
        CupertinoText(
            text = "同步",
            modifier = Modifier.padding(top = 2.dp, bottom = 10.dp),
            fontSize = 26.sp,
            fontWeight = FontWeight.SemiBold,
            color = scheme.label,
            maxLines = 1,
        )
    }
}

/** 分组标题：小字号、拉字距、灰。 */
@Composable
fun GroupLabel(
    text: String,
    modifier: Modifier = Modifier,
    trailing: String? = null,
    inset: androidx.compose.ui.unit.Dp = PageMargin,
    topGap: androidx.compose.ui.unit.Dp = 24.dp,
) {
    val scheme = CupertinoTheme.colorScheme
    Row(
        modifier
            .fillMaxWidth()
            .padding(start = inset, end = inset, top = topGap, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CupertinoText(
            text = text,
            modifier = Modifier.weight(1f),
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = 1.2.sp,
            color = scheme.secondaryLabel,
            maxLines = 1,
        )
        if (trailing != null) {
            CupertinoText(
                text = trailing,
                fontSize = 10.5.sp,
                color = scheme.secondaryLabel,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun Stat(value: String, label: String, modifier: Modifier = Modifier) {
    val scheme = CupertinoTheme.colorScheme
    Column(modifier = modifier.padding(vertical = 12.dp)) {
        CupertinoText(
            text = value,
            fontSize = 16.sp,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Medium,
            color = scheme.label,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(3.dp))
        CupertinoText(text = label, fontSize = 10.sp, color = scheme.secondaryLabel, maxLines = 1)
    }
}

@Composable
private fun StatDivider() {
    Box(Modifier.width(0.6.dp).height(26.dp).background(CupertinoTheme.colorScheme.separator))
}

@Composable
private fun SyncBookRow(book: Book, state: ShelfUiState, onRetry: () -> Unit) {
    val scheme = CupertinoTheme.colorScheme
    val syncState = state.stateOf(book)
    val reason = state.reasonOf(book)
    val percent = state.transferPercent(book)
    val retryable = syncState == SyncState.FAILED || syncState == SyncState.NOT_SYNCED

    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .then(if (retryable) Modifier.clickable(onClick = onRetry) else Modifier)
                .padding(horizontal = PageMargin)
                .padding(vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                CupertinoText(
                    text = book.title,
                    fontSize = 14.5.sp,
                    fontWeight = FontWeight.Medium,
                    color = scheme.label,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(3.dp))
                CupertinoText(
                    text = buildString {
                        append(state.sourceLabelOf(book))
                        append(" · ")
                        append(if (book.hasLocalFile) sizeLabel(book.size) else "未下载")
                        if (!reason.isNullOrBlank()) append(" · ").append(reason)
                    },
                    fontSize = 11.sp,
                    color = scheme.secondaryLabel,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.width(10.dp))
            CupertinoText(
                text = labelOf(syncState),
                fontSize = 11.sp,
                color = when (syncState) {
                    SyncState.FAILED, SyncState.CONTENT_MISMATCH -> scheme.accent
                    else -> scheme.secondaryLabel
                },
                maxLines = 1,
            )
            if (retryable) {
                Spacer(Modifier.width(10.dp))
                CupertinoText(
                    text = "重试",
                    modifier = Modifier
                        .clickable(onClick = onRetry)
                        .padding(horizontal = 4.dp, vertical = 4.dp),
                    fontSize = 11.sp,
                    color = scheme.accent,
                    maxLines = 1,
                )
            }
        }
        if (syncState == SyncState.TRANSFERRING) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = PageMargin, end = PageMargin, bottom = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier
                        .weight(1f)
                        .height(2.dp)
                        .background(scheme.separator),
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth((percent / 100f).coerceIn(0f, 1f))
                            .height(2.dp)
                            .background(scheme.accent)
                    )
                }
                Spacer(Modifier.width(10.dp))
                CupertinoText(text = "$percent%", fontSize = 10.sp, color = scheme.secondaryLabel)
            }
        }
        CupertinoHorizontalDivider(
            modifier = Modifier.fillMaxWidth().padding(start = PageMargin),
            color = scheme.separator,
        )
    }
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
