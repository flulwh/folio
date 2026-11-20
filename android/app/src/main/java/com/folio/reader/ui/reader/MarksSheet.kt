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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.folio.reader.core.ReaderMark
import com.folio.reader.ui.FolioSheet
import io.github.alexzhirkevich.cupertino.CupertinoButton
import io.github.alexzhirkevich.cupertino.CupertinoButtonDefaults
import io.github.alexzhirkevich.cupertino.CupertinoText
import io.github.alexzhirkevich.cupertino.CupertinoTextField
import io.github.alexzhirkevich.cupertino.theme.CupertinoTheme
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 书签与笔记面板（Cupertino）：统计 + 主操作 + 痕迹列表。
 * 点整行跳转；行内「跳转 / 笔记 / 删除」是小号文字按钮。
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
    val scheme = CupertinoTheme.colorScheme

    FolioSheet(
        onDismiss = onDismiss,
        title = "书签与笔记",
        subtitle = "${marks.size} 条痕迹",
    ) {
        // 三条统计
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            StatCell("${marks.count { it.isBookmark }}", "书签", Modifier.weight(1f))
            StatCell("${marks.count { !it.isBookmark }}", "划线", Modifier.weight(1f))
            StatCell(if (isBookmarked) "有" else "无", "P.${currentPara + 1}", Modifier.weight(1f))
        }

        CupertinoButton(
            onClick = onToggleBookmark,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 18.dp, vertical = 8.dp),
            colors = CupertinoButtonDefaults.filledButtonColors(),
        ) {
            CupertinoText(
                text = if (isBookmarked) "取消本页书签" else "给当前位置加书签",
                fontSize = 15.sp,
            )
        }

        if (marks.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                CupertinoText(text = "还没有痕迹", fontSize = 14.sp, color = scheme.label)
                Spacer(Modifier.height(6.dp))
                CupertinoText(
                    text = "点顶栏书签图标，或在段落上划线",
                    fontSize = 12.sp,
                    color = scheme.secondaryLabel,
                )
            }
        } else {
            LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f, fill = false)) {
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
        NoteEditor(
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
private fun StatCell(value: String, label: String, modifier: Modifier = Modifier) {
    val scheme = CupertinoTheme.colorScheme
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(scheme.secondarySystemFill)
            .padding(vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CupertinoText(text = value, fontSize = 18.sp, color = scheme.label)
        Spacer(Modifier.height(2.dp))
        CupertinoText(text = label, fontSize = 11.sp, color = scheme.secondaryLabel, maxLines = 1)
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
    val scheme = CupertinoTheme.colorScheme
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
        CupertinoText(
            text = "P.${mark.paraIndex + 1}",
            fontSize = 11.sp,
            color = scheme.secondaryLabel,
            modifier = Modifier.widthIn(min = 40.dp),
        )
        Column(Modifier.weight(1f)) {
            CupertinoText(
                text = mark.excerpt.ifBlank { "（无摘录）" },
                fontSize = 14.5.sp,
                color = scheme.label,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (mark.note.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Row(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
                    Box(
                        Modifier
                            .width(2.dp)
                            .fillMaxHeight()
                            .background(scheme.accent)
                    )
                    Spacer(Modifier.width(8.dp))
                    CupertinoText(
                        text = mark.note,
                        fontSize = 12.5.sp,
                        color = scheme.secondaryLabel,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                CupertinoText(
                    text = buildString {
                        append(mark.chapterTitle.ifBlank { "第 ${mark.chapterIndex + 1} 章" })
                        append(" · ")
                        append(dateLabel)
                    },
                    fontSize = 11.sp,
                    color = scheme.secondaryLabel,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                MarkAction("跳转", scheme.secondaryLabel, onJump)
                MarkAction("笔记", scheme.secondaryLabel, onEdit)
                MarkAction("删除", scheme.accent, onRemove)
            }
        }
    }
}

@Composable
private fun MarkAction(text: String, color: Color, onClick: () -> Unit) {
    CupertinoText(
        text = text,
        modifier = Modifier
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            )
            .padding(horizontal = 8.dp, vertical = 4.dp),
        fontSize = 11.sp,
        color = color,
        maxLines = 1,
    )
}

@Composable
private fun NoteEditor(
    mark: ReaderMark,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var text by remember(mark.id) { mutableStateOf(mark.note) }
    val scheme = CupertinoTheme.colorScheme

    FolioSheet(onDismiss = onDismiss, title = "笔记") {
        Column(Modifier.padding(horizontal = 16.dp)) {
            CupertinoTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = {
                    CupertinoText(
                        text = "写点什么",
                        fontSize = 14.sp,
                        color = scheme.placeholderText,
                    )
                },
                minLines = 4,
            )
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                CupertinoButton(
                    onClick = onDismiss,
                    modifier = Modifier.weight(1f),
                    colors = CupertinoButtonDefaults.grayButtonColors(),
                ) {
                    CupertinoText(text = "取消", fontSize = 14.sp)
                }
                CupertinoButton(
                    onClick = { onConfirm(text) },
                    modifier = Modifier.weight(1f),
                    colors = CupertinoButtonDefaults.filledButtonColors(),
                ) {
                    CupertinoText(text = "保存", fontSize = 14.sp)
                }
            }
        }
    }
}
