package com.folio.reader.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
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
import androidx.compose.ui.text.style.TextIndent
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.folio.reader.data.ConnectionState
import com.folio.reader.data.SettingsStore
import com.folio.reader.ui.miuix.FolioMotion
import com.folio.reader.ui.miuix.GroupLabel
import com.folio.reader.ui.miuix.Hairline
import com.folio.reader.ui.miuix.Reveal
import com.folio.reader.ui.miuix.pressScale
import java.util.Locale
import kotlin.math.roundToInt
import top.yukonga.miuix.kmp.basic.BasicComponent
import top.yukonga.miuix.kmp.basic.Button
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.Slider
import top.yukonga.miuix.kmp.basic.TextField
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.extra.SuperArrow
import top.yukonga.miuix.kmp.extra.SuperDropdown
import top.yukonga.miuix.kmp.extra.SuperSwitch
import top.yukonga.miuix.kmp.theme.MiuixTheme

/** 漫画阅读方向两档。 */
private val DirectionChoices = listOf(
    "竖向" to SettingsStore.COMIC_VERTICAL,
    "横向" to SettingsStore.COMIC_HORIZONTAL,
)

/** 自动滚动速度四档，下标即 `SettingsStore.AUTO_SCROLL_SPEEDS` 的档位。 */
private val AutoScrollChoices = listOf("慢", "稳", "快", "疾")

