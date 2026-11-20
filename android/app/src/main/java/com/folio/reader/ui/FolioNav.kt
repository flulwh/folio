package com.folio.reader.ui

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
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

/** 路由名只用来判断「现在是不是在阅读页」（音量键翻页）。 */
const val ROUTE_SHELF = "shelf"
const val ROUTE_READER = "reader"
const val ROUTE_COMIC = "comic"
const val ROUTE_EPUB = "epub"
const val ROUTE_SETTINGS = "settings"
const val ROUTE_SYNC = "sync"
const val ROUTE_FONT_STORE = "fonts"

/** 六页的导航栈；页面之间用系统默认的横向滑入滑出。 */
@Composable
fun FolioNav(session: SessionStore) {
    Navigator(ShelfRoute) { navigator ->
        LaunchedEffect(navigator.lastItem) {
            session.reportRoute(navigator.lastItem.routeName)
        }
        SlideTransition(navigator) { screen -> screen.Content() }
    }
}

private val Screen.routeName: String
    get() = when (this) {
        ShelfRoute -> ROUTE_SHELF
        ReaderRoute -> ROUTE_READER
        ComicRoute -> ROUTE_COMIC
        EpubRoute -> ROUTE_EPUB
        SettingsRoute -> ROUTE_SETTINGS
        SyncRoute -> ROUTE_SYNC
        FontStoreRoute -> ROUTE_FONT_STORE
        else -> ""
    }

@Composable
private fun recallSession(): SessionStore =
    (LocalContext.current.applicationContext as FolioApp).session

private object ShelfRoute : Screen {

    @Composable
    override fun Content() {
        val navigator = LocalNavigator.currentOrThrow
        val session = recallSession()
        val model = rememberScreenModel { ShelfModel(session) }
        ShelfScreen(
            model = model,
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

                    else -> {
                        session.openBook(book)
                        navigator.push(ReaderRoute)
                    }
                }
            },
            onOpenSettings = { navigator.push(SettingsRoute) },
            onOpenSyncStatus = { navigator.push(SyncRoute) },
        )
    }
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
        )
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
