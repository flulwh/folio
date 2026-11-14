package com.folio.reader.ui.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextIndent
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.folio.reader.data.SettingsStore
import com.folio.reader.ui.READING_PALETTES
import com.folio.reader.ui.ReadingPalette
import com.folio.reader.ui.SettingsUiState
import com.folio.reader.ui.miuix.HyperGroup
import com.folio.reader.ui.miuix.HyperSectionTitle
import com.folio.reader.ui.miuix.HyperSegmented
import com.folio.reader.ui.miuix.HyperSheet
import com.folio.reader.ui.miuix.HyperSliderRow
import com.folio.reader.ui.miuix.HyperSwitchRow
import kotlin.math.roundToInt
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme

/** 排版面板顶部的试样，用当前字号 / 行距 / 字距 / 段距实时排版。 */
private const val SPECIMEN_ONE =
    "纸上的字，先要安静。把字号、行距、字距与段距调好，正文才肯把注意力还给故事本身。"

private const val SPECIMEN_TWO =
    "排版不是装饰，而是一种秩序：一页里所有的数字都该对齐，所有的分隔都只留一条线。"

/**
 * 排版面板（HyperOS）：阅读方式 + 试样 + 正文 / 字体 / 底色 / 版面 / 自动滚动 / 翻页。
 * 所有改动即时生效，不做二次确认。
 */
