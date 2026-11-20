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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.alexzhirkevich.cupertino.CupertinoScaffoldDefaults
import io.github.alexzhirkevich.cupertino.theme.CupertinoTheme
import io.github.alexzhirkevich.cupertino.theme.Shapes
import io.github.alexzhirkevich.cupertino.theme.Typography
import io.github.alexzhirkevich.cupertino.theme.darkColorScheme
import io.github.alexzhirkevich.cupertino.theme.lightColorScheme

/* ==========================================================================
   Folio · iOS 皮肤
   --------------------------------------------------------------------------
   组件与观感全部交给 compose-cupertino（iOS 风格），这里只做三件事：
   - 语义色直接对齐 iOS 系统色板：label / secondaryLabel / separator /
     systemGroupedBackground（#F2F2F7 · #000000）/ 卡片（#FFFFFF · #1C1C1E）
   - 强调色用 systemBlue（#007AFF / #0A84FF），绿 / 橙 / 红只做状态点缀
   - 底色 = 当前阅读底色预设（浅色 / 纸白 / 米色 / 石墨 / 夜间），全部落在系统灰阶上
   正文的排版（字号 / 行距 / 字距 / 段距）与皮肤无关，仍由阅读设置驱动。
   ========================================================================== */

/* ------------------------------ 系统色板 ------------------------------ */

/** 主墨色：正文与深色底。 */
val BrandInk = Color(0xFF000000)
/** 主纸色：浅色底与深色底上的文字。 */
val BrandPaper = Color(0xFFFFFFFF)
/** 系统灰：次级文字（iOS systemGray）。 */
val BrandGray = Color(0xFF8E8E93)
/** 系统浅灰：填充底（iOS systemGray5）。 */
val BrandFill = Color(0xFFE5E5EA)
/** 主强调色：systemBlue，只给可点文字、进度、开关、当前项。 */
val BrandAccent = Color(0xFF007AFF)
/** 深色下的 systemBlue：夜间底上高一档亮度才够对比。 */
val BrandAccentDark = Color(0xFF0A84FF)
/** 正向状态：systemGreen。 */
val BrandPositive = Color(0xFF34C759)
/** 提醒状态：systemOrange。 */
val BrandWarning = Color(0xFFFF9500)
/** 失败状态：systemRed。 */
val BrandNegative = Color(0xFFFF3B30)

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
    val line: Color get() = ink.copy(alpha = if (isDark) 0.24f else 0.20f)
    val lineStrong: Color get() = ink.copy(alpha = if (isDark) 0.42f else 0.34f)
    val accent: Color get() = if (isDark) BrandAccentDark else BrandAccent
    /** 蓝底足够深，上面压白字。 */
    val accentInk: Color get() = BrandPaper
    val accentSoft: Color get() = accent.copy(alpha = if (isDark) 0.24f else 0.14f)
    /** 卡片底：iOS secondarySystemGroupedBackground。 */
    val card: Color get() = when {
        !isDark -> BrandPaper
        id == "night" -> Color(0xFF1C1C1E)
        else -> Color(0xFF2C2C2E)
    }
    /** 比卡片再高一层：输入框、分段控件底、未选中的胶囊。 */
    val fill: Color get() = if (isDark) Color(0xFF3A3A3C) else BrandFill
}

private val WHITE_PALETTE = ReadingPalette(
    id = "white",
    label = "浅色",
    bg = Color(0xFFF2F2F7),
    ink = BrandInk,
    soft = BrandGray,
    isDark = false,
)

private val PAPER_PALETTE = ReadingPalette(
    id = "paper",
    label = "纸白",
    bg = BrandPaper,
    ink = BrandInk,
    soft = BrandGray,
    isDark = false,
)

private val CREAM_PALETTE = ReadingPalette(
    id = "cream",
    label = "米色",
    bg = Color(0xFFF7F3EC),
    ink = Color(0xFF1C1B18),
    soft = Color(0xFF79736A),
    isDark = false,
)

private val GRAPHITE_PALETTE = ReadingPalette(
    id = "graphite",
    label = "石墨",
    bg = Color(0xFF1C1C1E),
    ink = Color(0xFFF2F2F7),
    soft = Color(0xFF98989F),
    isDark = true,
)

