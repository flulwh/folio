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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.folio.reader.ui.miuix.HyperSheet
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextField
import top.yukonga.miuix.kmp.theme.MiuixTheme

/**
 * 目录面板（HyperOS）：胶囊搜索框 + 章节列表，当前章用朱砂块标出来。
 *
 * 本机书的章来自正则切分，云端书的章来自 `/api/toc`，这一层只认 [labels] 与 [currentIndex]。
 */
@Composable
fun TocSheet(
    labels: List<String>,
    currentIndex: Int,
    onSelect: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    var keyword by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val scheme = MiuixTheme.colorScheme

    val filtered = if (keyword.isBlank()) {
        labels.indices.toList()
    } else {
        labels.indices.filter { labels[it].contains(keyword.trim(), ignoreCase = true) }
    }

    LaunchedEffect(currentIndex, labels.size) {
        val at = filtered.indexOf(currentIndex)
        if (at >= 0) listState.scrollToItem(at)
    }

    HyperSheet(
        onDismiss = onDismiss,
        title = "目录",
        subtitle = "${labels.size} 章",
    ) {
        TextField(
            value = keyword,
            onValueChange = { keyword = it },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            label = "搜索章节",
            useLabelAsPlaceholder = true,
            singleLine = true,
            cornerRadius = 16.dp,
        )

        if (filtered.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(text = "没有找到", fontSize = 14.sp, color = scheme.onSurface)
                Spacer(Modifier.height(6.dp))
                Text(text = "换个更短的关键词试试", fontSize = 12.sp, color = scheme.onSurfaceVariantSummary)
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f, fill = false)
                    .padding(top = 4.dp),
            ) {
                itemsIndexed(filtered, key = { _, chapterIndex -> chapterIndex }) { _, chapterIndex ->
                    val selected = chapterIndex == currentIndex
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 2.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .background(if (selected) scheme.primaryContainer else scheme.surface)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                                onClick = { onSelect(chapterIndex) },
                            )
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = (chapterIndex + 1).toString().padStart(2, '0'),
                            fontSize = 11.sp,
                            color = if (selected) scheme.primary else scheme.onSurfaceVariantSummary,
                            maxLines = 1,
                        )
                        Spacer(Modifier.width(12.dp))
                        Text(
                            text = labels[chapterIndex].ifBlank { "第 ${chapterIndex + 1} 章" },
                            modifier = Modifier.weight(1f),
                            fontSize = 15.sp,
                            color = if (selected) scheme.primary else scheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (selected) {
                            Box(
                                Modifier
                                    .size(6.dp)
                                    .clip(RoundedCornerShape(3.dp))
                                    .background(scheme.primary)
                            )
                        }
                    }
                }
            }
        }
    }
}
