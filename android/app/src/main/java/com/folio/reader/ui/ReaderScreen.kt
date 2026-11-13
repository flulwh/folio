package com.folio.reader.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.distinctUntilChanged

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReaderScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
) {
    val reader by vm.reader.collectAsState()
    val settings by vm.settingsState.collectAsState()
    val listState = rememberLazyListState()
    var scrubbing by remember { mutableStateOf(false) }
    var sliderValue by remember { mutableFloatStateOf(0f) }

    val book = reader.book
    val fontSize = (17f * settings.fontScale).sp
    val lineHeight = (fontSize.value * settings.lineHeight).sp
    val scrollTarget by vm.scrollTarget.collectAsState()

    LaunchedEffect(book?.id) {
        val index = reader.paraIndex
        if (index > 0 && reader.paragraphs.isNotEmpty()) listState.scrollToItem(index)
    }

    // 目录跳章：ViewModel 只发目标位置，滚动交给列表状态。
    LaunchedEffect(scrollTarget) {
        if (scrollTarget >= 0) {
            listState.scrollToItem(scrollTarget)
            vm.clearScrollTarget()
        }
    }

    LaunchedEffect(listState, book?.id) {
        snapshotFlow { listState.firstVisibleItemIndex }
            .distinctUntilChanged()
            .collect { index -> if (!scrubbing) vm.updatePosition(index) }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                title = {
                    Column {
                        Text(
                            text = book?.title.orEmpty(),
                            style = MaterialTheme.typography.titleSmall,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            fontWeight = FontWeight.Medium,
                        )
                        if (reader.chapterTitle.isNotBlank()) {
                            Text(
                                text = reader.chapterTitle,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = { vm.toggleToc() }) {
                        Icon(Icons.AutoMirrored.Filled.List, contentDescription = "目录")
                    }
                },
            )
        },
        bottomBar = {
            Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Slider(
                        value = if (scrubbing) sliderValue else reader.percent.toFloat(),
                        onValueChange = {
                            scrubbing = true
                            sliderValue = it
                        },
                        onValueChangeFinished = {
                            scrubbing = false
                            vm.seekToPercent(sliderValue.toDouble())
                        },
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(
                        text = "${reader.percent.toInt()}%",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (reader.offline) {
                    Text(
                        text = "离线阅读中，连上桌面端会自动同步进度",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background),
        ) {
            when {
                reader.loading -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) { CircularProgressIndicator() }

                reader.error != null -> Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = reader.error.orEmpty(),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(32.dp),
                    )
                }

                else -> LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(
                        horizontal = settings.pagePadding.dp,
                        vertical = 16.dp,
                    ),
                ) {
                    itemsIndexed(reader.paragraphs) { _, paragraph ->
                        if (paragraph.blank) {
                            Spacer(Modifier.height(lineHeight.value.dp * 0.6f))
                        } else {
                            Text(
                                text = paragraph.text,
                                fontSize = fontSize,
                                lineHeight = lineHeight,
                                color = MaterialTheme.colorScheme.onBackground,
                                modifier = Modifier.padding(bottom = 6.dp),
                            )
                        }
                    }
                }
            }
        }
    }

    if (reader.showToc) {
        ModalBottomSheet(onDismissRequest = { vm.toggleToc() }) {
            Column(modifier = Modifier.padding(bottom = 24.dp)) {
                Text(
                    text = "目录",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f))
                if (reader.isCloud) {
                    LazyColumn(modifier = Modifier.fillMaxWidth().height(420.dp)) {
                        itemsIndexed(reader.toc) { index, chapter ->
                            TocRow(chapter.title) { vm.switchChapter(index) }
                        }
                    }
                } else {
                    LazyColumn(modifier = Modifier.fillMaxWidth().height(420.dp)) {
                        itemsIndexed(reader.chapters) { _, chapter ->
                            TocRow(chapter.title) { vm.scrollToParagraph(chapter.paraIndex) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TocRow(title: String, onClick: () -> Unit) {
    Text(
        text = title,
        style = MaterialTheme.typography.bodyMedium,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 12.dp),
    )
}
