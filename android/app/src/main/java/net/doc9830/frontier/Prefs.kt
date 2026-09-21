package net.doc9830.frontier

import android.content.Context
import androidx.core.content.edit

/** Shell settings: which bundle is installed, when we last asked GitHub, and the source repo. */
class Prefs(context: Context) {
    private val prefs = context.getSharedPreferences("frontier.shell", Context.MODE_PRIVATE)

    /** Version of the downloaded game bundle (empty = the copy inside the APK is in use). */
    var webVersion: String
        get() = prefs.getString(KEY_WEB_VERSION, "").orEmpty()
        set(value) = prefs.edit { putString(KEY_WEB_VERSION, value) }

    var lastCheckAt: Long
        get() = prefs.getLong(KEY_LAST_CHECK, 0L)
        set(value) = prefs.edit { putLong(KEY_LAST_CHECK, value) }

    /** Raw JSON of the last seen release, so the UI has something to show offline. */
    var cachedRelease: String?
        get() = prefs.getString(KEY_RELEASE, null)
        set(value) = prefs.edit { putString(KEY_RELEASE, value) }

    var autoCheck: Boolean
        get() = prefs.getBoolean(KEY_AUTO_CHECK, true)
        set(value) = prefs.edit { putBoolean(KEY_AUTO_CHECK, value) }

    /** Update source: any GitHub repository; kept configurable for forks. */
    var repo: String
        get() = prefs.getString(KEY_REPO, BuildConfig.REPO)?.takeIf { it.isNotBlank() } ?: BuildConfig.REPO
        set(value) = prefs.edit { putString(KEY_REPO, value.trim().trimEnd('/')) }

    private companion object {
        const val KEY_WEB_VERSION = "webVersion"
        const val KEY_LAST_CHECK = "lastCheckAt"
        const val KEY_RELEASE = "cachedRelease"
        const val KEY_AUTO_CHECK = "autoCheck"
        const val KEY_REPO = "repo"
    }
}
