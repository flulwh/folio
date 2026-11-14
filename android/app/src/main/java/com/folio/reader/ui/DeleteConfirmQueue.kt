package com.folio.reader.ui

import com.folio.reader.core.LocalBook
import com.folio.reader.data.DeleteConfirmer
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * 把「删唯一副本要问用户」变成一次可等待的 UI 交互（T11）。
 *
 * [DeleteConfirmer] 是个挂起接口：指令执行器在这里停住，等用户点确认或取消。
 * 这个类就是那段等待的落点 —— `AppViewModel` 只负责把它暴露成 Compose 状态，
 * 真正的并发细节（新请求顶掉旧请求、弹层被取消）都在这里收口。
 *
 * 两条必须守住的规则：
 *  1. **绝不永久挂起**。旧请求被新请求顶掉时按「拒绝」收尾，执行器继续走，
 *     否则那条指令会卡住整轮队列，桌面端只能等 1 小时超时重投。
 *  2. **默认拒绝**。没人回答（比如进程被杀）就不删 —— 与 `DeleteConfirmer.REJECT`
 *     的安全取向一致：宁可少删一本，也不能凭一条网络指令抹掉唯一副本。
 */
class DeleteConfirmQueue : DeleteConfirmer {

    private val _request = MutableStateFlow<DeleteConfirmState?>(null)

    /** 当前待确认的请求；null 表示没有弹层。 */
    val request: StateFlow<DeleteConfirmState?> = _request.asStateFlow()

    private val lock = Any()
    private var seq = 0L
    private var pending: CompletableDeferred<Boolean>? = null

    override suspend fun confirm(book: LocalBook): Boolean {
        val answer = CompletableDeferred<Boolean>()
        val requestId: Long
        val previous: CompletableDeferred<Boolean>?
        synchronized(lock) {
            seq += 1
            requestId = seq
            previous = pending
            pending = answer
            _request.value = DeleteConfirmState(book = book, requestId = requestId)
        }
        // 上一次确认还没人回答就被顶掉：按拒绝收尾，不让它永远挂在 await 上
        previous?.complete(false)
        try {
            return answer.await()
        } finally {
            synchronized(lock) {
                if (pending === answer) pending = null
                // 只清自己的那一层：被顶掉时 request 已经换成新请求了
                if (_request.value?.requestId == requestId) _request.value = null
            }
        }
    }

    /** 用户点了确认 / 取消；没有待确认请求时什么也不做。 */
    fun answer(allow: Boolean) {
        val target = synchronized(lock) {
            val current = pending
            pending = null
            _request.value = null
            current
        } ?: return
        target.complete(allow)
    }
}
