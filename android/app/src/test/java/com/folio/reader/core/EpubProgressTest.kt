package com.folio.reader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * EPUB 百分比换算：与桌面端对齐到 0–100，缺失时退回章内比例，脏值夹住不抛异常。
 */
class EpubProgressTest {

    @Test
    fun `totalProgression 换算成百分比`() {
        assertEquals(42.0, epubPercent(0.42, null)!!, 1e-9)
    }

    @Test
    fun `缺 totalProgression 时退回章内比例`() {
        assertEquals(50.0, epubPercent(null, 0.5)!!, 1e-9)
    }

    @Test
    fun `两者都缺时返回 null`() {
        assertNull(epubPercent(null, null))
    }

    @Test
    fun `脏值夹到 0 到 100 之间`() {
        assertEquals(100.0, epubPercent(8.0, null)!!, 1e-9)
        assertEquals(0.0, epubPercent(-1.0, null)!!, 1e-9)
        assertNull(epubPercent(Double.NaN, null))
    }

    @Test
    fun `百分比反解为 0 到 1 的比例`() {
        assertEquals(0.42, epubFraction(42.0), 1e-9)
        assertEquals(1.0, epubFraction(180.0), 1e-9)
        assertEquals(0.0, epubFraction(null), 1e-9)
    }
}
