package com.folio.reader.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.folio.reader.data.ConnectionState
import com.folio.reader.data.SettingsStore

/** 强调色六选一：够区分、又不至于刺眼。 */
private val AccentPresets = listOf(
    0xFF1F6FEB.toInt(),
    0xFF2E7D32.toInt(),
    0xFFB3261E.toInt(),
    0xFF6A3FBF.toInt(),
    0xFFB26A00.toInt(),
    0xFF00696E.toInt(),
)

/** 行距三档：紧凑 / 标准 / 宽松。 */
private val LineHeightChoices = listOf(
    "紧凑" to 1.5f,
    "标准" to 1.8f,
    "宽松" to 2.1f,
)

/** 页边距三档：窄 / 标准 / 宽。 */
private val PaddingChoices = listOf(
    "窄" to 16,
    "标准" to 24,
    "宽" to 36,
)

/** 底色三档：纸白 / 米色 / 夜间。 */
private val ThemeChoices = listOf(
    "纸白" to SettingsStore.THEME_PAPER,
    "米色" to SettingsStore.THEME_CREAM,
    "夜间" to SettingsStore.THEME_NIGHT,
)

/** 漫画阅读方向两档。 */
private val DirectionChoices = listOf(
    "竖向" to SettingsStore.COMIC_VERTICAL,
    "横向" to SettingsStore.COMIC_HORIZONTAL,
)

