package com.folio.reader.ui.miuix

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import top.yukonga.miuix.kmp.basic.Card
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.Slider
import top.yukonga.miuix.kmp.basic.SmallTitle
import top.yukonga.miuix.kmp.basic.Switch
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme

/* ==========================================================================
   HyperOS 零件
   --------------------------------------------------------------------------
   Miuix 0.4.x 没有 bottom sheet，这里按它的语言自己拼一个：
   28dp 顶角、纸色面板、弹簧上滑、下拉关闭。其余是列表行 / 分段控件 / 滑杆。

   间距只有四档，所有页面共用，避免「东一块 16、西一块 20」：
   页面边距 20dp / 组间 20dp / 组内 10dp / 卡片圆角 18dp。
   ========================================================================== */

/** 页面左右边距：所有页面、所有分组统一用它。 */
val PageMargin: Dp = 20.dp
/** 分组之间的垂直距离。 */
val SectionGap: Dp = 20.dp
/** 分组标题与内容之间。 */
val LabelGap: Dp = 8.dp
/** 列表行内的水平内边距。 */
val RowInset: Dp = 16.dp
/** 分组卡片圆角。 */
val GroupRadius: Dp = 18.dp

/** 面板最大高度：屏幕的 86%，再多就该整页了。 */
@Composable
private fun sheetMaxHeight(): Dp =
    (LocalConfiguration.current.screenHeightDp * 0.86f).dp

/**
 * HyperOS 底部面板。
 *
 * 内容高度自适应，超过上限内部自行滚动（调用方给 `weight(1f)` 的列表）。
 * 标题栏固定，带一个 4dp 拖拽条，可以下拉关闭。
 */
@Composable
fun HyperSheet(
    onDismiss: () -> Unit,
    title: String? = null,
    subtitle: String? = null,
    headerActions: @Composable RowScope.() -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
        ),
    ) {
        val scope = rememberCoroutineScope()
        val progress = remember { Animatable(1f) }
        var drag by remember { mutableFloatStateOf(0f) }
        val density = LocalDensity.current
        val palette = MiuixTheme.colorScheme
        LaunchedEffect(Unit) {
            progress.animateTo(0f, spring(dampingRatio = 0.86f, stiffness = 420f))
        }
        val scrimAlpha = (1f - progress.value) * 0.34f
        val maxH = sheetMaxHeight()

        Box(Modifier.fillMaxSize()) {
            // 遮罩：点击关闭；透明度跟着面板一起动
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = scrimAlpha))
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = onDismiss,
                    )
            )
            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .heightIn(max = maxH)
                    .graphicsLayer {
                        translationY = with(density) {
                            (maxH.toPx() * progress.value + drag).toInt().toFloat()
                        }
                    }
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                    .background(palette.surface)
                    .navigationBarsPadding()
                    .pointerInput(Unit) {
                        detectVerticalDragGestures(
                            onDragEnd = {
                                if (drag > with(density) { 96.dp.toPx() }) {
                                    onDismiss()
                                } else {
                                    scope.launch { progress.animateTo(0f, spring(stiffness = 500f)) }
                                    drag = 0f
                                }
                            },
                            onDragCancel = {
                                drag = 0f
                            },
                            onVerticalDrag = { _, delta ->
                                drag = (drag + delta).coerceAtLeast(0f)
                            },
                        )
                    },
            ) {
                // 拖拽条
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 10.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier
                            .width(38.dp)
                            .height(4.dp)
                            .clip(CircleShape)
                            .background(palette.onSurface.copy(alpha = 0.18f))
                    )
                }
                if (title != null) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = 24.dp, end = 12.dp, top = 12.dp, bottom = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                text = title,
                                fontSize = 21.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = palette.onSurface,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            if (subtitle != null) {
                                Spacer(Modifier.height(2.dp))
                                Text(
                                    text = subtitle,
                                    fontSize = 12.5.sp,
                                    color = palette.onSurfaceVariantSummary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                        headerActions()
                    }
                }
                content()
                Spacer(Modifier.height(10.dp))
            }
        }
    }
}

/**
 * 发丝线：把列表行分开，靠线而不是靠卡片底。
 *
 * [inset] 是左缩进，用来让线与行文字对齐；缩进后仍贯穿到右边缘。
 */
@Composable
fun Hairline(modifier: Modifier = Modifier, inset: Dp = 0.dp) {
    Box(
        modifier
            .fillMaxWidth()
            .padding(start = inset)
            .height(0.6.dp)
            .background(MiuixTheme.colorScheme.dividerLine)
    )
}

/**
 * 分组标题：小字号、拉字距、灰，像表格的分栏注释。
 * 与行文字左对齐（[RowInset]），右侧可以带一个计数。
 */
@Composable
fun GroupLabel(
    text: String,
    modifier: Modifier = Modifier,
    trailing: String? = null,
    inset: Dp = RowInset,
    topGap: Dp = 24.dp,
) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(start = inset, end = inset, top = topGap, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = text,
            modifier = Modifier.weight(1f),
            fontSize = 11.sp,
            fontWeight = FontWeight.Medium,
            letterSpacing = 1.2.sp,
            color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            maxLines = 1,
        )
        if (trailing != null) {
            Text(
                text = trailing,
                fontSize = 10.5.sp,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
                maxLines = 1,
            )
        }
    }
}

