package com.folio.reader.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/* ==========================================================================
   Folio · HyperOS 皮肤
   --------------------------------------------------------------------------
   组件结构、圆角、动效全部交给 Miuix（HyperOS 观感）；品牌色仍然是纸、墨、朱：
   - 底色 = 当前阅读底色预设（白 / 纸 / 米 / 石墨 / 夜间）
   - 卡片 = 纸底提亮一点，圆角 16–28dp，层级靠底色差而不是重阴影
   - 强调色 = 朱砂（#C4251C），只出现在进度、开关、当前项
   正文的排版（字号 / 行距 / 字距 / 段距）与皮肤无关，仍由阅读设置驱动。
   ========================================================================== */

/** 阅读底色预设（同时决定阅读器与整个 App 的明暗）。 */
@Immutable
data class ReadingPalette(
    val id: String,
    val label: String,
    val bg: Color,
    val ink: Color,
    val soft: Color,
    val isDark: Boolean,
) {
    val line: Color get() = ink.copy(alpha = if (isDark) 0.16f else 0.14f)
    val lineStrong: Color get() = ink.copy(alpha = if (isDark) 0.32f else 0.30f)
    val accent: Color get() = if (isDark) Color(0xFFFF4438) else Color(0xFFC4251C)
    val accentInk: Color get() = if (isDark) Color(0xFF140404) else Color(0xFFFFFFFF)
    val accentSoft: Color get() = accent.copy(alpha = if (isDark) 0.18f else 0.08f)
}

private val WHITE_PALETTE = ReadingPalette(
    id = "white",
    label = "冷白",
    bg = Color(0xFFF4F4F1),
    ink = Color(0xFF111111),
    soft = Color(0xFF5B5B55),
    isDark = false,
)

private val PAPER_PALETTE = ReadingPalette(
    id = "paper",
    label = "纸白",
    bg = Color(0xFFFBF8F1),
    ink = Color(0xFF23201C),
    soft = Color(0xFF6A645B),
    isDark = false,
)

private val CREAM_PALETTE = ReadingPalette(
    id = "cream",
    label = "米色",
    bg = Color(0xFFF1E7D3),
    ink = Color(0xFF1F1A12),
    soft = Color(0xFF6B5C45),
    isDark = false,
)

private val GRAPHITE_PALETTE = ReadingPalette(
    id = "graphite",
    label = "石墨",
    bg = Color(0xFF1C1C1E),
    ink = Color(0xFFE6E6E1),
    soft = Color(0xFF9A9A94),
    isDark = true,
)

private val NIGHT_PALETTE = ReadingPalette(
    id = "night",
    label = "夜间",
    bg = Color(0xFF0C0C0E),
    ink = Color(0xFFC9C9C4),
    soft = Color(0xFF85857F),
    isDark = true,
)

/** 顺序即视觉顺序：从最亮到最暗，排版弹层里横向铺开。 */
val READING_PALETTES: List<ReadingPalette> = listOf(
    WHITE_PALETTE,
    PAPER_PALETTE,
    CREAM_PALETTE,
    GRAPHITE_PALETTE,
    NIGHT_PALETTE,
)

fun readingPalette(id: String?): ReadingPalette =
    READING_PALETTES.firstOrNull { it.id == id } ?: WHITE_PALETTE

/** 当前生效的纸色，组件与阅读器共用。 */
val LocalReadingPalette = staticCompositionLocalOf { WHITE_PALETTE }

/* --------------------------------- 字体 --------------------------------- */

private val Sans = FontFamily.SansSerif
private val Mono = FontFamily.Monospace

/**
 * 网格标题：字重沉、字距收（中文靠字号与留白拉层次，不靠花体）。
 * 元信息：等宽 + 大幅字距，读起来像标尺刻度。
 */
