package com.folio.reader.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.alexzhirkevich.cupertino.theme.CupertinoTheme
import io.github.alexzhirkevich.cupertino.theme.Shapes
import io.github.alexzhirkevich.cupertino.theme.Typography
import io.github.alexzhirkevich.cupertino.theme.darkColorScheme
import io.github.alexzhirkevich.cupertino.theme.lightColorScheme

/* ==========================================================================
   Folio · Anthropic 皮肤
   --------------------------------------------------------------------------
   组件与观感全部交给 compose-cupertino（iOS 风格），这里只做三件事：
   - 品牌色换成 Anthropic：墨 #141413 / 纸 #FAF9F5 / 中灰 #B0AEA5 / 浅灰 #E8E6DC
   - 强调色只有暖橙 #D97757，蓝 #6A9BCC 与绿 #788C5D 只做状态点缀
   - 底色 = 当前阅读底色预设（白 / 纸 / 米 / 石墨 / 夜间），全部落在品牌灰阶上
   正文的排版（字号 / 行距 / 字距 / 段距）与皮肤无关，仍由阅读设置驱动。
   ========================================================================== */

/* ------------------------------ 品牌色板 ------------------------------ */

/** 主墨色：正文与深色底。 */
val BrandInk = Color(0xFF141413)
/** 主纸色：浅色底与深色底上的文字。 */
val BrandLight = Color(0xFFFAF9F5)
/** 中灰：次级元素。 */
val BrandMidGray = Color(0xFFB0AEA5)
/** 浅灰：分区底、分隔。 */
val BrandLightGray = Color(0xFFE8E6DC)
/** 主强调色：只给进度、开关、当前项。 */
val BrandOrange = Color(0xFFD97757)
/** 次强调色：在线 / 提示。 */
val BrandBlue = Color(0xFF6A9BCC)
/** 三级强调色：健康状态。 */
val BrandGreen = Color(0xFF788C5D)

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
    val accent: Color get() = BrandOrange
    /** 橙是中调，上面压深墨才看得清。 */
    val accentInk: Color get() = Color(0xFF1F1A16)
    val accentSoft: Color get() = accent.copy(alpha = if (isDark) 0.20f else 0.12f)
    /** 卡片底：比页面底色略亮 / 略深，用来区分分组。 */
    val card: Color get() = if (isDark) mix(bg, ink, 0.10f) else mix(bg, BrandLight, 0.72f)
    /** 比卡片再高一层：输入框、分段控件底。 */
    val fill: Color get() = if (isDark) mix(bg, ink, 0.16f) else mix(bg, ink, 0.06f)
}

private val WHITE_PALETTE = ReadingPalette(
    id = "white",
    label = "冷白",
    bg = Color(0xFFF2F1EB),
    ink = BrandInk,
    soft = Color(0xFF6E6B62),
    isDark = false,
)

private val PAPER_PALETTE = ReadingPalette(
    id = "paper",
    label = "纸白",
    bg = BrandLight,
    ink = BrandInk,
    soft = Color(0xFF6B6860),
    isDark = false,
)

private val CREAM_PALETTE = ReadingPalette(
    id = "cream",
    label = "米色",
    bg = BrandLightGray,
    ink = BrandInk,
    soft = Color(0xFF5F5C4E),
    isDark = false,
)

private val GRAPHITE_PALETTE = ReadingPalette(
    id = "graphite",
    label = "石墨",
    bg = Color(0xFF24231F),
    ink = Color(0xFFF0EEE7),
    soft = BrandMidGray,
    isDark = true,
)

