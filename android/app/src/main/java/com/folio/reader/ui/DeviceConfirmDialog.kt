package com.folio.reader.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.alexzhirkevich.cupertino.CupertinoText
import io.github.alexzhirkevich.cupertino.theme.CupertinoTheme

/**
 * 「删掉手机上的唯一副本」确认框（T11）。
 *
 * 由 `MainActivity` 挂在导航之上，阅读器 / 漫画 / 设置页里都能弹出来。
 * 只会在 `remove-book{unique:true}` 时出现：删掉之后两端都没有这本书了，
 * 所以文案必须把后果说清楚。
 *
 * 形态按 iOS 11 的 alert 做：270dp 居中、14dp 圆角、17sp 标题、按钮等分一行。
 * 之前是底部面板，破坏性确认用 alert 更符合系统直觉（点遮罩即取消）。
 */
@Composable
fun DeviceConfirmDialog(
    state: DeleteConfirmState?,
    onAnswer: (Boolean) -> Unit,
) {
    val request = state ?: return
    val scheme = CupertinoTheme.colorScheme

    // 返回键等同「取消」：跟点遮罩一个语义，不会误删。
    BackHandler { onAnswer(false) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(ModalScrim)
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
            ) { onAnswer(false) },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .width(270.dp)
                .clip(RoundedCornerShape(SheetRadius))
                .background(scheme.secondarySystemGroupedBackground)
                // 卡片内的点击停在卡片上，不要穿透到遮罩触发「取消」。
                .pointerInput(Unit) { detectTapGestures { } },
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 18.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                CupertinoText(
                    text = "把《${request.book.title}》从手机上删掉？",
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = scheme.label,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(6.dp))
                CupertinoText(
                    text = "手机上是唯一副本，删掉之后两端都没有这本书了。手机端会再问你一次。",
                    fontSize = 13.sp,
                    color = scheme.secondaryLabel,
                    textAlign = TextAlign.Center,
                )
            }

            Box(Modifier.fillMaxWidth().height(0.5.dp).background(scheme.separator))

            Row(Modifier.fillMaxWidth().height(44.dp)) {
                AlertAction(
                    text = "取消",
                    color = scheme.accent,
                    modifier = Modifier.weight(1f),
                ) { onAnswer(false) }
                Box(Modifier.width(0.5.dp).fillMaxSize().background(scheme.separator))
                AlertAction(
                    text = "删除",
                    color = BrandNegative,
                    modifier = Modifier.weight(1f),
                ) { onAnswer(true) }
            }
        }
    }
}

/** alert 里的一个文字按钮：17sp、整格可点、按下不作额外缩放。 */
@Composable
private fun AlertAction(
    text: String,
    color: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        CupertinoText(
            text = text,
            fontSize = 17.sp,
            color = color,
        )
    }
}
