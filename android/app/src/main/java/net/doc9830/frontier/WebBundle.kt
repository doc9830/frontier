package net.doc9830.frontier

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.zip.ZipInputStream

/**
 * The game itself is a folder of static files, so updating it is a pure file
 * swap under `filesDir`: `www.pending` becomes `www` and the WebView picks the
 * new build up on the next reload.
 *
 * Both the copy bundled in the APK and the downloaded one are served from the
 * same fake https origin, therefore localStorage (the save game) is never
 * touched by an update — it only ever sees a fresh deployment.
 */
object WebBundle {
    private const val WEB_JSON = "version.json"
    private const val ENTRY = "index.html"

    fun liveDir(context: Context) = File(context.filesDir, "www")
    fun pendingDir(context: Context) = File(context.filesDir, "www.pending")
    fun backupDir(context: Context) = File(context.filesDir, "www.old")

    /** Version recorded inside a bundle folder, or null when it is not a bundle. */
    fun readVersion(dir: File): String? {
        val file = File(dir, WEB_JSON)
        if (!file.isFile) return null
        return runCatching { Version.clean(JSONObject(file.readText()).optString("version")) }
            .getOrNull()
            ?.takeIf { it.isNotEmpty() }
    }

    /**
     * Extracts `zip` into `target`. Entries outside the archive root are refused
     * and a bundle without index.html is rejected, so a broken download can never
     * replace a working game.
     */
    fun unpack(zip: File, target: File): Int {
        target.deleteRecursively()
        if (!target.mkdirs() && !target.isDirectory) {
            throw IOException("нет доступа к ${target.absolutePath}")
        }
        val root = target.canonicalFile
        val prefix = root.path + File.separator
        var entries = 0
        ZipInputStream(zip.inputStream().buffered()).use { input ->
            while (true) {
                val entry = input.nextEntry ?: break
                val name = entry.name.replace('\\', '/').removePrefix("./").trimStart('/')
                if (name.isEmpty()) {
                    input.closeEntry()
                    continue
                }
                val out = File(root, name)
                if (!out.canonicalPath.startsWith(prefix)) {
                    throw IOException("подозрительный путь в архиве: $name")
                }
                if (entry.isDirectory) {
                    out.mkdirs()
                } else {
                    out.parentFile?.mkdirs()
                    out.outputStream().use { file -> input.copyTo(file) }
                    entries++
                }
                input.closeEntry()
            }
        }
        if (!File(root, ENTRY).isFile) throw IOException("в архиве нет $ENTRY")
        return entries
    }

    /** Moves the pending bundle in place. The previous one is only dropped on success. */
    fun activate(context: Context): Boolean =
        activate(liveDir(context), pendingDir(context), backupDir(context))

    /** File-level variant, kept separate so the swap can be unit tested. */
    fun activate(live: File, pending: File, backup: File): Boolean {
        if (!File(pending, ENTRY).isFile) return false
        backup.deleteRecursively()
        val hadLive = live.isDirectory
        if (hadLive && !live.renameTo(backup)) return false
        if (!pending.renameTo(live)) {
            if (hadLive) backup.renameTo(live)
            return false
        }
        backup.deleteRecursively()
        return true
    }

    fun discardPending(context: Context) {
        pendingDir(context).deleteRecursively()
    }

    /** Falls back to the bundle shipped inside the APK (used after an APK update). */
    fun drop(context: Context) {
        liveDir(context).deleteRecursively()
        discardPending(context)
        backupDir(context).deleteRecursively()
    }
}
