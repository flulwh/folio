package com.folio.reader.ui

import com.folio.reader.ui.model.FontsModel

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.folio.reader.data.CatalogFont
import com.folio.reader.data.FontStore
import com.folio.reader.data.InstalledFont
import io.github.alexzhirkevich.cupertino.CupertinoButton
import io.github.alexzhirkevich.cupertino.CupertinoButtonDefaults
import io.github.alexzhirkevich.cupertino.CupertinoHorizontalDivider
import io.github.alexzhirkevich.cupertino.CupertinoIcon
import io.github.alexzhirkevich.cupertino.CupertinoNavigationTitle
import io.github.alexzhirkevich.cupertino.CupertinoScaffold
import io.github.alexzhirkevich.cupertino.CupertinoText
import io.github.alexzhirkevich.cupertino.CupertinoTopAppBar
import io.github.alexzhirkevich.cupertino.ExperimentalCupertinoApi
import io.github.alexzhirkevich.cupertino.icons.CupertinoIcons
import io.github.alexzhirkevich.cupertino.icons.outlined.ChevronBackward
import io.github.alexzhirkevich.cupertino.theme.CupertinoTheme

/**
 * 字体商店。
 *
 * iOS 设置页排版：大标题下面两张分组卡片——「已安装」「字体商店」。
 * 上面那张可切换、可移除；下面那张是目录（同一份 catalog.json，与桌面端共用 id）。
 * 下载进度来自 `FontStoreUiState`，由 ViewModel 里 200ms 节流的回调推送，UI 只管画。
 */
@Composable
fun FontStoreScreen(model: FontsModel, onBack: () -> Unit) {
    val vm = model.session
    val storeState by vm.fontStore.collectAsStateWithLifecycle()
    val settings by vm.settingsState.collectAsStateWithLifecycle()
    val scheme = CupertinoTheme.colorScheme
    val context = LocalContext.current
    val store = remember { FontStore(context.filesDir) }
    // 已安装字体的 FontFamily 只算一次，别在每张卡片里读 installed.json
    val installedFamilies = remember(storeState.installed) {
        storeState.installed.associate { it.id to FontFamilies.familyOf(store.fileOf(it.id)) }
    }

    LaunchedEffect(Unit) {
        if (storeState.catalog.isEmpty() && storeState.installing.isBlank()) vm.loadFontStore()
    }

    CupertinoScaffold(
        modifier = Modifier.fillMaxSize(),
        topBar = { FontStoreTopBar(onBack = onBack) },
        containerColor = scheme.systemGroupedBackground,
        appBarsBlurAlpha = FolioAppBarAlpha,
        appBarsBlurRadius = FolioAppBarBlurRadius,
        hasNavigationTitle = true,
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(
                    top = padding.calculateTopPadding(),
                    bottom = padding.calculateBottomPadding() + 24.dp,
                ),
        ) {
            CupertinoNavigationTitle {
                CupertinoText(text = "字体")
            }

            CupertinoText(
                text = "与桌面端同一份目录 · 装好即用",
                modifier = Modifier.fillMaxWidth().padding(horizontal = PageMargin, vertical = 10.dp),
                fontSize = 13.sp,
                color = scheme.secondaryLabel,
            )
            IosGroup(title = "已安装") {
                // 「系统字体」永远在第一位：选它等于清空商店字体
                SystemFontRow(
                    active = settings.userFontId.isBlank(),
                    systemLabel = if (settings.fontFamily == "sans") "黑体" else "宋体",
                    onClick = { vm.selectUserFont("") },
                )

                if (storeState.installed.isEmpty()) {
                    CardDivider()
                    CupertinoText(
                        text = "还没有装字体。下面挑一款下载，装好就能在正文里用。",
                        modifier = Modifier.fillMaxWidth().padding(horizontal = RowInset, vertical = 12.dp),
                        fontSize = 13.sp,
                        color = scheme.secondaryLabel,
                    )
                }

                // 已安装和目录里会出现同一款字体，靠渲染位置区分即可
                storeState.installed.forEach { font ->
                    CardDivider()
                    InstalledFontRow(
                        font = font,
                        family = installedFamilies[font.id],
                        active = settings.userFontId == font.id,
                        onSelect = { vm.selectUserFont(font.id) },
                        onRemove = { vm.removeFont(font.id) },
                    )
                }
            }

            IosGroup(
                title = "字体商店",
                action = {
                    PlainAction(
                        text = if (storeState.loading) "刷新中…" else "刷新",
                        onClick = { if (!storeState.loading) vm.loadFontStore(force = true) },
                    )
                },
            ) {
                if (storeState.error.isNotBlank()) {
                    CupertinoText(
                        text = storeState.error,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = RowInset, vertical = 12.dp),
                        fontSize = 13.sp,
                        color = BrandNegative,
                    )
                }

                if (storeState.catalog.isEmpty() && storeState.loading) {
                    CupertinoText(
                        text = "正在获取字体目录…",
                        modifier = Modifier.fillMaxWidth().padding(horizontal = RowInset, vertical = 14.dp),
                        fontSize = 15.sp,
                        color = scheme.secondaryLabel,
                    )
                }

                storeState.catalog.forEachIndexed { index, font ->
                    if (index > 0) CardDivider()
                    val installed = storeState.installed.firstOrNull { it.id == font.id }
                    CatalogFontRow(
                        font = font,
                        installed = installed,
                        family = installedFamilies[font.id],
                        installing = storeState.installing == font.id,
                        received = storeState.bytesReceived,
                        total = storeState.bytesTotal,
                        onInstall = { vm.installFont(font.id) },
                        onSelect = { vm.selectUserFont(font.id) },
                        onRemove = { vm.removeFont(font.id) },
                    )
                }
            }

            CupertinoText(
                text = when (storeState.source) {
                    "cache" -> "当前显示的是本地缓存目录，联网后会更新。字体来自各上游开源项目（OFL-1.1），只装在手机本地。"
                    "bundled" -> "当前显示的是安装包自带的目录，联网后「刷新」会更新。字体来自各上游开源项目（OFL-1.1），只装在手机本地。"
                    else -> "字体来自各上游开源项目（OFL-1.1），只装在手机本地，不上传任何数据。"
                },
                modifier = Modifier.fillMaxWidth().padding(horizontal = PageMargin + 4.dp, vertical = 16.dp),
                fontSize = 12.sp,
                lineHeight = 18.sp,
                color = scheme.secondaryLabel,
            )
        }
    }
}

