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