private val NIGHT_PALETTE = ReadingPalette(
    id = "night",
    label = "夜间",
    bg = BrandInk,
    ink = Color(0xFFEBEBF0),
    soft = Color(0xFF98989F),
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

/* ------------------------------ 顶栏毛玻璃 ------------------------------ */

/**
 * 顶栏与 Tab Bar 的毛玻璃半径。
 *
 * compose-cupertino 默认 40dp，安卓上每一帧都要按这个半径重做一次卷积：
 * 书架上下滑、封面滚动时它是最主要的 GPU 开销。压到 60%（约 24dp）后
 * 仍是磨砂观感，代价明显下降；系统「减弱透明度」时基准是 50dp，同样按比例缩。
 */
val FolioAppBarBlurRadius: Dp
    get() = CupertinoScaffoldDefaults.AppBarsBlurRadius * 0.6f

/** 与 [FolioAppBarBlurRadius] 配套：半径缩小后把底色提一点，避免发灰发薄。 */
val FolioAppBarBlurAlpha: Float
    get() = CupertinoScaffoldDefaults.AppBarsBlurAlpha.let { if (it > 0.6f) it else 0.62f }

/* --------------------------------- 字体 --------------------------------- */

private val Sans = FontFamily.SansSerif

/**
 * iOS 字阶（SF Pro 的槽位）：34 / 28 / 22 / 20 / 17 / 16 / 15 / 13 / 12 / 11。
 *
 * 41dp 的 largeTitle 行高 + Bold 是 iOS 大标题的标准形态；
 * 列表行统一 17sp，副标题 13sp，元信息不再用等宽（iOS 里没有这一层）。
 */
val FolioTypography: Typography = Typography(
    largeTitle = TextStyle(
        fontFamily = Sans,
        fontSize = 34.sp,
        lineHeight = 41.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.4).sp,
    ),
    title1 = TextStyle(
        fontFamily = Sans,
        fontSize = 28.sp,
        lineHeight = 34.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.3).sp,
    ),
    title2 = TextStyle(
        fontFamily = Sans,
        fontSize = 22.sp,
        lineHeight = 28.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.2).sp,
    ),
    title3 = TextStyle(
        fontFamily = Sans,
        fontSize = 20.sp,
        lineHeight = 25.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.1).sp,
    ),
    headline = TextStyle(
        fontFamily = Sans,
        fontSize = 17.sp,
        lineHeight = 22.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.sp,
    ),
    body = TextStyle(
        fontFamily = Sans,
        fontSize = 17.sp,
        lineHeight = 22.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 0.sp,
    ),
    callout = TextStyle(
        fontFamily = Sans,
        fontSize = 16.sp,
        lineHeight = 21.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 0.sp,
    ),
    subhead = TextStyle(
        fontFamily = Sans,
        fontSize = 15.sp,
        lineHeight = 20.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 0.sp,
    ),
    footnote = TextStyle(
        fontFamily = Sans,
        fontSize = 13.sp,
        lineHeight = 18.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 0.sp,
    ),
    caption1 = TextStyle(
        fontFamily = Sans,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 0.sp,
    ),
    caption2 = TextStyle(
        fontFamily = Sans,
        fontSize = 11.sp,
        lineHeight = 13.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 0.sp,
    ),
)

/** iOS 的圆角语言：卡片 10dp、分组 12dp、抽屉 20dp、封面 6dp。 */
val FolioShapes: Shapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(10.dp),
    large = RoundedCornerShape(14.dp),
    extraLarge = RoundedCornerShape(20.dp),
)

/* --------------------------------- 主题 --------------------------------- */

/**
 * 把纸色预设映射到 Cupertino 的 iOS 语义色板。
 *
 * accent = systemBlue；label = 墨；separator = 系统发丝线；
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
            tertiaryLabel = soft.copy(alpha = 0.70f),
            quaternaryLabel = soft.copy(alpha = 0.40f),
            systemFill = ink.copy(alpha = 0.18f),
            secondarySystemFill = fill,
            tertiarySystemFill = ink.copy(alpha = 0.10f),
            quaternarySystemFill = ink.copy(alpha = 0.05f),
            placeholderText = soft.copy(alpha = 0.55f),
            separator = line,
            opaqueSeparator = lineStrong,
            link = accent,
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
            tertiaryLabel = soft.copy(alpha = 0.70f),
            quaternaryLabel = soft.copy(alpha = 0.40f),
            systemFill = fill,
            secondarySystemFill = ink.copy(alpha = 0.08f),
            tertiarySystemFill = ink.copy(alpha = 0.05f),
            quaternarySystemFill = ink.copy(alpha = 0.03f),
            placeholderText = soft.copy(alpha = 0.70f),
            separator = line,
            opaqueSeparator = lineStrong,
            link = accent,
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