@OptIn(ExperimentalCupertinoApi::class)
@Composable
private fun FontStoreTopBar(onBack: () -> Unit) {
    val scheme = CupertinoTheme.colorScheme
    CupertinoTopAppBar(
        title = { CupertinoText(text = "字体", maxLines = 1) },
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
    )
}

/** iOS inset grouped 卡片，带可选的分组标题与右侧动作。 */
@Composable
private fun IosGroup(
    title: String? = null,
    action: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val scheme = CupertinoTheme.colorScheme
    Column(Modifier.fillMaxWidth().padding(horizontal = PageMargin)) {
        if (title != null) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 4.dp, top = 22.dp, bottom = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CupertinoText(
                    text = title,
                    modifier = Modifier.weight(1f),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    color = scheme.secondaryLabel,
                )
                action?.invoke()
            }
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(GroupRadius))
                .background(scheme.secondarySystemGroupedBackground),
            content = content,
        )
    }
}

@Composable
private fun CardDivider() {
    CupertinoHorizontalDivider(
        modifier = Modifier.fillMaxWidth().padding(start = RowInset),
        color = CupertinoTheme.colorScheme.separator,
    )
}

@Composable
private fun SystemFontRow(active: Boolean, systemLabel: String, onClick: () -> Unit) {
    val scheme = CupertinoTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = RowInset, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            CupertinoText(text = "系统字体", fontSize = 17.sp, color = scheme.label)
            CupertinoText(
                text = "跟随设置里的「$systemLabel」",
                fontSize = 13.sp,
                color = scheme.secondaryLabel,
            )
        }
        if (active) {
            CupertinoText(text = "使用中", fontSize = 15.sp, color = scheme.accent)
        }
    }
}

@Composable
private fun InstalledFontRow(
    font: InstalledFont,
    family: FontFamily?,
    active: Boolean,
    onSelect: () -> Unit,
    onRemove: () -> Unit,
) {
    val scheme = CupertinoTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onSelect)
            .padding(start = RowInset, end = 8.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            CupertinoText(
                text = font.name,
                fontSize = 17.sp,
                color = scheme.label,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(3.dp))
            CupertinoText(
                text = "${font.name} 0123 · ${formatSize(font.size)}",
                fontSize = 17.sp,
                fontFamily = family ?: FontFamily.Serif,
                color = scheme.secondaryLabel,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (active) {
            CupertinoText(
                text = "使用中",
                modifier = Modifier.padding(horizontal = 6.dp),
                fontSize = 15.sp,
                color = scheme.accent,
            )
        }
        PlainAction(text = "移除", onClick = onRemove)
    }
}

