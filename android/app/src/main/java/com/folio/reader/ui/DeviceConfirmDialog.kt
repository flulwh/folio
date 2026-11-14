package com.folio.reader.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.folio.reader.ui.miuix.HyperSheet
import top.yukonga.miuix.kmp.basic.Button
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.theme.MiuixTheme

/**
 * 「删掉手机上的唯一副本」确认弹层（T11）。
 *
 * 由 `MainActivity` 挂在 NavHost 之上，阅读器 / 漫画 / 设置页里都能弹出来。
 * 只会在 `remove-book{unique:true}` 时出现：删掉之后两端都没有这本书了，
 * 所以文案必须把后果说清楚。
 */
@Composable
fun DeviceConfirmDialog(
    state: DeleteConfirmState?,
    onAnswer: (Boolean) -> Unit,
) {
    val request = state ?: return
    val scheme = MiuixTheme.colorScheme

    HyperSheet(onDismiss = { onAnswer(false) }) {
        Column(Modifier.padding(horizontal = 20.dp)) {
            Spacer(Modifier.height(4.dp))
            Text(
                text = "把《${request.book.title}》从手机上删掉？",
                fontSize = 19.sp,
                fontWeight = FontWeight.Medium,
                color = scheme.onSurface,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = "手机上是唯一副本，删掉之后两端都没有这本书了。手机端会再问你一次。",
                fontSize = 13.sp,
                color = scheme.onSurfaceVariantSummary,
            )
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TextButton(
                    text = "取消",
                    onClick = { onAnswer(false) },
                    modifier = Modifier.weight(1f),
                    cornerRadius = 16.dp,
                )
                Button(
                    onClick = { onAnswer(true) },
                    modifier = Modifier.weight(1f),
                    cornerRadius = 16.dp,
                ) {
                    Text(text = "删除", fontSize = 14.sp, color = scheme.onPrimary)
                }
            }
        }
    }
}
