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

/** Path handler for `assets/www`, with the MIME type left to the WebView. */
class WebAssetHandler(context: Context) : WebViewAssetLoader.PathHandler {
    private val assets: AssetManager = context.assets

    override fun handle(path: String): WebResourceResponse? = try {
        WebResourceResponse(null, null, assets.open(bundledAssetPath(path), AssetManager.ACCESS_STREAMING))
    } catch (error: IOException) {
        null // lets the next registered handler, if any, answer instead
    }
}