@Composable
private fun CatalogFontRow(
    font: CatalogFont,
    installed: InstalledFont?,
    family: FontFamily?,
    installing: Boolean,
    received: Long,
    total: Long,
    onInstall: () -> Unit,
    onSelect: () -> Unit,
    onRemove: () -> Unit,
) {
    val scheme = CupertinoTheme.colorScheme
    Column(Modifier.fillMaxWidth().padding(horizontal = RowInset, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                CupertinoText(
                    text = font.name,
                    fontSize = 17.sp,
                    color = scheme.label,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                CupertinoText(
                    text = "${font.family} · ${font.file.format.uppercase()} · ${formatSize(font.file.size)}",
                    fontSize = 13.sp,
                    color = scheme.secondaryLabel,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            when {
                installing -> CupertinoText(
                    text = progressLabel(received, total),
                    fontSize = 15.sp,
                    color = scheme.accent,
                )
                installed != null -> PlainAction(text = "移除", onClick = onRemove)
                else -> PlainAction(text = "安装", onClick = onInstall)
            }
        }

        if (font.description.isNotBlank()) {
            Spacer(Modifier.height(6.dp))
            CupertinoText(
                text = font.description,
                fontSize = 13.sp,
                lineHeight = 18.sp,
                color = scheme.secondaryLabel,
            )
        }

        if (font.preview.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            CupertinoText(
                text = font.preview,
                fontSize = 17.sp,
                lineHeight = 26.sp,
                // 没装时先用正常字体占位，装完立刻换成真字形
                fontFamily = family ?: FontFamily.Default,
                color = scheme.label,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }

        when {
            installing -> {
                Spacer(Modifier.height(8.dp))
                DownloadBar(received = received, total = total)
            }
            installed != null -> {
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CupertinoText(
                        text = "已安装",
                        fontSize = 13.sp,
                        color = scheme.accent,
                    )
                    Spacer(Modifier.width(8.dp))
                    PlainAction(text = "使用", onClick = onSelect)
                    Spacer(Modifier.weight(1f))
                    if (font.license.spdx.isNotBlank()) {
                        CupertinoText(
                            text = font.license.spdx,
                            fontSize = 12.sp,
                            color = scheme.secondaryLabel,
                        )
                    }
                }
            }
            else -> {
                if (font.license.spdx.isNotBlank()) {
                    Spacer(Modifier.height(6.dp))
                    CupertinoText(
                        text = "许可：${font.license.name.ifBlank { font.license.spdx }}",
                        fontSize = 12.sp,
                        color = scheme.secondaryLabel,
                    )
                }
            }
        }
    }
}

/** 小号文字按钮：Cupertino 纯净按钮，不占一整行。 */
@Composable
private fun PlainAction(text: String, onClick: () -> Unit) {
    CupertinoButton(
        onClick = onClick,
        colors = CupertinoButtonDefaults.plainButtonColors(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 4.dp),
    ) {
        CupertinoText(text = text, fontSize = 15.sp)
    }
}

@Composable
private fun DownloadBar(received: Long, total: Long) {
    val scheme = CupertinoTheme.colorScheme
    val fraction = if (total > 0L) (received.toFloat() / total).coerceIn(0f, 1f) else 0f
    Box(
        Modifier
            .fillMaxWidth()
            .height(3.dp)
            .clip(CircleShape)
            .background(scheme.secondarySystemFill),
    ) {
        Box(
            Modifier
                .fillMaxWidth(fraction)
                .height(3.dp)
                .clip(CircleShape)
                .background(scheme.accent),
        )
    }
}

private fun progressLabel(received: Long, total: Long): String {
    if (total <= 0L) return "下载中…"
    val pct = (received * 100 / total).coerceIn(0L, 100L)
    return "$pct%"
}

private fun formatSize(bytes: Long): String = when {
    bytes >= 1048576L -> String.format("%.1f MB", bytes / 1048576.0)
    bytes < 1024L -> "$bytes B"
    else -> "${bytes / 1024} KB"
}