/**
 * 设置页。
 *
 * 整页就是一张表：分组标题 + 行 + 发丝线，没有卡片、没有圆角容器。
 * 行零件全部用 Miuix 自带组件（`SuperSwitch` / `SuperArrow` / `SuperDropdown` /
 * `BasicComponent`），自己只写带数值的滑杆行、阅读排版预览和底色选择。
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
            modifier = Modifier.fillMaxWidth().weight(1f).navigationBarsPadding(),
            contentPadding = PaddingValues(bottom = 40.dp),
        ) {
            /* ---------------- 连接 ---------------- */
            item("connect") {
                Reveal(index = 0) {
                GroupLabel(text = "连接", topGap = 12.dp)
                Hairline(inset = 16.dp)
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
                    TextField(
                        value = urlText,
                        onValueChange = {
                            urlText = it
                            vm.updateServerUrl(it)
                        },
                        modifier = Modifier.fillMaxWidth(),
                        label = "http://192.168.1.20:7788",
                        useLabelAsPlaceholder = true,
                        singleLine = true,
                        cornerRadius = 10.dp,
                    )
                    Spacer(Modifier.height(8.dp))
                    TextField(
                        value = tokenText,
                        onValueChange = {
                            tokenText = it
                            vm.updateToken(it)
                        },
                        modifier = Modifier.fillMaxWidth(),
                        label = "访问码（桌面端「设置 → 网络」）",
                        useLabelAsPlaceholder = true,
                        singleLine = true,
                        cornerRadius = 10.dp,
                    )
                }
                Hairline(inset = 16.dp)
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Button(
                        onClick = { vm.testConnection() },
                        enabled = !state.searching,
                        cornerRadius = 10.dp,
                        minHeight = 36.dp,
                    ) {
                        Text("测试连接", fontSize = 13.sp, color = scheme.onPrimary)
                    }
                    if (state.searching) {
                        TextButton(
                            text = "取消",
                            onClick = { vm.cancelDiscover() },
                            cornerRadius = 10.dp,
                            minHeight = 36.dp,
                        )
                    } else if (state.connection != ConnectionState.UNKNOWN) {
                        TextButton(
                            text = "断开",
                            onClick = { vm.disconnect() },
                            cornerRadius = 10.dp,
                            minHeight = 36.dp,
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    Text(
                        text = if (state.searching) "搜索中…" else "搜索桌面端",
                        modifier = Modifier
                            .clickable(enabled = !state.searching) { vm.discover { } }
                            .padding(horizontal = 4.dp, vertical = 6.dp),
                        fontSize = 12.5.sp,
                        color = if (state.searching) scheme.disabledOnSurface else scheme.primary,
                        maxLines = 1,
                    )
                }
                Hairline(inset = 16.dp)
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val dotColor by animateColorAsState(
                        targetValue = if (state.connection.healthy) BrandGreen else scheme.primary,
                        animationSpec = tween(FolioMotion.Normal, easing = FolioMotion.Easing),
                        label = "connection-dot",
                    )
                    Box(
                        Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(dotColor)
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
                    state.discovered.forEach { url ->
                        Hairline(inset = 16.dp)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    urlText = url
                                    vm.updateServerUrl(url)
                                }
                                .padding(horizontal = 16.dp, vertical = 10.dp),
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
                } else {
                    Hairline(inset = 16.dp)
                    Text(
                        text = "桌面端要开着「局域网面板」；端口在桌面端「设置 → 网络」里。",
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 10.dp),
                        fontSize = 11.5.sp,
                        color = scheme.onSurfaceVariantSummary,
                    )
                }
                Hairline(inset = 16.dp)
                SuperArrow(
                    title = "同步状态",
                    summary = "逐本查看",
                    onClick = onOpenSyncStatus,
                )
                Hairline(inset = 16.dp)
                }
            }

            /* ---------------- 同步 ---------------- */
            item("sync") {
                Reveal(index = 1) {
                GroupLabel(text = "同步")
                Hairline(inset = 16.dp)
                SuperSwitch(
                    checked = state.autoSync,
                    onCheckedChange = vm::updateAutoSync,
                    title = "自动同步",
                    summary = "连上桌面端时自动对齐书架与进度",
                )
                Hairline(inset = 16.dp)
                SuperSwitch(
                    checked = state.autoTransferUnder20MB,
                    onCheckedChange = vm::updateAutoTransfer,
                    title = "自动上传 20MB 以内的书",
                    summary = "更大的书等你点「下载到手机」",
                )
                Hairline(inset = 16.dp)
                SuperSwitch(
                    checked = state.wifiOnly,
                    onCheckedChange = vm::updateWifiOnly,
                    title = "仅在 Wi-Fi 下传输",
                    summary = "按流量计费的网络里打开它",
                )
                Hairline(inset = 16.dp)
                SuperSwitch(
                    checked = state.hideRemoteWhenOffline,
                    onCheckedChange = vm::updateHideRemote,
                    title = "未连接时隐藏在线书",
                    summary = "免得点进去只看到一句报错",
                )
                Hairline(inset = 16.dp)
                SuperArrow(
                    title = "立即同步",
                    summary = lastSyncLabel(state.lastSyncAt),
                    rightText = if (shelf.syncing) "同步中…" else "同步",
                    onClick = if (shelf.syncing) null else ({ vm.syncNow() }),
                )
                if (state.conflictCount > 0) {
                    Hairline(inset = 16.dp)
                    SuperArrow(
                        title = "${state.conflictCount} 处冲突",
                        summary = "同名不同内容，需要你选保留哪一版",
                        rightText = "处理",
                        onClick = onOpenSyncStatus,
                    )
                }
                Hairline(inset = 16.dp)
                }
            }

            /* ---------------- 阅读 ---------------- */
            item("read") {
                Reveal(index = 2) {
                GroupLabel(text = "阅读")
                Hairline(inset = 16.dp)
                ReadingPreview(state)
                Hairline(inset = 16.dp)
                SuperDropdown(
                    items = listOf("上下滚动", "左右翻页"),
                    selectedIndex = if (state.readingMode == SettingsStore.MODE_PAGED) 1 else 0,
                    title = "阅读方式",
                    onSelectedIndexChange = {
                        vm.updateReadingMode(
                            if (it == 1) SettingsStore.MODE_PAGED else SettingsStore.MODE_SCROLL
                        )
                    },
                )
                Hairline(inset = 16.dp)
                SliderRow(
                    title = "字号",
                    valueLabel = "${state.fontSizeSp.roundToInt()}sp",
                    value = state.fontSizeSp.coerceIn(12f, 32f),
                    onValueChange = vm::updateFontSize,
                    minValue = 12f,
                    maxValue = 32f,
                    decimalPlaces = 0,
                )
                Hairline(inset = 16.dp)
                SliderRow(
                    title = "行距",
                    valueLabel = String.format(Locale.US, "%.2f×", state.lineHeight),
                    value = state.lineHeight.coerceIn(1.3f, 2.4f),
                    onValueChange = vm::updateLineHeight,
                    minValue = 1.3f,
                    maxValue = 2.4f,
                    decimalPlaces = 2,
                )
                Hairline(inset = 16.dp)
                SliderRow(
                    title = "字距",
                    valueLabel = String.format(Locale.US, "%.3f em", state.letterSpacingEm),
                    value = state.letterSpacingEm.coerceIn(0f, 0.12f),
                    onValueChange = vm::updateLetterSpacing,
                    minValue = 0f,
                    maxValue = 0.12f,
                    decimalPlaces = 3,
                )
                Hairline(inset = 16.dp)
                SliderRow(
                    title = "段距",
                    valueLabel = String.format(Locale.US, "%.2f×", state.paragraphSpacing),
                    value = state.paragraphSpacing.coerceIn(0f, 2f),
                    onValueChange = vm::updateParagraphSpacing,
                    minValue = 0f,
                    maxValue = 2f,
                    decimalPlaces = 2,
                )
                Hairline(inset = 16.dp)
                SliderRow(
                    title = "页边距",
                    valueLabel = "${state.pagePadding}dp",
                    value = state.pagePadding.toFloat().coerceIn(12f, 48f),
                    onValueChange = { vm.updatePagePadding(it.roundToInt()) },
                    minValue = 12f,
                    maxValue = 48f,
                    decimalPlaces = 0,
                )
                Hairline(inset = 16.dp)
                SuperDropdown(
                    items = listOf("宋体", "黑体"),
                    selectedIndex = if (state.fontFamily == SettingsStore.FONT_SANS) 1 else 0,
                    title = "字体",
                    onSelectedIndexChange = { index ->
                        vm.updateFontFamily(
                            if (index == 1) SettingsStore.FONT_SANS else SettingsStore.FONT_SERIF
                        )
                    },
                )
                Hairline(inset = 16.dp)
                SuperDropdown(
                    items = AutoScrollChoices,
                    selectedIndex = state.autoScrollSpeed.coerceIn(0, AutoScrollChoices.lastIndex),
                    title = "自动滚动",
                    onSelectedIndexChange = vm::updateAutoScrollSpeed,
                )
                Hairline(inset = 16.dp)
                SuperSwitch(
                    checked = state.firstLineIndent,
                    onCheckedChange = vm::updateFirstLineIndent,
                    title = "首行缩进",
                    summary = "每段首行缩进两个字符",
                )
                Hairline(inset = 16.dp)
                SuperSwitch(
                    checked = state.keepScreenOn,
                    onCheckedChange = vm::updateKeepScreenOn,
                    title = "保持常亮",
                    summary = "阅读时不熄屏",
                )
                Hairline(inset = 16.dp)
                PaletteRow(
                    selectedId = state.themePreset,
                    onSelect = vm::updateThemePreset,
                )
                Hairline(inset = 16.dp)
                SuperDropdown(
                    items = DirectionChoices.map { it.first },
                    selectedIndex = DirectionChoices
                        .indexOfFirst { it.second == state.comicDirection }
                        .coerceAtLeast(0),
                    title = "漫画方向",
                    onSelectedIndexChange = { index ->
                        vm.updateComicDirection(DirectionChoices[index].second)
                    },
                )
                Hairline(inset = 16.dp)
                }
            }

            /* ---------------- 本机 ---------------- */
            item("local") {
                Reveal(index = 3) {
                GroupLabel(text = "本机")
                Hairline(inset = 16.dp)
                ValueRow(title = "本机正文", value = formatSize(state.localBytes))
                Hairline(inset = 16.dp)
                ValueRow(title = "内存缓存", value = formatSize(state.memoryBytes))
                Hairline(inset = 16.dp)
                ValueRow(
                    title = "磁盘缓存",
                    value = if (state.cacheIsZero) "0 B ✓" else formatSize(state.cacheBytes),
                    valueColor = if (state.cacheIsZero) scheme.primary else null,
                )
                Hairline(inset = 16.dp)
                BasicComponent(
                    title = "清空内存缓存",
                    summary = "3.0 起正文不留磁盘副本",
                    onClick = { vm.clearMemoryCache() },
                    rightActions = {
                        Text(
                            text = "清理",
                            fontSize = 13.sp,
                            color = scheme.primary,
                            maxLines = 1,
                        )
                    },
                )
                Hairline(inset = 16.dp)
                ValueRow(title = "本机版本", value = state.appVersion)
                Hairline(inset = 16.dp)
                ValueRow(
                    title = "桌面端",
                    value = state.serverVersion.ifBlank { "未连接" },
                )
                Hairline(inset = 16.dp)
                SuperArrow(
                    title = "诊断信息",
                    summary = state.connectionDetail.ifBlank { "还没有连过桌面端" },
                    rightText = if (showDiagnostics) "收起" else "展开",
                    onClick = { showDiagnostics = !showDiagnostics },
                )
                if (showDiagnostics) {
                    Hairline(inset = 16.dp)
                    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
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
                Hairline(inset = 16.dp)
                val message = state.message ?: shelf.message
                if (!message.isNullOrBlank()) {
                    Text(
                        text = message,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                        fontSize = 12.sp,
                        color = scheme.primary,
                    )
                }
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
            .padding(horizontal = 8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val source = remember { MutableInteractionSource() }
            Box(
                Modifier
                    .pressScale(source)
                    .size(42.dp)
                    .clip(CircleShape)
                    .clickable(interactionSource = source, indication = null, onClick = onBack),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "返回",
                    modifier = Modifier.size(19.dp),
                    tint = scheme.onSurface,
                )
            }
        }
        Text(
            text = "设置",
            modifier = Modifier.padding(start = 8.dp, top = 2.dp),
            fontSize = 26.sp,
            fontWeight = FontWeight.SemiBold,
            color = scheme.onSurface,
        )
        Text(
            text = "FOLIO $appVersion · 桌面端 ${serverVersion.ifBlank { "未连接" }}",
            modifier = Modifier.padding(start = 8.dp, top = 3.dp, bottom = 8.dp),
            fontSize = 11.sp,
            fontFamily = FontFamily.Monospace,
            color = scheme.onSurfaceVariantSummary,
        )
    }
}

