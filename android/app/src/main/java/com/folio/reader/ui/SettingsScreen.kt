package com.folio.reader.ui

import com.folio.reader.ui.model.SettingsModel

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import io.github.alexzhirkevich.cupertino.CupertinoButton
import io.github.alexzhirkevich.cupertino.CupertinoButtonDefaults
import io.github.alexzhirkevich.cupertino.CupertinoHorizontalDivider
import io.github.alexzhirkevich.cupertino.CupertinoIcon
import io.github.alexzhirkevich.cupertino.CupertinoScaffold
import io.github.alexzhirkevich.cupertino.CupertinoSegmentedControl
import io.github.alexzhirkevich.cupertino.CupertinoSegmentedControlTab
import io.github.alexzhirkevich.cupertino.CupertinoSlider
import io.github.alexzhirkevich.cupertino.CupertinoSwitch
import io.github.alexzhirkevich.cupertino.CupertinoText
import io.github.alexzhirkevich.cupertino.CupertinoTextField
import io.github.alexzhirkevich.cupertino.CupertinoTopAppBar
import io.github.alexzhirkevich.cupertino.ExperimentalCupertinoApi
import io.github.alexzhirkevich.cupertino.icons.CupertinoIcons
import io.github.alexzhirkevich.cupertino.icons.outlined.ChevronBackward
import io.github.alexzhirkevich.cupertino.section.CupertinoSection
import io.github.alexzhirkevich.cupertino.section.SectionItem
import io.github.alexzhirkevich.cupertino.section.SectionLink
import io.github.alexzhirkevich.cupertino.section.SectionScope
import io.github.alexzhirkevich.cupertino.section.SectionStyle
import io.github.alexzhirkevich.cupertino.section.section
import io.github.alexzhirkevich.cupertino.theme.CupertinoTheme
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
 * 设置页（Cupertino）。
 *
 * 四组 InsetGrouped 分组：连接 / 同步 / 阅读 / 本机。
 * 开关、滑杆、下拉全部用 Cupertino 原生件，只有「排版预览」与「底色选择」是内容块。
 */
