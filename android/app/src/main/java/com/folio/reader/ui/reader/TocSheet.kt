package com.folio.reader.ui.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.dp
import com.folio.reader.ui.FolioHairline
import com.folio.reader.ui.FolioKicker
import com.folio.reader.ui.FolioListRow
import com.folio.reader.ui.FolioSheet

/**
 * 目录抽屉：等宽章号索引 + 章节过滤 + 当前章朱红标记。
 *
 * 本机书的章来自正则切分，云端书的章来自 `/api/toc`，两者在这一层长得一样，
 * UI 只认 [labels] 与 [currentIndex]。
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

    val filtered = if (keyword.isBlank()) {
        labels.indices.toList()
    } else {
        labels.indices.filter { labels[it].contains(keyword.trim(), ignoreCase = true) }
    }

    // 打开时把当前章滚进视野，用户不用自己找
    LaunchedEffect(currentIndex, labels.size) {
        val at = filtered.indexOf(currentIndex)
        if (at >= 0) listState.scrollToItem(at)
    }

    FolioSheet(
        onDismiss = onDismiss,
        title = "目录",
        kicker = "INDEX / ${labels.size} 章",
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
                value = keyword,
                onValueChange = { keyword = it },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium.copy(
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                modifier = Modifier.weight(1f),
                decorationBox = { inner ->
                    Box {
                        if (keyword.isEmpty()) {
                            Text(
                                text = "搜章节标题",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        inner()
                    }
                },
            )
        }
        FolioHairline(Modifier.padding(horizontal = 20.dp))

        if (filtered.isEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 56.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = "NO MATCH",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "没有找到「${keyword.trim()}」",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxWidth()
                    .fillMaxHeight(0.66f),
            ) {
                itemsIndexed(filtered, key = { _, chapterIndex -> chapterIndex }) { _, chapterIndex ->
                    val selected = chapterIndex == currentIndex
                    Box(Modifier.fillMaxWidth()) {
                        FolioListRow(
                            index = String.format("%03d", chapterIndex + 1),
                            title = labels[chapterIndex].ifBlank { "第 ${chapterIndex + 1} 章" },
                            selected = selected,
                            onClick = { onSelect(chapterIndex) },
                        )
                        if (selected) {
                            // 朱红竖条压在左边线上，像排版软件里的当前段落标记
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
