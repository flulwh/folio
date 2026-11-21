package com.folio.reader.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import cafe.adriel.voyager.core.model.rememberScreenModel
import cafe.adriel.voyager.core.screen.Screen
import cafe.adriel.voyager.navigator.LocalNavigator
import cafe.adriel.voyager.navigator.Navigator
import cafe.adriel.voyager.navigator.currentOrThrow
import cafe.adriel.voyager.transitions.SlideTransition
import com.folio.reader.FolioApp
import com.folio.reader.ui.book.EpubReaderScreen
import com.folio.reader.ui.model.ComicModel
import com.folio.reader.ui.model.EpubModel
import com.folio.reader.ui.model.FontsModel
import com.folio.reader.ui.model.ReaderModel
import com.folio.reader.ui.model.SettingsModel
import com.folio.reader.ui.model.ShelfModel
import com.folio.reader.ui.model.SyncModel
import com.folio.reader.ui.session.SessionStore
import io.github.alexzhirkevich.cupertino.CupertinoIcon
import io.github.alexzhirkevich.cupertino.CupertinoNavigationBar
import io.github.alexzhirkevich.cupertino.CupertinoNavigationBarItem
import io.github.alexzhirkevich.cupertino.CupertinoText
import io.github.alexzhirkevich.cupertino.ExperimentalCupertinoApi
import io.github.alexzhirkevich.cupertino.icons.CupertinoIcons
import io.github.alexzhirkevich.cupertino.icons.outlined.ArrowClockwise
import io.github.alexzhirkevich.cupertino.icons.outlined.Book
import io.github.alexzhirkevich.cupertino.icons.outlined.Gear

/** 路由名只用来判断「现在是不是在阅读页」（音量键翻页）。 */
const val ROUTE_SHELF = "shelf"
const val ROUTE_READER = "reader"
const val ROUTE_COMIC = "comic"
const val ROUTE_EPUB = "epub"
const val ROUTE_SETTINGS = "settings"
const val ROUTE_SYNC = "sync"
const val ROUTE_FONT_STORE = "fonts"
const val ROUTE_NOTICE = "notice"

/**
 * 根容器：iOS 式底部 Tab Bar（书架 / 同步 / 设置）+ 压栈的阅读页。
 *
 * Tab 之间是平级切换（不做横向转场，和 iOS 一致）；阅读页、字体商店仍走
 * Voyager 的栈内 push/pop，返回键与转场保持原行为。
 */
@Composable
fun FolioNav(session: SessionStore) {
    Navigator(RootRoute) { navigator ->
        LaunchedEffect(navigator.lastItem) {
            val name = navigator.lastItem.routeName
            // Tab 根页自己按当前 Tab 上报路由，这里跳过空名字
            if (name.isNotEmpty()) session.reportRoute(name)
        }
        SlideTransition(navigator) { screen -> screen.Content() }
    }
}

private val Screen.routeName: String
    get() = when (this) {
        ReaderRoute -> ROUTE_READER
        ComicRoute -> ROUTE_COMIC
        EpubRoute -> ROUTE_EPUB
        SettingsRoute -> ROUTE_SETTINGS
        SyncRoute -> ROUTE_SYNC
        FontStoreRoute -> ROUTE_FONT_STORE
        NoticeRoute -> ROUTE_NOTICE
        else -> ""
    }

@Composable
private fun recallSession(): SessionStore =
    (LocalContext.current.applicationContext as FolioApp).session

/* ------------------------------ Tab 根页 ------------------------------ */

/** 0 = 书架，1 = 同步，2 = 设置。 */
private object RootRoute : Screen {

    @Composable
    override fun Content() {
        val navigator = LocalNavigator.currentOrThrow
        val session = recallSession()
        var tab by rememberSaveable { mutableIntStateOf(0) }
        val shelfModel = rememberScreenModel { ShelfModel(session) }
        val syncModel = rememberScreenModel { SyncModel(session) }
        val settingsModel = rememberScreenModel { SettingsModel(session) }

        LaunchedEffect(tab) {
            session.reportRoute(
                when (tab) {
                    0 -> ROUTE_SHELF
                    1 -> ROUTE_SYNC
                    else -> ROUTE_SETTINGS
                }
            )
        }

        // Tab Bar 由各根页自己的 CupertinoScaffold 承载：只有放进 scaffold 的 bottomBar，
        // 才能拿到 iOS 的毛玻璃，并且高度会被算进内容的 PaddingValues（不会重复叠系统栏）。
        val bottomBar: @Composable () -> Unit = {
            FolioTabBar(selected = tab, onSelect = { tab = it })
        }

        when (tab) {
            0 -> ShelfScreen(
                model = shelfModel,
                onOpenBook = { book ->
                    when {
                        book.isComic -> {
                            session.openBook(book)
                            navigator.push(ComicRoute)
                        }

                        book.isEpub -> {
                            session.openEpub(book)
                            navigator.push(EpubRoute)
                        }

                        // PDF 没有安卓阅读器：别落进文本通道把二进制解成乱码
                        book.isPdf -> session.showMessage("PDF 只能在这台电脑上看")

                        else -> {
                            session.openBook(book)
                            navigator.push(ReaderRoute)
                        }
                    }
                },
                onOpenSettings = { tab = 2 },
                onOpenSyncStatus = { tab = 1 },
                onOpenNotices = { navigator.push(NoticeRoute) },
                bottomBar = bottomBar,
            )

            1 -> SyncStatusScreen(model = syncModel, onBack = null, bottomBar = bottomBar)

            else -> SettingsScreen(
                model = settingsModel,
                onBack = null,
                onOpenSyncStatus = { tab = 1 },
                onOpenFontStore = { navigator.push(FontStoreRoute) },
                onOpenNotices = { navigator.push(NoticeRoute) },
                bottomBar = bottomBar,
            )
        }
    }
}

