package com.folio.reader.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

private val AccentPresets = listOf(
    0xFF1F6FEB.toInt(),
    0xFF2E7D32.toInt(),
    0xFFB3261E.toInt(),
    0xFF6A3FBF.toInt(),
    0xFFB26A00.toInt(),
    0xFF00696E.toInt(),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
) {
    val state by vm.settingsState.collectAsState()
    val shelf by vm.shelf.collectAsState()
    var searching by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                title = { Text("设置") },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
        ) {
            SectionTitle("桌面端连接")
            OutlinedTextField(
                value = state.serverUrl,
                onValueChange = vm::updateServerUrl,
                label = { Text("地址") },
                placeholder = { Text("http://192.168.1.20:57321") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = state.token,
                onValueChange = vm::updateToken,
                label = { Text("访问码") },
                placeholder = { Text("桌面端「设置 → 网络」里的访问码") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(
                    onClick = { vm.testConnection() },
                    enabled = !searching,
                ) { Text("测试连接") }
                TextButton(
                    onClick = {
                        searching = true
                        vm.discover { searching = false }
                    },
                    enabled = !searching,
                ) { Text(if (searching) "搜索中…" else "搜索桌面端") }
            }
            if (state.discovered.isNotEmpty()) {
                state.discovered.forEach { url ->
                    Text(
                        text = url,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { vm.updateServerUrl(url) }
                            .padding(vertical = 8.dp),
                    )
                }
            }
            Text(
                text = "桌面端要开着「局域网面板」。地址里的端口在桌面端「设置 → 网络」里。",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            SectionTitle("排版")
            SettingSlider(
                label = "字号",
                value = state.fontScale,
                range = 0.85f..1.6f,
                display = "${(state.fontScale * 100).toInt()}%",
                onChange = vm::updateFontScale,
            )
            SettingSlider(
                label = "行距",
                value = state.lineHeight,
                range = 1.3f..2.4f,
                display = String.format("%.1f", state.lineHeight),
                onChange = vm::updateLineHeight,
            )
            SettingSlider(
                label = "页边距",
                value = state.pagePadding.toFloat(),
                range = 12f..56f,
                display = "${state.pagePadding}dp",
                onChange = { vm.updatePagePadding(it.toInt()) },
            )

            SectionTitle("外观")
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                AccentPresets.forEach { color ->
                    val selected = state.accent.toInt() == color
                    Box(
                        modifier = Modifier
                            .size(34.dp)
                            .background(Color(color), CircleShape)
                            .clickable { vm.updateAccent(color) },
                        contentAlignment = Alignment.Center,
                    ) {
                        if (selected) {
                            Box(
                                modifier = Modifier
                                    .size(14.dp)
                                    .background(Color.White, CircleShape),
                            )
                        }
                    }
                }
            }

            SectionTitle("离线与同步")
            ToggleRow(
                label = "自动同步",
                hint = "后台定期把进度同步回桌面端",
                checked = state.autoSync,
                onChange = vm::updateAutoSync,
            )
            ToggleRow(
                label = "自动缓存正文",
                hint = "打开本地书时顺手下到手机，断网也能读",
                checked = state.autoCache,
                onChange = vm::updateAutoCache,
            )
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "离线缓存",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = formatSize(state.cacheSize),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.width(8.dp))
                TextButton(onClick = { vm.clearCache() }) { Text("清空") }
            }

            if (shelf.message != null) {
                Text(
                    text = shelf.message.orEmpty(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }

            Spacer(Modifier.height(40.dp))
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Spacer(Modifier.height(24.dp))
    Text(
        text = text,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.primary,
    )
    Spacer(Modifier.height(10.dp))
}

@Composable
private fun SettingSlider(
    label: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    display: String,
    onChange: (Float) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(text = label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Text(
                text = display,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Slider(
            value = value.coerceIn(range.start, range.endInclusive),
            onValueChange = onChange,
            valueRange = range,
        )
    }
}

@Composable
private fun ToggleRow(
    label: String,
    hint: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(text = label, style = MaterialTheme.typography.bodyMedium)
            Text(
                text = hint,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

private fun formatSize(bytes: Long): String {
    if (bytes <= 0L) return "0 KB"
    val kb = bytes / 1024.0
    if (kb < 1024) return String.format("%.0f KB", kb)
    return String.format("%.1f MB", kb / 1024.0)
}
