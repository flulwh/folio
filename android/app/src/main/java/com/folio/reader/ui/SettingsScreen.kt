package com.folio.reader.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.folio.reader.data.ConnectionState
import com.folio.reader.data.SettingsStore
import com.folio.reader.ui.miuix.HyperGroup
import com.folio.reader.ui.miuix.HyperRow
import com.folio.reader.ui.miuix.HyperSectionTitle
import com.folio.reader.ui.miuix.HyperSegmented
import com.folio.reader.ui.miuix.HyperSliderRow
import com.folio.reader.ui.miuix.HyperSwitchRow
import com.folio.reader.ui.miuix.PageMargin
import com.folio.reader.ui.miuix.RowInset
import java.util.Locale
import kotlin.math.roundToInt
import top.yukonga.miuix.kmp.basic.Button
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.SmallTitle
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.basic.TextField
import top.yukonga.miuix.kmp.theme.MiuixTheme

/** 漫画阅读方向两档。 */
private val DirectionChoices = listOf(
    "竖向" to SettingsStore.COMIC_VERTICAL,
    "横向" to SettingsStore.COMIC_HORIZONTAL,
)

/** 自动滚动速度四档，下标即 `SettingsStore.AUTO_SCROLL_SPEEDS` 的档位。 */
private val AutoScrollChoices = listOf("慢", "稳", "快", "疾")

/**
 * 设置页（HyperOS）：分组卡片 + 开关 + 滑杆 + 胶囊分段。
 * 桌面端 / 同步 / 排版 / 底色 / 漫画 / 存储 / 关于，顺序与旧版一致。
 */
