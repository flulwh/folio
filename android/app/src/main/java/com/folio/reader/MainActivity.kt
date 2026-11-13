package com.folio.reader

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.folio.reader.ui.AppViewModel
import com.folio.reader.ui.FolioTheme
import com.folio.reader.ui.ReaderScreen
import com.folio.reader.ui.SettingsScreen
import com.folio.reader.ui.ShelfScreen

class MainActivity : ComponentActivity() {

    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val settings by vm.settingsState.collectAsState()
            FolioTheme(
                accent = settings.accent,
                paper = settings.paper,
                ink = settings.ink,
            ) {
                val navController = rememberNavController()
                NavHost(navController = navController, startDestination = "shelf") {
                    composable("shelf") {
                        ShelfScreen(
                            vm = vm,
                            onOpenBook = { book ->
                                vm.openBook(book)
                                // 书的 id 里带书名和书源地址（含 :// 和 /），
                                // 塞进路由会被路径切碎，这里只用无参路由，
                                // 当前书由 ViewModel 持有。
                                navController.navigate("reader")
                            },
                            onOpenSettings = { navController.navigate("settings") },
                        )
                    }
                    composable("reader") {
                        ReaderScreen(
                            vm = vm,
                            onBack = {
                                vm.closeReader()
                                navController.popBackStack()
                            },
                        )
                    }
                    composable("settings") {
                        SettingsScreen(
                            vm = vm,
                            onBack = { navController.popBackStack() },
                        )
                    }
                }
            }
        }
    }

    override fun onStop() {
        super.onStop()
        // 退到后台立刻把进度写盘，不等防抖计时器。
        vm.flush()
    }
}
