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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextIndent
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.folio.reader.data.SettingsStore
import com.folio.reader.ui.FolioKicker
import com.folio.reader.ui.FolioSegmented
import com.folio.reader.ui.FolioSectionHeader
import com.folio.reader.ui.FolioSheet
import com.folio.reader.ui.FolioSliderRow
import com.folio.reader.ui.FolioSwitchRow
import com.folio.reader.ui.READING_PALETTES
import com.folio.reader.ui.ReadingPalette
import com.folio.reader.ui.SettingsUiState
import kotlin.math.roundToInt

/** 排版面板顶部的两段试样，用当前字号 / 行距 / 字距 / 段距实时排版。 */
private const val SPECIMEN_ONE =
    "纸上的字，先要安静。把字号、行距、字距与段距调好，正文才肯把注意力还给故事本身。"

private const val SPECIMEN_TWO =
    "排版不是装饰，而是一种秩序：一页里所有的数字都该对齐，所有的分隔都该只留一条线。"

/**
 * 排版弹层：字样试样 + 正文 / 字体 / 底色 / 版面 / 自动滚动五组设置。
 *
 * 所有改动即时生效，滑块直接回调，不做二次确认。
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
    onDismiss: () -> Unit,
) {
    val specimenStyle = TextStyle(
        fontFamily = if (state.fontFamily == SettingsStore.FONT_SANS) {
            FontFamily.SansSerif
        } else {
            FontFamily.Serif
        },
        fontSize = state.fontSizeSp.sp,
        lineHeight = (state.fontSizeSp * state.lineHeight).sp,
        letterSpacing = state.letterSpacingEm.em,
        textIndent = if (state.firstLineIndent) TextIndent(firstLine = 2.em) else TextIndent(),
        color = MaterialTheme.colorScheme.onSurface,
    )

    FolioSheet(
        onDismiss = onDismiss,
        title = "排版",
        kicker = "TYPE / STYLE",
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
                .padding(top = 14.dp, bottom = 24.dp),
        ) {
            FolioKicker("SPECIMEN")
            Spacer(Modifier.height(8.dp))
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .border(1.dp, MaterialTheme.colorScheme.outlineVariant)
                    .padding(16.dp),
            ) {
                Text(text = SPECIMEN_ONE, style = specimenStyle)
                Spacer(Modifier.height((state.fontSizeSp * state.paragraphSpacing).dp))
                Text(text = SPECIMEN_TWO, style = specimenStyle)
            }

            /* 01 正文 */
            Spacer(Modifier.height(20.dp))
            FolioSectionHeader(number = "01", title = "正文")
            FolioSliderRow(
                label = "字号",
                valueLabel = "${state.fontSizeSp.roundToInt()}sp",
                value = state.fontSizeSp,
                onValueChange = onFontSize,
                valueRange = 12f..32f,
                steps = 19,
            )
            FolioSliderRow(
                label = "行距",
                valueLabel = String.format("%.1f×", state.lineHeight),
                value = state.lineHeight,
                onValueChange = onLineHeight,
                valueRange = 1.3f..2.4f,
                steps = 10,
            )
            FolioSliderRow(
                label = "字距",
                valueLabel = String.format("%.2fem", state.letterSpacingEm),
                value = state.letterSpacingEm,
                onValueChange = onLetterSpacing,
                valueRange = 0f..0.12f,
                steps = 11,
            )
            FolioSliderRow(
                label = "段距",
                valueLabel = String.format("%.1f×", state.paragraphSpacing),
                value = state.paragraphSpacing,
                onValueChange = onParagraphSpacing,
                valueRange = 0f..2f,
                steps = 19,
            )
            FolioSwitchRow(
                label = "首行缩进",
                checked = state.firstLineIndent,
                onCheckedChange = onFirstLineIndent,
            )

            /* 02 字体 */
            Spacer(Modifier.height(20.dp))
            FolioSectionHeader(number = "02", title = "字体")
            Spacer(Modifier.height(8.dp))
            FolioSegmented(
                options = listOf("宋体", "黑体"),
                selectedIndex = if (state.fontFamily == SettingsStore.FONT_SANS) 1 else 0,
                onSelect = { index ->
                    onFontFamily(
                        if (index == 1) SettingsStore.FONT_SANS else SettingsStore.FONT_SERIF
                    )
                },
            )

            /* 03 底色 */
            Spacer(Modifier.height(20.dp))
            FolioSectionHeader(number = "03", title = "底色")
            Spacer(Modifier.height(10.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                READING_PALETTES.forEach { palette ->
                    PaletteSwatch(
                        palette = palette,
                        selected = state.themePreset == palette.id,
                        onSelect = onThemePreset,
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            /* 04 版面 */
            Spacer(Modifier.height(20.dp))
            FolioSectionHeader(number = "04", title = "版面")
            FolioSliderRow(
                label = "页边距",
                valueLabel = "${state.pagePadding}dp",
                value = state.pagePadding.toFloat(),
                onValueChange = { onPagePadding(it.roundToInt()) },
                valueRange = 12f..48f,
                steps = 35,
            )

            /* 05 自动滚动 */
            Spacer(Modifier.height(20.dp))
            FolioSectionHeader(
                number = "05",
                title = "自动滚动",
                trailing = "${SettingsStore.AUTO_SCROLL_SPEEDS[state.autoScrollSpeed.coerceIn(0, 3)]} px/s",
            )
            Spacer(Modifier.height(8.dp))
            FolioSegmented(
                options = listOf("慢", "稳", "快", "疾"),
                selectedIndex = state.autoScrollSpeed.coerceIn(0, 3),
                onSelect = onAutoScrollSpeed,
            )
            FolioSwitchRow(
                label = "保持屏幕常亮",
                checked = state.keepScreenOn,
                onCheckedChange = onKeepScreenOn,
            )
        }
    }
}

/** 44dp 方形纸色样本：选中时换 2dp 墨线，中央压一枚 6dp 朱红方点。 */
@Composable
private fun PaletteSwatch(
    palette: ReadingPalette,
    selected: Boolean,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
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
                .size(44.dp)
                .background(palette.bg)
                .border(
                    width = 2.dp,
                    color = if (selected) {
                        MaterialTheme.colorScheme.onSurface
                    } else {
                        MaterialTheme.colorScheme.outlineVariant
                    },
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
        Spacer(Modifier.height(6.dp))
        FolioKicker(
            text = palette.label,
            color = if (selected) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
    }
}
