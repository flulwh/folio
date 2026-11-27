package com.folio.reader.ui.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
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
import com.folio.reader.ui.FolioSheet
import io.github.alexzhirkevich.cupertino.CupertinoSearchTextField
import io.github.alexzhirkevich.cupertino.CupertinoText
import io.github.alexzhirkevich.cupertino.ExperimentalCupertinoApi
import io.github.alexzhirkevich.cupertino.section.SectionStyle
import io.github.alexzhirkevich.cupertino.section.section
import io.github.alexzhirkevich.cupertino.theme.CupertinoTheme

/**
 * 目录面板（Cupertino）：搜索框 + 章节列表，当前章用强调色块标出来。
 *
 * 本机书的章来自正则切分，云端书的章来自 `/api/toc`，这一层只认 [labels] 与 [currentIndex]。
 */
@OptIn(ExperimentalCupertinoApi::class)
@Composable
fun TocSheet(
    labels: List<String>,
    currentIndex: Int,
    onSelect: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    var keyword by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val scheme = CupertinoTheme.colorScheme

    val filtered = if (keyword.isBlank()) {
        labels.indices.toList()
    } else {
        labels.indices.filter { labels[it].contains(keyword.trim(), ignoreCase = true) }
    }

    LaunchedEffect(currentIndex, labels.size) {
        val at = filtered.indexOf(currentIndex)
        if (at >= 0) listState.scrollToItem(at)
    }

    FolioSheet(
        onDismiss = onDismiss,
        title = "目录",
        subtitle = "${labels.size} 章",
    ) {
        CupertinoSearchTextField(
            value = keyword,
            onValueChange = { keyword = it },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            placeholder = {
                CupertinoText(text = "搜索章节", fontSize = 14.sp, color = scheme.placeholderText)
            },
        )

        if (filtered.isEmpty()) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                CupertinoText(text = "没有找到", fontSize = 14.sp, color = scheme.label)
                Spacer(Modifier.height(6.dp))
                CupertinoText(text = "换个更短的关键词试试", fontSize = 12.sp, color = scheme.secondaryLabel)
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f, fill = false),
            ) {
                section(style = SectionStyle.InsetGrouped) {
                    filtered.forEach { chapterIndex ->
                        item(key = chapterIndex) { padding ->
                            val selected = chapterIndex == currentIndex
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(padding)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(
                                        if (selected) scheme.accent.copy(alpha = 0.12f)
                                        else androidx.compose.ui.graphics.Color.Transparent
                                    )
                                    // 少了这个 modifier，目录就只是「能看不能点」的列表：
                                    // onSelect 一路传到 SessionStore.switchChapter 都接好了，
                                    // 但没有 clickable 就永远不会触发。漫画目录有这一行，小说目录漏了。
                                    .clickable { onSelect(chapterIndex) }
                                    .padding(horizontal = 12.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                CupertinoText(
                                    text = (chapterIndex + 1).toString().padStart(2, '0'),
                                    fontSize = 11.sp,
                                    color = if (selected) scheme.accent else scheme.secondaryLabel,
                                    maxLines = 1,
                                )
                                Spacer(Modifier.width(12.dp))
                                CupertinoText(
                                    text = labels[chapterIndex].ifBlank { "第 ${chapterIndex + 1} 章" },
                                    modifier = Modifier.weight(1f),
                                    fontSize = 15.sp,
                                    color = if (selected) scheme.accent else scheme.label,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                if (selected) {
                                    Box(
                                        Modifier
                                            .size(6.dp)
                                            .clip(CircleShape)
                                            .background(scheme.accent)
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
