package com.folio.reader.ui

import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import com.folio.reader.data.CoverImage
import com.folio.reader.ui.model.ShelfModel

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import com.folio.reader.core.Book
import com.folio.reader.core.Origin
import com.folio.reader.data.ConnectionState
import io.github.alexzhirkevich.cupertino.CupertinoActivityIndicator
import io.github.alexzhirkevich.cupertino.CupertinoButton
import io.github.alexzhirkevich.cupertino.CupertinoButtonDefaults
import io.github.alexzhirkevich.cupertino.CupertinoDropdownMenu
import io.github.alexzhirkevich.cupertino.CupertinoHorizontalDivider
import io.github.alexzhirkevich.cupertino.CupertinoIcon
import io.github.alexzhirkevich.cupertino.CupertinoScaffold
import io.github.alexzhirkevich.cupertino.CupertinoSearchTextField
import io.github.alexzhirkevich.cupertino.CupertinoText
import io.github.alexzhirkevich.cupertino.CupertinoTopAppBar
import io.github.alexzhirkevich.cupertino.ExperimentalCupertinoApi
import io.github.alexzhirkevich.cupertino.icons.CupertinoIcons
import io.github.alexzhirkevich.cupertino.icons.outlined.ArrowClockwise
import io.github.alexzhirkevich.cupertino.icons.outlined.Book
import io.github.alexzhirkevich.cupertino.icons.outlined.ChevronForward
import io.github.alexzhirkevich.cupertino.icons.outlined.Gear
import io.github.alexzhirkevich.cupertino.icons.outlined.MagnifyingGlass
import io.github.alexzhirkevich.cupertino.icons.outlined.Plus
import io.github.alexzhirkevich.cupertino.icons.outlined.Xmark
import io.github.alexzhirkevich.cupertino.MenuAction
import io.github.alexzhirkevich.cupertino.theme.CupertinoTheme
import java.util.Locale
import kotlin.math.absoluteValue

/**
 * 书架。
 *
 * 结构只有三层：
 * 1. 顶栏：实色底、标题常显，右侧放搜索 / 导入 / 同步；
 * 2. 筛选：横向胶囊，选中给朱砂底，不做下划线那套「表格感」；
 * 3. 内容：最近在读的一本放大成一张「继续阅读」卡片，其余书按封面墙三列排开。
 *
 * 封面是书架的主角：占满整格、带投影与纸色占位；书名两行、进度一条细轨。
 * 长按封面（或点右上角 ⋯）出菜单，行为与旧列表版完全一致。
 */
