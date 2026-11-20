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
import com.folio.reader.ui.FolioSheet
import com.folio.reader.ui.FontFamilies
import com.folio.reader.ui.READING_PALETTES
import com.folio.reader.ui.ReadingPalette
import com.folio.reader.ui.SettingsUiState
import io.github.alexzhirkevich.cupertino.CupertinoSegmentedControl
import io.github.alexzhirkevich.cupertino.CupertinoSegmentedControlTab
import io.github.alexzhirkevich.cupertino.CupertinoSlider
import io.github.alexzhirkevich.cupertino.CupertinoSwitch
import io.github.alexzhirkevich.cupertino.CupertinoText
import io.github.alexzhirkevich.cupertino.ExperimentalCupertinoApi
import io.github.alexzhirkevich.cupertino.section.CupertinoSection
import io.github.alexzhirkevich.cupertino.section.SectionItem
import io.github.alexzhirkevich.cupertino.section.SectionStyle
import io.github.alexzhirkevich.cupertino.theme.CupertinoTheme
import kotlin.math.roundToInt

/** 排版面板顶部的试样，用当前字号 / 行距 / 字距 / 段距实时排版。 */
private const val SPECIMEN_ONE =
    "纸上的字，先要安静。把字号、行距、字距与段距调好，正文才肯把注意力还给故事本身。"

private const val SPECIMEN_TWO =
    "排版不是装饰，而是一种秩序：一页里所有的数字都该对齐，所有的分隔都只留一条线。"

/**
 * 排版面板（Cupertino）：阅读方式 + 试样 + 正文 / 字体 / 底色 / 版面 / 自动滚动 / 翻页。
 * 所有改动即时生效，不做二次确认。
 */
@OptIn(ExperimentalCupertinoApi::class)
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
    val scheme = CupertinoTheme.colorScheme
    val specimenStyle = TextStyle(
        fontFamily = FontFamilies.rememberReaderFamily(
            state.userFontId,
            if (state.fontFamily == SettingsStore.FONT_SANS) FontFamily.SansSerif else FontFamily.Serif,
        ),
        fontSize = state.fontSizeSp.sp,
        lineHeight = (state.fontSizeSp * state.lineHeight).sp,
        letterSpacing = state.letterSpacingEm.em,
        textIndent = if (state.firstLineIndent) TextIndent(firstLine = 2.em) else TextIndent.None,
    )

    FolioSheet(onDismiss = onDismiss, title = "排版", subtitle = "TYPE / STYLE") {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 16.dp),
        ) {
            // 阅读方式
            StyleSection(title = "阅读方式") {
                SectionItem(title = {
                    Segmented(
                        options = listOf("上下滚动", "左右翻页"),
                        selectedIndex = if (state.readingMode == SettingsStore.MODE_PAGED) 1 else 0,
                        onSelect = {
                            onReadingMode(
                                if (it == 1) SettingsStore.MODE_PAGED else SettingsStore.MODE_SCROLL
                            )
                        },
                    )
                })
            }

            // 试样
            StyleSection(title = "字样") {
                SectionItem(title = {
                    Column {
                        CupertinoText(text = SPECIMEN_ONE, color = scheme.label, style = specimenStyle)
                        Spacer(Modifier.height((state.fontSizeSp * state.paragraphSpacing).dp))
                        CupertinoText(text = SPECIMEN_TWO, color = scheme.label, style = specimenStyle)
                    }
                })
            }

            StyleSection(title = "正文") {
                SliderRow(
                    title = "字号",
                    valueLabel = "${state.fontSizeSp.roundToInt()}sp",
                    value = state.fontSizeSp,
                    onValueChange = onFontSize,
                    minValue = 12f,
                    maxValue = 32f,
                )
                SliderRow(
                    title = "行距",
                    valueLabel = String.format("%.1f×", state.lineHeight),
                    value = state.lineHeight,
                    onValueChange = onLineHeight,
                    minValue = 1.3f,
                    maxValue = 2.4f,
                )
                SliderRow(
                    title = "字距",
                    valueLabel = String.format("%.2fem", state.letterSpacingEm),
                    value = state.letterSpacingEm,
                    onValueChange = onLetterSpacing,
                    minValue = 0f,
                    maxValue = 0.12f,
                )
                SliderRow(
                    title = "段距",
                    valueLabel = String.format("%.1f×", state.paragraphSpacing),
                    value = state.paragraphSpacing,
                    onValueChange = onParagraphSpacing,
                    minValue = 0f,
                    maxValue = 2f,
                )
                SwitchRow(
                    title = "首行缩进",
                    checked = state.firstLineIndent,
                    onCheckedChange = onFirstLineIndent,
                )
                SwitchRow(
                    title = "保持屏幕常亮",
                    checked = state.keepScreenOn,
                    onCheckedChange = onKeepScreenOn,
                )
            }

            StyleSection(title = "字体") {
                SectionItem(title = {
                    Segmented(
                        options = listOf("宋体", "黑体"),
                        selectedIndex = if (state.fontFamily == SettingsStore.FONT_SANS) 1 else 0,
                        onSelect = { index ->
                            onFontFamily(
                                if (index == 1) SettingsStore.FONT_SANS else SettingsStore.FONT_SERIF
                            )
                        },
                    )
                })
            }

            StyleSection(title = "底色") {
                SectionItem(title = {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
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
                })
            }

            StyleSection(title = "版面") {
                SliderRow(
                    title = "页边距",
                    valueLabel = "${state.pagePadding}dp",
                    value = state.pagePadding.toFloat(),
                    onValueChange = { onPagePadding(it.roundToInt()) },
                    minValue = 12f,
                    maxValue = 48f,
                )
            }

            StyleSection(title = "自动滚动") {
                SectionItem(title = {
                    Segmented(
                        options = listOf("慢", "稳", "快", "疾"),
                        selectedIndex = state.autoScrollSpeed.coerceIn(0, 3),
                        onSelect = onAutoScrollSpeed,
                    )
                })
                SectionItem(trailingContent = {
                    CupertinoText(
                        text = "${SettingsStore.AUTO_SCROLL_SPEEDS[state.autoScrollSpeed.coerceIn(0, 3)]} px/s",
                        fontSize = 12.sp,
                    )
                }) {
                    CupertinoText(text = "当前速度", fontSize = 14.sp, color = scheme.label)
                }
            }

            StyleSection(title = "翻页") {
                SwitchRow(
                    title = "点两侧翻页",
                    summary = "左侧上一页 / 右侧下一页，中间切换工具栏",
                    checked = state.tapToTurn,
                    onCheckedChange = onTapToTurn,
                )
                SwitchRow(
                    title = "音量键翻页",
                    summary = "音量上键上一页、下键下一页",
                    checked = state.volumeKeysTurn,
                    onCheckedChange = onVolumeKeysTurn,
                )
            }
        }
    }
}

