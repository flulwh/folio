package com.folio.reader.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folio.reader.data.ConnectionState
import com.folio.reader.data.SettingsStore
import java.util.Locale
import kotlin.math.roundToInt

/** 漫画阅读方向两档。 */
private val DirectionChoices = listOf(
    "竖向" to SettingsStore.COMIC_VERTICAL,
    "横向" to SettingsStore.COMIC_HORIZONTAL,
)

/** 自动滚动速度四档，下标即 `SettingsStore.AUTO_SCROLL_SPEEDS` 的档位。 */
private val AutoScrollChoices = listOf("慢", "稳", "快", "疾")

/**
 * 设置页：按一份排好的版面组织，而不是 Material 卡片堆。
 *
 * 01 桌面端 / 02 同步 / 03 排版 / 04 底色 / 05 漫画 / 06 存储 / 07 关于，
 * 每区的编号、标题、实墨线都由 [FolioSectionHeader] 统一给出。
 * 数字与地址全部等宽，输入框只有一条底部发丝线。
 */
@Composable
fun SettingsScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
    onOpenSyncStatus: () -> Unit,
) {
    val state by vm.settingsState.collectAsState()
    val shelf by vm.shelf.collectAsState()
    var showDiagnostics by remember { mutableStateOf(false) }

    // 输入态放在本地：每次重组不把光标顶到行尾；外部（局域网发现）填入时同步回本地。
    var urlText by remember { mutableStateOf(state.serverUrl) }
    var tokenText by remember { mutableStateOf(state.token) }
    LaunchedEffect(state.serverUrl) {
        if (state.serverUrl != urlText) urlText = state.serverUrl
    }
    LaunchedEffect(state.token) {
        if (state.token != tokenText) tokenText = state.token
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
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
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 48.dp),
        ) {
            /* ---------------- 01 桌面端 ---------------- */
            item("desktop") {
                FolioSectionHeader("01", "桌面端")
                FolioField(
                    label = "URL",
                    value = urlText,
                    placeholder = "http://192.168.1.20:7788",
                    onValueChange = { value ->
                        urlText = value
                        vm.updateServerUrl(value)
                    },
                )
                FolioField(
                    label = "访问码",
                    value = tokenText,
                    placeholder = "桌面端「设置 → 网络」里的访问码",
                    onValueChange = { value ->
                        tokenText = value
                        vm.updateToken(value)
                    },
                )
                Spacer(Modifier.height(14.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    FolioButton(
                        text = "测试连接",
                        onClick = { vm.testConnection() },
                        enabled = !state.searching,
                    )
                    if (state.searching) {
                        FolioButton(
                            text = "取消",
                            onClick = { vm.cancelDiscover() },
                            filled = false,
                        )
                    } else if (state.connection != ConnectionState.UNKNOWN) {
                        FolioButton(
                            text = "断开",
                            onClick = { vm.disconnect() },
                            filled = false,
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    FolioTextAction(
                        text = if (state.searching) "搜索中…（5 秒）" else "搜索桌面端",
                        onClick = { vm.discover { } },
                        enabled = !state.searching,
                    )
                }
                Spacer(Modifier.height(12.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .size(6.dp)
                            .background(
                                if (state.connection.healthy) {
                                    Color(0xFF2E7D32)
                                } else {
                                    MaterialTheme.colorScheme.error
                                }
                            )
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(
                        text = if (state.connection.healthy) {
                            state.connectionDetail.ifBlank { state.connection.label }
                        } else {
                            state.connection.label
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (state.discovered.isNotEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    FolioKicker("找到 ${state.discovered.size} 个桌面端")
                    state.discovered.forEach { url ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    urlText = url
                                    vm.updateServerUrl(url)
                                }
                                .padding(vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = url,
                                style = MaterialTheme.typography.bodySmall.copy(
                                    fontFamily = FontFamily.Monospace,
                                ),
                                color = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.weight(1f),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Spacer(Modifier.width(10.dp))
                            FolioKicker("填入", color = MaterialTheme.colorScheme.primary)
                        }
                        FolioHairline()
                    }
                } else {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = "桌面端要开着「局域网面板」。地址里的端口在桌面端「设置 → 网络」里。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.height(10.dp))
                FolioHairline()
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(onClick = onOpenSyncStatus)
                        .padding(vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "同步状态 →",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.weight(1f),
                    )
                    FolioKicker("逐本查看")
                }
                FolioHairline()
                FolioSwitchRow(
                    label = "未连接时隐藏在线书",
                    checked = state.hideRemoteWhenOffline,
                    onCheckedChange = vm::updateHideRemote,
                    description = "把「只能连桌面端读」的书先藏起来，免得点进去报错",
                )
            }

            /* ---------------- 02 同步 ---------------- */
            item("sync") {
                Spacer(Modifier.height(24.dp))
                FolioSectionHeader("02", "同步")
                FolioSwitchRow(
                    label = "自动同步",
                    checked = state.autoSync,
                    onCheckedChange = vm::updateAutoSync,
                    description = "连上桌面端时自动对齐书架与进度",
                )
                FolioHairline()
                FolioSwitchRow(
                    label = "自动上传 20MB 以内的书",
                    checked = state.autoTransferUnder20MB,
                    onCheckedChange = vm::updateAutoTransfer,
                    description = "更大的书留在书架里等你点「下载到手机」",
                )
                FolioHairline()
                FolioSwitchRow(
                    label = "仅在 Wi-Fi 下传输",
                    checked = state.wifiOnly,
                    onCheckedChange = vm::updateWifiOnly,
                    description = "按流量计费的网络里打开它",
                )
                Spacer(Modifier.height(14.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    FolioButton(
                        text = if (shelf.syncing) "正在同步…" else "立即同步",
                        onClick = { vm.syncNow() },
                        enabled = !shelf.syncing,
                    )
                    Spacer(Modifier.width(14.dp))
                    FolioKicker(
                        text = lastSyncLabel(state.lastSyncAt),
                        modifier = Modifier.weight(1f),
                    )
                }
                if (state.conflictCount > 0) {
                    Spacer(Modifier.height(12.dp))
                    Box(
                        modifier = Modifier
                            .border(
                                width = 1.dp,
                                color = MaterialTheme.colorScheme.primary,
                                shape = RoundedCornerShape(1.dp),
                            )
                            .clickable(onClick = onOpenSyncStatus)
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                    ) {
                        Text(
                            text = "${state.conflictCount} 处冲突 →",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }

            /* ---------------- 03 排版 ---------------- */
            item("style") {
                Spacer(Modifier.height(24.dp))
                FolioSectionHeader("03", "排版")
                FolioSliderRow(
                    label = "字号",
                    valueLabel = "${state.fontSizeSp.roundToInt()}sp",
                    value = state.fontSizeSp.coerceIn(12f, 32f),
                    onValueChange = vm::updateFontSize,
                    valueRange = 12f..32f,
                    steps = 19,
                )
                FolioSliderRow(
                    label = "行距",
                    valueLabel = String.format(Locale.US, "%.2f×", state.lineHeight),
                    value = state.lineHeight.coerceIn(1.3f, 2.4f),
                    onValueChange = vm::updateLineHeight,
                    valueRange = 1.3f..2.4f,
                    steps = 10,
                )
                FolioSliderRow(
                    label = "字距",
                    valueLabel = String.format(Locale.US, "%.3f em", state.letterSpacingEm),
                    value = state.letterSpacingEm.coerceIn(0f, 0.12f),
                    onValueChange = vm::updateLetterSpacing,
                    valueRange = 0f..0.12f,
                    steps = 11,
                )
                FolioSliderRow(
                    label = "段距",
                    valueLabel = String.format(Locale.US, "%.2f×", state.paragraphSpacing),
                    value = state.paragraphSpacing.coerceIn(0f, 2f),
                    onValueChange = vm::updateParagraphSpacing,
                    valueRange = 0f..2f,
                    steps = 19,
                )
                Spacer(Modifier.height(6.dp))
                FolioHairline()
                FolioSwitchRow(
                    label = "首行缩进",
                    checked = state.firstLineIndent,
                    onCheckedChange = vm::updateFirstLineIndent,
                    description = "每段首行缩进两个字符",
                )
                FolioHairline()
                LabeledSegmented(
                    label = "字体",
                    options = listOf("宋体", "黑体"),
                    selectedIndex = if (state.fontFamily == SettingsStore.FONT_SANS) 1 else 0,
                    onSelect = { index ->
                        vm.updateFontFamily(
                            if (index == 1) SettingsStore.FONT_SANS else SettingsStore.FONT_SERIF,
                        )
                    },
                )
                FolioSliderRow(
                    label = "页边距",
                    valueLabel = "${state.pagePadding}dp",
                    value = state.pagePadding.toFloat().coerceIn(12f, 48f),
                    onValueChange = { vm.updatePagePadding(it.roundToInt()) },
                    valueRange = 12f..48f,
                    steps = 35,
                )
                LabeledSegmented(
                    label = "自动滚动速度",
                    options = AutoScrollChoices,
                    selectedIndex = state.autoScrollSpeed.coerceIn(0, AutoScrollChoices.lastIndex),
                    onSelect = { index -> vm.updateAutoScrollSpeed(index) },
                )
                Spacer(Modifier.height(4.dp))
                FolioSwitchRow(
                    label = "保持常亮",
                    checked = state.keepScreenOn,
                    onCheckedChange = vm::updateKeepScreenOn,
                    description = "阅读时不熄屏",
                )
            }

            /* ---------------- 04 底色 ---------------- */
            item("theme") {
                Spacer(Modifier.height(24.dp))
                FolioSectionHeader("04", "底色")
                Spacer(Modifier.height(16.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
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
                                    .size(44.dp)
                                    .background(palette.bg)
                                    .border(
                                        width = 2.dp,
                                        color = if (selected) {
                                            MaterialTheme.colorScheme.onSurface
                                        } else {
                                            palette.line
                                        },
                                        shape = RoundedCornerShape(0.dp),
                                    ),
                                contentAlignment = Alignment.Center,
                            ) {
                                if (selected) {
                                    Box(
                                        Modifier
                                            .size(6.dp)
                                            .background(MaterialTheme.colorScheme.primary)
                                    )
                                }
                            }
                            Spacer(Modifier.height(8.dp))
                            FolioKicker(palette.label)
                        }
                    }
                }
            }

            /* ---------------- 05 漫画 ---------------- */
            item("comic") {
                Spacer(Modifier.height(24.dp))
                FolioSectionHeader("05", "漫画")
                LabeledSegmented(
                    label = "阅读方向",
                    options = DirectionChoices.map { it.first },
                    selectedIndex = DirectionChoices
                        .indexOfFirst { it.second == state.comicDirection }
                        .coerceAtLeast(0),
                    onSelect = { index -> vm.updateComicDirection(DirectionChoices[index].second) },
                )
            }

            /* ---------------- 06 存储 ---------------- */
            item("storage") {
                Spacer(Modifier.height(24.dp))
                FolioSectionHeader("06", "存储")
                Spacer(Modifier.height(4.dp))
                ValueRow("本机正文", formatSize(state.localBytes))
                FolioHairline()
                ValueRow("内存缓存", formatSize(state.memoryBytes))
                FolioHairline()
                ValueRow(
                    label = "磁盘缓存",
                    value = if (state.cacheIsZero) "0 B ✓" else formatSize(state.cacheBytes),
                    valueColor = if (state.cacheIsZero) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "3.0 的缓存全在内存里，磁盘上不留正文副本。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(14.dp))
                FolioButton(
                    text = "清空内存缓存",
                    onClick = { vm.clearMemoryCache() },
                    filled = false,
                )
            }

            /* ---------------- 07 关于 ---------------- */
            item("about") {
                Spacer(Modifier.height(24.dp))
                FolioSectionHeader("07", "关于")
                Spacer(Modifier.height(4.dp))
                ValueRow("本机版本", state.appVersion)
                FolioHairline()
                ValueRow("桌面端", state.serverVersion.ifBlank { "未连接" })
                FolioHairline()
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { showDiagnostics = !showDiagnostics }
                        .padding(vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "诊断信息",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.weight(1f),
                    )
                    FolioKicker(
                        text = if (showDiagnostics) "收起" else "展开",
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                if (showDiagnostics) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .border(
                                width = 1.dp,
                                color = MaterialTheme.colorScheme.outlineVariant,
                                shape = RoundedCornerShape(1.dp),
                            )
                            .padding(12.dp),
                    ) {
                        Text(
                            text = state.connectionDetail.ifBlank { "还没有连过桌面端" },
                            style = MaterialTheme.typography.bodySmall.copy(
                                fontFamily = FontFamily.Monospace,
                            ),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(
                            text = "连接状态：${state.connection.label}",
                            style = MaterialTheme.typography.bodySmall.copy(
                                fontFamily = FontFamily.Monospace,
                            ),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.height(10.dp))
                        Text(
                            text = "本地存储：正文与设置写在应用私有目录，缓存只留在内存，磁盘上不留副本。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                val message = state.message ?: shelf.message
                if (!message.isNullOrBlank()) {
                    Spacer(Modifier.height(20.dp))
                    FolioHairline()
                    Text(
                        text = message,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                }
            }
        }
    }
}

/* ---------------- 页头 ---------------- */

@Composable
private fun SettingsHeader(
    appVersion: String,
    serverVersion: String,
    onBack: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = 20.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FolioIconAction(
                icon = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "返回",
                onClick = onBack,
            )
            Spacer(Modifier.weight(1f))
            FolioKicker("SETTINGS")
        }
        Text(
            text = "设置",
            style = MaterialTheme.typography.displayMedium,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(top = 6.dp, bottom = 14.dp),
        )
        FolioRule()
        FolioKicker(
            text = "FOLIO $appVersion · 桌面端 ${serverVersion.ifBlank { "未连接" }}",
            modifier = Modifier.padding(top = 8.dp, bottom = 2.dp),
        )
    }
}

/* ---------------- 小组件 ---------------- */

/** 只有底部一条发丝线的输入框，避免 Material 输入框的药丸轮廓。 */
@Composable
private fun FolioField(
    label: String,
    value: String,
    placeholder: String,
    onValueChange: (String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 10.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FolioKicker(label, Modifier.width(56.dp))
            Spacer(Modifier.width(10.dp))
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium.copy(
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                modifier = Modifier
                    .weight(1f)
                    .padding(vertical = 6.dp),
                decorationBox = { innerTextField ->
                    Box {
                        if (value.isEmpty()) {
                            Text(
                                text = placeholder,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        innerTextField()
                    }
                },
            )
        }
        Spacer(Modifier.height(8.dp))
        FolioHairline()
    }
}

/** 反白主操作 / 方框次操作，二选一。 */
@Composable
private fun FolioButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    filled: Boolean = true,
    enabled: Boolean = true,
) {
    val ink = MaterialTheme.colorScheme.onSurface
    val paper = MaterialTheme.colorScheme.background
    val background = when {
        !filled -> Color.Transparent
        enabled -> ink
        else -> ink.copy(alpha = 0.28f)
    }
    val foreground = when {
        !filled -> if (enabled) ink else ink.copy(alpha = 0.32f)
        else -> if (enabled) paper else paper.copy(alpha = 0.7f)
    }
    Box(
        modifier = modifier
            .height(40.dp)
            .background(background, RoundedCornerShape(2.dp))
            .border(
                width = 1.dp,
                color = if (enabled) ink else ink.copy(alpha = 0.28f),
                shape = RoundedCornerShape(2.dp),
            )
            .clickable(
                enabled = enabled,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            )
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            color = foreground,
            maxLines = 1,
        )
    }
}

/** 无边框文字操作，用在「搜索桌面端」这类次级入口。 */
@Composable
private fun FolioTextAction(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Box(
        modifier = modifier
            .height(36.dp)
            .clickable(
                enabled = enabled,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            )
            .padding(horizontal = 4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            color = if (enabled) {
                MaterialTheme.colorScheme.onSurface
            } else {
                MaterialTheme.colorScheme.onSurface.copy(alpha = 0.32f)
            },
            maxLines = 1,
        )
    }
}

/** 等宽小标题 + 反白分段控件。 */
@Composable
private fun LabeledSegmented(
    label: String,
    options: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
) {
    FolioKicker(
        text = label,
        modifier = Modifier.padding(top = 14.dp, bottom = 8.dp),
    )
    FolioSegmented(
        options = options,
        selectedIndex = selectedIndex,
        onSelect = onSelect,
    )
}

/** 表格行：左侧等宽标签、右侧等宽数值。 */
@Composable
private fun ValueRow(
    label: String,
    value: String,
    valueColor: Color = MaterialTheme.colorScheme.onSurfaceVariant,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FolioKicker(label, Modifier.weight(1f))
        Spacer(Modifier.width(12.dp))
        Text(
            text = value,
            style = MaterialTheme.typography.labelLarge,
            color = valueColor,
            maxLines = 1,
        )
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
    if (kb < 1024) return String.format(Locale.US, "%.0f KB", kb)
    return String.format(Locale.US, "%.1f MB", kb / 1024.0)
}