val FolioTypography: Typography = Typography(
    displayLarge = TextStyle(
        fontFamily = Sans,
        fontSize = 40.sp,
        lineHeight = 42.sp,
        fontWeight = FontWeight.Black,
        letterSpacing = (-1.4).sp,
    ),
    displayMedium = TextStyle(
        fontFamily = Sans,
        fontSize = 32.sp,
        lineHeight = 34.sp,
        fontWeight = FontWeight.Black,
        letterSpacing = (-1.0).sp,
    ),
    headlineLarge = TextStyle(
        fontFamily = Sans,
        fontSize = 27.sp,
        lineHeight = 31.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.6).sp,
    ),
    headlineMedium = TextStyle(
        fontFamily = Sans,
        fontSize = 23.sp,
        lineHeight = 27.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.4).sp,
    ),
    headlineSmall = TextStyle(
        fontFamily = Sans,
        fontSize = 20.sp,
        lineHeight = 24.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.2).sp,
    ),
    titleLarge = TextStyle(
        fontFamily = Sans,
        fontSize = 18.sp,
        lineHeight = 22.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = Sans,
        fontSize = 16.sp,
        lineHeight = 21.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.1.sp,
    ),
    titleSmall = TextStyle(
        fontFamily = Sans,
        fontSize = 14.sp,
        lineHeight = 19.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 0.1.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = Sans,
        fontSize = 16.sp,
        lineHeight = 24.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 0.2.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = Sans,
        fontSize = 14.sp,
        lineHeight = 21.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 0.2.sp,
    ),
    bodySmall = TextStyle(
        fontFamily = Sans,
        fontSize = 12.5.sp,
        lineHeight = 18.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 0.2.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = Mono,
        fontSize = 13.sp,
        lineHeight = 18.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 0.6.sp,
    ),
    labelMedium = TextStyle(
        fontFamily = Mono,
        fontSize = 11.sp,
        lineHeight = 15.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 1.2.sp,
    ),
    labelSmall = TextStyle(
        fontFamily = Mono,
        fontSize = 10.sp,
        lineHeight = 14.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 1.6.sp,
    ),
)