/** 面板里的分组标题：12sp 半粗、拉开字距，上方 20dp、下方 8dp。 */
@Composable
fun HyperSectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        modifier = modifier.padding(start = PageMargin, end = PageMargin, top = SectionGap, bottom = LabelGap),
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.6.sp,
        color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
    )
}

/** 兼容旧调用名。 */
@Composable
fun HyperSectionTitle(text: String, modifier: Modifier = Modifier) = HyperSectionLabel(text, modifier)

/** 一张 HyperOS 卡片：纸色面板 + 18dp 圆角，组内行之间用发丝线分隔。 */
@Composable
fun HyperGroup(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = PageMargin),
        cornerRadius = GroupRadius,
        color = MiuixTheme.colorScheme.surface,
    ) {
        content()
    }
}

/** 紧凑筛选胶囊：30dp 高，选中朱砂底。 */
@Composable
fun HyperChip(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = MiuixTheme.colorScheme
    val source = remember { MutableInteractionSource() }
    Box(
        modifier = modifier
            .pressScale(source)
            .height(30.dp)
            .clip(RoundedCornerShape(15.dp))
            .background(if (selected) palette.primary else palette.secondary)
            .clickable(
                interactionSource = source,
                indication = null,
                onClick = onClick,
            )
            .padding(horizontal = 13.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            fontSize = 12.5.sp,
            fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
            color = if (selected) palette.onPrimary else palette.onSurfaceVariantSummary,
            maxLines = 1,
        )
    }
}

/** 列表行：左标题（+ 副标题），右侧任意内容。 */
@Composable
fun HyperRow(
    title: String,
    modifier: Modifier = Modifier,
    summary: String? = null,
    enabled: Boolean = true,
    onClick: (() -> Unit)? = null,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    val palette = MiuixTheme.colorScheme
    Row(
        modifier = modifier
            .fillMaxWidth()
            .then(
                if (onClick != null) {
                    Modifier.clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        enabled = enabled,
                        onClick = onClick,
                    )
                } else {
                    Modifier
                }
            )
            .padding(horizontal = RowInset, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = title,
                fontSize = 15.sp,
                color = if (enabled) palette.onSurface else palette.disabledOnSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (summary != null) {
                Spacer(Modifier.height(2.dp))
                Text(
                    text = summary,
                    fontSize = 12.5.sp,
                    color = palette.onSurfaceVariantSummary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            content = trailing,
        )
    }
}

/** 开关行。 */
@Composable
fun HyperSwitchRow(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    summary: String? = null,
    enabled: Boolean = true,
) {
    HyperRow(
        title = title,
        summary = summary,
        modifier = modifier,
        enabled = enabled,
        onClick = if (enabled) ({ onCheckedChange(!checked) }) else null,
        trailing = {
            Switch(checked = checked, onCheckedChange = onCheckedChange, enabled = enabled)
        },
    )
}

/** 滑杆行：标题 + 当前值 + Miuix 滑杆。 */
@Composable
fun HyperSliderRow(
    title: String,
    valueLabel: String,
    value: Float,
    onValueChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
    minValue: Float = 0f,
    maxValue: Float = 1f,
    decimalPlaces: Int = 2,
) {
    Column(modifier.fillMaxWidth().padding(horizontal = RowInset, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = title,
                modifier = Modifier.weight(1f),
                fontSize = 14.5.sp,
                color = MiuixTheme.colorScheme.onSurface,
            )
            Text(
                text = valueLabel,
                fontSize = 13.sp,
                color = MiuixTheme.colorScheme.onSurfaceVariantSummary,
            )
        }
        Slider(
            progress = value,
            onProgressChange = onValueChange,
            minValue = minValue,
            maxValue = maxValue,
            decimalPlaces = decimalPlaces,
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
        )
    }
}

/**
 * HyperOS 分段控件：圆角胶囊 + 选中拇指。
 * 用 Box 叠一层选中层，避免引入额外的动画依赖。
 */
@Composable
fun HyperSegmented(
    options: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = MiuixTheme.colorScheme
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(palette.secondary)
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        options.forEachIndexed { index, label ->
            val selected = index == selectedIndex
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height(38.dp)
                    .clip(RoundedCornerShape(11.dp))
                    .background(if (selected) palette.surface else Color.Transparent)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { onSelect(index) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = label,
                    fontSize = 13.5.sp,
                    fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal,
                    color = if (selected) palette.onSurface else palette.onSurfaceVariantSummary,
                    maxLines = 1,
                )
            }
        }
    }
}

