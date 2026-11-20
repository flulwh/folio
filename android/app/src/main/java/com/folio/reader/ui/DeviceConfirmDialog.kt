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
import io.github.alexzhirkevich.cupertino.CupertinoButton
import io.github.alexzhirkevich.cupertino.CupertinoButtonDefaults
import io.github.alexzhirkevich.cupertino.CupertinoText
import io.github.alexzhirkevich.cupertino.theme.CupertinoTheme

/**
 * 「删掉手机上的唯一副本」确认弹层（T11）。
 *
 * 由 `MainActivity` 挂在导航之上，阅读器 / 漫画 / 设置页里都能弹出来。
 * 只会在 `remove-book{unique:true}` 时出现：删掉之后两端都没有这本书了，
 * 所以文案必须把后果说清楚。
 */
@Composable
fun DeviceConfirmDialog(
    state: DeleteConfirmState?,
    onAnswer: (Boolean) -> Unit,
) {
    val request = state ?: return
    val scheme = CupertinoTheme.colorScheme

    FolioSheet(onDismiss = { onAnswer(false) }) {
        Column(Modifier.padding(horizontal = 20.dp)) {
            Spacer(Modifier.height(4.dp))
            CupertinoText(
                text = "把《${request.book.title}》从手机上删掉？",
                fontSize = 19.sp,
                fontWeight = FontWeight.Medium,
                color = scheme.label,
            )
            Spacer(Modifier.height(8.dp))
            CupertinoText(
                text = "手机上是唯一副本，删掉之后两端都没有这本书了。手机端会再问你一次。",
                fontSize = 13.sp,
                color = scheme.secondaryLabel,
            )
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CupertinoButton(
                    onClick = { onAnswer(false) },
                    modifier = Modifier.weight(1f),
                    colors = CupertinoButtonDefaults.grayButtonColors(),
                ) {
                    CupertinoText(text = "取消", fontSize = 14.sp)
                }
                CupertinoButton(
                    onClick = { onAnswer(true) },
                    modifier = Modifier.weight(1f),
                    colors = CupertinoButtonDefaults.filledButtonColors(),
                ) {
                    CupertinoText(text = "删除", fontSize = 14.sp)
                }
            }
        }
    }
}