/** 纸是软的：HyperOS 的圆角语言，卡片 16dp、抽屉 28dp。 */
val FolioShapes: Shapes = Shapes(
    extraSmall = RoundedCornerShape(10.dp),
    small = RoundedCornerShape(14.dp),
    medium = RoundedCornerShape(18.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

/* --------------------------------- 主题 --------------------------------- */

private fun schemeFor(palette: ReadingPalette) = with(palette) {
    val base = if (isDark) {
        darkColorScheme(
            primary = accent,
            onPrimary = accentInk,
            primaryContainer = accentSoft,
            onPrimaryContainer = tint(accent, ink, 0.55f),
            secondary = ink,
            onSecondary = bg,
            secondaryContainer = ink.copy(alpha = 0.10f),
            onSecondaryContainer = ink,
            background = bg,
            onBackground = ink,
            surface = elevate(bg, ink),
            onSurface = ink,
            surfaceVariant = elevate(bg, ink, 0.05f),
            onSurfaceVariant = soft,
            outline = lineStrong,
            outlineVariant = line,
            error = Color(0xFFFF6B5E),
            onError = Color(0xFF1A0503),
            errorContainer = Color(0xFF3A1210),
            onErrorContainer = Color(0xFFFFB4AC),
        )
    } else {
        lightColorScheme(
            primary = accent,
            onPrimary = accentInk,
            primaryContainer = accentSoft,
            onPrimaryContainer = Color(0xFF6D140D),
            secondary = ink,
            onSecondary = bg,
            secondaryContainer = ink.copy(alpha = 0.06f),
            onSecondaryContainer = ink,
            background = bg,
            onBackground = ink,
            surface = elevate(bg, ink),
            onSurface = ink,
            surfaceVariant = elevate(bg, ink, 0.04f),
            onSurfaceVariant = soft,
            outline = lineStrong,
            outlineVariant = line,
            error = Color(0xFFB3261E),
            onError = Color(0xFFFFFFFF),
            errorContainer = Color(0xFFF9DEDC),
            onErrorContainer = Color(0xFF410E0B),
        )
    }
    base
}

/** 深色底略微提亮，浅色底略微提亮，用来区分 surface 与 background。 */
private fun elevate(bg: Color, ink: Color, amount: Float = 0.03f): Color =
    Color(
        red = bg.red + (ink.red - bg.red) * amount,
        green = bg.green + (ink.green - bg.green) * amount,
        blue = bg.blue + (ink.blue - bg.blue) * amount,
        alpha = 1f,
    )

private fun tint(from: Color, toward: Color, amount: Float): Color =
    Color(
        red = from.red + (toward.red - from.red) * amount,
        green = from.green + (toward.green - from.green) * amount,
        blue = from.blue + (toward.blue - from.blue) * amount,
        alpha = 1f,
    )

/* ------------------------------ Miuix 配色 ------------------------------ */

/**
 * 把纸色预设映射到 Miuix 的 HyperOS 色板。
 *
 * 只覆盖「有品牌含义」的几组，其余用 Miuix 默认值：
 * primary = 朱砂（开关 / 滑杆 / 选中）；
 * background = 阅读底色；surface = 提亮后的卡片色；
 * secondaryContainer = 输入框 / 分段控件的浅底。
 */
fun miuixSchemeFor(palette: ReadingPalette) = with(palette) {
    val card = if (isDark) mix(bg, ink, 0.10f) else mix(bg, Color.White, 0.72f)
    val elevated = if (isDark) mix(bg, ink, 0.16f) else mix(bg, ink, 0.06f)
    val quiet = if (isDark) mix(bg, ink, 0.22f) else mix(bg, ink, 0.10f)
    if (isDark) {
        top.yukonga.miuix.kmp.theme.darkColorScheme(
            primary = accent,
            onPrimary = Color(0xFF1A0503),
            primaryVariant = accent,
            primaryContainer = accent.copy(alpha = 0.22f),
            onPrimaryContainer = ink,
            secondary = elevated,
            onSecondary = ink,
            secondaryVariant = card,
            onSecondaryVariant = soft,
            secondaryContainer = elevated,
            onSecondaryContainer = soft,
            tertiaryContainer = accent.copy(alpha = 0.18f),
            onTertiaryContainer = accent,
            background = bg,
            onBackground = ink,
            onBackgroundVariant = soft,
            surface = card,
            onSurface = ink,
            surfaceVariant = card,
            onSurfaceSecondary = ink.copy(alpha = 0.82f),
            onSurfaceVariantSummary = soft,
            onSurfaceVariantActions = soft.copy(alpha = 0.72f),
            disabledOnSurface = soft.copy(alpha = 0.38f),
            outline = quiet,
            dividerLine = ink.copy(alpha = 0.10f),
            surfaceContainer = elevated,
            onSurfaceContainer = ink,
            onSurfaceContainerVariant = soft,
            surfaceContainerHigh = quiet,
            onSurfaceContainerHigh = soft,
            surfaceContainerHighest = quiet,
            onSurfaceContainerHighest = ink,
        )
    } else {
        top.yukonga.miuix.kmp.theme.lightColorScheme(
            primary = accent,
            onPrimary = Color.White,
            primaryVariant = accent,
            primaryContainer = accent.copy(alpha = 0.14f),
            onPrimaryContainer = ink,
            secondary = elevated,
            onSecondary = ink,
            secondaryVariant = Color.White,
            onSecondaryVariant = ink,
            secondaryContainer = elevated,
            onSecondaryContainer = soft,
            tertiaryContainer = accent.copy(alpha = 0.10f),
            onTertiaryContainer = accent,
            background = bg,
            onBackground = ink,
            onBackgroundVariant = soft,
            surface = card,
            onSurface = ink,
            surfaceVariant = card,
            onSurfaceSecondary = ink.copy(alpha = 0.82f),
            onSurfaceVariantSummary = soft,
            onSurfaceVariantActions = soft.copy(alpha = 0.72f),
            disabledOnSurface = soft.copy(alpha = 0.38f),
            outline = quiet,
            dividerLine = ink.copy(alpha = 0.08f),
            surfaceContainer = elevated,
            onSurfaceContainer = ink,
            onSurfaceContainerVariant = soft,
            surfaceContainerHigh = elevated,
            onSurfaceContainerHigh = soft,
            surfaceContainerHighest = card,
            onSurfaceContainerHighest = ink,
        )
    }
}

private fun mix(a: Color, b: Color, amount: Float): Color =
    Color(
        red = a.red + (b.red - a.red) * amount,
        green = a.green + (b.green - a.green) * amount,
        blue = a.blue + (b.blue - a.blue) * amount,
        alpha = 1f,
    )

@Composable
fun FolioTheme(
    preset: String,
    content: @Composable () -> Unit,
) {
    val palette = readingPalette(preset)
    val miuixColors = remember(palette) { miuixSchemeFor(palette) }
    androidx.compose.runtime.CompositionLocalProvider(LocalReadingPalette provides palette) {
        top.yukonga.miuix.kmp.theme.MiuixTheme(colors = miuixColors) {
            MaterialTheme(
                colorScheme = schemeFor(palette),
                typography = FolioTypography,
                shapes = FolioShapes,
                content = content,
            )
        }
    }
}
