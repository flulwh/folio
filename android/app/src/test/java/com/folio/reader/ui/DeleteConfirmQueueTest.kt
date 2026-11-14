package com.folio.reader.ui

import com.folio.reader.core.LocalBook
import com.folio.reader.core.Origin
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * T11 的唯一副本删除确认。
 *
 * 这里验的是「挂起等用户点」这段交互本身：点确认才放行、点取消就拒绝、
 * 新请求顶掉旧请求时旧请求必须立刻按拒绝收尾（否则执行器会永久卡住）。
 * 删除动作本身是否真的删干净由 `CommandExecutorTest` 覆盖。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DeleteConfirmQueueTest {

    private fun book(title: String) = LocalBook(
        id = "sha1-$title",
        title = title,
        origin = Origin.LOCAL,
        contentHash = "a".repeat(40),
        size = 12L,
        hasLocalFile = true,
    )

    @Test
    fun 点确认后才放行并清空弹层() = runTest {
        val queue = DeleteConfirmQueue()
        val waiting = async { queue.confirm(book("唯一副本")) }
        runCurrent()

        val request = queue.request.value
        assertEquals("弹层要拿到书名", "唯一副本", request!!.book.title)

        queue.answer(true)

        assertTrue("点确认应该放行删除", waiting.await())
        assertNull("答完弹层必须收起来", queue.request.value)
    }

    @Test
    fun 点取消返回false() = runTest {
        val queue = DeleteConfirmQueue()
        val waiting = async { queue.confirm(book("唯一副本")) }
        runCurrent()
        assertEquals(1L, queue.request.value!!.requestId)

        queue.answer(false)

        assertFalse("点取消必须拒绝删除", waiting.await())
        assertNull(queue.request.value)
    }

    @Test
    fun 新请求顶掉旧请求时旧的按拒绝收尾() = runTest {
        val queue = DeleteConfirmQueue()
        val first = async { queue.confirm(book("第一本")) }
        runCurrent()

        val second = async { queue.confirm(book("第二本")) }
        runCurrent()

        assertFalse("被顶掉的旧请求不能永远挂着", first.await())
        val current = queue.request.value
        assertEquals("弹层应该换成新请求", "第二本", current!!.book.title)

        queue.answer(true)
        assertTrue("新请求自己回答自己的", second.await())
        assertNull(queue.request.value)
    }

    @Test
    fun 没有待确认请求时回答不会出错() {
        val queue = DeleteConfirmQueue()
        queue.answer(true)
        queue.answer(false)
        assertNull(queue.request.value)
    }
}
