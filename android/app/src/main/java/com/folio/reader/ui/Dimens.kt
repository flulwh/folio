package com.folio.reader.ui

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/* ==========================================================================
   间距只有四档，所有页面共用，避免「东一块 16、西一块 20」。
   ========================================================================== */

/** 页面左右边距：iOS 分组列表的标准缩进。 */
val PageMargin: Dp = 16.dp
/** 分组之间的垂直距离。 */
val SectionGap: Dp = 22.dp
/** 分组标题与内容之间。 */
val LabelGap: Dp = 7.dp
/** 列表行内的水平内边距。 */
val RowInset: Dp = 16.dp
/** 分组卡片圆角：iOS inset grouped 卡片是 10dp。 */
val GroupRadius: Dp = 10.dp
/** 面板内容区通用内边距。 */
val SheetPadding: Dp = 16.dp

/**
 * 底部面板圆角：iOS 11 的 sheet 是 14dp。
 * 原来写 20dp，观感更接近 iOS 15 的抽屉，和 11 的紧凑感不符。
 */
val SheetRadius: Dp = 14.dp

/** 阅读器浮层（顶栏 / 底栏卡片）圆角，与面板同一档。 */
val HudRadius: Dp = 14.dp

/**
 * 正文列最宽：平板 / 横屏上把行宽收在 680dp。
 *
 * 中文一行超过 40 字就难回行，宽屏上满幅铺开会让眼睛在行尾找不回下一行。
 * Apple Books 与各家阅读器在宽屏都会限制正文宽度；滚动与翻页两种模式共用这一个上限，
 * 多出来的宽度均分到左右两侧留白。
 */
val ReaderColumn: Dp = 680.dp