@OptIn(ExperimentalCupertinoApi::class)
@Composable
fun SettingsScreen(
    model: SettingsModel,
    onBack: (() -> Unit)?,
    onOpenSyncStatus: () -> Unit,
    onOpenFontStore: () -> Unit,
    bottomBar: @Composable () -> Unit = {},
) {
    val vm = model.session
    val state by vm.settingsState.collectAsState()
    val shelf by vm.shelf.collectAsState()
    val scheme = CupertinoTheme.colorScheme
    var showDiagnostics by remember { mutableStateOf(false) }

    var urlText by remember { mutableStateOf(state.serverUrl) }
    var tokenText by remember { mutableStateOf(state.token) }
    LaunchedEffect(state.serverUrl) {
        if (state.serverUrl != urlText) urlText = state.serverUrl
    }
    LaunchedEffect(state.token) {
        if (state.token != tokenText) tokenText = state.token
    }

    CupertinoScaffold(
        modifier = Modifier.fillMaxSize(),
        topBar = { SettingsTopBar(onBack = onBack) },
        bottomBar = bottomBar,
        containerColor = scheme.systemBackground,
        appBarsBlurAlpha = FolioAppBarAlpha,
        appBarsBlurRadius = FolioAppBarBlurRadius,
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                top = padding.calculateTopPadding(),
                bottom = padding.calculateBottomPadding() + 24.dp,
            ),
        ) {
            /* ---------------- 连接 ---------------- */
            item("connect") {
                Reveal(index = 0) {
                    CupertinoSection(style = SectionStyle.InsetGrouped, title = sectionTitle("连接")) {
                        Item(key = "url") {
                            CupertinoTextField(
                                value = urlText,
                                onValueChange = {
                                    urlText = it
                                    vm.updateServerUrl(it)
                                },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                                placeholder = {
                                    CupertinoText(
                                        text = "http://192.168.1.20:7788",
                                        fontSize = 16.sp,
                                        color = scheme.placeholderText,
                                    )
                                },
                            )
                        }
                        Item(key = "token") {
                            CupertinoTextField(
                                value = tokenText,
                                onValueChange = {
                                    tokenText = it
                                    vm.updateToken(it)
                                },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                                placeholder = {
                                    CupertinoText(
                                        text = "访问码（桌面端「设置 → 网络」）",
                                        fontSize = 16.sp,
                                        color = scheme.placeholderText,
                                    )
                                },
                            )
                        }
                        Item(key = "actions") {
                            Column {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    CupertinoButton(
                                        onClick = { vm.testConnection() },
                                        enabled = !state.searching,
                                        colors = CupertinoButtonDefaults.filledButtonColors(),
                                    ) {
                                        CupertinoText(text = "测试连接", fontSize = 13.sp)
                                    }
                                    if (state.searching) {
                                        CupertinoButton(
                                            onClick = { vm.cancelDiscover() },
                                            colors = CupertinoButtonDefaults.grayButtonColors(),
                                        ) {
                                            CupertinoText(text = "取消", fontSize = 13.sp)
                                        }
                                    } else if (state.connection != ConnectionState.UNKNOWN) {
                                        CupertinoButton(
                                            onClick = { vm.disconnect() },
                                            colors = CupertinoButtonDefaults.grayButtonColors(),
                                        ) {
                                            CupertinoText(text = "断开", fontSize = 13.sp)
                                        }
                                    }
                                    Spacer(Modifier.weight(1f))
                                    CupertinoText(
                                        text = if (state.searching) "搜索中…" else "搜索桌面端",
                                        modifier = Modifier
                                            .clickable(enabled = !state.searching) { vm.discover { } }
                                            .padding(horizontal = 4.dp, vertical = 6.dp),
                                        fontSize = 12.5.sp,
                                        color = if (state.searching) scheme.tertiaryLabel else scheme.accent,
                                        maxLines = 1,
                                    )
                                }
                                Spacer(Modifier.height(10.dp))
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    val dotColor by animateColorAsState(
                                        targetValue = if (state.connection.healthy) scheme.accent else scheme.secondaryLabel,
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
                                    CupertinoText(
                                        text = if (state.connection.healthy) {
                                            state.connectionDetail.ifBlank { state.connection.label }
                                        } else {
                                            state.connection.label
                                        },
                                        modifier = Modifier.weight(1f),
                                        fontSize = 11.5.sp,
                                        color = scheme.secondaryLabel,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                        }
                        if (state.discovered.isNotEmpty()) {
                            state.discovered.forEach { url ->
                                Item(key = "discovered-$url") {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable {
                                                urlText = url
                                                vm.updateServerUrl(url)
                                            },
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        CupertinoText(
                                            text = url,
                                            modifier = Modifier.weight(1f),
                                            fontSize = 12.5.sp,
                                            fontFamily = FontFamily.Monospace,
                                            color = scheme.label,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                        CupertinoText(text = "填入", fontSize = 11.5.sp, color = scheme.accent)
                                    }
                                }
                            }
                        } else {
                            Item(key = "discover-hint") {
                                CupertinoText(
                                    text = "桌面端要开着「局域网面板」；端口在桌面端「设置 → 网络」里。",
                                    modifier = Modifier.fillMaxWidth(),
                                    fontSize = 11.5.sp,
                                    color = scheme.secondaryLabel,
                                )
                            }
                        }
                        Item(key = "sync-entry") {
                            SectionLink(
                                onClick = onOpenSyncStatus,
                                caption = { CupertinoText(text = "逐本查看", fontSize = 12.sp) },
                            ) {
                                CupertinoText(text = "同步状态", fontSize = 17.sp, color = scheme.label)
                            }
                        }
                    }
                }
            }

            /* ---------------- 同步 ---------------- */
            item("sync") {
                Reveal(index = 1) {
                    CupertinoSection(style = SectionStyle.InsetGrouped, title = sectionTitle("同步")) {
                        SwitchItem(
                            title = "自动同步",
                            summary = "连上桌面端时自动对齐书架与进度",
                            checked = state.autoSync,
                            onCheckedChange = vm::updateAutoSync,
                        )
                        SwitchItem(
                            title = "自动上传 20MB 以内的书",
                            summary = "更大的书等你点「下载到手机」",
                            checked = state.autoTransferUnder20MB,
                            onCheckedChange = vm::updateAutoTransfer,
                        )
                        SwitchItem(
                            title = "仅在 Wi-Fi 下传输",
                            summary = "按流量计费的网络里打开它",
                            checked = state.wifiOnly,
                            onCheckedChange = vm::updateWifiOnly,
                        )
                        SwitchItem(
                            title = "未连接时隐藏在线书",
                            summary = "免得点进去只看到一句报错",
                            checked = state.hideRemoteWhenOffline,
                            onCheckedChange = vm::updateHideRemote,
                        )
                        Item(key = "sync-now") {
                            SectionLink(
                                onClick = { if (!shelf.syncing) vm.syncNow() },
                                enabled = !shelf.syncing,
                                caption = { CupertinoText(text = lastSyncLabel(state.lastSyncAt), fontSize = 12.sp) },
                            ) {
                                CupertinoText(
                                    text = if (shelf.syncing) "同步中…" else "立即同步",
                                    fontSize = 17.sp,
                                    color = scheme.label,
                                )
                            }
                        }
                        if (state.conflictCount > 0) {
                            Item(key = "conflicts") {
                                SectionLink(
                                    onClick = onOpenSyncStatus,
                                    caption = { CupertinoText(text = "同名不同内容，需要你选保留哪一版", fontSize = 12.sp) },
                                ) {
                                    CupertinoText(
                                        text = "${state.conflictCount} 处冲突",
                                        fontSize = 17.sp,
                                        color = scheme.accent,
                                    )
                                }
                            }
                        }
                    }
                }
            }

            /* ---------------- 阅读 ---------------- */
            item("read") {
                Reveal(index = 2) {
                    CupertinoSection(style = SectionStyle.InsetGrouped, title = sectionTitle("阅读")) {
                        Item(key = "preview") { ReadingPreview(state) }
                        Item(key = "mode") {
                            SegmentedRow(
                                title = "阅读方式",
                                options = listOf("上下滚动", "左右翻页"),
                                selectedIndex = if (state.readingMode == SettingsStore.MODE_PAGED) 1 else 0,
                                onSelect = {
                                    vm.updateReadingMode(
                                        if (it == 1) SettingsStore.MODE_PAGED else SettingsStore.MODE_SCROLL
                                    )
                                },
                            )
                        }
                        SliderItem(
                            title = "字号",
                            valueLabel = "${state.fontSizeSp.roundToInt()}sp",
                            value = state.fontSizeSp.coerceIn(12f, 32f),
                            onValueChange = vm::updateFontSize,
                            minValue = 12f,
                            maxValue = 32f,
                        )
                        SliderItem(
                            title = "行距",
                            valueLabel = String.format(Locale.US, "%.2f×", state.lineHeight),
                            value = state.lineHeight.coerceIn(1.3f, 2.4f),
                            onValueChange = vm::updateLineHeight,
                            minValue = 1.3f,
                            maxValue = 2.4f,
                        )
                        SliderItem(
                            title = "字距",
                            valueLabel = String.format(Locale.US, "%.3f em", state.letterSpacingEm),
                            value = state.letterSpacingEm.coerceIn(0f, 0.12f),
                            onValueChange = vm::updateLetterSpacing,
                            minValue = 0f,
                            maxValue = 0.12f,
                        )
                        SliderItem(
                            title = "段距",
                            valueLabel = String.format(Locale.US, "%.2f×", state.paragraphSpacing),
                            value = state.paragraphSpacing.coerceIn(0f, 2f),
                            onValueChange = vm::updateParagraphSpacing,
                            minValue = 0f,
                            maxValue = 2f,
                        )
                        SliderItem(
                            title = "页边距",
                            valueLabel = "${state.pagePadding}dp",
                            value = state.pagePadding.toFloat().coerceIn(12f, 48f),
                            onValueChange = { vm.updatePagePadding(it.roundToInt()) },
                            minValue = 12f,
                            maxValue = 48f,
                        )
                        Item(key = "font-family") {
                            SegmentedRow(
                                title = "系统字体",
                                options = listOf("宋体", "黑体"),
                                selectedIndex = if (state.fontFamily == SettingsStore.FONT_SANS) 1 else 0,
                                onSelect = { index ->
                                    vm.selectUserFont("")
                                    vm.updateFontFamily(
                                        if (index == 1) SettingsStore.FONT_SANS else SettingsStore.FONT_SERIF
                                    )
                                },
                            )
                        }
                        Item(key = "font-store") {
                            SectionLink(
                                onClick = onOpenFontStore,
                                caption = { CupertinoText(text = "开源中文字体，与桌面端同一份目录", fontSize = 12.sp) },
                            ) {
                                CupertinoText(text = "字体商店", fontSize = 17.sp, color = scheme.label)
                            }
                        }
                        Item(key = "auto-scroll") {
                            SegmentedRow(
                                title = "自动滚动",
                                options = AutoScrollChoices,
                                selectedIndex = state.autoScrollSpeed.coerceIn(0, AutoScrollChoices.lastIndex),
                                onSelect = vm::updateAutoScrollSpeed,
                            )
                        }
                        SwitchItem(
                            title = "首行缩进",
                            summary = "每段首行缩进两个字符",
                            checked = state.firstLineIndent,
                            onCheckedChange = vm::updateFirstLineIndent,
                        )
                        SwitchItem(
                            title = "保持常亮",
                            summary = "阅读时不熄屏",
                            checked = state.keepScreenOn,
                            onCheckedChange = vm::updateKeepScreenOn,
                        )
                        Item(key = "palette") {
                            PaletteRow(
                                selectedId = state.themePreset,
                                onSelect = vm::updateThemePreset,
                            )
                        }
                        Item(key = "comic-direction") {
                            SegmentedRow(
                                title = "漫画方向",
                                options = DirectionChoices.map { it.first },
                                selectedIndex = DirectionChoices
                                    .indexOfFirst { it.second == state.comicDirection }
                                    .coerceAtLeast(0),
                                onSelect = { index ->
                                    vm.updateComicDirection(DirectionChoices[index].second)
                                },
                            )
                        }
                    }
                }
            }

            /* ---------------- 本机 ---------------- */
            item("local") {
                Reveal(index = 3) {
                    CupertinoSection(style = SectionStyle.InsetGrouped, title = sectionTitle("本机")) {
                        Item(key = "local-bytes") { ValueRow(title = "本机正文", value = formatSize(state.localBytes)) }
                        Item(key = "memory") { ValueRow(title = "内存缓存", value = formatSize(state.memoryBytes)) }
                        Item(key = "disk") {
                            ValueRow(
                                title = "磁盘缓存",
                                value = if (state.cacheIsZero) "0 B ✓" else formatSize(state.cacheBytes),
                                valueColor = if (state.cacheIsZero) scheme.accent else null,
                            )
                        }
                        Item(key = "clear-cache") {
                            SectionLink(
                                onClick = { vm.clearMemoryCache() },
                                caption = { CupertinoText(text = "3.0 起正文不留磁盘副本", fontSize = 12.sp) },
                            ) {
                                CupertinoText(text = "清空内存缓存", fontSize = 17.sp, color = scheme.label)
                            }
                        }
                        Item(key = "version") { ValueRow(title = "本机版本", value = state.appVersion) }
                        Item(key = "server-version") {
                            ValueRow(
                                title = "桌面端",
                                value = state.serverVersion.ifBlank { "未连接" },
                            )
                        }
                        Item(key = "diagnostics") {
                            SectionLink(
                                onClick = { showDiagnostics = !showDiagnostics },
                                caption = {
                                    CupertinoText(
                                        text = state.connectionDetail.ifBlank { "还没有连过桌面端" },
                                        fontSize = 12.sp,
                                    )
                                },
                            ) {
                                CupertinoText(
                                    text = if (showDiagnostics) "诊断信息 · 收起" else "诊断信息 · 展开",
                                    fontSize = 17.sp,
                                    color = scheme.label,
                                )
                            }
                        }
                        if (showDiagnostics) {
                            Item(key = "diagnostics-body") {
                                Column {
                                    CupertinoText(
                                        text = state.connectionDetail.ifBlank { "还没有连过桌面端" },
                                        fontSize = 11.5.sp,
                                        fontFamily = FontFamily.Monospace,
                                        color = scheme.secondaryLabel,
                                    )
                                    Spacer(Modifier.height(6.dp))
                                    CupertinoText(
                                        text = "连接状态：${state.connection.label}",
                                        fontSize = 11.5.sp,
                                        fontFamily = FontFamily.Monospace,
                                        color = scheme.secondaryLabel,
                                    )
                                }
                            }
                        }
                        val message = state.message ?: shelf.message
                        if (!message.isNullOrBlank()) {
                            Item(key = "message") {
                                CupertinoText(
                                    text = message,
                                    modifier = Modifier.fillMaxWidth(),
                                    fontSize = 12.sp,
                                    color = scheme.accent,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/* ---------------- 页头 ---------------- */

/** 顶栏：实色底、标题常显；从设置页 push 进来时才画返回箭头。 */
@OptIn(ExperimentalCupertinoApi::class)
@Composable
private fun SettingsTopBar(onBack: (() -> Unit)?) {
    val scheme = CupertinoTheme.colorScheme
    CupertinoTopAppBar(
        title = { CupertinoText(text = "设置", maxLines = 1) },
        colors = folioTopBarColors(),
        navigationIcon = {
            if (onBack != null) {
                val source = remember { MutableInteractionSource() }
                Box(
                    Modifier
                        .padding(start = PageMargin)
                        .pressScale(source, pressedScale = 0.92f)
                        .size(42.dp)
                        .clickable(interactionSource = source, indication = null, onClick = onBack),
                    contentAlignment = Alignment.Center,
                ) {
                    CupertinoIcon(
                        imageVector = CupertinoIcons.Outlined.ChevronBackward,
                        contentDescription = "返回",
                        modifier = Modifier.size(22.dp),
                        tint = scheme.accent,
                    )
                }
            }
        },
    )
}

/* ---------------- Section 内的行 ---------------- */

/** Section 里的普通整行：内容自己排，外层只提供卡片内边距。 */
@OptIn(ExperimentalCupertinoApi::class)
@Composable
private fun SectionScope.Item(key: String, content: @Composable () -> Unit) {
    SectionItem(title = content)
}

private fun sectionTitle(text: String): @Composable () -> Unit = {
    CupertinoText(
        text = text,
        fontSize = 13.sp,
        color = CupertinoTheme.colorScheme.secondaryLabel,
    )
}

@OptIn(ExperimentalCupertinoApi::class)
@Composable
private fun SectionScope.SwitchItem(
    title: String,
    summary: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    val scheme = CupertinoTheme.colorScheme
    SectionItem(
        trailingContent = {
            CupertinoSwitch(checked = checked, onCheckedChange = onCheckedChange)
        },
        title = {
            Column {
                CupertinoText(text = title, fontSize = 17.sp, color = scheme.label)
                Spacer(Modifier.height(2.dp))
                CupertinoText(text = summary, fontSize = 13.sp, color = scheme.secondaryLabel)
            }
        },
    )
}

@OptIn(ExperimentalCupertinoApi::class)
@Composable
private fun SectionScope.SliderItem(
    title: String,
    valueLabel: String,
    value: Float,
    onValueChange: (Float) -> Unit,
    minValue: Float,
    maxValue: Float,
) {
    val scheme = CupertinoTheme.colorScheme
    SectionItem(title = {
        Column(Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CupertinoText(
                    text = title,
                    modifier = Modifier.weight(1f),
                    fontSize = 17.sp,
                    color = scheme.label,
                )
                CupertinoText(
                    text = valueLabel,
                    fontSize = 15.sp,
                    color = scheme.secondaryLabel,
                )
            }
            CupertinoSlider(
                value = value,
                onValueChange = onValueChange,
                valueRange = minValue..maxValue,
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
            )
        }
    })
}

/** 下拉用 Cupertino 分段控件代替：选项少，点一下就切。 */
@Composable
private fun SegmentedRow(
    title: String,
    options: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
) {
    val scheme = CupertinoTheme.colorScheme
    Column(Modifier.fillMaxWidth()) {
        CupertinoText(text = title, fontSize = 17.sp, color = scheme.label)
        Spacer(Modifier.height(8.dp))
        CupertinoSegmentedControl(
            selectedTabIndex = selectedIndex,
            modifier = Modifier.fillMaxWidth(),
        ) {
            options.forEachIndexed { index, label ->
                CupertinoSegmentedControlTab(
                    onClick = { onSelect(index) },
                    isSelected = index == selectedIndex,
                ) {
                    CupertinoText(text = label, fontSize = 13.sp)
                }
            }
        }
    }
}

/** 只读的「标题 — 值」行。 */
@Composable
private fun ValueRow(title: String, value: String, valueColor: Color? = null) {
    val scheme = CupertinoTheme.colorScheme
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        CupertinoText(
            text = title,
            modifier = Modifier.weight(1f),
            fontSize = 17.sp,
            color = scheme.label,
        )
        CupertinoText(
            text = value,
            fontSize = 17.sp,
            color = valueColor ?: scheme.secondaryLabel,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
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
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(preset.bg)
            .border(0.5.dp, preset.line, RoundedCornerShape(8.dp))
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        CupertinoText(
            text = "山色空蒙雨亦奇",
            style = style,
            color = preset.ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height((fontScale * state.paragraphSpacing).dp))
        CupertinoText(
            text = "水光潋滟晴方好，淡妆浓抹总相宜。",
            style = style,
            color = preset.ink,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(10.dp))
        CupertinoText(
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

/** 阅读底色：横排色块，选中的那格描朱砂边。 */
@Composable
private fun PaletteRow(selectedId: String, onSelect: (String) -> Unit) {
    val scheme = CupertinoTheme.colorScheme
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
                            color = if (selected) scheme.accent else scheme.separator,
                            shape = RoundedCornerShape(6.dp),
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    if (selected) {
                        Box(
                            Modifier
                                .size(6.dp)
                                .clip(RoundedCornerShape(3.dp))
                                .background(scheme.accent)
                        )
                    }
                }
                Spacer(Modifier.height(6.dp))
                CupertinoText(
                    text = palette.label,
                    fontSize = 11.sp,
                    color = if (selected) scheme.accent else scheme.secondaryLabel,
                    maxLines = 1,
                )
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