@OptIn(ExperimentalCupertinoApi::class)
@Composable
private fun FolioTabBar(selected: Int, onSelect: (Int) -> Unit) {
    CupertinoNavigationBar {
        TabItem(CupertinoIcons.Outlined.Book, "书架", selected == 0) { onSelect(0) }
        TabItem(CupertinoIcons.Outlined.ArrowClockwise, "同步", selected == 1) { onSelect(1) }
        TabItem(CupertinoIcons.Outlined.Gear, "设置", selected == 2) { onSelect(2) }
    }
}

@OptIn(ExperimentalCupertinoApi::class)
@Composable
private fun RowScope.TabItem(
    icon: ImageVector,
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    CupertinoNavigationBarItem(
        selected = selected,
        onClick = onClick,
        icon = {
            CupertinoIcon(
                imageVector = icon,
                contentDescription = label,
                modifier = Modifier.size(24.dp),
            )
        },
        // 不额外传字号/颜色：继承收起后的 caption2 与选中着色，和 iOS 一致。
        label = { CupertinoText(text = label, maxLines = 1) },
    )
}

private object ReaderRoute : Screen {

    @Composable
    override fun Content() {
        val navigator = LocalNavigator.currentOrThrow
        val session = recallSession()
        val model = rememberScreenModel { ReaderModel(session) }
        ReaderScreen(
            model = model,
            onBack = {
                session.closeReader()
                navigator.pop()
            },
            onOpenSettings = { navigator.push(SettingsRoute) },
        )
        // 系统返回键与顶栏返回走同一条路，否则进度不落盘。
        BackHandler {
            session.closeReader()
            navigator.pop()
        }
    }
}

private object ComicRoute : Screen {

    @Composable
    override fun Content() {
        val navigator = LocalNavigator.currentOrThrow
        val session = recallSession()
        val model = rememberScreenModel { ComicModel(session) }
        ComicReaderScreen(
            model = model,
            onBack = {
                session.closeComic()
                navigator.pop()
            },
            onOpenSettings = { navigator.push(SettingsRoute) },
        )
        BackHandler {
            session.closeComic()
            navigator.pop()
        }
    }
}

private object EpubRoute : Screen {

    @Composable
    override fun Content() {
        val navigator = LocalNavigator.currentOrThrow
        val session = recallSession()
        val model = rememberScreenModel { EpubModel(session) }
        EpubReaderScreen(
            model = model,
            onBack = {
                session.closeEpub()
                navigator.pop()
            },
        )
        // EPUB 的正文在 WebView 里，返回键先收页面，位置由宿主 Fragment 写盘。
        BackHandler {
            session.closeEpub()
            navigator.pop()
        }
    }
}

private object SettingsRoute : Screen {
    @Composable
    override fun Content() {
        val navigator = LocalNavigator.currentOrThrow
        val session = recallSession()
        val model = rememberScreenModel { SettingsModel(session) }
        SettingsScreen(
            model = model,
            onBack = { navigator.pop() },
            onOpenSyncStatus = { navigator.push(SyncRoute) },
            onOpenFontStore = { navigator.push(FontStoreRoute) },
            onOpenNotices = { navigator.push(NoticeRoute) },
        )
    }
}

private object NoticeRoute : Screen {
    @Composable
    override fun Content() {
        val navigator = LocalNavigator.currentOrThrow
        NoticeScreen(session = recallSession(), onBack = { navigator.pop() })
    }
}

private object SyncRoute : Screen {

    @Composable
    override fun Content() {
        val navigator = LocalNavigator.currentOrThrow
        val session = recallSession()
        val model = rememberScreenModel { SyncModel(session) }
        SyncStatusScreen(
            model = model,
            onBack = { navigator.pop() },
        )
    }
}

private object FontStoreRoute : Screen {

    @Composable
    override fun Content() {
        val navigator = LocalNavigator.currentOrThrow
        val session = recallSession()
        val model = rememberScreenModel { FontsModel(session) }
        FontStoreScreen(
            model = model,
            onBack = { navigator.pop() },
        )
    }
}
