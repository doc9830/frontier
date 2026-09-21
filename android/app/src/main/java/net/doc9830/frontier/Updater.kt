package net.doc9830.frontier

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.Executors

/**
 * Two update channels, both driven from inside the app:
 *
 *  - **the game** — a zip of the built web app, unpacked and swapped under
 *    filesDir, then the WebView simply reloads (no installer, no browser);
 *  - **the shell** — this APK, downloaded and handed to the system installer.
 *
 * Everything happens on one background thread; progress is published as JSON so
 * the game UI can render it without knowing anything about the native side.
 */
class Updater(private val context: Context, private val prefs: Prefs) {
    private val ui = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "frontier-updater") }

    @Volatile
    private var busy = false

    @Volatile
    private var lastRelease: ReleaseInfo? = null

    // --- queries -------------------------------------------------------------

    /** Version of the bundle the WebView is serving right now. */
    fun installedWebVersion(): String =
        WebBundle.readVersion(WebBundle.liveDir(context)) ?: bundledWebVersion()

    fun infoJson(): String = JSONObject()
        .put("app", BuildConfig.VERSION_NAME)
        .put("appCode", BuildConfig.VERSION_CODE)
        .put("web", installedWebVersion())
        .put("repo", prefs.repo)
        .put("repoUrl", repoUrl())
        .put("autoCheck", prefs.autoCheck)
        .toString()

    fun repoUrl(): String = "https://github.com/${prefs.repo}"

    // --- lifecycle -----------------------------------------------------------

    /**
     * Housekeeping at launch: leftovers from an interrupted update are dropped and
     * a bundle shipped inside a newer APK wins over a downloaded one.
     */
    fun syncWithBundledAssets() {
        WebBundle.discardPending(context)
        val live = WebBundle.readVersion(WebBundle.liveDir(context)) ?: return
        if (Version.isNewer(bundledWebVersion(), live)) WebBundle.drop(context)
    }

    /** Silent check, at most every few hours, so the game can mention an update. */
    fun autoCheckIfDue(intervalMs: Long = 6 * 60 * 60 * 1000L) {
        if (!prefs.autoCheck) return
        if (System.currentTimeMillis() - prefs.lastCheckAt < intervalMs) return
        check(silent = true)
    }

    // --- update channels -----------------------------------------------------

    fun check(silent: Boolean = false) {
        if (busy) {
            if (!silent) emitPhase("busy", "Операция уже выполняется.")
            return
        }
        busy = true
        emitPhase("checking", "Проверяю ${prefs.repo}…") { put("silent", silent) }
        worker.execute {
            val next = runCatching { fetchRelease() }
            busy = false
            next.onSuccess { report(it, silent) }
                .onFailure { emitPhase("error", describe(it)) { put("silent", silent) } }
        }
    }

    /** Downloads the web bundle and swaps it in; the caller reloads the WebView after. */
    fun applyWebUpdate() {
        if (busy) {
            emitPhase("busy", "Дождитесь окончания операции.")
            return
        }
        busy = true
        worker.execute {
            var archive: File? = null
            try {
                val release = ensureRelease()
                val asset = release.webAsset ?: throw IOException("в релизе нет ${ReleaseInfo.WEB_ASSET}")
                archive = File(context.cacheDir, "updates/frontier-web.zip")
                download(asset, archive, "Скачиваю сборку игры")
                emitPhase("unpacking", "Распаковываю сборку…")
                val pending = WebBundle.pendingDir(context)
                WebBundle.unpack(archive, pending)
                val version = WebBundle.readVersion(pending) ?: release.version
                if (!WebBundle.activate(context)) throw IOException("не удалось заменить файлы игры")
                prefs.webVersion = version
                busy = false
                emitPhase("ready", "Игра обновлена до $version.") {
                    put("version", version)
                    put("installedWeb", version)
                    put("web", false)
                    put("reload", true)
                }
            } catch (error: Exception) {
                busy = false
                WebBundle.discardPending(context)
                emitPhase("error", describe(error))
            } finally {
                archive?.delete()
            }
        }
    }

    /** Downloads the APK and drives the system installer; the app restarts itself. */
    fun applyApkUpdate() {
        if (busy) {
            emitPhase("busy", "Дождитесь окончания операции.")
            return
        }
        busy = true
        worker.execute {
            try {
                val release = ensureRelease()
                val asset = release.apkAsset ?: throw IOException("в релизе нет APK")
                val apk = File(context.cacheDir, "updates/frontier-${release.version}.apk")
                download(asset, apk, "Скачиваю приложение")
                if (ApkUpdate.canInstall(context)) {
                    emitPhase("installing", "Передаю пакет установщику Android…") { put("channel", "apk") }
                    busy = false
                    ApkUpdate.install(context, apk)
                } else {
                    busy = false
                    emitPhase("permission", "Разрешите установку приложений для FRONTIER.") {
                        put("needsPermission", true)
                        put("channel", "apk")
                        put("version", release.version)
                    }
                }
            } catch (error: Exception) {
                busy = false
                emitPhase("error", describe(error)) { put("channel", "apk") }
            }
        }
    }

    // --- internals -----------------------------------------------------------

    private fun report(release: ReleaseInfo, silent: Boolean) {
        val installedWeb = installedWebVersion()
        val webUpdate = release.webAsset != null && Version.isNewer(release.version, installedWeb)
        val apkUpdate = release.apkAsset != null && Version.isNewer(release.version, BuildConfig.VERSION_NAME)
        val latest = !webUpdate && !apkUpdate
        emit {
            put("phase", if (latest) "uptodate" else "available")
            put("version", release.version)
            put("installedWeb", installedWeb)
            put("installedApp", BuildConfig.VERSION_NAME)
            put("web", webUpdate)
            put("apk", apkUpdate)
            put("silent", silent)
            put("notes", release.notes)
            put("url", "${repoUrl()}/releases/tag/v${release.version}")
            put(
                "message",
                when {
                    latest -> "Установлена последняя версия: ${release.version}."
                    webUpdate && apkUpdate -> "Доступна версия ${release.version}: игра и приложение."
                    webUpdate -> "Доступно обновление игры ${release.version}."
                    else -> "Доступно обновление приложения ${release.version}."
                },
            )
        }
    }

    private fun download(asset: ReleaseAsset, target: File, caption: String) {
        emitPhase("downloading", "$caption…") {
            put("percent", 0)
            put("bytes", asset.size)
        }
        Http.download(asset.url, target, asset.size) { done, total ->
            val percent = if (total > 0) ((done * 100) / total).toInt() else -1
            emitPhase("downloading", "$caption… ${percent.coerceAtLeast(0)}%") {
                put("percent", percent)
                put("done", done)
                put("bytes", total)
            }
        }
    }

    private fun fetchRelease(): ReleaseInfo {
        val json = Http.getText("https://api.github.com/repos/${prefs.repo}/releases/latest")
        prefs.lastCheckAt = System.currentTimeMillis()
        prefs.cachedRelease = json
        return ReleaseInfo.parse(json).also { lastRelease = it }
    }

    /** Reuses the release from the last check, but nothing older than ten minutes. */
    private fun ensureRelease(): ReleaseInfo {
        lastRelease?.let { return it }
        val fresh = System.currentTimeMillis() - prefs.lastCheckAt < 10 * 60 * 1000L
        if (fresh) {
            prefs.cachedRelease?.let { cached ->
                runCatching { ReleaseInfo.parse(cached) }.getOrNull()?.let { return it }
            }
        }
        return fetchRelease()
    }

    /** The version shipped inside the APK, read straight from the bundled assets. */
    private fun bundledWebVersion(): String = runCatching {
        context.assets.open("www/version.json").bufferedReader().use { it.readText() }
    }
        .mapCatching { Version.clean(JSONObject(it).optString("version")) }
        .getOrNull()
        ?.takeIf { it.isNotEmpty() }
        ?: BuildConfig.WEB_VERSION

    private fun describe(error: Throwable): String = when (error) {
        is UnknownHostException -> "Нет соединения с GitHub."
        is SocketTimeoutException -> "GitHub не ответил вовремя."
        else -> error.message ?: "Неизвестная ошибка обновления."
    }

    private fun emitPhase(phase: String, message: String, configure: JSONObject.() -> Unit = {}) = emit {
        put("phase", phase)
        put("message", message)
        configure()
    }

    private fun emit(configure: JSONObject.() -> Unit) {
        val json = JSONObject().apply(configure).toString()
        ui.post { UpdateEvents.emit(json) }
    }
}
