package com.folio.reader.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
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
import io.github.alexzhirkevich.cupertino.CupertinoSurface
import io.github.alexzhirkevich.cupertino.CupertinoText
import io.github.alexzhirkevich.cupertino.theme.CupertinoTheme
import kotlinx.coroutines.launch

/* ==========================================================================
   底部面板宿主
   --------------------------------------------------------------------------
   面板本体（圆角、纸色、发丝线）来自 compose-cupertino 的 CupertinoSurface；
   这里只负责 Android 侧的承载：Dialog + 遮罩 + 拖拽条 + 下拉关闭。
   四个面板（目录 / 搜索 / 书签 / 排版）共用这一份，不再各写一遍。
   ========================================================================== */

/** 面板最大高度：屏幕的 86%，再多就该整页了。 */
@Composable
private fun sheetMaxHeight(): Dp =
    (LocalConfiguration.current.screenHeightDp * 0.86f).dp

@Composable
fun FolioSheet(
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
        val scheme = CupertinoTheme.colorScheme
        val maxH = sheetMaxHeight()

        LaunchedEffect(Unit) {
            progress.animateTo(0f, spring(dampingRatio = 0.86f, stiffness = 420f))
        }
        val scrimAlpha = (1f - progress.value) * 0.34f

        Box(Modifier.fillMaxSize()) {
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
            CupertinoSurface(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .heightIn(max = maxH)
                    .graphicsLayer {
                        translationY = with(density) {
                            (maxH.toPx() * progress.value + drag).toInt().toFloat()
                        }
                    },
                shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
                color = scheme.secondarySystemGroupedBackground,
                contentColor = scheme.label,
                shadowElevation = 16.dp,
            ) {
                Column(
                    Modifier
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
                                onDragCancel = { drag = 0f },
                                onVerticalDrag = { _, delta ->
                                    drag = (drag + delta).coerceAtLeast(0f)
                                },
                            )
                        },
                ) {
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
                                .background(scheme.tertiaryLabel)
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
                                CupertinoText(
                                    text = title,
                                    fontSize = 21.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = scheme.label,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                if (subtitle != null) {
                                    Spacer(Modifier.height(2.dp))
                                    CupertinoText(
                                        text = subtitle,
                                        fontSize = 12.5.sp,
                                        color = scheme.secondaryLabel,
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
}
