package net.doc9830.frontier

import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Minimal HTTPS client: the shell ships no HTTP library, the platform one is enough. */
object Http {
    private const val USER_AGENT = "Frontier-Android-Updater"
    private const val PROGRESS_STEP = 128 * 1024L

    fun getText(url: String, timeoutMs: Int = 20_000): String {
        val connection = open(url, timeoutMs)
        try {
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code !in 200..299) throw IOException("GitHub ответил $code: ${body.take(160)}")
            return body
        } finally {
            connection.disconnect()
        }
    }

    /**
     * Streams to `target` and reports progress on the way. GitHub answers asset
     * requests with a redirect to a CDN, which the platform client follows.
     */
    fun download(
        url: String,
        target: File,
        expectedBytes: Long = -1L,
        onProgress: (Long, Long) -> Unit = { _, _ -> },
    ): File {
        val connection = open(url, 30_000)
        try {
            val code = connection.responseCode
            if (code !in 200..299) throw IOException("GitHub ответил $code при загрузке файла")
            val declared = connection.contentLengthLong
            val total = if (declared > 0) declared else expectedBytes
            target.parentFile?.mkdirs()
            connection.inputStream.use { input ->
                target.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var done = 0L
                    var reported = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        output.write(buffer, 0, read)
                        done += read
                        if (done - reported >= PROGRESS_STEP) {
                            reported = done
                            onProgress(done, total)
                        }
                    }
                    onProgress(done, total)
                }
            }
            return target
        } finally {
            connection.disconnect()
        }
    }

    private fun open(url: String, timeoutMs: Int): HttpURLConnection {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = true
        connection.connectTimeout = timeoutMs
        connection.readTimeout = timeoutMs
        connection.setRequestProperty("User-Agent", USER_AGENT)
        connection.setRequestProperty("Accept", "application/vnd.github+json, application/octet-stream")
        connection.setRequestProperty("Accept-Encoding", "identity")
        return connection
    }
}
