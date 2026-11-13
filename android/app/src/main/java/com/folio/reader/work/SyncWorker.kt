package com.folio.reader.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.folio.reader.FolioApp
import java.util.concurrent.TimeUnit

/**
 * 后台同步。
 *
 * 用 WorkManager 而不是自己起 Service：系统会在合适的时机唤醒任务，
 * 合并唤醒、遵守电量与网络约束，手机不会因为它一直耗电。
 */
class SyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val app = applicationContext as? FolioApp ?: return Result.failure()
        val container = app.container
        if (!container.settings.autoSync) return Result.success()
        if (!container.settings.hasServer) return Result.success()
        val outcome = container.sync.sync()
        return if (outcome.ok) Result.success() else Result.retry()
    }

    companion object {
        private const val NAME = "folio-periodic-sync"

        /** 开启周期同步。15 分钟是 WorkManager 允许的最小间隔。 */
        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .setRequiresBatteryNotLow(true)
                .build()
            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 5, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }

        /** 关掉自动同步时取消。 */
        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(NAME)
        }
    }
}