/**
 * 设置页（T18）。
 *
 * 五个分区：
 *  1. 桌面端连接 —— 地址、访问码、测试连接、搜索桌面端、断开、当前状态。
 *  2. 同步 —— 自动上传 ≤20MB、仅 Wi-Fi、立即同步、上次同步时间、冲突列表入口。
 *  3. 排版 —— 小说默认字号 / 行距 / 底色 / 页边距，漫画默认阅读方向。
 *  4. 外观 —— 强调色六选一。
 *  5. 存储 —— 本机正文、内存缓存、磁盘缓存（零缓存自证读数）。
 *  6. 关于 —— App 版本、桌面端版本、网络诊断。
 *
 * 「存储」里那行 **磁盘缓存占用** 读的是 `cacheDir` 的真实大小，
 * 3.0 从不往里写东西，所以它必须恒为 0 —— 用读数自证，而不是嘴上保证。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
    onOpenSyncStatus: () -> Unit,
) {
    val state by vm.settingsState.collectAsState()
    val shelf by vm.shelf.collectAsState()
    var showDiagnostics by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                title = { Text("设置") },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
        ) {
            /* ---------------- 1. 桌面端连接 ---------------- */
            SectionTitle("桌面端连接")
            OutlinedTextField(
                value = state.serverUrl,
                onValueChange = vm::updateServerUrl,
                label = { Text("地址") },
                placeholder = { Text("http://192.168.1.20:7788") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = state.token,
                onValueChange = vm::updateToken,
                label = { Text("访问码") },
                placeholder = { Text("桌面端「设置 → 网络」里的访问码") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(10.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Button(
                    onClick = { vm.testConnection() },
                    enabled = !state.searching,
                ) { Text("测试连接") }
                TextButton(
                    onClick = { vm.discover { } },
                    enabled = !state.searching,
                ) { Text(if (state.searching) "搜索中…（5 秒）" else "搜索桌面端") }
                if (state.searching) {
                    TextButton(onClick = { vm.cancelDiscover() }) { Text("取消") }
                } else if (state.connection != ConnectionState.UNKNOWN) {
                    TextButton(onClick = { vm.disconnect() }) { Text("断开") }
                }
            }
            ConnectionRow(state.connection, state.connectionDetail)
            if (state.discovered.isNotEmpty()) {
                Text(
                    text = "找到 ${state.discovered.size} 个桌面端",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp),
                )
                state.discovered.forEach { url ->
                    Text(
                        text = url,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { vm.updateServerUrl(url) }
                            .padding(vertical = 8.dp),
                    )
                }
            } else {
                Text(
                    text = "桌面端要开着「局域网面板」。地址里的端口在桌面端「设置 → 网络」里。",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            /* ---------------- 2. 同步 ---------------- */
            SectionTitle("同步")
            ToggleRow(
                label = "自动同步",
                hint = "连上桌面端时自动对齐书架与进度",
                checked = state.autoSync,
                onChange = vm::updateAutoSync,
            )
            ToggleRow(
                label = "自动上传 20MB 以内的书",
                hint = "更大的书留在书架里等你点「下载到手机」",
                checked = state.autoTransferUnder20MB,
                onChange = vm::updateAutoTransfer,
            )
            ToggleRow(
                label = "仅在 Wi-Fi 下传输",
                hint = "按流量计费的网络里打开它",
                checked = state.wifiOnly,
                onChange = vm::updateWifiOnly,
            )
            ToggleRow(
                label = "未连接时隐藏在线书",
                hint = "把「只能连桌面端读」的书先藏起来，免得点进去报错",
                checked = state.hideRemoteWhenOffline,
                onChange = vm::updateHideRemote,
            )
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = if (shelf.syncing) "正在同步…" else "立即同步",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        text = lastSyncLabel(state.lastSyncAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Button(onClick = { vm.syncNow() }, enabled = !shelf.syncing) { Text("同步") }
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onOpenSyncStatus)
                    .padding(vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("同步状态", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        text = if (state.conflictCount > 0) {
                            "两端内容不一致，请选择保留哪一版"
                        } else {
                            "逐本查看同步情况"
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = if (state.conflictCount > 0) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                }
                if (state.conflictCount > 0) {
                    Text(
                        text = "${state.conflictCount} 本冲突",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.error,
                    )
                } else {
                    Text(
                        text = "查看",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }

            /* ---------------- 3. 排版 ---------------- */
            SectionTitle("排版")
            Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "字号",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        text = "${state.fontSizeSp.toInt()}sp",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Slider(
                    value = state.fontSizeSp.coerceIn(14f, 28f),
                    onValueChange = vm::updateFontSize,
                    valueRange = 14f..28f,
                    steps = 13,
                )
            }
            ChoiceRow(
                label = "行距",
                choices = LineHeightChoices.map { it.first },
                selectedIndex = LineHeightChoices.indexOfFirst { it.second == state.lineHeight }
                    .coerceAtLeast(0),
                onSelect = { index -> vm.updateLineHeight(LineHeightChoices[index].second) },
            )
            ChoiceRow(
                label = "字体",
                choices = listOf("宋体", "黑体"),
                selectedIndex = if (state.fontFamily == SettingsStore.FONT_SANS) 1 else 0,
                onSelect = { index ->
                    vm.updateFontFamily(
                        if (index == 1) SettingsStore.FONT_SANS else SettingsStore.FONT_SERIF,
                    )
                },
            )
            ChoiceRow(
                label = "页边距",
                choices = PaddingChoices.map { it.first },
                selectedIndex = PaddingChoices.indexOfFirst { it.second == state.pagePadding }
                    .coerceAtLeast(0),
                onSelect = { index -> vm.updatePagePadding(PaddingChoices[index].second) },
            )
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "底色",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ThemeChoices.forEach { (label, preset) ->
                        val (paper, ink) = AppViewModel.colorsOf(preset)
                        val selected = state.themePreset == preset
                        Box(
                            modifier = Modifier
                                .height(30.dp)
                                .background(
                                    color = Color(paper),
                                    shape = RoundedCornerShape(8.dp),
                                )
                                .clickable { vm.updateThemePreset(preset) }
                                .padding(horizontal = 12.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = label,
                                style = MaterialTheme.typography.labelMedium,
                                color = Color(ink),
                                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                            )
                        }
                    }
                }
            }
            ChoiceRow(
                label = "漫画阅读方向",
                choices = DirectionChoices.map { it.first },
                selectedIndex = DirectionChoices.indexOfFirst { it.second == state.comicDirection }
                    .coerceAtLeast(0),
                onSelect = { index -> vm.updateComicDirection(DirectionChoices[index].second) },
            )

            /* ---------------- 4. 外观 ---------------- */
            SectionTitle("外观")
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AccentPresets.forEach { color ->
                    val selected = (state.accent and 0xFFFFFFFFL) ==
                        (color.toLong() and 0xFFFFFFFFL)
                    Box(
                        modifier = Modifier
                            .size(34.dp)
                            .background(Color(color), CircleShape)
                            .then(
                                if (selected) {
                                    Modifier.border(
                                        width = 2.dp,
                                        color = MaterialTheme.colorScheme.onSurface,
                                        shape = CircleShape,
                                    )
                                } else {
                                    Modifier
                                },
                            )
                            .clickable { vm.updateAccent(color) },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (selected) {
                            Box(Modifier.size(12.dp).background(Color.White, CircleShape))
                        }
                    }
                }
            }

            /* ---------------- 5. 存储 ---------------- */
            SectionTitle("存储")
            ValueRow("本机正文", formatSize(state.localBytes))
            ValueRow("内存缓存（章节 + 图片）", formatSize(state.memoryBytes))
            ValueRow(
                label = "磁盘缓存",
                value = formatSize(state.cacheBytes) + if (state.cacheIsZero) " · 零缓存" else "",
                highlight = state.cacheIsZero,
            )
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "3.0 的缓存全在内存里，磁盘上不留正文副本",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { vm.clearMemoryCache() }) { Text("清空内存缓存") }
            }

            /* ---------------- 6. 关于 ---------------- */
            SectionTitle("关于")
            ValueRow("Folio Android", state.appVersion)
            ValueRow("桌面端", state.serverVersion.ifBlank { "未连接" })
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { showDiagnostics = !showDiagnostics }
                    .padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "网络诊断",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = if (showDiagnostics) "收起" else "展开",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            if (showDiagnostics) {
                Text(
                    text = state.connectionDetail.ifBlank { "还没有连过桌面端" },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "连接状态：${state.connection.label}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            val message = state.message ?: shelf.message
            if (!message.isNullOrBlank()) {
                Spacer(Modifier.height(12.dp))
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }

            Spacer(Modifier.height(40.dp))
        }
    }
}