@Composable
fun ReaderStyleSheet(
    state: SettingsUiState,
    onFontSize: (Float) -> Unit,
    onLineHeight: (Float) -> Unit,
    onLetterSpacing: (Float) -> Unit,
    onParagraphSpacing: (Float) -> Unit,
    onFirstLineIndent: (Boolean) -> Unit,
    onFontFamily: (String) -> Unit,
    onThemePreset: (String) -> Unit,
    onPagePadding: (Int) -> Unit,
    onAutoScrollSpeed: (Int) -> Unit,
    onKeepScreenOn: (Boolean) -> Unit,
    onTapToTurn: (Boolean) -> Unit,
    onVolumeKeysTurn: (Boolean) -> Unit,
    onReadingMode: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val palette = MiuixTheme.colorScheme
    val specimenStyle = TextStyle(
        fontFamily = if (state.fontFamily == SettingsStore.FONT_SANS) {
            FontFamily.SansSerif
        } else {
            FontFamily.Serif
        },
        fontSize = state.fontSizeSp.sp,
        lineHeight = (state.fontSizeSp * state.lineHeight).sp,
        letterSpacing = state.letterSpacingEm.em,
        textIndent = if (state.firstLineIndent) TextIndent(firstLine = 2.em) else TextIndent.None,
    )

    HyperSheet(onDismiss = onDismiss, title = "排版", subtitle = "TYPE / STYLE") {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 16.dp),
        ) {
            // 阅读方式
            HyperSectionTitle("阅读方式")
            HyperGroup {
                Column(Modifier.padding(10.dp)) {
                    HyperSegmented(
                        options = listOf("上下滚动", "左右翻页"),
                        selectedIndex = if (state.readingMode == SettingsStore.MODE_PAGED) 1 else 0,
                        onSelect = {
                            onReadingMode(
                                if (it == 1) SettingsStore.MODE_PAGED else SettingsStore.MODE_SCROLL
                            )
                        },
                    )
                }
            }

            // 试样
            HyperSectionTitle("字样")
            HyperGroup {
                Column(Modifier.padding(16.dp)) {
                    Text(text = SPECIMEN_ONE, style = specimenStyle, color = palette.onSurface)
                    Spacer(Modifier.height((state.fontSizeSp * state.paragraphSpacing).dp))
                    Text(text = SPECIMEN_TWO, style = specimenStyle, color = palette.onSurface)
                }
            }

            HyperSectionTitle("正文")
            HyperGroup {
                HyperSliderRow(
                    title = "字号",
                    valueLabel = "${state.fontSizeSp.roundToInt()}sp",
                    value = state.fontSizeSp,
                    onValueChange = onFontSize,
                    minValue = 12f,
                    maxValue = 32f,
                    decimalPlaces = 0,
                )
                HyperSliderRow(
                    title = "行距",
                    valueLabel = String.format("%.1f×", state.lineHeight),
                    value = state.lineHeight,
                    onValueChange = onLineHeight,
                    minValue = 1.3f,
                    maxValue = 2.4f,
                    decimalPlaces = 1,
                )
                HyperSliderRow(
                    title = "字距",
                    valueLabel = String.format("%.2fem", state.letterSpacingEm),
                    value = state.letterSpacingEm,
                    onValueChange = onLetterSpacing,
                    minValue = 0f,
                    maxValue = 0.12f,
                    decimalPlaces = 2,
                )
                HyperSliderRow(
                    title = "段距",
                    valueLabel = String.format("%.1f×", state.paragraphSpacing),
                    value = state.paragraphSpacing,
                    onValueChange = onParagraphSpacing,
                    minValue = 0f,
                    maxValue = 2f,
                    decimalPlaces = 1,
                )
                HyperSwitchRow(
                    title = "首行缩进",
                    checked = state.firstLineIndent,
                    onCheckedChange = onFirstLineIndent,
                )
                HyperSwitchRow(
                    title = "保持屏幕常亮",
                    checked = state.keepScreenOn,
                    onCheckedChange = onKeepScreenOn,
                )
            }

            HyperSectionTitle("字体")
            HyperGroup {
                Column(Modifier.padding(10.dp)) {
                    HyperSegmented(
                        options = listOf("宋体", "黑体"),
                        selectedIndex = if (state.fontFamily == SettingsStore.FONT_SANS) 1 else 0,
                        onSelect = { index ->
                            onFontFamily(
                                if (index == 1) SettingsStore.FONT_SANS else SettingsStore.FONT_SERIF
                            )
                        },
                    )
                }
            }

            HyperSectionTitle("底色")
            HyperGroup {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    READING_PALETTES.forEach { preset ->
                        PaletteSwatch(
                            palette = preset,
                            selected = state.themePreset == preset.id,
                            onSelect = onThemePreset,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }

            HyperSectionTitle("版面")
            HyperGroup {
                HyperSliderRow(
                    title = "页边距",
                    valueLabel = "${state.pagePadding}dp",
                    value = state.pagePadding.toFloat(),
                    onValueChange = { onPagePadding(it.roundToInt()) },
                    minValue = 12f,
                    maxValue = 48f,
                    decimalPlaces = 0,
                )
            }

            HyperSectionTitle("自动滚动")
            HyperGroup {
                Column(Modifier.padding(10.dp)) {
                    HyperSegmented(
                        options = listOf("慢", "稳", "快", "疾"),
                        selectedIndex = state.autoScrollSpeed.coerceIn(0, 3),
                        onSelect = onAutoScrollSpeed,
                    )
                }
                Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 10.dp)) {
                    Text(
                        text = "当前速度",
                        fontSize = 14.sp,
                        color = palette.onSurface,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        text = "${SettingsStore.AUTO_SCROLL_SPEEDS[state.autoScrollSpeed.coerceIn(0, 3)]} px/s",
                        fontSize = 12.sp,
                        color = palette.onSurfaceVariantSummary,
                    )
                }
            }

            HyperSectionTitle("翻页")
            HyperGroup {
                HyperSwitchRow(
                    title = "点两侧翻页",
                    summary = "左侧上一页 / 右侧下一页，中间切换工具栏",
                    checked = state.tapToTurn,
                    onCheckedChange = onTapToTurn,
                )
                HyperSwitchRow(
                    title = "音量键翻页",
                    summary = "音量上键上一页、下键下一页",
                    checked = state.volumeKeysTurn,
                    onCheckedChange = onVolumeKeysTurn,
                )
            }
        }
    }
}

/** 纸色样本：圆角方块，选中时用朱砂描边 + 中央小点。 */
@Composable
private fun PaletteSwatch(
    palette: ReadingPalette,
    selected: Boolean,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val scheme = MiuixTheme.colorScheme
    Column(
        modifier = modifier.clickable(
            interactionSource = remember { MutableInteractionSource() },
            indication = null,
            onClick = { onSelect(palette.id) },
        ),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(42.dp)
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