@Composable
fun SettingsScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
    onOpenSyncStatus: () -> Unit,
) {
    val state by vm.settingsState.collectAsState()
    val shelf by vm.shelf.collectAsState()
    val scheme = MiuixTheme.colorScheme
    var showDiagnostics by remember { mutableStateOf(false) }

    var urlText by remember { mutableStateOf(state.serverUrl) }
    var tokenText by remember { mutableStateOf(state.token) }
    LaunchedEffect(state.serverUrl) {
        if (state.serverUrl != urlText) urlText = state.serverUrl
    }
    LaunchedEffect(state.token) {
        if (state.token != tokenText) tokenText = state.token
    }

    Column(Modifier.fillMaxSize().background(scheme.background)) {
        SettingsHeader(
            appVersion = state.appVersion,
            serverVersion = state.serverVersion,
            onBack = onBack,
        )

        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .navigationBarsPadding(),
            contentPadding = PaddingValues(bottom = 40.dp),
        ) {
            /* ---------------- 01 桌面端 ---------------- */
            item("desktop") {
                HyperSectionTitle("桌面端")
                HyperGroup {
                    TextField(
                        value = urlText,
                        onValueChange = {
                            urlText = it
                            vm.updateServerUrl(it)
                        },
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp),
                        label = "http://192.168.1.20:7788",
                        useLabelAsPlaceholder = true,
                        singleLine = true,
                        cornerRadius = 14.dp,
                    )
                    TextField(
                        value = tokenText,
                        onValueChange = {
                            tokenText = it
                            vm.updateToken(it)
                        },
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp),
                        label = "访问码（桌面端「设置 → 网络」）",
                        useLabelAsPlaceholder = true,
                        singleLine = true,
                        cornerRadius = 14.dp,
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Button(
                            onClick = { vm.testConnection() },
                            enabled = !state.searching,
                            cornerRadius = 14.dp,
                            minHeight = 40.dp,
                        ) {
                            Text("测试连接", fontSize = 13.sp, color = scheme.onPrimary)
                        }
                        if (state.searching) {
                            TextButton(
                                text = "取消",
                                onClick = { vm.cancelDiscover() },
                                cornerRadius = 14.dp,
                                minHeight = 40.dp,
                            )
                        } else if (state.connection != ConnectionState.UNKNOWN) {
                            TextButton(
                                text = "断开",
                                onClick = { vm.disconnect() },
                                cornerRadius = 14.dp,
                                minHeight = 40.dp,
                            )
                        }
                        Spacer(Modifier.weight(1f))
                        Text(
                            text = if (state.searching) "搜索中…" else "搜索桌面端",
                            modifier = Modifier
                                .clickable(enabled = !state.searching) { vm.discover { } }
                                .padding(horizontal = 6.dp, vertical = 6.dp),
                            fontSize = 12.5.sp,
                            color = if (state.searching) scheme.disabledOnSurface else scheme.primary,
                            maxLines = 1,
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(7.dp)
                                .clip(CircleShape)
                                .background(
                                    if (state.connection.healthy) Color(0xFF2E7D32) else scheme.primary
                                )
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            text = if (state.connection.healthy) {
                                state.connectionDetail.ifBlank { state.connection.label }
                            } else {
                                state.connection.label
                            },
                            modifier = Modifier.weight(1f),
                            fontSize = 11.5.sp,
                            color = scheme.onSurfaceVariantSummary,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (state.discovered.isNotEmpty()) {
                        Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 4.dp)) {
                            Text(
                                text = "找到 ${state.discovered.size} 个桌面端",
                                fontSize = 11.5.sp,
                                color = scheme.primary,
                            )
                            state.discovered.forEach { url ->
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(12.dp))
                                        .clickable {
                                            urlText = url
                                            vm.updateServerUrl(url)
                                        }
                                        .padding(vertical = 10.dp, horizontal = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        text = url,
                                        modifier = Modifier.weight(1f),
                                        fontSize = 12.5.sp,
                                        fontFamily = FontFamily.Monospace,
                                        color = scheme.onSurface,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(text = "填入", fontSize = 11.5.sp, color = scheme.primary)
                                }
                            }
                        }
                    } else {
                        Text(
                            text = "桌面端要开着「局域网面板」；地址里的端口在桌面端「设置 → 网络」里。",
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 6.dp),
                            fontSize = 11.5.sp,
                            color = scheme.onSurfaceVariantSummary,
                        )
                    }
                    HyperRow(title = "同步状态", summary = "逐本查看", onClick = onOpenSyncStatus)
                    HyperSwitchRow(
                        title = "未连接时隐藏在线书",
                        summary = "免得点进去只看到一句报错",
                        checked = state.hideRemoteWhenOffline,
                        onCheckedChange = vm::updateHideRemote,
                    )
                }
            }

            /* ---------------- 02 同步 ---------------- */
            item("sync") {
                HyperSectionTitle("同步")
                HyperGroup {
                    HyperSwitchRow(
                        title = "自动同步",
                        summary = "连上桌面端时自动对齐书架与进度",
                        checked = state.autoSync,
                        onCheckedChange = vm::updateAutoSync,
                    )
                    HyperSwitchRow(
                        title = "自动上传 20MB 以内的书",
                        summary = "更大的书等你点「下载到手机」",
                        checked = state.autoTransferUnder20MB,
                        onCheckedChange = vm::updateAutoTransfer,
                    )
                    HyperSwitchRow(
                        title = "仅在 Wi-Fi 下传输",
                        summary = "按流量计费的网络里打开它",
                        checked = state.wifiOnly,
                        onCheckedChange = vm::updateWifiOnly,
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Button(
                            onClick = { vm.syncNow() },
                            enabled = !shelf.syncing,
                            cornerRadius = 14.dp,
                            minHeight = 40.dp,
                        ) {
                            Text(
                                text = if (shelf.syncing) "正在同步…" else "立即同步",
                                fontSize = 13.sp,
                                color = scheme.onPrimary,
                            )
                        }
                        Spacer(Modifier.width(12.dp))
                        Text(
                            text = lastSyncLabel(state.lastSyncAt),
                            fontSize = 11.5.sp,
                            color = scheme.onSurfaceVariantSummary,
                            maxLines = 1,
                        )
                    }
                    if (state.conflictCount > 0) {
                        HyperRow(
                            title = "${state.conflictCount} 处冲突",
                            summary = "同名不同内容，需要你选保留哪一版",
                            onClick = onOpenSyncStatus,
                            trailing = {
                                Text(text = "处理 →", fontSize = 12.sp, color = scheme.primary)
                            },
                        )
                    }
                }
            }

            /* ---------------- 03 排版 ---------------- */
            item("style") {
                HyperSectionTitle("排版")
                HyperGroup {
                    Column(Modifier.padding(12.dp)) {
                        HyperSegmented(
                            options = listOf("上下滚动", "左右翻页"),
                            selectedIndex = if (state.readingMode == SettingsStore.MODE_PAGED) 1 else 0,
                            onSelect = {
                                vm.updateReadingMode(
                                    if (it == 1) SettingsStore.MODE_PAGED else SettingsStore.MODE_SCROLL
                                )
                            },
                        )
                    }
                    HyperSliderRow(
                        title = "字号",
                        valueLabel = "${state.fontSizeSp.roundToInt()}sp",
                        value = state.fontSizeSp.coerceIn(12f, 32f),
                        onValueChange = vm::updateFontSize,
                        minValue = 12f,
                        maxValue = 32f,
                        decimalPlaces = 0,
                    )
                    HyperSliderRow(
                        title = "行距",
                        valueLabel = String.format(Locale.US, "%.2f×", state.lineHeight),
                        value = state.lineHeight.coerceIn(1.3f, 2.4f),
                        onValueChange = vm::updateLineHeight,
                        minValue = 1.3f,
                        maxValue = 2.4f,
                        decimalPlaces = 2,
                    )
                    HyperSliderRow(
                        title = "字距",
                        valueLabel = String.format(Locale.US, "%.3f em", state.letterSpacingEm),
                        value = state.letterSpacingEm.coerceIn(0f, 0.12f),
                        onValueChange = vm::updateLetterSpacing,
                        minValue = 0f,
                        maxValue = 0.12f,
                        decimalPlaces = 3,
                    )
                    HyperSliderRow(
                        title = "段距",
                        valueLabel = String.format(Locale.US, "%.2f×", state.paragraphSpacing),
                        value = state.paragraphSpacing.coerceIn(0f, 2f),
                        onValueChange = vm::updateParagraphSpacing,
                        minValue = 0f,
                        maxValue = 2f,
                        decimalPlaces = 2,
                    )
                    HyperSliderRow(
                        title = "页边距",
                        valueLabel = "${state.pagePadding}dp",
                        value = state.pagePadding.toFloat().coerceIn(12f, 48f),
                        onValueChange = { vm.updatePagePadding(it.roundToInt()) },
                        minValue = 12f,
                        maxValue = 48f,
                        decimalPlaces = 0,
                    )
                    HyperSwitchRow(
                        title = "首行缩进",
                        summary = "每段首行缩进两个字符",
                        checked = state.firstLineIndent,
                        onCheckedChange = vm::updateFirstLineIndent,
                    )
                    HyperSwitchRow(
                        title = "保持常亮",
                        summary = "阅读时不熄屏",
                        checked = state.keepScreenOn,
                        onCheckedChange = vm::updateKeepScreenOn,
                    )
                    Column(Modifier.padding(12.dp)) {
                        HyperSegmented(
                            options = listOf("宋体", "黑体"),
                            selectedIndex = if (state.fontFamily == SettingsStore.FONT_SANS) 1 else 0,
                            onSelect = { index ->
                                vm.updateFontFamily(
                                    if (index == 1) SettingsStore.FONT_SANS else SettingsStore.FONT_SERIF
                                )
                            },
                        )
                        Spacer(Modifier.height(10.dp))
                        HyperSegmented(
                            options = AutoScrollChoices,
                            selectedIndex = state.autoScrollSpeed.coerceIn(0, AutoScrollChoices.lastIndex),
                            onSelect = { vm.updateAutoScrollSpeed(it) },
                        )
                    }
                }
            }

            /* ---------------- 04 底色 ---------------- */
            item("theme") {
                HyperSectionTitle("底色")
                HyperGroup {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        READING_PALETTES.forEach { palette ->
                            val selected = state.themePreset == palette.id
                            Column(
                                modifier = Modifier
                                    .weight(1f)
                                    .clickable { vm.updateThemePreset(palette.id) },
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(40.dp)
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(palette.bg)
                                        .border(
                                            width = 2.dp,
                                            color = if (selected) scheme.primary else scheme.dividerLine,
                                            shape = RoundedCornerShape(12.dp),
                                        ),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    if (selected) {
                                        Box(
                                            Modifier
                                                .size(7.dp)
                                                .clip(RoundedCornerShape(4.dp))
                                                .background(scheme.primary)
                                        )
                                    }
                                }
                                Spacer(Modifier.height(6.dp))
                                Text(
                                    text = palette.label,
                                    fontSize = 11.sp,
                                    color = if (selected) scheme.primary else scheme.onSurfaceVariantSummary,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                }
            }

            /* ---------------- 05 漫画 ---------------- */
            item("comic") {
                HyperSectionTitle("漫画")
                HyperGroup {
                    Column(Modifier.padding(12.dp)) {
                        HyperSegmented(
                            options = DirectionChoices.map { it.first },
                            selectedIndex = DirectionChoices
                                .indexOfFirst { it.second == state.comicDirection }
                                .coerceAtLeast(0),
                            onSelect = { index -> vm.updateComicDirection(DirectionChoices[index].second) },
                        )
                    }
                }
            }

            /* ---------------- 06 存储 ---------------- */
            item("storage") {
                HyperSectionTitle("存储")
                HyperGroup {
                    HyperRow(title = "本机正文", trailing = { Value(formatSize(state.localBytes)) })
                    HyperRow(title = "内存缓存", trailing = { Value(formatSize(state.memoryBytes)) })
                    HyperRow(
                        title = "磁盘缓存",
                        trailing = {
                            Value(
                                text = if (state.cacheIsZero) "0 B ✓" else formatSize(state.cacheBytes),
                                color = if (state.cacheIsZero) scheme.primary else scheme.onSurfaceVariantSummary,
                            )
                        },
                    )
                    Text(
                        text = "3.0 的缓存全在内存里，磁盘上不留正文副本。",
                        modifier = Modifier.padding(horizontal = 18.dp, vertical = 8.dp),
                        fontSize = 11.5.sp,
                        color = scheme.onSurfaceVariantSummary,
                    )
                    TextButton(
                        text = "清空内存缓存",
                        onClick = { vm.clearMemoryCache() },
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp),
                        cornerRadius = 14.dp,
                    )
                }
            }

            /* ---------------- 07 关于 ---------------- */
            item("about") {
                HyperSectionTitle("关于")
                HyperGroup {
                    HyperRow(title = "本机版本", trailing = { Value(state.appVersion) })
                    HyperRow(
                        title = "桌面端",
                        trailing = { Value(state.serverVersion.ifBlank { "未连接" }) },
                    )
                    HyperRow(
                        title = "诊断信息",
                        summary = state.connectionDetail.ifBlank { "还没有连过桌面端" },
                        onClick = { showDiagnostics = !showDiagnostics },
                        trailing = {
                            Text(
                                text = if (showDiagnostics) "收起" else "展开",
                                fontSize = 12.sp,
                                color = scheme.primary,
                            )
                        },
                    )
                    if (showDiagnostics) {
                        Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 8.dp)) {
                            Text(
                                text = state.connectionDetail.ifBlank { "还没有连过桌面端" },
                                fontSize = 11.5.sp,
                                fontFamily = FontFamily.Monospace,
                                color = scheme.onSurfaceVariantSummary,
                            )
                            Spacer(Modifier.height(6.dp))
                            Text(
                                text = "连接状态：${state.connection.label}",
                                fontSize = 11.5.sp,
                                fontFamily = FontFamily.Monospace,
                                color = scheme.onSurfaceVariantSummary,
                            )
                        }
                    }
                }
                val message = state.message ?: shelf.message
                if (!message.isNullOrBlank()) {
                    Text(
                        text = message,
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp),
                        fontSize = 12.sp,
                        color = scheme.primary,
                    )
                }
            }
        }
    }
}

