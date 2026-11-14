package com.folio.reader

import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.folio.reader.ui.AppViewModel
import com.folio.reader.ui.ComicReaderScreen
import com.folio.reader.ui.DeviceConfirmDialog
import com.folio.reader.ui.FolioTheme
import com.folio.reader.ui.ReaderScreen
import com.folio.reader.ui.SettingsScreen
import com.folio.reader.ui.ShelfScreen
import com.folio.reader.ui.SyncStatusScreen

/** 路由名常量：改成字面量拼接容易打错，集中放一处。 */
private const val ROUTE_SHELF = "shelf"
private const val ROUTE_NOVEL = "reader"
private const val ROUTE_COMIC = "comic"
private const val ROUTE_SETTINGS = "settings"
private const val ROUTE_SYNC = "sync"

class MainActivity : ComponentActivity() {

    private val vm: AppViewModel by viewModels()

    /** 当前路由：音量键只在小说阅读页里翻页，设置页照常调音量。 */
    private var route: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val settings by vm.settingsState.collectAsState()
            val deleteConfirm by vm.deleteConfirm.collectAsState()
            FolioTheme(preset = settings.themePreset) {
                val navController = rememberNavController()
                DisposableEffect(navController) {
                    val listener = androidx.navigation.NavController.OnDestinationChangedListener { _, destination, _ ->
                        route = destination.route
                    }
                    navController.addOnDestinationChangedListener(listener)
                    onDispose { navController.removeOnDestinationChangedListener(listener) }
                }
                Box(Modifier.fillMaxSize()) {
                    NavHost(navController = navController, startDestination = ROUTE_SHELF) {
                        composable(ROUTE_SHELF) {
                            ShelfScreen(
                                vm = vm,
                                onOpenBook = { book ->
                                    vm.openBook(book)
                                    // 书的 id 里带书名和书源地址（含 :// 和 /），
                                    // 塞进路由会被路径切碎，这里只用无参路由，
                                    // 当前书由 ViewModel 持有。
                                    navController.navigate(
                                        if (book.isComic) ROUTE_COMIC else ROUTE_NOVEL,
                                    )
                                },
                                onOpenSettings = { navController.navigate(ROUTE_SETTINGS) },
                                onOpenSyncStatus = { navController.navigate(ROUTE_SYNC) },
                            )
                        }
                        composable(ROUTE_NOVEL) {
                            ReaderScreen(
                                vm = vm,
                                onBack = {
                                    vm.closeReader()
                                    navController.popBackStack()
                                },
                                onOpenSettings = { navController.navigate(ROUTE_SETTINGS) },
                            )
                            // 系统的返回键跟顶栏返回走同一条路，否则进度不落盘。
                            BackHandler {
                                vm.closeReader()
                                navController.popBackStack()
                            }
                        }
                        composable(ROUTE_COMIC) {
                            ComicReaderScreen(
                                vm = vm,
                                onBack = {
                                    vm.closeComic()
                                    navController.popBackStack()
                                },
                                onOpenSettings = { navController.navigate(ROUTE_SETTINGS) },
                            )
                            BackHandler {
                                vm.closeComic()
                                navController.popBackStack()
                            }
                        }
                        composable(ROUTE_SETTINGS) {
                            SettingsScreen(
                                vm = vm,
                                onBack = { navController.popBackStack() },
                                onOpenSyncStatus = { navController.navigate(ROUTE_SYNC) },
                            )
                        }
                        composable(ROUTE_SYNC) {
                            SyncStatusScreen(
                                vm = vm,
                                onBack = { navController.popBackStack() },
                            )
                        }
                    }
                    // 挂在 NavHost 之上：阅读器里也能弹出来，不会被页面盖住
                    DeviceConfirmDialog(
                        state = deleteConfirm,
                        onAnswer = vm::answerDeleteConfirm,
                    )
                }
            }
        }
    }

    /**
     * 音量键翻页：只在小说阅读页消费，其他页面保持系统音量行为。
     * 开关在排版面板「06 翻页」里，关掉后这里直接放行。
     */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (route == ROUTE_NOVEL && vm.onVolumeKey(keyCode)) return true
        return super.onKeyDown(keyCode, event)
    }

    override fun onStart() {
        super.onStart()
        // 回前台做一次健康检查：连得上就顺手同步（3.0 没有后台任务）。
        vm.onForeground()
        // T09：前台才开 SSE，App 一退到后台连接就断（离线态不是假象）
        vm.startDeviceChannel()
    }

    override fun onStop() {
        super.onStop()
        // 退到后台立刻断开在线通道，并把进度写盘，不等防抖计时器。
        vm.stopDeviceChannel()
        vm.flush()
    }
}
