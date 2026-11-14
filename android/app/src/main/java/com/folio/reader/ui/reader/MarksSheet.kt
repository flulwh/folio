package com.folio.reader.ui.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folio.reader.core.ReaderMark
import com.folio.reader.ui.FolioHairline
import com.folio.reader.ui.FolioKicker
import com.folio.reader.ui.FolioSheet
import com.folio.reader.ui.FolioStat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 书签与笔记抽屉：三条统计 + 整宽反白主操作 + 按段落升序的痕迹列表。
 *
 * 点整行跳转；行内「跳转 / 笔记 / 删除」是等宽小字文本按钮，不做 Material 胶囊。
 */
@Composable
fun MarksSheet(
    marks: List<ReaderMark>,
    currentPara: Int,
    isBookmarked: Boolean,
    onToggleBookmark: () -> Unit,
    onJump: (ReaderMark) -> Unit,
    onRemove: (String) -> Unit,
    onUpdateNote: (String, String) -> Unit,
    onDismiss: () -> Unit,
) {
    var editing by remember { mutableStateOf<ReaderMark?>(null) }
    val dateFormat = remember { SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()) }

    FolioSheet(
        onDismiss = onDismiss,
        title = "书签与笔记",
        kicker = "MARKS / ${marks.size}",
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(top = 16.dp, bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            FolioStat(
                value = "${marks.count { it.isBookmark }}",
                label = "书签数",
                modifier = Modifier.weight(1f),
            )
            FolioStat(
                value = "${marks.count { !it.isBookmark }}",
                label = "划线条数",
                modifier = Modifier.weight(1f),
            )
            FolioStat(
                value = if (isBookmarked) "有" else "无",
                label = "P.${currentPara + 1} 书签",
                modifier = Modifier.weight(1f),
                alignEnd = true,
            )
        }
        FolioHairline(Modifier.padding(horizontal = 20.dp))

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(top = 14.dp, bottom = 12.dp)
                .height(44.dp)
                .background(
                    color = MaterialTheme.colorScheme.onSurface,
                    shape = RoundedCornerShape(2.dp),
                )
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onToggleBookmark,
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = if (isBookmarked) "取消本页书签" else "给当前位置加书签",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.background,
            )
        }

        if (marks.isEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 56.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = "NO MARKS",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "点顶栏书签图标，或在段落上划线",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .fillMaxHeight(0.56f),
            ) {
                items(marks, key = { it.id }) { mark ->
                    MarkRow(
                        mark = mark,
                        dateLabel = dateFormat.format(Date(mark.createdAt)),
                        onJump = { onJump(mark) },
                        onEdit = { editing = mark },
                        onRemove = { onRemove(mark.id) },
                    )
                }
            }
        }
    }

    val noteMark = editing
    if (noteMark != null) {
        NoteDialog(
            mark = noteMark,
            onDismiss = { editing = null },
            onConfirm = { text ->
                onUpdateNote(noteMark.id, text)
                editing = null
            },
        )
    }
}

@Composable
private fun MarkRow(
    mark: ReaderMark,
    dateLabel: String,
    onJump: () -> Unit,
    onEdit: () -> Unit,
    onRemove: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onJump,
            )
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = "P.${mark.paraIndex + 1}",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.widthIn(min = 40.dp),
        )
        Column(Modifier.weight(1f)) {
            Text(
                text = mark.excerpt.ifBlank { "（无摘录）" },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (mark.note.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(IntrinsicSize.Min),
                ) {
                    Box(
                        Modifier
                            .width(2.dp)
                            .fillMaxHeight()
                            .background(MaterialTheme.colorScheme.primary)
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = mark.note,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = buildString {
                        append(
                            mark.chapterTitle.ifBlank { "第 ${mark.chapterIndex + 1} 章" }
                        )
                        append(" · ")
                        append(dateLabel)
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                MarkAction("跳转", MaterialTheme.colorScheme.onSurfaceVariant, onJump)
                MarkAction("笔记", MaterialTheme.colorScheme.onSurfaceVariant, onEdit)
                MarkAction("删除", MaterialTheme.colorScheme.primary, onRemove)
            }
        }
    }
}

/** 行内等宽文字按钮：无涟漪、无底色，只有字。 */
@Composable
private fun MarkAction(text: String, color: Color, onClick: () -> Unit) {
    Text(
        text = text,
        modifier = Modifier
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            )
            .padding(horizontal = 8.dp, vertical = 4.dp),
        style = MaterialTheme.typography.labelSmall,
        color = color,
        maxLines = 1,
    )
}

@Composable
private fun NoteDialog(
    mark: ReaderMark,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    // 每条标记各自持有一份草稿，切换条目时不会串词
    var text by remember(mark.id) { mutableStateOf(mark.note) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("笔记") },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3,
                placeholder = { Text("写点什么") },
            )
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(text) }) { Text("保存") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        },
    )
}
