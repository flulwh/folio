package com.folio.reader

import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.fragment.app.FragmentActivity
import com.folio.reader.ui.DeviceConfirmDialog
import com.folio.reader.ui.FolioNav
import com.folio.reader.ui.FolioTheme
import com.folio.reader.ui.ROUTE_READER
import com.folio.reader.ui.readingPalette
import com.folio.reader.ui.session.SessionStore

/**
 * 唯一的 Activity：Compose + Voyager 导航。
 *
 * 继承 FragmentActivity 是为了给 EPUB 的 Readium presenter 提供 Fragment 宿主；
 * 会话状态在 `FolioApp.session`（应用作用域），页面出栈不会丢。
 */
class MainActivity : FragmentActivity() {

    private val session: SessionStore by lazy { (application as FolioApp).session }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            // lifecycle-aware：页面进后台就停止收集，不在不可见时白白重组 / 耗电。
            val settings by session.settingsState.collectAsStateWithLifecycle()
            val deleteConfirm by session.deleteConfirm.collectAsStateWithLifecycle()
            // 状态栏 / 导航栏图标跟着纸色走：夜间底上用浅色图标，纸白底上用深色图标。
            // 只靠 enableEdgeToEdge() 会跟随系统深色模式，和 App 内的底色不是一回事。
            val view = LocalView.current
            val dark = readingPalette(settings.themePreset).isDark
            SideEffect {
                val window = (view.context as android.app.Activity).window
                WindowCompat.getInsetsController(window, view).apply {
                    isAppearanceLightStatusBars = !dark
                    isAppearanceLightNavigationBars = !dark
                }
            }
            FolioTheme(preset = settings.themePreset) {
                Box(Modifier.fillMaxSize()) {
                    FolioNav(session)
                    // 挂在导航之上：阅读器里也能弹出来，不会被页面盖住
                    DeviceConfirmDialog(
                        state = deleteConfirm,
                        onAnswer = session::answerDeleteConfirm,
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
        if (session.route.value == ROUTE_READER && session.onVolumeKey(keyCode)) return true
        return super.onKeyDown(keyCode, event)
    }

    override fun onStart() {
        super.onStart()
        // 回前台做一次健康检查：连得上就顺手同步（3.0 没有后台任务）。
        session.onForeground()
        // T09：前台才开 SSE，App 一退到后台连接就断（离线态不是假象）
        session.startDeviceChannel()
    }

    override fun onStop() {
        super.onStop()
        // 退到后台立刻断开在线通道，并把进度写盘，不等防抖计时器。
        session.stopDeviceChannel()
        session.flush()
    }
}