private val NIGHT_PALETTE = ReadingPalette(
    id = "night",
    label = "夜间",
    bg = BrandInk,
    ink = Color(0xFFC9C7BE),
    soft = Color(0xFF8A877E),
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

private fun mix(a: Color, b: Color, amount: Float): Color =
    Color(
        red = a.red + (b.red - a.red) * amount,
        green = a.green + (b.green - a.green) * amount,
        blue = a.blue + (b.blue - a.blue) * amount,
        alpha = 1f,
    )

/** 深色底略微提亮，浅色底略微提亮，用来区分 surface 与 background。 */
private fun elevate(bg: Color, ink: Color, amount: Float = 0.03f): Color = mix(bg, ink, amount)

/* --------------------------------- 字体 --------------------------------- */

private val Sans = FontFamily.SansSerif
private val Mono = FontFamily.Monospace

/**
 * 字号刻度沿用原来的 11 → 32 级，只是换到 Cupertino 的槽位上。
 * 网格标题：字重沉、字距收（中文靠字号与留白拉层次，不靠花体）。
 * 元信息：等宽 + 大幅字距，读起来像标尺刻度。
 */
val FolioTypography: Typography = Typography(
    largeTitle = TextStyle(
        fontFamily = Sans,
        fontSize = 32.sp,
        lineHeight = 34.sp,
        fontWeight = FontWeight.Black,
        letterSpacing = (-1.0).sp,
    ),
    title1 = TextStyle(
        fontFamily = Sans,
        fontSize = 27.sp,
        lineHeight = 31.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.6).sp,
    ),
    title2 = TextStyle(
        fontFamily = Sans,
        fontSize = 23.sp,
        lineHeight = 27.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.4).sp,
    ),
    title3 = TextStyle(
        fontFamily = Sans,
        fontSize = 20.sp,
        lineHeight = 24.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.2).sp,
    ),
    headline = TextStyle(
        fontFamily = Sans,
        fontSize = 18.sp,
        lineHeight = 22.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.sp,
    ),
    body = TextStyle(
        fontFamily = Sans,
        fontSize = 16.sp,
        lineHeight = 24.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 0.2.sp,
    ),
    callout = TextStyle(
        fontFamily = Sans,
        fontSize = 14.5.sp,
        lineHeight = 20.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 0.2.sp,
    ),
    subhead = TextStyle(
        fontFamily = Sans,
        fontSize = 14.sp,
        lineHeight = 19.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 0.1.sp,
    ),
    footnote = TextStyle(
        fontFamily = Sans,
        fontSize = 12.5.sp,
        lineHeight = 18.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 0.2.sp,
    ),
    // 元信息用等宽：像刻度尺，与正文区分开。
    caption1 = TextStyle(
        fontFamily = Mono,
        fontSize = 11.sp,
        lineHeight = 15.sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = 1.2.sp,
    ),
    caption2 = TextStyle(
        fontFamily = Mono,
        fontSize = 10.sp,
        lineHeight = 14.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 1.6.sp,
    ),
)

/** 纸是软的：卡片 18dp、抽屉 28dp，与旧版圆角语言保持一致。 */
val FolioShapes: Shapes = Shapes(
    extraSmall = RoundedCornerShape(10.dp),
    small = RoundedCornerShape(14.dp),
    medium = RoundedCornerShape(18.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

/* --------------------------------- 主题 --------------------------------- */

/**
 * 把纸色预设映射到 Cupertino 的 iOS 语义色板。
 *
 * accent = 暖橙；label = 墨；separator = 发丝线；
 * systemGroupedBackground = 页面底；secondarySystemGroupedBackground = 卡片底。
 */
fun folioColorScheme(palette: ReadingPalette) = with(palette) {
    val cardColor = card
    val fillColor = fill
    if (isDark) {
        darkColorScheme(
            accent = accent,
            label = ink,
            secondaryLabel = soft,
            tertiaryLabel = soft.copy(alpha = 0.72f),
            quaternaryLabel = soft.copy(alpha = 0.48f),
            systemFill = ink.copy(alpha = 0.16f),
            secondarySystemFill = ink.copy(alpha = 0.12f),
            tertiarySystemFill = ink.copy(alpha = 0.08f),
            quaternarySystemFill = ink.copy(alpha = 0.04f),
            placeholderText = soft.copy(alpha = 0.60f),
            separator = line,
            opaqueSeparator = lineStrong,
            link = BrandBlue,
            systemGroupedBackground = bg,
            secondarySystemGroupedBackground = cardColor,
            tertiarySystemGroupedBackground = fillColor,
            systemBackground = bg,
            secondarySystemBackground = cardColor,
            tertiarySystemBackground = fillColor,
        )
    } else {
        lightColorScheme(
            accent = accent,
            label = ink,
            secondaryLabel = soft,
            tertiaryLabel = soft.copy(alpha = 0.72f),
            quaternaryLabel = soft.copy(alpha = 0.48f),
            systemFill = ink.copy(alpha = 0.10f),
            secondarySystemFill = ink.copy(alpha = 0.07f),
            tertiarySystemFill = ink.copy(alpha = 0.05f),
            quaternarySystemFill = ink.copy(alpha = 0.03f),
            placeholderText = soft.copy(alpha = 0.60f),
            separator = line,
            opaqueSeparator = lineStrong,
            link = BrandBlue,
            systemGroupedBackground = bg,
            secondarySystemGroupedBackground = cardColor,
            tertiarySystemGroupedBackground = fillColor,
            systemBackground = bg,
            secondarySystemBackground = cardColor,
            tertiarySystemBackground = fillColor,
        )
    }
}

@Composable
fun FolioTheme(
    preset: String,
    content: @Composable () -> Unit,
) {
    val palette = readingPalette(preset)
    val colors = remember(palette) { folioColorScheme(palette) }
    CupertinoTheme(colorScheme = colors, typography = FolioTypography, shapes = FolioShapes) {
        CompositionLocalProvider(LocalReadingPalette provides palette) {
            content()
        }
    }
}