@OptIn(ExperimentalFoundationApi::class, ExperimentalCupertinoApi::class)
@Composable
fun ShelfScreen(
    model: ShelfModel,
    onOpenBook: (Book) -> Unit,
    onOpenSettings: () -> Unit,
    onOpenSyncStatus: () -> Unit,
    bottomBar: @Composable () -> Unit = {},
) {
    val vm = model.session
    val state by vm.shelf.collectAsState()
    val gridState = rememberLazyGridState()
    val scheme = CupertinoTheme.colorScheme

    var searchOpen by remember { mutableStateOf(false) }
    var menuFor by remember { mutableStateOf<String?>(null) }
    var pendingDelete by remember { mutableStateOf<Book?>(null) }
    var pendingRemove by remember { mutableStateOf<Book?>(null) }
    var message by remember { mutableStateOf<String?>(null) }

    val importLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris -> vm.importDocuments(uris) }

    LaunchedEffect(state.message) {
        val text = state.message ?: return@LaunchedEffect
        message = text
        vm.dismissMessage()
    }

    // 分区要过滤 + 去重 + 排序（O(n log n)）。搜索框开关、长按菜单这些局部状态
    // 变化不该带动整份书架重算，按真正影响结果的输入做记忆。
    val sections = remember(
        state.books,
        state.progress,
        state.filter,
        state.query,
        state.hideRemoteWhenOffline,
        state.online,
    ) { state.sections }

    // 封面墙里翻到新导入的书：先按「头部区 + 分区标题 + 每本一格」换算成网格下标。
    // 头部区（统计 / 搜索 / 筛选 / 横幅）在网格里也各占一格，计数要和下面的 item 一一对应。
    val headerItems = 1 + 1 + 1 + 1 + if (state.importing) 1 else 0
    LaunchedEffect(state.highlightId, sections) {
        val id = state.highlightId ?: return@LaunchedEffect
        var index = headerItems + if (sections.any { it.key == "continue" }) 1 else 0
        var target = -1
        for (section in sections) {
            if (section.key == "continue") continue
            index += 1 // 分区标题占一格
            val offset = section.books.indexOfFirst { it.id == id }
            if (offset >= 0) {
                target = index + offset
                break
            }
            index += section.books.size
        }
        if (target >= 0) gridState.animateScrollToItem(target)
        vm.clearHighlight()
    }

    val importAction = { importLauncher.launch(IMPORT_MIME_TYPES) }

    CupertinoScaffold(
        modifier = Modifier.fillMaxSize(),
        topBar = {
            ShelfTopBar(
                state = state,
                searchOpen = searchOpen,
                onToggleSearch = { searchOpen = !searchOpen },
                onImport = importAction,
                onSync = { vm.syncNow() },
            )
        },
        bottomBar = bottomBar,
        containerColor = scheme.systemGroupedBackground,
        appBarsBlurAlpha = FolioAppBarAlpha,
        appBarsBlurRadius = FolioAppBarBlurRadius,
    ) { padding ->
        LazyVerticalGrid(
            columns = GridCells.Fixed(3),
            state = gridState,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = PageMargin,
                end = PageMargin,
                top = padding.calculateTopPadding(),
                bottom = padding.calculateBottomPadding() + 20.dp,
            ),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            item(key = "shelf-stats", span = { GridItemSpan(maxLineSpan) }) {
                ShelfStats(state = state, onOpenSyncStatus = onOpenSyncStatus)
            }

            item(key = "shelf-search", span = { GridItemSpan(maxLineSpan) }) {
                AnimatedVisibility(
                    visible = searchOpen,
                    enter = fadeIn(tween(FolioMotion.Normal)) + expandVertically(tween(FolioMotion.Normal)),
                    exit = fadeOut(tween(FolioMotion.Instant)) + shrinkVertically(tween(FolioMotion.Normal)),
                ) {
                    CupertinoSearchTextField(
                        value = state.query,
                        onValueChange = vm::setQuery,
                        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                        placeholder = {
                            CupertinoText(
                                text = "搜书名或作者",
                                fontSize = 16.sp,
                                color = scheme.placeholderText,
                            )
                        },
                    )
                }
            }

            item(key = "shelf-filter", span = { GridItemSpan(maxLineSpan) }) {
                FilterChips(selected = state.filter, onSelect = vm::setFilter)
            }

            item(key = "shelf-banner", span = { GridItemSpan(maxLineSpan) }) {
                AnimatedVisibility(
                    visible = state.showBanner,
                    enter = fadeIn(tween(FolioMotion.Normal)) + expandVertically(tween(FolioMotion.Normal)),
                    exit = fadeOut(tween(FolioMotion.Instant)) + shrinkVertically(tween(FolioMotion.Normal)),
                ) {
                    OfflineBanner(onConnect = onOpenSettings, onDismiss = vm::dismissBanner)
                }
            }

            if (state.importing) {
                item(key = "shelf-import", span = { GridItemSpan(maxLineSpan) }) {
                    ImportStrip(label = state.importLabel.ifBlank { "正在导入…" })
                }
            }

            if (sections.isEmpty()) {
                item(key = "shelf-empty", span = { GridItemSpan(maxLineSpan) }) {
                    // 固定高度而不是 heightIn：网格项的最大高度是无穷大，
                    // heightIn 会让 EmptyShelf 的 fillMaxSize 失效、内容贴顶。
                    Box(Modifier.fillMaxWidth().height(340.dp)) {
                        EmptyShelf(
                            hasBooks = state.books.isNotEmpty(),
                            onImport = importAction,
                            onConnect = onOpenSettings,
                        )
                    }
                }
            } else {
                sections.forEach { section ->
                    if (section.key == "continue") {
                        item(
                            key = "continue-hero",
                            span = { GridItemSpan(maxLineSpan) },
                        ) {
                            val featured = section.books.first()
                            ContinueCard(
                                book = featured,
                                state = state,
                                onOpen = { onOpenBook(featured) },
                            )
                        }
                    } else {
                        item(
                            key = "header-${section.key}",
                            span = { GridItemSpan(maxLineSpan) },
                        ) {
                            SectionLabel(
                                title = section.title.substringBefore("（"),
                                count = section.books.size,
                            )
                        }
                        itemsIndexed(
                            items = section.books,
                            key = { _, book -> "book-${section.key}-${book.id}" },
                        ) { index, book ->
                            val rowKey = "${section.key}-${book.id}"
                            Reveal(index = index) {
                                BookCell(
                                    book = book,
                                    // 只传单元格自己用得到的值：整份 ShelfUiState 是不稳定类型，
                                    // 传进来会让同步 / 进度变化时每个可见封面都跟着重组。
                                    badge = state.badgeOf(book),
                                    transferPercent = state.transferPercent(book),
                                    percent = state.progressPercentOf(book),
                                    summary = state.progressSummaryOf(book),
                                    readable = state.readable(book),
                                    highlighted = state.highlightId == book.id,
                                    menuOpen = menuFor == rowKey,
                                    onToggleMenu = {
                                        menuFor = if (menuFor == rowKey) null else rowKey
                                    },
                                    onOpen = {
                                        menuFor = null
                                        onOpenBook(book)
                                    },
                                    onDownload = {
                                        menuFor = null
                                        vm.downloadOffline(book)
                                    },
                                    onDeleteLocal = {
                                        menuFor = null
                                        pendingDelete = book
                                    },
                                    onRemoveFromShelf = {
                                        menuFor = null
                                        pendingRemove = book
                                    },
                                    onSyncStatus = {
                                        menuFor = null
                                        onOpenSyncStatus()
                                    },
                                )
                            }
                        }
                    }
                }
            }
        }

        message?.let { text ->
            Box(Modifier.fillMaxSize().padding(bottom = padding.calculateBottomPadding())) {
                Snack(text = text, onDismiss = { message = null })
            }
        }
    }

    pendingDelete?.let { book ->
        ConfirmSheet(
            title = "删除本机副本？",
            summary = "只会删掉手机上的《${book.title}》，桌面端那份不受影响。",
            confirmText = "删除",
            onCancel = { pendingDelete = null },
            onConfirm = {
                pendingDelete = null
                vm.deleteLocalCopy(book)
            },
        )
    }

    pendingRemove?.let { book ->
        ConfirmSheet(
            title = "从手机书架移除？",
            summary = "《${book.title}》会从手机书架消失，桌面端那份不受影响；下次同步会重新出现。",
            confirmText = "移除",
            onCancel = { pendingRemove = null },
            onConfirm = {
                pendingRemove = null
                vm.removeFromShelf(book)
            },
        )
    }
}

