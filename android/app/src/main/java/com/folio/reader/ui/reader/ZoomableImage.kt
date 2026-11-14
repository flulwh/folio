package com.folio.reader.ui.reader

import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import kotlin.math.max

/**
 * 可缩放的一页漫画。
 *
 * 手势（架构文档 §5 T17）：
 *  - 双指：1x–3x 连续缩放；
 *  - 双击：在 1x 与 2x 之间切换；
 *  - 放大态可拖动平移，松手不越界；回到 1x 时位移清零，避免「图跑出屏幕」。
 *
 * 不引第三方缩放库：`detectTransformGestures` + `graphicsLayer` 就够，
 * 也避免为了一个手势多背一个依赖。
 */
@Composable
fun ZoomableImage(
    bitmap: ImageBitmap,
    modifier: Modifier = Modifier,
    minScale: Float = 1f,
    maxScale: Float = 3f,
) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var containerWidth by remember { mutableFloatStateOf(0f) }
    var containerHeight by remember { mutableFloatStateOf(0f) }

    Box(
        modifier = modifier
            .onSizeChanged { size ->
                containerWidth = size.width.toFloat()
                containerHeight = size.height.toFloat()
            }
            .pointerInput(Unit) {
                detectTransformGestures { _, pan, zoom, _ ->
                    val next = (scale * zoom).coerceIn(minScale, maxScale)
                    scale = next
                    offset = if (next <= minScale + 0.01f) {
                        Offset.Zero
                    } else {
                        clampOffset(offset + pan, next, containerWidth, containerHeight)
                    }
                }
            }
            .pointerInput(Unit) {
                detectTapGestures(
                    onDoubleTap = {
                        if (scale > 1.01f) {
                            scale = 1f
                            offset = Offset.Zero
                        } else {
                            scale = 2f
                        }
                    },
                )
            },
    ) {
        Image(
            bitmap = bitmap,
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer(
                    scaleX = scale,
                    scaleY = scale,
                    translationX = offset.x,
                    translationY = offset.y,
                ),
        )
    }
}

/** 放大后允许的平移范围：图比容器大出来的那一半。 */
private fun clampOffset(offset: Offset, scale: Float, width: Float, height: Float): Offset {
    if (width <= 0f || height <= 0f) return offset
    val maxX = max(0f, (width * (scale - 1f)) / 2f)
    val maxY = max(0f, (height * (scale - 1f)) / 2f)
    return Offset(
        x = offset.x.coerceIn(-maxX, maxX),
        y = offset.y.coerceIn(-maxY, maxY),
    )
}