/* ---------------- 行零件（Miuix 没提供的两样） ---------------- */

/** 标题 + 数值 + 滑杆，水平内边距与 `BasicComponent` 对齐。 */
@Composable
private fun SliderRow(
    title: String,
    valueLabel: String,
    value: Float,
    onValueChange: (Float) -> Unit,
    minValue: Float,
    maxValue: Float,
    decimalPlaces: Int,
) {
    val scheme = MiuixTheme.colorScheme
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = title,
                modifier = Modifier.weight(1f),
                fontSize = 16.sp,
                color = scheme.onSurface,
            )
            Text(
                text = valueLabel,
                fontSize = 12.5.sp,
                fontFamily = FontFamily.Monospace,
                color = scheme.onSurfaceVariantSummary,
            )
        }
        Slider(
            progress = value,
            onProgressChange = onValueChange,
            minValue = minValue,
            maxValue = maxValue,
            decimalPlaces = decimalPlaces,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** 只读的「标题 — 值」行，用 Miuix 的 `BasicComponent` 排。 */
@Composable
private fun ValueRow(title: String, value: String, valueColor: Color? = null) {
    val scheme = MiuixTheme.colorScheme
    BasicComponent(
        title = title,
        rightActions = {
            Text(
                text = value,
                fontSize = 13.sp,
                fontFamily = FontFamily.Monospace,
                color = valueColor ?: scheme.onSurfaceVariantSummary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        },
    )
}

/**
 * 排版实时预览：显示当前底色与字号 / 行距 / 段距下的两行正文。
 * 字号上限压到 20sp，避免预览把设置项挤走。
 */
@Composable
private fun ReadingPreview(state: SettingsUiState) {
    val preset = readingPalette(state.themePreset)
    val fontScale = state.fontSizeSp.coerceIn(12f, 20f)
    val style = androidx.compose.ui.text.TextStyle(
        fontFamily = if (state.fontFamily == SettingsStore.FONT_SANS) {
            FontFamily.SansSerif
        } else {
            FontFamily.Serif
        },
        fontSize = fontScale.sp,
        lineHeight = (fontScale * state.lineHeight).sp,
        letterSpacing = state.letterSpacingEm.em,
        textIndent = if (state.firstLineIndent) TextIndent(firstLine = 2.em) else TextIndent.None,
    )
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(preset.bg)
                .border(0.5.dp, preset.line, RoundedCornerShape(8.dp))
                .padding(horizontal = 16.dp, vertical = 14.dp),
        ) {
            Text(
                text = "山色空蒙雨亦奇",
                style = style,
                color = preset.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height((fontScale * state.paragraphSpacing).dp))
            Text(
                text = "水光潋滟晴方好，淡妆浓抹总相宜。",
                style = style,
                color = preset.ink,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                text = "${state.fontSizeSp.roundToInt()}sp · 行距 " +
                    String.format(Locale.US, "%.2f", state.lineHeight) + " · 段距 " +
                    String.format(Locale.US, "%.2f", state.paragraphSpacing),
                fontSize = 10.sp,
                fontFamily = FontFamily.Monospace,
                color = preset.soft,
                maxLines = 1,
            )
        }
    }
}

/** 阅读底色：横排色块，选中的那格描朱砂边。 */
@Composable
private fun PaletteRow(selectedId: String, onSelect: (String) -> Unit) {
    val scheme = MiuixTheme.colorScheme
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            READING_PALETTES.forEach { palette ->
                val selected = selectedId == palette.id
                Column(
                    modifier = Modifier.weight(1f).clickable { onSelect(palette.id) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Box(
                        modifier = Modifier
                            .size(38.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(palette.bg)
                            .border(
                                width = if (selected) 2.dp else 0.5.dp,
                                color = if (selected) scheme.primary else scheme.dividerLine,
                                shape = RoundedCornerShape(6.dp),
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (selected) {
                            Box(
                                Modifier
                                    .size(6.dp)
                                    .clip(RoundedCornerShape(3.dp))
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