/** 一组 Cupertino 分组卡片，标题用小号灰字。 */
@OptIn(ExperimentalCupertinoApi::class)
@Composable
private fun StyleSection(
    title: String,
    content: @Composable io.github.alexzhirkevich.cupertino.section.SectionScope.() -> Unit,
) {
    CupertinoSection(
        style = SectionStyle.InsetGrouped,
        title = {
            CupertinoText(
                text = title,
                fontSize = 12.sp,
                color = CupertinoTheme.colorScheme.secondaryLabel,
            )
        },
        content = content,
    )
}

@OptIn(ExperimentalCupertinoApi::class)
@Composable
private fun io.github.alexzhirkevich.cupertino.section.SectionScope.SliderRow(
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
                    fontSize = 14.5.sp,
                    color = scheme.label,
                )
                CupertinoText(text = valueLabel, fontSize = 13.sp, color = scheme.secondaryLabel)
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

@OptIn(ExperimentalCupertinoApi::class)
@Composable
private fun io.github.alexzhirkevich.cupertino.section.SectionScope.SwitchRow(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    summary: String? = null,
) {
    val scheme = CupertinoTheme.colorScheme
    SectionItem(
        trailingContent = {
            CupertinoSwitch(checked = checked, onCheckedChange = onCheckedChange)
        },
        title = {
            Column {
                CupertinoText(text = title, fontSize = 15.sp, color = scheme.label)
                if (summary != null) {
                    Spacer(Modifier.height(2.dp))
                    CupertinoText(text = summary, fontSize = 12.5.sp, color = scheme.secondaryLabel)
                }
            }
        },
    )
}

@Composable
private fun Segmented(
    options: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
) {
    CupertinoSegmentedControl(
        selectedTabIndex = selectedIndex,
        modifier = Modifier.fillMaxWidth(),
    ) {
        options.forEachIndexed { index, label ->
            CupertinoSegmentedControlTab(
                onClick = { onSelect(index) },
                isSelected = index == selectedIndex,
            ) {
                CupertinoText(text = label, fontSize = 13.5.sp)
            }
        }
    }
}

/** 纸色样本：圆角方块，选中时用强调色描边 + 中央小点。 */
@Composable
private fun PaletteSwatch(
    palette: ReadingPalette,
    selected: Boolean,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val scheme = CupertinoTheme.colorScheme
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
                    color = if (selected) scheme.accent else scheme.separator,
                    shape = RoundedCornerShape(12.dp),
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (selected) {
                Box(
                    Modifier
                        .size(7.dp)
                        .clip(RoundedCornerShape(4.dp))
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