/** 阅读器底栏的一格：图标在上、文字在下，选中时用朱砂。 */
@Composable
fun HyperActionCell(
    label: String,
    icon: @Composable () -> Unit,
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    badge: String? = null,
) {
    val palette = MiuixTheme.colorScheme
    val tint = if (active) palette.primary else palette.onSurfaceVariantSummary
    val source = remember { MutableInteractionSource() }
    Column(
        modifier = modifier
            .pressScale(source)
            .clip(RoundedCornerShape(14.dp))
            .clickable(
                interactionSource = source,
                indication = null,
                onClick = onClick,
            )
            .padding(vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(contentAlignment = Alignment.Center) {
            androidx.compose.runtime.CompositionLocalProvider(
                androidx.compose.material3.LocalContentColor provides tint
            ) { icon() }
            if (badge != null) {
                Text(
                    text = badge,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(start = 14.dp, bottom = 8.dp),
                    fontSize = 9.sp,
                    color = tint,
                    maxLines = 1,
                )
            }
        }
        Spacer(Modifier.height(2.dp))
        Text(text = label, fontSize = 9.5.sp, color = tint, maxLines = 1)
    }
}

/** 统一的小号元信息文字。 */
@Composable
fun HyperMeta(text: String, modifier: Modifier = Modifier, color: Color = MiuixTheme.colorScheme.onSurfaceVariantSummary) {
    Text(
        text = text,
        modifier = modifier,
        fontSize = 11.5.sp,
        color = color,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** 圆形图标按钮：40dp 触摸区，HyperOS 的浅底。 */
@Composable
fun HyperRoundIcon(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = MiuixTheme.colorScheme.onSurface,
) {
    Box(
        modifier = modifier
            .size(38.dp)
            .clip(CircleShape)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription,
            modifier = Modifier.size(20.dp),
            tint = tint,
        )
    }
}

/** 阅读器/书架顶部的小标题（章节名、书名的第二行）。 */
@Composable
fun HyperBookTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        modifier = modifier,
        fontSize = 16.sp,
        fontWeight = FontWeight.Medium,
        color = MiuixTheme.colorScheme.onSurface,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** 仅供预览/调试的占位状态，保持与真实组件同样的圆角。 */
@Composable
fun HyperEmpty(text: String, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = text, fontSize = 13.sp, color = MiuixTheme.colorScheme.onSurfaceVariantSummary)
    }
}

/** 面板内容区通用内边距。 */
val HyperSheetPadding: Dp = 16.dp

/** 未使用的占位：让调用方可以 `MutableState` 控制显示，与 SuperDialog 的用法一致。 */
@Composable
fun rememberHyperShowState(initial: Boolean = false) = remember { mutableStateOf(initial) }

/* ==========================================================================
   动效
   --------------------------------------------------------------------------
   全 App 一套节奏：150–220ms、小幅位移、没有弹跳与夸张缩放。
   只做四件事：页面转场、列表入场、按压反馈、HUD 显隐。
   ========================================================================== */

/** 动效节奏的唯一来源，页面转场与控件反馈都从这里取。 */
object FolioMotion {
    /** 按压 / 颜色过渡。 */
    const val Instant = 150
    /** 入场、HUD 显隐。 */
    const val Normal = 200
    /** 列表错开的间隔与上限：同屏最多 6 项依次出现。 */
    const val StaggerStep = 28
    const val StaggerMax = 6
    val Easing = FastOutSlowInEasing
}

/**
 * 列表入场：淡入 + 10dp 上移，按 [index] 错开一小段。
 *
 * 用 `Column` 而不是 `Box`：列表项里经常直接并排写好几个组件
 * （分组标题、发丝线、设置行），`Box` 会把它们叠在同一位置。
 *
 * 状态用 `rememberSaveable` 保存，滚出屏幕再滚回来时不会重新播一遍。
 */
@Composable
fun Reveal(
    index: Int = 0,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    var shown by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (!shown) {
            val delayMs = index.coerceIn(0, FolioMotion.StaggerMax) * FolioMotion.StaggerStep
            if (delayMs > 0) delay(delayMs.toLong())
            shown = true
        }
    }
    val alpha by animateFloatAsState(
        targetValue = if (shown) 1f else 0f,
        animationSpec = tween(FolioMotion.Normal, easing = FolioMotion.Easing),
        label = "reveal-alpha",
    )
    val lift by animateDpAsState(
        targetValue = if (shown) 0.dp else 10.dp,
        animationSpec = tween(FolioMotion.Normal, easing = FolioMotion.Easing),
        label = "reveal-lift",
    )
    val liftPx = with(LocalDensity.current) { lift.toPx() }
    Column(
        modifier.graphicsLayer {
            this.alpha = alpha
            translationY = liftPx
        },
        content = content,
    )
}

/** 按压缩放：默认 0.98，克制到只让人感到「按到了」。 */
@Composable
fun Modifier.pressScale(
    interactionSource: MutableInteractionSource,
    pressedScale: Float = 0.98f,
): Modifier {
    val pressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) pressedScale else 1f,
        animationSpec = tween(FolioMotion.Instant, easing = FolioMotion.Easing),
        label = "press-scale",
    )
    return graphicsLayer {
        scaleX = scale
        scaleY = scale
    }
}
