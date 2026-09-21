package net.doc9830.frontier

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import org.json.JSONObject

/** Relays the PackageInstaller verdict back into the game UI. */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT) as? Intent
                confirm?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                if (confirm == null) {
                    UpdateEvents.emit(event("error", "Система не показала окно установки."))
                } else {
                    runCatching { context.startActivity(confirm) }
                }
            }

            PackageInstaller.STATUS_SUCCESS ->
                UpdateEvents.emit(event("installed", "Приложение обновлено. Перезапустите FRONTIER."))

            else -> {
                val reason = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                UpdateEvents.emit(event("error", "Установка не выполнена: ${reason ?: "отменено"}"))
            }
        }
    }

    private fun event(phase: String, message: String): String = JSONObject()
        .put("phase", phase)
        .put("message", message)
        .put("channel", "apk")
        .toString()
}
