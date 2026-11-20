package com.folio.reader.ui

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

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

/** 未使用的占位：让调用方可以 `MutableState` 控制显示。 */
@Composable
fun rememberHyperShowState(initial: Boolean = false) = remember { mutableStateOf(initial) }