/* ---------------- 小组件 ---------------- */

@Composable
private fun ConnectionRow(state: ConnectionState, detail: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = if (state.healthy) Icons.Default.CheckCircle else Icons.Default.ErrorOutline,
            contentDescription = null,
            tint = if (state.healthy) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.error
            },
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text = if (state.healthy) detail.ifBlank { state.label } else state.label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun SectionTitle(text: String) {
    Spacer(Modifier.height(24.dp))
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.primary,
    )
    Spacer(Modifier.height(10.dp))
}

@Composable
private fun ValueRow(label: String, value: String, highlight: Boolean = false) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall,
            color = if (highlight) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
    }
}

/**
 * 一组互斥选项，平铺成等宽小块。
 *
 * 用平铺而不是下拉，是因为这几组都是 2–3 个值，摊开比再点开一层快。
 */
@Composable
private fun ChoiceRow(
    label: String,
    choices: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            choices.forEachIndexed { index, choice ->
                val selected = index == selectedIndex
                Box(
                    modifier = Modifier
                        .background(
                            color = if (selected) {
                                MaterialTheme.colorScheme.primaryContainer
                            } else {
                                MaterialTheme.colorScheme.surfaceVariant
                            },
                            shape = RoundedCornerShape(8.dp),
                        )
                        .clickable { onSelect(index) }
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                ) {
                    Text(
                        text = choice,
                        style = MaterialTheme.typography.labelMedium,
                        color = if (selected) {
                            MaterialTheme.colorScheme.onPrimaryContainer
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun ToggleRow(
    label: String,
    hint: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(text = label, style = MaterialTheme.typography.bodyMedium)
            Text(
                text = hint,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

/** 「上次同步 3 分钟前」；从没同步过就直说。 */
private fun lastSyncLabel(at: Long): String {
    if (at <= 0L) return "还没同步过"
    val delta = System.currentTimeMillis() - at
    return when {
        delta < 60_000L -> "上次同步 刚刚"
        delta < 3_600_000L -> "上次同步 ${delta / 60_000L} 分钟前"
        delta < 86_400_000L -> "上次同步 ${delta / 3_600_000L} 小时前"
        else -> "上次同步 ${delta / 86_400_000L} 天前"
    }
}

private fun formatSize(bytes: Long): String {
    if (bytes <= 0L) return "0 KB"
    val kb = bytes / 1024.0
    if (kb < 1024) return String.format("%.0f KB", kb)
    return String.format("%.1f MB", kb / 1024.0)
}
