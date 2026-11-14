package com.folio.reader.ui

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable

/**
 * 「删掉手机上的唯一副本」确认弹层（T11）。
 *
 * 由 `MainActivity` 挂在 NavHost 之上，所以阅读器、漫画、设置页里都能弹出来 ——
 * 桌面端发来的删除指令可不会挑用户正在哪一页。
 *
 * 只会在 `remove-book{unique:true}` 时出现：删掉之后两端都没有这本书了，
 * 所以文案里必须把这个后果说清楚。
 *
 * @param state 当前待确认的请求；null 时什么都不渲染
 * @param onAnswer true = 允许删除，false = 拒绝
 */
@Composable
fun DeviceConfirmDialog(
    state: DeleteConfirmState?,
    onAnswer: (Boolean) -> Unit,
) {
    val request = state ?: return
    AlertDialog(
        onDismissRequest = { onAnswer(false) },
        title = { Text("把《${request.book.title}》从手机上删掉？") },
        text = {
            Text(
                "手机上是唯一副本，手机端会再问你一次。",
                color = MaterialTheme.colorScheme.error,
            )
        },
        confirmButton = {
            TextButton(onClick = { onAnswer(true) }) {
                Text("删除", color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = { onAnswer(false) }) {
                Text("取消")
            }
        },
    )
}
