package com.folio.reader.ui.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.folio.reader.core.SearchHit
import com.folio.reader.ui.FolioSheet
import com.folio.reader.ui.SearchUiState
import io.github.alexzhirkevich.cupertino.CupertinoSearchTextField
import io.github.alexzhirkevich.cupertino.CupertinoText
import io.github.alexzhirkevich.cupertino.theme.CupertinoTheme

/**
 * 全书搜索面板（Cupertino）：搜索框 + 命中状态 + 高亮结果。
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
    val scheme = CupertinoTheme.colorScheme

    LaunchedEffect(Unit) {
        withFrameNanos { }
        focusRequester.requestFocus()
    }

    FolioSheet(
        onDismiss = onDismiss,
        title = "全书搜索",
        subtitle = if (state.total > 0) "命中 ${state.total} 条" else "SEARCH",
    ) {
        CupertinoSearchTextField(
            value = state.query,
            onValueChange = onQueryChange,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .focusRequester(focusRequester),
            placeholder = {
                CupertinoText(text = "输入关键词", fontSize = 14.sp, color = scheme.placeholderText)
            },
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                CupertinoText(
                    text = when {
                        state.running -> "正在搜索…"
                        state.cursor < 0 -> "命中 ${state.total} 条"
                        else -> "当前 ${state.cursor + 1} / ${state.total}"
                    },
                    fontSize = 12.sp,
                    color = if (state.running) scheme.accent else scheme.secondaryLabel,
                    maxLines = 1,
                )
            }
            StepAction("上一处", state.total > 0) { onStep(-1) }
            Spacer(Modifier.width(6.dp))
            StepAction("下一处", state.total > 0) { onStep(1) }
        }

        when {
            state.query.isBlank() -> EmptyHint("输入关键词，搜这一本书")
            state.running && state.hits.isEmpty() -> EmptyHint("正在搜索…")
            state.hits.isEmpty() -> EmptyHint("没有找到「${state.query.trim()}」")
            else -> LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f, fill = false)) {
                itemsIndexed(
                    items = state.hits,
                    key = { _, hit -> "${hit.paraIndex}-${hit.start}" },
                ) { index, hit ->
                    val current = index == state.cursor
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                                onClick = { onJump(hit) },
                            )
                            .background(
                                if (current) scheme.accent.copy(alpha = 0.12f)
                                else androidx.compose.ui.graphics.Color.Transparent
                            )
                            .padding(horizontal = 20.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        CupertinoText(
                            text = "${index + 1}".padStart(3, '0'),
                            fontSize = 11.sp,
                            color = if (current) scheme.accent else scheme.secondaryLabel,
                            modifier = Modifier.widthIn(min = 34.dp),
                        )
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            CupertinoText(
                                text = hit.chapterTitle.ifBlank { "第 ${hit.chapterIndex + 1} 章" },
                                fontSize = 11.sp,
                                color = scheme.secondaryLabel,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Spacer(Modifier.height(4.dp))
                            CupertinoText(
                                text = highlighted(hit),
                                fontSize = 14.5.sp,
                                color = scheme.label,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        if (current) {
                            Box(
                                Modifier
                                    .width(3.dp)
                                    .height(20.dp)
                                    .background(scheme.accent)
                            )
                        }
                    }
                }
            }
        }
    }
}

/** 命中摘录：关键词用强调色薄底 + 加粗标出来。 */
@Composable
private fun highlighted(hit: SearchHit): AnnotatedString {
    val accent = CupertinoTheme.colorScheme.accent
    return buildAnnotatedString {
        append(hit.excerpt)
        if (hit.start >= 0 && hit.start < hit.end && hit.end <= hit.excerpt.length) {
            addStyle(
                SpanStyle(
                    background = accent.copy(alpha = 0.16f),
                    color = accent,
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
        modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CupertinoText(
            text = text,
            fontSize = 13.sp,
            color = CupertinoTheme.colorScheme.secondaryLabel,
        )
    }
}

@Composable
private fun StepAction(label: String, enabled: Boolean, onClick: () -> Unit) {
    CupertinoText(
        text = label,
        modifier = Modifier
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                enabled = enabled,
                onClick = onClick,
            )
            .padding(horizontal = 10.dp, vertical = 6.dp),
        fontSize = 12.sp,
        color = CupertinoTheme.colorScheme.accent.copy(
            alpha = if (enabled) 1f else 0.32f
        ),
        maxLines = 1,
    )
}
