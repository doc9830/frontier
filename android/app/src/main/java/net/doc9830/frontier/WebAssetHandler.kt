package net.doc9830.frontier

import android.content.Context
import android.content.res.AssetManager
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.IOException

/**
 * Serves the copy of the game that travels inside the APK.
 *
 * The built game lives in `assets/www`, while `WebViewAssetLoader` hands handlers
 * the request path with the registered prefix already stripped, and its own
 * `AssetsPathHandler` reads from the assets root only — which would answer every
 * request with a 404 and leave a blank screen. The mapping is therefore explicit
 * and covered by [WebAssetHandlerTest].
 */
internal fun bundledAssetPath(requestPath: String, root: String = "www"): String {
    val clean = requestPath.trimStart('/').removePrefix("$root/")
    val name = clean.ifEmpty { "index.html" }
    return "$root/$name"
}

/**
 * MIME type (and charset for text) of a request path.
 *
 * The WebView is strict here: a response without a JavaScript MIME type is refused
 * for `<script type="module">`, which is exactly what the built game uses — the
 * page then stays empty. Extensions the build actually emits are listed one by one,
 * and anything unknown is served as a byte stream instead of a wrong type.
 */
internal fun mimeTypeFor(requestPath: String): Pair<String, String?> {
    val extension = requestPath
        .substringBefore('?')
        .substringBefore('#')
        .substringAfterLast('.', "")
        .lowercase()
    return when (extension) {
        "html", "htm" -> "text/html" to "UTF-8"
        "js", "mjs" -> "text/javascript" to "UTF-8"
        "css" -> "text/css" to "UTF-8"
        "json", "map" -> "application/json" to "UTF-8"
        "webmanifest" -> "application/manifest+json" to "UTF-8"
        "txt" -> "text/plain" to "UTF-8"
        "svg" -> "image/svg+xml" to "UTF-8"
        "png" -> "image/png" to null
        "jpg", "jpeg" -> "image/jpeg" to null
        "webp" -> "image/webp" to null
        "gif" -> "image/gif" to null
        "avif" -> "image/avif" to null
        "ico" -> "image/x-icon" to null
        "woff2" -> "font/woff2" to null
        "woff" -> "font/woff" to null
        "ttf" -> "font/ttf" to null
        "otf" -> "font/otf" to null
        "mp3" -> "audio/mpeg" to null
        "ogg", "oga" -> "audio/ogg" to null
        "wav" -> "audio/wav" to null
        "webm" -> "video/webm" to null
        "mp4" -> "video/mp4" to null
        else -> "application/octet-stream" to null
    }
}

/** Path handler for `assets/www`, with the MIME type the WebView insists on. */
class WebAssetHandler(context: Context) : WebViewAssetLoader.PathHandler {
    private val assets: AssetManager = context.assets

    override fun handle(path: String): WebResourceResponse? = try {
        val (mimeType, charset) = mimeTypeFor(path)
        WebResourceResponse(
            mimeType,
            charset,
            assets.open(bundledAssetPath(path), AssetManager.ACCESS_STREAMING),
        )
    } catch (error: IOException) {
        null // lets the next registered handler, if any, answer instead
    }
}
