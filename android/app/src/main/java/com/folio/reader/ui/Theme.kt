package com.folio.reader.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** Folio 主题：纸感底色 + 可选强调色，跟桌面端同一套观感。 */
@Composable
fun FolioTheme(
    accent: Long,
    paper: Long,
    ink: Long,
    content: @Composable () -> Unit,
) {
    val primary = Color(accent.toInt())
    val background = Color(paper.toInt())
    val onBackground = Color(ink.toInt())
    @Suppress("UNUSED_EXPRESSION")
    isSystemInDarkTheme()

    val scheme = lightColorScheme(
        primary = primary,
        onPrimary = Color.White,
        secondary = primary,
        onSecondary = Color.White,
        background = background,
        onBackground = onBackground,
        surface = background,
        onSurface = onBackground,
        surfaceVariant = background.blend(Color(0x14000000)),
        onSurfaceVariant = onBackground.copy(alpha = 0.72f),
        outline = onBackground.copy(alpha = 0.18f),
        error = Color(0xFFB3261E),
    )

    MaterialTheme(colorScheme = scheme, content = content)
}

/** 在纸色上混合一点墨色，得到分隔线、卡片底这类浅色。 */
fun Color.blend(other: Color): Color = Color(
    red = (red + other.red) / 2f,
    green = (green + other.green) / 2f,
    blue = (blue + other.blue) / 2f,
    alpha = 1f,
)