/* ---------------- 顶栏 ---------------- */

/**
 * 顶栏：实色底、标题常显，动作按钮用无底色 tinted 图标。
 *
 * 老版 iOS 没有折叠大标题，栏的高度与标题位置全程不变。
 */
@OptIn(ExperimentalCupertinoApi::class)
@Composable
private fun ShelfTopBar(
    state: ShelfUiState,
    searchOpen: Boolean,
    onToggleSearch: () -> Unit,
    onImport: () -> Unit,
    onSync: () -> Unit,
) {
    CupertinoTopAppBar(
        title = {
            CupertinoText(text = "书架", maxLines = 1)
        },
        colors = folioTopBarColors(),
        actions = {
            NavIcon(
                icon = CupertinoIcons.Outlined.MagnifyingGlass,
                description = if (searchOpen) "关闭搜索" else "搜索",
                onClick = onToggleSearch,
            )
            NavIcon(CupertinoIcons.Outlined.Plus, "导入书籍", onImport)
            if (state.syncing) {
                Box(Modifier.size(42.dp), contentAlignment = Alignment.Center) {
                    CupertinoActivityIndicator(size = 16.dp)
                }
            } else {
                NavIcon(CupertinoIcons.Outlined.ArrowClockwise, "同步", onSync)
            }
        },
    )
}

