package com.folio.reader.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
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
import com.folio.reader.ui.miuix.GroupLabel
import com.folio.reader.ui.miuix.Hairline
import com.folio.reader.ui.miuix.pressScale
import top.yukonga.miuix.kmp.basic.Icon
import top.yukonga.miuix.kmp.basic.TextButton
import top.yukonga.miuix.kmp.theme.MiuixTheme

/**
 * 字体商店。
 *
 * 两段式：上面是「已安装」（可切换、可移除），下面是目录（同一份 catalog.json，
 * 与桌面端共用 id）。下载进度来自 `FontStoreUiState`，由 ViewModel 里 200ms 节流的
 * 回调推送，UI 只管画。
 */
@Composable
fun FontStoreScreen(vm: AppViewModel, onBack: () -> Unit) {
    val storeState by vm.fontStore.collectAsState()
    val settings by vm.settingsState.collectAsState()
    val scheme = MiuixTheme.colorScheme
    val context = LocalContext.current
    val store = remember { FontStore(context.filesDir) }
    // 已安装字体的 FontFamily 只算一次，别在每张卡片里读 installed.json
    val installedFamilies = remember(storeState.installed) {
        storeState.installed.associate { it.id to FontFamilies.familyOf(store.fileOf(it.id)) }
    }

    LaunchedEffect(Unit) {
        if (storeState.catalog.isEmpty() && storeState.installing.isBlank()) vm.loadFontStore()
    }

    Column(Modifier.fillMaxSize().background(scheme.background)) {
        FontStoreHeader(onBack = onBack)

        LazyColumn(Modifier.fillMaxSize()) {
            item {
                GroupLabel(text = "已安装 ${storeState.installed.size}")
                Hairline(inset = 16.dp)
                // 「系统字体」永远在第一位：选它等于清空商店字体
                SystemFontRow(
                    active = settings.userFontId.isBlank(),
                    systemLabel = if (settings.fontFamily == "sans") "黑体" else "宋体",
                    onClick = { vm.selectUserFont("") },
                )
            }

            if (storeState.installed.isEmpty()) {
                item {
                    Text(
                        text = "还没有装字体。下面挑一款下载，装好就能在正文里用。",
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                        fontSize = 12.sp,
                        color = scheme.onSurfaceVariantSummary,
                    )
                }
            }

            items(storeState.installed, key = { it.id }) { font ->
                InstalledFontRow(
                    font = font,
                    family = installedFamilies[font.id],
                    active = settings.userFontId == font.id,
                    onSelect = { vm.selectUserFont(font.id) },
                    onRemove = { vm.removeFont(font.id) },
                )
                Hairline(inset = 16.dp)
            }

            item {
                Spacer(Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "字体商店",
                        modifier = Modifier.weight(1f),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        color = scheme.onSurfaceVariantSummary,
                    )
                    TextButton(
                        text = if (storeState.loading) "刷新中…" else "刷新",
                        onClick = { if (!storeState.loading) vm.loadFontStore(force = true) },
                    )
                }
                if (storeState.error.isNotBlank()) {
                    Text(
                        text = storeState.error,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                        fontSize = 12.sp,
                        color = scheme.primary,
                    )
                }
            }

            if (storeState.catalog.isEmpty() && storeState.loading) {
                item {
                    Text(
                        text = "正在获取字体目录…",
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                        fontSize = 12.sp,
                        color = scheme.onSurfaceVariantSummary,
                    )
                }
            }

            items(storeState.catalog, key = { it.id }) { font ->
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
                Hairline(inset = 16.dp)
            }

            item {
                Text(
                    text = if (storeState.source == "cache") {
                        "当前显示的是本地缓存目录，联网后会更新。字体来自各上游开源项目（OFL-1.1），只装在手机本地。"
                    } else {
                        "字体来自各上游开源项目（OFL-1.1），只装在手机本地，不上传任何数据。"
                    },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
                    fontSize = 11.sp,
                    lineHeight = 17.sp,
                    color = scheme.onSurfaceVariantSummary,
                )
            }
        }
    }
}

