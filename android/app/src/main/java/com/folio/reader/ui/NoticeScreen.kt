package com.folio.reader.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.folio.reader.ui.session.SessionStore
import io.github.alexzhirkevich.cupertino.CupertinoActivityIndicator
import io.github.alexzhirkevich.cupertino.CupertinoIcon
import io.github.alexzhirkevich.cupertino.CupertinoNavigationTitle
import io.github.alexzhirkevich.cupertino.CupertinoScaffold
import io.github.alexzhirkevich.cupertino.CupertinoText
import io.github.alexzhirkevich.cupertino.CupertinoTopAppBar
import io.github.alexzhirkevich.cupertino.ExperimentalCupertinoApi
import io.github.alexzhirkevich.cupertino.icons.CupertinoIcons
import io.github.alexzhirkevich.cupertino.icons.outlined.ArrowClockwise
import io.github.alexzhirkevich.cupertino.icons.outlined.ChevronBackward
import io.github.alexzhirkevich.cupertino.section.CupertinoSection
import io.github.alexzhirkevich.cupertino.section.SectionItem
import io.github.alexzhirkevich.cupertino.section.SectionLink
import io.github.alexzhirkevich.cupertino.section.SectionScope
import io.github.alexzhirkevich.cupertino.section.SectionStyle
import io.github.alexzhirkevich.cupertino.theme.CupertinoTheme

/**
 * 公告中心：独立整页，不再挤在设置页的一个分组里。
 *
 * 数据与已读状态来自 [SessionStore.noticeState]；点一条即标已读，
 * 有链接时顺手用浏览器打开。返回书架后首屏横幅会按同一份状态消失。
 */
@OptIn(ExperimentalCupertinoApi::class)
@Composable
fun NoticeScreen(session: SessionStore, onBack: () -> Unit) {
    val state by session.noticeState.collectAsStateWithLifecycle()
    val scheme = CupertinoTheme.colorScheme
    val context = LocalContext.current

    CupertinoScaffold(
        modifier = Modifier.fillMaxSize(),
        topBar = {
            NoticeTopBar(
                onBack = onBack,
                loading = state.loading,
                onRefresh = { session.refreshNotices() },
            )
        },
        containerColor = scheme.systemGroupedBackground,
        appBarsBlurAlpha = FolioAppBarAlpha,
        appBarsBlurRadius = FolioAppBarBlurRadius,
        hasNavigationTitle = true,
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                top = padding.calculateTopPadding(),
                bottom = padding.calculateBottomPadding() + 24.dp,
            ),
        ) {
            item("nav-title") {
                CupertinoNavigationTitle {
                    CupertinoText(text = "公告")
                }
            }

            item("notice-list") {
                Reveal(index = 0) {
                    CupertinoSection(
                        style = SectionStyle.InsetGrouped,
                        title = sectionLabel("全部公告"),
                    ) {
                        if (state.notices.isEmpty()) {
                            NoticeItem(key = "notice-empty") {
                                CupertinoText(
                                    text = when {
                                        state.loading -> "正在读取公告…"
                                        state.error.isNotBlank() -> state.error
                                        else -> "暂时没有公告，恢复网络后点右上角刷新"
                                    },
                                    modifier = Modifier.padding(vertical = 6.dp),
                                    fontSize = 13.sp,
                                    color = scheme.secondaryLabel,
                                )
                            }
                        } else {
                            state.notices.forEach { notice ->
                                NoticeItem(key = "notice-${notice.id}") {
                                    NoticeRow(
                                        notice = notice,
                                        read = state.isRead(notice.id),
                                        onClick = {
                                            session.dismissNotice(notice.id)
                                            if (notice.url.isNotBlank()) {
                                                openInBrowser(context, notice.url)
                                            }
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }

            if (state.notices.isNotEmpty()) {
                item("notice-actions") {
                    Reveal(index = 1) {
                        CupertinoSection(style = SectionStyle.InsetGrouped) {
                            NoticeItem(key = "notice-read-all") {
                                SectionLink(
                                    onClick = { session.markAllNoticesRead() },
                                    enabled = state.unreadCount > 0,
                                    caption = {
                                        CupertinoText(
                                            text = if (state.unreadCount > 0) {
                                                "${state.unreadCount} 条未读"
                                            } else {
                                                "全部已读"
                                            },
                                            fontSize = 12.sp,
                                        )
                                    },
                                ) {
                                    CupertinoText(text = "全部已读", fontSize = 17.sp, color = scheme.accent)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalCupertinoApi::class)
@Composable
private fun NoticeTopBar(onBack: () -> Unit, loading: Boolean, onRefresh: () -> Unit) {
    val scheme = CupertinoTheme.colorScheme
    CupertinoTopAppBar(
        title = { CupertinoText(text = "公告", maxLines = 1) },
        colors = folioTopBarColors(),
        navigationIcon = {
            val source = remember { MutableInteractionSource() }
            Box(
                Modifier
                    .padding(start = PageMargin)
                    .pressScale(source, pressedScale = 0.92f)
                    .size(42.dp)
                    .clickable(interactionSource = source, indication = null, onClick = onBack),
                contentAlignment = Alignment.Center,
            ) {
                CupertinoIcon(
                    imageVector = CupertinoIcons.Outlined.ChevronBackward,
                    contentDescription = "返回",
                    modifier = Modifier.size(22.dp),
                    tint = scheme.accent,
                )
            }
        },
        actions = {
            if (loading) {
                Box(Modifier.size(42.dp), contentAlignment = Alignment.Center) {
                    CupertinoActivityIndicator(size = 16.dp)
                }
            } else {
                val source = remember { MutableInteractionSource() }
                Box(
                    Modifier
                        .pressScale(source, pressedScale = 0.88f)
                        .size(42.dp)
                        .clip(CircleShape)
                        .clickable(interactionSource = source, indication = null, onClick = onRefresh),
                    contentAlignment = Alignment.Center,
                ) {
                    CupertinoIcon(
                        imageVector = CupertinoIcons.Outlined.ArrowClockwise,
                        contentDescription = "刷新公告",
                        modifier = Modifier.size(21.dp),
                        tint = scheme.accent,
                    )
                }
            }
        },
    )
}

/** Section 里的整行；和设置页的私有 Item 同构，只是这份只在公告页用。 */
@OptIn(ExperimentalCupertinoApi::class)
@Composable
private fun SectionScope.NoticeItem(key: String, content: @Composable () -> Unit) {
    SectionItem(title = content)
}

private fun sectionLabel(text: String): @Composable () -> Unit = {
    CupertinoText(
        text = text,
        fontSize = 13.sp,
        color = CupertinoTheme.colorScheme.secondaryLabel,
    )
}
