package net.doc9830.frontier

import android.webkit.JavascriptInterface
import java.lang.ref.WeakReference

/**
 * The whole native surface the game can see: `window.FrontierAndroid`.
 * Calls arrive on a WebView thread, so every method hops back to the activity
 * and does no work of its own.
 */
class Bridge(activity: MainActivity) {
    private val ref = WeakReference(activity)

    /** Versions and repository, as JSON, for the update card in the game UI. */
    @JavascriptInterface
    fun info(): String = runCatching { ref.get()?.updater?.infoJson() }.getOrNull() ?: "{}"

    @JavascriptInterface
    fun check() {
        ref.get()?.bridgeCheck()
    }

    @JavascriptInterface
    fun installWeb() {
        ref.get()?.bridgeInstallWeb()
    }

    @JavascriptInterface
    fun installApk() {
        ref.get()?.bridgeInstallApk()
    }

    /** Opens the "install unknown apps" system screen — still inside the app. */
    @JavascriptInterface
    fun openInstallSettings() {
        ref.get()?.bridgeOpenInstallSettings()
    }

    @JavascriptInterface
    fun reload() {
        ref.get()?.bridgeReload()
    }

    @JavascriptInterface
    fun toast(message: String) {
        ref.get()?.bridgeToast(message)
    }

    /** Set from native code to report which repository the shell is following. */
    @JavascriptInterface
    fun repo(): String = runCatching { ref.get()?.updater?.repoUrl() }.getOrNull().orEmpty()
}
