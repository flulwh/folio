package com.folio.reader.core

/**
 * 图片采样：**纯函数**，可单测，不碰 Bitmap。
 *
 * 目标是「3 倍放大还能看清，又不炸内存」：
 *  - 解码前先用 `inJustDecodeBounds` 拿到源尺寸；
 *  - 目标宽度 = `min(源宽, 屏宽 × 2)`（架构文档 §1.4）——
 *    屏宽的 2 倍是视觉上限，再多也只是白占内存；
 *  - `inSampleSize` 只能是 2 的幂（BitmapFactory 的约定），
 *    取「缩完后两边都还 ≥ 目标」的最大值。
 *
 * 例：4000×6000 的漫画页在 1080 宽的屏上 → 目标宽 2160 →
 * `inSampleSize = 1`（4000/2 = 2000 < 2160，再缩就糊了）。
 */
object SampleSize {

    /** 目标宽度的放大余量：屏宽的 2 倍。 */
    const val MAX_SCALE = 2

    /** ARGB_8888 每像素字节数（Bitmap 默认配置）。 */
    const val BYTES_PER_PIXEL = 4

    /**
     * 解码目标宽度。
     *
     * @param sourceWidth 源图宽（像素）
     * @param screenWidth 屏幕宽（像素）
     * @param maxScale 放大余量，默认 [MAX_SCALE]
     * @return `min(源宽, 屏宽 × maxScale)`，至少 1
     */
    fun targetWidth(sourceWidth: Int, screenWidth: Int, maxScale: Int = MAX_SCALE): Int {
        if (sourceWidth <= 0) return 1
        val screen = if (screenWidth <= 0) sourceWidth else screenWidth
        val limit = screen.toLong() * maxScale.coerceAtLeast(1).toLong()
        return minOf(sourceWidth.toLong(), limit).coerceAtLeast(1L).toInt()
    }

    /**
     * 算 `inSampleSize`（2 的幂）。
     *
     * @param sourceWidth 源宽
     * @param sourceHeight 源高
     * @param targetWidth 目标宽；≤0 表示不限宽
     * @param targetHeight 目标高；≤0 表示不限高
     * @return 1 / 2 / 4 / 8 …
     */
    fun calculate(
        sourceWidth: Int,
        sourceHeight: Int,
        targetWidth: Int,
        targetHeight: Int = 0,
    ): Int {
        if (sourceWidth <= 0 || sourceHeight <= 0) return 1
        if (targetWidth <= 0 && targetHeight <= 0) return 1
        var sample = 1
        // 上限 1024 只是防呆：真到这个量级图早就没法看了
        while (sample < MAX_SAMPLE) {
            val next = sample * 2
            val width = sourceWidth / next
            val height = sourceHeight / next
            val widthOk = targetWidth <= 0 || width >= targetWidth
            val heightOk = targetHeight <= 0 || height >= targetHeight
            if (!widthOk || !heightOk) break
            sample = next
        }
        return sample
    }

    /**
     * 一步到位：给定源尺寸与屏幕宽，算出该用多大的 `inSampleSize`。
     *
     * 阅读器只需要「按屏宽铺满一页」，所以高度不设限。
     */
    fun forScreen(sourceWidth: Int, sourceHeight: Int, screenWidth: Int): Int {
        val target = targetWidth(sourceWidth, screenWidth)
        return calculate(sourceWidth, sourceHeight, target, 0)
    }

    /** 采样后的解码尺寸（宽）。 */
    fun decodedWidth(sourceWidth: Int, sampleSize: Int): Int {
        val sample = sampleSize.coerceAtLeast(1)
        return (sourceWidth / sample).coerceAtLeast(1)
    }

    /** 采样后的解码尺寸（高）。 */
    fun decodedHeight(sourceHeight: Int, sampleSize: Int): Int {
        val sample = sampleSize.coerceAtLeast(1)
        return (sourceHeight / sample).coerceAtLeast(1)
    }

    /** 采样后的内存占用估算（字节）。 */
    fun estimatedBytes(sourceWidth: Int, sourceHeight: Int, sampleSize: Int): Long =
        decodedWidth(sourceWidth, sampleSize).toLong() *
            decodedHeight(sourceHeight, sampleSize).toLong() *
            BYTES_PER_PIXEL

    /** 采样幂的上限，纯防呆。 */
    private const val MAX_SAMPLE = 1024
}
