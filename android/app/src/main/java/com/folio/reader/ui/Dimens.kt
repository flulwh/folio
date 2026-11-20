package com.folio.reader.ui

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/* ==========================================================================
   间距只有四档，所有页面共用，避免「东一块 16、西一块 20」。
   ========================================================================== */

/** 页面左右边距：所有页面、所有分组统一用它。 */
val PageMargin: Dp = 20.dp
/** 分组之间的垂直距离。 */
val SectionGap: Dp = 20.dp
/** 分组标题与内容之间。 */
val LabelGap: Dp = 8.dp
/** 列表行内的水平内边距。 */
val RowInset: Dp = 16.dp
/** 分组卡片圆角。 */
val GroupRadius: Dp = 18.dp
/** 面板内容区通用内边距。 */
val SheetPadding: Dp = 16.dp