/**
 * 书架概览：本数、占用、连接状态。
 *
 * 老版 iOS 的栏里只有标题，这行元信息放到内容顶部，点一下进同步页。
 */
@Composable
private fun ShelfStats(state: ShelfUiState, onOpenSyncStatus: () -> Unit) {
    val scheme = CupertinoTheme.colorScheme
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = onOpenSyncStatus)
            .padding(vertical = 2.dp),
    ) {
        Box(
            Modifier
                .size(7.dp)
                .clip(CircleShape)
                .background(if (state.online) scheme.accent else scheme.secondaryLabel)
        )
        Spacer(Modifier.width(6.dp))
        CupertinoText(
            text = "${state.books.size} 本 · ${mbOf(state.localBytes)} MB · " +
                connectionTextOf(state),
            style = CupertinoTheme.typography.footnote,
            color = scheme.secondaryLabel,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** 导航栏动作按钮：44dp 触控区、21dp 图标、systemBlue 着色。 */
@Composable
private fun NavIcon(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    onClick: () -> Unit,
) {
    val scheme = CupertinoTheme.colorScheme
    val source = remember { MutableInteractionSource() }
    Box(
        modifier = Modifier
            .pressScale(source, pressedScale = 0.88f)
            .size(42.dp)
            .clip(CircleShape)
            .clickable(
                interactionSource = source,
                indication = null,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        CupertinoIcon(
            imageVector = icon,
            contentDescription = description,
            modifier = Modifier.size(21.dp),
            tint = scheme.accent,
        )
    }
}

private fun connectionTextOf(state: ShelfUiState): String = when {
    state.syncing -> "同步中…"
    state.online -> state.connectionLabel
    state.connection == ConnectionState.NEED_RECONNECT -> ConnectionState.NEED_RECONNECT.label
    state.connection == ConnectionState.UNKNOWN -> "未连接桌面端"
    else -> state.connectionLabel
}

private fun mbOf(bytes: Long): String =
    String.format(Locale.US, "%.1f", bytes / 1048576.0)

/* ---------------- 未连接横幅 ---------------- */

@Composable
private fun OfflineBanner(onConnect: () -> Unit, onDismiss: () -> Unit) {
    val scheme = CupertinoTheme.colorScheme
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp)
            .clip(RoundedCornerShape(GroupRadius))
            .background(scheme.systemFill)
            .padding(start = 14.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            CupertinoText(
                text = "未连接桌面端",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = scheme.label,
                maxLines = 1,
            )
            Spacer(Modifier.height(2.dp))
            CupertinoText(
                text = "同步与下载暂停；本机书照常可读。",
                fontSize = 12.sp,
                color = scheme.secondaryLabel,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        CupertinoText(
            text = "去连接",
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            color = scheme.accent,
            modifier = Modifier
                .clickable(onClick = onConnect)
                .padding(horizontal = 10.dp, vertical = 6.dp),
        )
        Box(
            Modifier
                .size(28.dp)
                .clip(CircleShape)
                .clickable(onClick = onDismiss),
            contentAlignment = Alignment.Center,
        ) {
            CupertinoIcon(
                CupertinoIcons.Outlined.Xmark,
                "不再提示",
                Modifier.size(13.dp),
                tint = scheme.secondaryLabel,
            )
        }
    }
}

/* ---------------- 筛选 ---------------- */

/** 筛选：等宽胶囊。未选白底加发丝描边，选中给 systemBlue 实底白字。 */
@Composable
private fun FilterChips(selected: String, onSelect: (String) -> Unit) {
    val scheme = CupertinoTheme.colorScheme
    val shape = RoundedCornerShape(8.dp)
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        ShelfUiState.FILTERS.forEach { (key, label) ->
            val on = key == selected
            Box(
                modifier = Modifier
                    .weight(1f)
                    .clip(shape)
                    .background(if (on) scheme.accent else scheme.secondarySystemGroupedBackground)
                    .border(1.dp, if (on) Color.Transparent else scheme.separator, shape)
                    .clickable { onSelect(key) }
                    .padding(vertical = 7.dp),
                contentAlignment = Alignment.Center,
            ) {
                CupertinoText(
                    text = label,
                    fontSize = 12.sp,
                    fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (on) BrandPaper else scheme.label,
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
private fun ImportStrip(label: String) {
    val scheme = CupertinoTheme.colorScheme
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        CupertinoText(
            text = label,
            fontSize = 11.sp,
            color = scheme.accent,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(6.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .height(2.dp)
                .background(CupertinoTheme.colorScheme.accent.copy(alpha = 0.32f))
        )
    }
}

/* ---------------- 分区标题 ---------------- */

/** 分组标题：iOS 分组头，13sp 次要灰，没有分隔线。 */
@Composable
private fun SectionLabel(title: String, count: Int) {
    val scheme = CupertinoTheme.colorScheme
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CupertinoText(
            text = title,
            modifier = Modifier.weight(1f),
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            color = scheme.secondaryLabel,
            maxLines = 1,
        )
        CupertinoText(
            text = "$count 本",
            fontSize = 13.sp,
            color = scheme.secondaryLabel,
            maxLines = 1,
        )
    }
}

/* ---------------- 空状态 ---------------- */

@Composable
private fun EmptyShelf(hasBooks: Boolean, onImport: () -> Unit, onConnect: () -> Unit) {
    val scheme = CupertinoTheme.colorScheme
    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 32.dp)
            .padding(bottom = 60.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .size(96.dp)
                .clip(CircleShape)
                .background(scheme.secondarySystemFill),
            contentAlignment = Alignment.Center,
        ) {
            CupertinoIcon(
                CupertinoIcons.Outlined.Book,
                null,
                Modifier.size(38.dp),
                tint = scheme.secondaryLabel,
            )
        }
        Spacer(Modifier.height(22.dp))
        CupertinoText(
            text = if (hasBooks) "没有符合条件的书" else "书架是空的",
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
            color = scheme.label,
        )
        Spacer(Modifier.height(8.dp))
        CupertinoText(
            text = if (hasBooks) {
                "换个筛选条件，或清掉搜索词再看看。"
            } else {
                "从手机里导入 TXT，或连接桌面端把书架搬过来。"
            },
            fontSize = 12.5.sp,
            color = scheme.secondaryLabel,
        )
        Spacer(Modifier.height(26.dp))
        CupertinoButton(
            onClick = onImport,
            modifier = Modifier.width(200.dp),
            colors = CupertinoButtonDefaults.filledButtonColors(),
        ) {
            CupertinoText(text = "从文件导入 TXT", fontSize = 14.sp)
        }
        Spacer(Modifier.height(6.dp))
        CupertinoButton(
            onClick = onConnect,
            modifier = Modifier.width(200.dp),
            colors = CupertinoButtonDefaults.plainButtonColors(),
        ) {
            CupertinoText(text = "连接桌面端", fontSize = 14.sp)
        }
    }
}

/* ---------------- 继续阅读 ---------------- */

@Composable
private fun ContinueCard(
    book: Book,
    state: ShelfUiState,
    onOpen: () -> Unit,
) {
    val scheme = CupertinoTheme.colorScheme
    val summary = state.progressSummaryOf(book)
    val percent = state.progressPercentOf(book)
    val source = remember { MutableInteractionSource() }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 6.dp)
            .pressScale(source, pressedScale = 0.985f)
            .clip(RoundedCornerShape(14.dp))
            .background(scheme.secondarySystemGroupedBackground)
            .clickable(
                interactionSource = source,
                indication = null,
                onClick = onOpen,
            )
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CoverArt(
            book = book,
            dimmed = false,
            modifier = Modifier.width(62.dp).aspectRatio(0.68f),
            radius = 8.dp,
            initialSize = 24.sp,
        )
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            CupertinoText(
                text = "继续阅读",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = scheme.accent,
                maxLines = 1,
            )
            Spacer(Modifier.height(6.dp))
            CupertinoText(
                text = book.title,
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                lineHeight = 22.sp,
                color = scheme.label,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(4.dp))
            CupertinoText(
                text = buildString {
                    val chapter = summary.chapterText
                    if (chapter.isNotBlank()) {
                        append(chapter)
                    } else {
                        append(state.sourceLabelOf(book))
                        book.author?.takeIf { it.isNotBlank() }?.let { append(" · ").append(it) }
                    }
                },
                fontSize = 11.sp,
                color = scheme.secondaryLabel,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                ProgressRail(
                    progress = (percent / 100.0).toFloat(),
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(10.dp))
                CupertinoText(
                    text = summary.percentText.ifBlank { "已开始" },
                    fontSize = 10.5.sp,
                    color = scheme.accent,
                    maxLines = 1,
                )
            }
        }
        Spacer(Modifier.width(10.dp))
        CupertinoIcon(
            CupertinoIcons.Outlined.ChevronForward,
            "继续阅读",
            Modifier.size(14.dp),
            tint = scheme.tertiaryLabel,
        )
    }
}

/* ---------------- 单本书（封面墙一格） ---------------- */

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun BookCell(
    book: Book,
    badge: BookBadge,
    transferPercent: Int,
    percent: Double,
    summary: ProgressSummary,
    readable: Boolean,
    highlighted: Boolean,
    menuOpen: Boolean,
    onToggleMenu: () -> Unit,
    onOpen: () -> Unit,
    onDownload: () -> Unit,
    onDeleteLocal: () -> Unit,
    onRemoveFromShelf: () -> Unit,
    onSyncStatus: () -> Unit,
) {
    val scheme = CupertinoTheme.colorScheme
    val dimmed = !readable

    val source = remember { MutableInteractionSource() }
    Column(
        Modifier
            .fillMaxWidth()
            .pressScale(source, pressedScale = 0.97f)
            .combinedClickable(
                interactionSource = source,
                indication = null,
                onClick = onOpen,
                onLongClick = onToggleMenu,
            ),
    ) {
        Box {
            CoverArt(
                book = book,
                dimmed = dimmed,
                modifier = Modifier.fillMaxWidth().aspectRatio(0.68f),
            )
            if (badge != BookBadge.NONE) {
                Row(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(6.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(scheme.secondarySystemGroupedBackground.copy(alpha = 0.92f))
                        .padding(horizontal = 5.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .size(4.dp)
                            .clip(CircleShape)
                            .background(badgeColor(badge))
                    )
                    Spacer(Modifier.width(4.dp))
                    CupertinoText(
                        text = badgeLabel(badge, transferPercent),
                        fontSize = 9.sp,
                        color = badgeColor(badge),
                        maxLines = 1,
                    )
                }
            }
            if (summary.read) {
                CupertinoText(
                    text = summary.percentText,
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(6.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Color.Black.copy(alpha = 0.46f))
                        .padding(horizontal = 5.dp, vertical = 2.dp),
                    fontSize = 9.sp,
                    color = Color.White,
                    maxLines = 1,
                )
            }
            // ⋯：封面右上角常驻，点一下就是旧版列表里的那套菜单。
            Box(Modifier.align(Alignment.TopEnd).padding(4.dp)) {
                Box(
                    Modifier
                        .size(24.dp)
                        .clip(CircleShape)
                        .background(scheme.secondarySystemGroupedBackground.copy(alpha = 0.82f))
                        .clickable(onClick = onToggleMenu),
                    contentAlignment = Alignment.Center,
                ) {
                    CupertinoText(
                        text = "⋯",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = scheme.secondaryLabel,
                    )
                }
                // 菜单只在打开时才组合：折叠状态下几十个封面各挂一个弹出层宿主，
                // 滚动时纯属白搭构图与测量。
                if (menuOpen) {
                    CupertinoDropdownMenu(
                        expanded = true,
                        onDismissRequest = onToggleMenu,
                    ) {
                        if (!book.isCloud && !book.hasLocalFile) {
                            MenuAction(onClick = onDownload) { CupertinoText("下载到手机", fontSize = 14.sp) }
                        }
                        if (book.hasLocalFile) {
                            MenuAction(onClick = onDeleteLocal) { CupertinoText("删除本机副本", fontSize = 14.sp) }
                        }
                        if (book.origin == Origin.DESKTOP) {
                            MenuAction(onClick = onRemoveFromShelf) { CupertinoText("从手机书架移除", fontSize = 14.sp) }
                        }
                        MenuAction(onClick = onSyncStatus) { CupertinoText("查看同步状态", fontSize = 14.sp) }
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        CupertinoText(
            text = book.title,
            fontSize = 13.sp,
            lineHeight = 17.sp,
            fontWeight = FontWeight.Medium,
            color = when {
                highlighted -> scheme.accent
                dimmed -> scheme.tertiaryLabel
                else -> scheme.label
            },
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(5.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            ProgressRail(
                progress = (percent / 100.0).toFloat(),
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            CupertinoText(
                text = when {
                    summary.read -> summary.percentText
                    !readable -> "未下载"
                    else -> "未读"
                },
                fontSize = 9.5.sp,
                color = scheme.secondaryLabel,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun ProgressRail(progress: Float, modifier: Modifier = Modifier) {
    val scheme = CupertinoTheme.colorScheme
    val filled by animateFloatAsState(
        targetValue = progress.coerceIn(0f, 1f),
        animationSpec = tween(FolioMotion.Normal, easing = FolioMotion.Easing),
        label = "rail-progress",
    )
    Box(
        modifier
            .fillMaxWidth()
            .height(2.dp)
            .clip(CircleShape)
            .background(scheme.separator),
    ) {
        Box(
            Modifier
                .fillMaxWidth(filled)
                .fillMaxHeight()
                .clip(CircleShape)
                .background(scheme.accent)
        )
    }
}

private fun badgeLabel(badge: BookBadge, percent: Int): String =
    if (badge == BookBadge.TRANSFERRING && percent in 1..99) {
        "传输中 $percent%"
    } else {
        badge.label
    }

@Composable
private fun badgeColor(badge: BookBadge): Color {
    val scheme = CupertinoTheme.colorScheme
    return when (badge) {
        BookBadge.MISMATCH, BookBadge.FAILED -> BrandNegative
        BookBadge.TRANSFERRING -> scheme.accent
        BookBadge.NOT_SYNCED, BookBadge.NEED_CONNECT, BookBadge.LOCAL_ONLY -> scheme.secondaryLabel
        BookBadge.NONE -> scheme.secondaryLabel
    }
}

/**
 * 封面。
 *
 * 有图就铺满；没图用书名哈希出一组低饱和纸色做竖向渐变，左侧一道书脊，
 * 中间放书名首字——空封面也像一本真书，而不是一块灰方块。
 */
@Composable
private fun CoverArt(
    book: Book,
    dimmed: Boolean,
    modifier: Modifier = Modifier,
    radius: Dp = 6.dp,
    initialSize: TextUnit = 22.sp,
) {
    val hue = (book.title.hashCode().absoluteValue % 360).toFloat()
    val paperTop = Color.hsl(hue, 0.18f, 0.87f)
    val paperBottom = Color.hsl(hue, 0.24f, 0.74f)
    val inkTone = Color.hsl(hue, 0.34f, 0.24f)
    val shape = RoundedCornerShape(radius)
    Box(
        modifier
            .shadow(elevation = if (dimmed) 0.dp else 3.dp, shape = shape, clip = false)
            .clip(shape)
            .background(Brush.verticalGradient(listOf(paperTop, paperBottom)))
            .border(0.5.dp, Color.Black.copy(alpha = 0.06f), shape)
            .alpha(if (dimmed) 0.55f else 1f),
    ) {
        Box(
            Modifier
                .fillMaxHeight()
                .width(4.dp)
                .background(inkTone.copy(alpha = 0.12f))
        )
        CupertinoText(
            text = book.title.take(1).ifBlank { "书" },
            modifier = Modifier.align(Alignment.Center),
            fontSize = initialSize,
            fontWeight = FontWeight.SemiBold,
            color = inkTone.copy(alpha = 0.78f),
        )
        // 有封面就盖在纸色底上；加载失败时这张图不画，回落到书名首字。
        if (book.cover != null) {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(CoverImage.of(book))
                    .build(),
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
        }
    }
}

/* ---------------- 提示 / 确认 ---------------- */

@Composable
private fun Snack(text: String, onDismiss: () -> Unit) {
    LaunchedEffect(text) {
        kotlinx.coroutines.delay(2600)
        onDismiss()
    }
    val scheme = CupertinoTheme.colorScheme
    Box(
        Modifier.fillMaxSize(),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Reveal {
            CupertinoText(
                text = text,
                modifier = Modifier
                    .padding(bottom = 24.dp, start = 24.dp, end = 24.dp)
                    .shadow(10.dp, RoundedCornerShape(14.dp))
                    .clip(RoundedCornerShape(14.dp))
                    .background(scheme.label.copy(alpha = 0.94f))
                    .padding(horizontal = 16.dp, vertical = 11.dp),
                fontSize = 12.5.sp,
                color = scheme.secondarySystemGroupedBackground,
            )
        }
    }
}

@Composable
private fun ConfirmSheet(
    title: String,
    summary: String,
    confirmText: String,
    onCancel: () -> Unit,
    onConfirm: () -> Unit,
) {
    val scheme = CupertinoTheme.colorScheme
    FolioSheet(onDismiss = onCancel) {
        Column(Modifier.padding(horizontal = 20.dp)) {
            Spacer(Modifier.height(6.dp))
            CupertinoText(text = title, fontSize = 19.sp, fontWeight = FontWeight.Medium, color = scheme.label)
            Spacer(Modifier.height(8.dp))
            CupertinoText(text = summary, fontSize = 13.sp, color = scheme.secondaryLabel)
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CupertinoButton(
                    onClick = onCancel,
                    modifier = Modifier.weight(1f),
                    colors = CupertinoButtonDefaults.grayButtonColors(),
                ) {
                    CupertinoText(text = "取消", fontSize = 14.sp)
                }
                CupertinoButton(
                    onClick = onConfirm,
                    modifier = Modifier.weight(1f),
                    colors = CupertinoButtonDefaults.filledButtonColors(),
                ) {
                    CupertinoText(text = confirmText, fontSize = 14.sp)
                }
            }
        }
    }
}

/** SAF 允许的类型：纯文本、EPUB、CBZ/ZIP 漫画，兜底给一个二进制流。 */
private val IMPORT_MIME_TYPES = arrayOf(
    "text/plain",
    "text/*",
    "application/epub+zip",
    "application/vnd.comicbook+zip",
    "application/x-cbz",
    "application/zip",
    "application/octet-stream",
)
