package com.folio.reader.ui.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.folio.reader.data.SettingsStore
import com.folio.reader.ui.SettingsUiState

/**
 * 排版弹层：字号 / 行距 / 字体 / 底色 / 页边距。
 *
 * 所有改动都**即时生效并持久化**（直接写 SharedPreferences）——
 * 用户在阅读页调完字号，退出再进来还是这个字号，不用二次确认。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReaderStyleSheet(
    state: SettingsUiState,
    onFontSize: (Float) -> Unit,
    onLineHeight: (Float) -> Unit,
    onFontFamily: (String) -> Unit,
    onThemePreset: (String) -> Unit,
    onPagePadding: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp),
        ) {
            Text("排版", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(12.dp))

            /* 字号 14–28sp，步进 1 */
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("字号", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.width(56.dp))
                Slider(
                    value = state.fontSizeSp,
                    onValueChange = { onFontSize(it) },
                    valueRange = 14f..28f,
                    steps = 13,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = "${state.fontSizeSp.toInt()}sp",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.width(48.dp),
                )
            }

            Spacer(Modifier.height(6.dp))
            ChoiceRow(
                label = "行距",
                options = listOf("紧凑" to 1.5f, "标准" to 1.8f, "宽松" to 2.1f),
                selected = state.lineHeight,
                onSelect = { onLineHeight(it) },
            )

            Spacer(Modifier.height(10.dp))
            ChoiceRow(
                label = "字体",
                options = listOf("宋体" to SettingsStore.FONT_SERIF, "黑体" to SettingsStore.FONT_SANS),
                selected = state.fontFamily,
                onSelect = onFontFamily,
            )

            Spacer(Modifier.height(10.dp))
            ChoiceRow(
                label = "页边距",
                options = listOf("窄" to 16, "标准" to 24, "宽" to 36),
                selected = state.pagePadding,
                onSelect = onPagePadding,
            )

            Spacer(Modifier.height(10.dp))
            Text("底色", style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ThemePresetChip(
                    label = "纸白",
                    preset = SettingsStore.THEME_PAPER,
                    selected = state.themePreset == SettingsStore.THEME_PAPER,
                    swatch = Color(0xFFFBF8F1),
                    onSelect = onThemePreset,
                )
                ThemePresetChip(
                    label = "米色",
                    preset = SettingsStore.THEME_CREAM,
                    selected = state.themePreset == SettingsStore.THEME_CREAM,
                    swatch = Color(0xFFF5EAD3),
                    onSelect = onThemePreset,
                )
                ThemePresetChip(
                    label = "夜间",
                    preset = SettingsStore.THEME_NIGHT,
                    selected = state.themePreset == SettingsStore.THEME_NIGHT,
                    swatch = Color(0xFF15171A),
                    onSelect = onThemePreset,
                )
            }
        }
    }
}

@Composable
private fun <T> ChoiceRow(
    label: String,
    options: List<Pair<String, T>>,
    selected: T,
    onSelect: (T) -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.width(56.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { (text, value) ->
                val isSelected = value == selected
                OutlinedButton(
                    onClick = { onSelect(value) },
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.height(36.dp),
                ) {
                    Text(
                        text = text,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (isSelected) {
                            MaterialTheme.colorScheme.primary
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
private fun ThemePresetChip(
    label: String,
    preset: String,
    selected: Boolean,
    swatch: Color,
    onSelect: (String) -> Unit,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.clickable { onSelect(preset) },
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .background(
                    color = swatch,
                    shape = RoundedCornerShape(10.dp),
                ),
        ) {
            if (selected) {
                Box(
                    modifier = Modifier
                        .size(10.dp)
                        .align(Alignment.Center)
                        .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(5.dp)),
                )
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = if (selected) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
    }
}
