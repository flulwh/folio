package com.folio.reader.ui.book

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.fragment.app.FragmentActivity
import androidx.fragment.app.FragmentContainerView
import androidx.fragment.app.commitNow
import com.folio.reader.R
import com.folio.reader.ui.model.EpubModel
import com.folio.reader.ui.readingPalette
import io.github.alexzhirkevich.cupertino.CupertinoActivityIndicator
import io.github.alexzhirkevich.cupertino.CupertinoButton
import io.github.alexzhirkevich.cupertino.CupertinoIcon
import io.github.alexzhirkevich.cupertino.CupertinoIconButton
import io.github.alexzhirkevich.cupertino.CupertinoText
import io.github.alexzhirkevich.cupertino.icons.CupertinoIcons
import io.github.alexzhirkevich.cupertino.icons.outlined.ChevronBackward

private const val EPUB_HOST_TAG = "epub-host"

/**
 * EPUB 阅读页。
 *
 * 正文由 Readium 的 WebView 渲染（`EpubHostFragment` 里），
 * Compose 只负责加载态、失败提示、返回按钮，以及把 Fragment 挂进容器。
 */
@Composable
fun EpubReaderScreen(model: EpubModel, onBack: () -> Unit) {
    val vm = model.session
    val state by vm.epub.collectAsState()
    val settings by vm.settingsState.collectAsState()
    val palette = readingPalette(settings.themePreset)
    val activity = LocalContext.current as? FragmentActivity

    Box(Modifier.fillMaxSize().background(palette.bg)) {
        val book = state.book
        when {
            state.error != null -> EpubError(
                message = state.error.orEmpty(),
                onRetry = { book?.let(vm::openEpub) },
                ink = palette.ink,
                soft = palette.soft,
            )

            book == null || state.loading || activity == null -> Box(
                Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                CupertinoActivityIndicator(size = 28.dp, color = palette.soft)
            }

            else -> {
                AndroidView(
                    factory = { ctx ->
                        FragmentContainerView(ctx).apply {
                            id = R.id.epub_container
                            // post：等视图挂到窗口上再提交事务，否则找不到容器 id
                            post { installHost(activity, book.id, palette.isDark) }
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                )
                DisposableEffect(book.id) {
                    onDispose { removeHost(activity) }
                }
            }
        }

        // 顶栏常驻：Readium 的 WebView 没有原生返回键，返回入口必须一直可见。
        // 形态是 iOS 紧凑导航栏：44dp 高、居中 17sp 标题、底部发丝线。
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(palette.bg.copy(alpha = 0.94f))
                .statusBarsPadding(),
        ) {
            Box(Modifier.fillMaxWidth().height(44.dp)) {
                val source = remember { MutableInteractionSource() }
                Box(
                    Modifier
                        .align(Alignment.CenterStart)
                        .size(44.dp)
                        .clickable(interactionSource = source, indication = null, onClick = onBack),
                    contentAlignment = Alignment.Center,
                ) {
                    CupertinoIcon(
                        imageVector = CupertinoIcons.Outlined.ChevronBackward,
                        contentDescription = "返回",
                        tint = palette.accent,
                    )
                }
                CupertinoText(
                    text = state.book?.title ?: "EPUB",
                    modifier = Modifier.align(Alignment.Center).padding(horizontal = 52.dp),
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = palette.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Box(Modifier.fillMaxWidth().height(0.5.dp).background(palette.line))
        }
    }
}

@Composable
private fun EpubError(
    message: String,
    onRetry: () -> Unit,
    ink: androidx.compose.ui.graphics.Color,
    soft: androidx.compose.ui.graphics.Color,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
    ) {
        CupertinoText(
            text = message,
            fontSize = 13.sp,
            color = soft,
        )
        Spacer(Modifier.height(16.dp))
        CupertinoButton(onClick = onRetry) {
            CupertinoText(text = "重试", fontSize = 14.sp, color = ink)
        }
    }
}

private fun installHost(activity: FragmentActivity, bookId: String, dark: Boolean) {
    val fm = activity.supportFragmentManager
    if (fm.isStateSaved || fm.findFragmentByTag(EPUB_HOST_TAG) != null) return
    runCatching {
        fm.commitNow {
            setReorderingAllowed(true)
            add(R.id.epub_container, EpubHostFragment.newInstance(bookId, dark), EPUB_HOST_TAG)
        }
    }
}

private fun removeHost(activity: FragmentActivity) {
    val fm = activity.supportFragmentManager
    val host = fm.findFragmentByTag(EPUB_HOST_TAG) ?: return
    runCatching { fm.beginTransaction().remove(host).commitNowAllowingStateLoss() }
}
