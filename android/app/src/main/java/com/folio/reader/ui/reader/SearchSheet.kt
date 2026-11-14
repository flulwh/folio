package com.folio.reader.ui.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folio.reader.core.SearchHit
import com.folio.reader.ui.FolioHairline
import com.folio.reader.ui.FolioIconAction
import com.folio.reader.ui.FolioKicker
import com.folio.reader.ui.FolioSheet
import com.folio.reader.ui.SearchUiState

/**
 * 全书搜索抽屉：等宽输入行 + 命中状态行 + 高亮结果列表。
 *
 * 命中高亮由 [SearchHit.start] / [SearchHit.end] 直接给出，UI 不再重复找词。
 */
@Composable
fun SearchSheet(
    state: SearchUiState,
    onQueryChange: (String) -> Unit,
    onJump: (SearchHit) -> Unit,
    onStep: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    val focusRequester = remember { FocusRequester() }

    // 等第一帧布局完成再要焦点，避免 FocusRequester 尚未挂上
    LaunchedEffect(Unit) {
        withFrameNanos { }
        focusRequester.requestFocus()
    }

    FolioSheet(
        onDismiss = onDismiss,
        title = "全书搜索",
        kicker = "SEARCH / ${state.total}",
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(top = 14.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FolioKicker("FIND")
            Spacer(Modifier.width(12.dp))
            BasicTextField(
                value = state.query,
                onValueChange = onQueryChange,
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium.copy(
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                modifier = Modifier
                    .weight(1f)
                    .focusRequester(focusRequester),
                decorationBox = { inner ->
                    Box {
                        if (state.query.isEmpty()) {
                            Text(
                                text = "输入关键词",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        inner()
                    }
                },
            )
            if (state.query.isNotEmpty()) {
                Spacer(Modifier.width(4.dp))
                FolioIconAction(
                    icon = Icons.Filled.Close,
                    contentDescription = "清除",
                    onClick = { onQueryChange("") },
                    size = 32.dp,
                    iconSize = 16.dp,
                )
            }
        }
        FolioHairline(Modifier.padding(horizontal = 20.dp))

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Row {
                    FolioKicker("命中 ${state.total} 条")
                    Spacer(Modifier.width(12.dp))
                    FolioKicker(
                        if (state.cursor < 0) {
                            "未定位"
                        } else {
                            "当前 ${state.cursor + 1}/${state.total}"
                        }
                    )
                }
                if (state.running) {
                    Spacer(Modifier.height(2.dp))
                    FolioKicker("正在搜索…", color = MaterialTheme.colorScheme.primary)
                }
            }
            StepAction("↑ 上一处", enabled = state.total > 0) { onStep(-1) }
            Spacer(Modifier.width(4.dp))
            StepAction("↓ 下一处", enabled = state.total > 0) { onStep(1) }
        }

        when {
            state.query.isBlank() -> EmptyHint("输入关键词，搜当前书")
            state.running && state.hits.isEmpty() -> EmptyHint("正在搜索…")
            state.hits.isEmpty() -> EmptyHint("没有找到「${state.query.trim()}」")
            else -> LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .fillMaxHeight(0.54f),
            ) {
                itemsIndexed(
                    items = state.hits,
                    key = { _, hit -> "${hit.paraIndex}-${hit.start}" },
                ) { index, hit ->
                    val current = index == state.cursor
                    Box(Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable(
                                    interactionSource = remember { MutableInteractionSource() },
                                    indication = null,
                                    onClick = { onJump(hit) },
                                ),
                        ) {
                            FolioHairline()
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 20.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.Top,
                            ) {
                                Text(
                                    text = String.format("%03d", index + 1),
                                    style = MaterialTheme.typography.labelMedium,
                                    color = if (current) {
                                        MaterialTheme.colorScheme.primary
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    },
                                    modifier = Modifier.widthIn(min = 34.dp),
                                )
                                Spacer(Modifier.width(12.dp))
                                Column(Modifier.weight(1f)) {
                                    FolioKicker(
                                        hit.chapterTitle.ifBlank {
                                            "第 ${hit.chapterIndex + 1} 章"
                                        }
                                    )
                                    Spacer(Modifier.height(4.dp))
                                    Text(
                                        text = highlighted(hit),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurface,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                        }
                        if (current) {
                            Box(Modifier.matchParentSize()) {
                                Box(
                                    Modifier
                                        .fillMaxHeight()
                                        .width(2.dp)
                                        .background(MaterialTheme.colorScheme.primary)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** 命中摘录：关键词用朱红薄底 + 加粗标出来。 */
@Composable
private fun highlighted(hit: SearchHit) = run {
    val primary = MaterialTheme.colorScheme.primary
    buildAnnotatedString {
        append(hit.excerpt)
        if (hit.start >= 0 && hit.start < hit.end && hit.end <= hit.excerpt.length) {
            addStyle(
                SpanStyle(
                    background = primary.copy(alpha = 0.16f),
                    color = primary,
                    fontWeight = FontWeight.Bold,
                ),
                hit.start,
                hit.end,
            )
        }
    }
}

@Composable
private fun EmptyHint(text: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 56.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun StepAction(label: String, enabled: Boolean, onClick: () -> Unit) {
    Text(
        text = label,
        modifier = Modifier
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                enabled = enabled,
                onClick = onClick,
            )
            .padding(horizontal = 6.dp, vertical = 4.dp),
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(
            alpha = if (enabled) 1f else 0.32f
        ),
        maxLines = 1,
    )
}
