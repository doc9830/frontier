package net.doc9830.frontier

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File

/**
 * Shell updates never touch a browser: the APK is handed to Android's own
 * PackageInstaller, which shows its single confirmation dialog and restarts the
 * app. That is the only way a non-store app can replace itself.
 */
object ApkUpdate {
    const val ACTION_RESULT = "net.doc9830.frontier.INSTALL_RESULT"

    /** True once the user allowed this app to install packages from itself. */
    fun canInstall(context: Context): Boolean = context.packageManager.canRequestPackageInstalls()

    /** System screen where that permission is granted, opened from inside the app. */
    fun permissionIntent(context: Context): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))

    fun install(context: Context, apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
            }
        }
        val sessionId = installer.createSession(params)
        try {
            installer.openSession(sessionId).use { session ->
                session.openWrite("frontier.apk", 0, apk.length()).use { output ->
                    apk.inputStream().use { input -> input.copyTo(output) }
                    session.fsync(output)
                }
                session.commit(resultIntent(context, sessionId).intentSender)
            }
        } catch (error: Exception) {
            runCatching { installer.abandonSession(sessionId) }
            // Some OEM builds refuse sessions; the platform installer is the fallback.
            openWithSystemInstaller(context, apk)
        }
    }

    private fun resultIntent(context: Context, sessionId: Int): PendingIntent {
        val intent = Intent(context, InstallResultReceiver::class.java)
            .setAction(ACTION_RESULT)
            .putExtra(PackageInstaller.EXTRA_SESSION_ID, sessionId)
        // Mutable: the installer adds the confirmation intent to this pending intent.
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        return PendingIntent.getBroadcast(context, sessionId, intent, flags)
    }

    private fun openWithSystemInstaller(context: Context, apk: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(intent)
    }
}
