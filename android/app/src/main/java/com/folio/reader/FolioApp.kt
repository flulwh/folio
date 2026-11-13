package com.folio.reader

import android.app.Application
import com.folio.reader.data.LibraryStore
import com.folio.reader.data.OfflineStore
import com.folio.reader.data.SettingsStore
import com.folio.reader.data.SyncManager
import com.folio.reader.work.SyncWorker

/** 依赖容器。手写单例比引入 DI 框架更省电也更省包体。 */
class AppContainer(app: Application) {
    val settings = SettingsStore(app)
    val library = LibraryStore(app)
    val offline = OfflineStore(app)
    val sync = SyncManager(app, settings, library, offline)
}

class FolioApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        // 周期同步交给系统调度，不常驻进程。
        if (container.settings.autoSync) {
            SyncWorker.schedule(this)
        }
    }
}