@Composable
private fun FontStoreHeader(onBack: () -> Unit) {
    val scheme = MiuixTheme.colorScheme
    Column(
        Modifier
            .fillMaxWidth()
            .background(scheme.background)
            .statusBarsPadding()
            .padding(horizontal = 8.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            val source = remember { MutableInteractionSource() }
            Box(
                Modifier
                    .pressScale(source, pressedScale = 0.92f)
                    .size(38.dp)
                    .clip(CircleShape)
                    .background(scheme.secondary)
                    .clickable(interactionSource = source, indication = null, onClick = onBack),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "返回",
                    modifier = Modifier.size(18.dp),
                    tint = scheme.onSurface,
                )
            }
        }
        Text(
            text = "字体",
            modifier = Modifier.padding(start = 8.dp, top = 14.dp),
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-0.6).sp,
            color = scheme.onSurface,
        )
        Text(
            text = "与桌面端同一份目录 · 装好即用",
            modifier = Modifier.padding(start = 8.dp, top = 5.dp, bottom = 10.dp),
            fontSize = 11.sp,
            fontFamily = FontFamily.Monospace,
            letterSpacing = 0.3.sp,
            color = scheme.onSurfaceVariantSummary,
        )
    }
}

@Composable
private fun SystemFontRow(active: Boolean, systemLabel: String, onClick: () -> Unit) {
    val scheme = MiuixTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(text = "系统字体", fontSize = 16.sp, color = scheme.onSurface)
            Text(
                text = "跟随设置里的「$systemLabel」",
                fontSize = 11.5.sp,
                color = scheme.onSurfaceVariantSummary,
            )
        }
        if (active) {
            Text(text = "使用中", fontSize = 12.sp, color = scheme.primary)
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
    val scheme = MiuixTheme.colorScheme
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onSelect)
            .padding(start = 16.dp, end = 8.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = font.name,
                fontSize = 16.sp,
                color = scheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "${font.name} 0123 · ${formatSize(font.size)}",
                fontSize = 17.sp,
                fontFamily = family ?: FontFamily.Serif,
                color = scheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (active) {
            Text(
                text = "使用中",
                modifier = Modifier.padding(horizontal = 6.dp),
                fontSize = 12.sp,
                color = scheme.primary,
            )
        }
        TextButton(text = "移除", onClick = onRemove)
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
    val scheme = MiuixTheme.colorScheme
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = font.name,
                    fontSize = 16.sp,
                    color = scheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "${font.family} · ${font.file.format.uppercase()} · ${formatSize(font.file.size)}",
                    fontSize = 11.sp,
                    color = scheme.onSurfaceVariantSummary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            when {
                installing -> Text(text = progressLabel(received, total), fontSize = 12.sp, color = scheme.primary)
                installed != null -> TextButton(text = "移除", onClick = onRemove)
                else -> TextButton(text = "安装", onClick = onInstall)
            }
        }

        if (font.description.isNotBlank()) {
            Spacer(Modifier.height(6.dp))
            Text(
                text = font.description,
                fontSize = 12.sp,
                lineHeight = 18.sp,
                color = scheme.onSurfaceVariantSummary,
            )
        }

        if (font.preview.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(
                text = font.preview,
                fontSize = 17.sp,
                lineHeight = 26.sp,
                // 没装时先用正常字体占位，装完立刻换成真字形
                fontFamily = family ?: FontFamily.Default,
                color = scheme.onSurface,
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
                    Text(
                        text = "已安装",
                        fontSize = 12.sp,
                        color = scheme.primary,
                    )
                    Spacer(Modifier.width(12.dp))
                    TextButton(
                        text = "使用",
                        onClick = onSelect,
                    )
                    Spacer(Modifier.weight(1f))
                    if (font.license.spdx.isNotBlank()) {
                        Text(
                            text = font.license.spdx,
                            fontSize = 10.5.sp,
                            color = scheme.onSurfaceVariantSummary,
                        )
                    }
                }
            }
            else -> {
                if (font.license.spdx.isNotBlank()) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = "许可：${font.license.name.ifBlank { font.license.spdx }}",
                        fontSize = 10.5.sp,
                        color = scheme.onSurfaceVariantSummary,
                    )
                }
            }
        }
    }
}

@Composable
private fun DownloadBar(received: Long, total: Long) {
    val scheme = MiuixTheme.colorScheme
    val fraction = if (total > 0L) (received.toFloat() / total).coerceIn(0f, 1f) else 0f
    Box(
        Modifier
            .fillMaxWidth()
            .height(3.dp)
            .clip(CircleShape)
            .background(scheme.secondary),
    ) {
        Box(
            Modifier
                .fillMaxWidth(fraction)
                .height(3.dp)
                .clip(CircleShape)
                .background(scheme.primary),
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
    bytes >= 1024L -> "${bytes / 1024} KB"
    else -> "$bytes B"
}