/* ---------------- 页头 ---------------- */

@Composable
private fun SettingsHeader(appVersion: String, serverVersion: String, onBack: () -> Unit) {
    val scheme = MiuixTheme.colorScheme
    Column(
        Modifier
            .fillMaxWidth()
            .background(scheme.background)
            .statusBarsPadding()
            .padding(horizontal = PageMargin),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .clickable(onClick = onBack),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "返回",
                    modifier = Modifier.size(20.dp),
                    tint = scheme.onSurface,
                )
            }
            Spacer(Modifier.weight(1f))
            Text(text = "SETTINGS", fontSize = 11.sp, color = scheme.primary)
        }
        Text(
            text = "设置",
            modifier = Modifier.padding(top = 4.dp),
            fontSize = 26.sp,
            fontWeight = FontWeight.SemiBold,
            color = scheme.onSurface,
        )
        Text(
            text = "FOLIO $appVersion · 桌面端 ${serverVersion.ifBlank { "未连接" }}",
            modifier = Modifier.padding(top = 2.dp, bottom = 8.dp),
            fontSize = 11.5.sp,
            color = scheme.onSurfaceVariantSummary,
        )
    }
}

@Composable
private fun Value(text: String, color: Color = MiuixTheme.colorScheme.onSurfaceVariantSummary) {
    Text(
        text = text,
        fontSize = 13.sp,
        color = color,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
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
    if (kb < 1024) return String.format(Locale.US, "%.0f KB", kb)
    return String.format(Locale.US, "%.1f MB", kb / 1024.0)
}
