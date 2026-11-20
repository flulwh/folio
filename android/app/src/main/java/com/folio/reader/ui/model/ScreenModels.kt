package com.folio.reader.ui.model

import cafe.adriel.voyager.core.model.ScreenModel
import com.folio.reader.ui.session.SessionStore

/**
 * 各页面的 Voyager ScreenModel。
 *
 * 跨页共享的状态与业务都在应用级 [SessionStore] 里（同步、落盘、网络不该随页面重建）；
 * ScreenModel 表示「这一页还活着」，页面出栈时由 Voyager 释放，
 * 页面私有的临时状态以后放这里，不必污染全局会话。
 */
class ShelfModel(val session: SessionStore) : ScreenModel

class ReaderModel(val session: SessionStore) : ScreenModel

class ComicModel(val session: SessionStore) : ScreenModel

class EpubModel(val session: SessionStore) : ScreenModel

class SettingsModel(val session: SessionStore) : ScreenModel

class SyncModel(val session: SessionStore) : ScreenModel

class FontsModel(val session: SessionStore) : ScreenModel
