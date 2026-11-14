package com.folio.reader.core

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 采样是纯函数，边界能穷举。
 *
 * 目标是「按屏宽铺满一页 + 3 倍放大还能看」：目标宽 = `min(源宽, 屏宽 × 2)`，
 * 再取「缩完之后两边都还 ≥ 目标」的最大 2 的幂。
 */
class SampleSizeTest {

    @Test
    fun 目标宽度不超过屏宽的两倍() {
        // 4000 宽的漫画页在 1080 屏上：目标 2160，不是 4000
        assertEquals(2160, SampleSize.targetWidth(4000, 1080))
        // 比屏宽还小的图不放大
        assertEquals(800, SampleSize.targetWidth(800, 1080))
    }

    @Test
    fun 屏幕宽度未知时不缩() {
        assertEquals(4000, SampleSize.targetWidth(4000, 0))
    }

    @Test
    fun 超大图按二的幂降采样() {
        // 8000/2 = 4000 ≥ 2160 → 2；8000/4 = 2000 < 2160 → 停
        assertEquals(2, SampleSize.forScreen(8000, 12000, 1080))
        // 16000/4 = 4000 ≥ 2160；16000/8 = 2000 < 2160 → 4
        assertEquals(4, SampleSize.forScreen(16000, 24000, 1080))
    }

    @Test
    fun 本来就不大的图原样解() {
        assertEquals(1, SampleSize.forScreen(1080, 1600, 1080))
        assertEquals(1, SampleSize.forScreen(720, 1280, 1080))
    }

    @Test
    fun 同时限制宽高时取更保守的那个() {
        // 目标 1000×1000：4000/2 = 2000 两边都够；4000/4 = 1000 也够；4000/8 = 500 不够
        assertEquals(4, SampleSize.calculate(4000, 4000, 1000, 1000))
    }

    @Test
    fun 采样后尺寸与内存估算() {
        assertEquals(1000, SampleSize.decodedWidth(4000, 4))
        assertEquals(1500, SampleSize.decodedHeight(6000, 4))
        assertEquals(4_000_000L, SampleSize.estimatedBytes(4000, 4000, 4))
    }

    @Test
    fun 非法输入不炸() {
        assertEquals(1, SampleSize.calculate(0, 0, 100, 100))
        assertEquals(1, SampleSize.calculate(100, 100, 0, 0))
        assertEquals(1, SampleSize.targetWidth(0, 1080))
        assertEquals(1, SampleSize.decodedWidth(10, 100))
    }
}
