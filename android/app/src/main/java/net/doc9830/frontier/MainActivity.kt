package net.doc9830.frontier

import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/**
 * FRONTIER on Android: the web game runs from local assets inside a WebView and
 * keeps itself up to date from the GitHub repository — the shell fetches release
 * assets, swaps the game files and, when the shell itself changed, hands a new
 * APK to the system installer. No browser is involved at any point.
 */
class MainActivity : Activity() {
    private lateinit var root: FrameLayout
    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader

    lateinit var updater: Updater
        private set

    private var lastBackPress = 0L
    private var lastNotice: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        updater = Updater(this, Prefs(this))
        updater.syncWithBundledAssets()
        assetLoader = buildAssetLoader().build()

        window.setBackgroundDrawableResource(R.color.frontier_bg)
        applyWindowChrome()

        root = FrameLayout(this).apply { setBackgroundColor(Color.parseColor(GAME_BG)) }
        webView = createWebView()
        root.addView(
            webView,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        setContentView(root)

        webView.loadUrl("$ASSET_ORIGIN/index.html")

        UpdateEvents.register { json ->
            webView.post {
                webView.evaluateJavascript("window.__frontierUpdate && window.__frontierUpdate($json)", null)
            }
            announce(json)
        }

        updater.autoCheckIfDue()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        // The installer may have sent the user to a settings screen; a second look never hurts.
        updater.autoCheckIfDue()
    }

    override fun onPause() {
        flushSave()
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        UpdateEvents.register(null)
        webView.destroy()
        super.onDestroy()
    }

    // --- WebView -------------------------------------------------------------

    private fun buildAssetLoader(): WebViewAssetLoader.Builder {
        val builder = WebViewAssetLoader.Builder()
        // A downloaded bundle shadows the copy shipped inside the APK; when a file
        // is missing there, the bundled handler answers instead.
        val live = WebBundle.liveDir(this)
        if (live.isDirectory) {
            builder.addPathHandler("/", WebViewAssetLoader.InternalStoragePathHandler(this, live))
        }
        builder.addPathHandler("/", WebAssetHandler(this))
        return builder
    }

    private fun createWebView(): WebView {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val view = WebView(this)
        view.setBackgroundColor(Color.parseColor(GAME_BG))
        view.isVerticalScrollBarEnabled = false
        view.isHorizontalScrollBarEnabled = false
        view.overScrollMode = View.OVER_SCROLL_NEVER
        view.isLongClickable = false
        view.setOnLongClickListener { true }

        with(view.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true // the save game lives in localStorage
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            setGeolocationEnabled(false)
        }

        view.addJavascriptInterface(Bridge(this), "FrontierAndroid")
        view.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                android.util.Log.d("FrontierWeb", "${message.message()} @${message.lineNumber()}")
                return true
            }
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // The shell is a local app: anything pointing outside it is refused.
                if (request.url.toString().startsWith(ASSET_ORIGIN)) return false
                toast("Внешние ссылки в приложении отключены.")
                return true
            }
        }
        return view
    }

    // --- bridge --------------------------------------------------------------

    fun bridgeCheck() = runOnUiThread { updater.check(silent = false) }

    fun bridgeInstallWeb() = runOnUiThread { updater.applyWebUpdate() }

    fun bridgeInstallApk() = runOnUiThread { updater.applyApkUpdate() }

    /** Opens the "install unknown apps" system screen — still inside the app. */
    fun bridgeOpenInstallSettings() = runOnUiThread {
        runCatching { startActivity(ApkUpdate.permissionIntent(this)) }
            .onFailure { toast("Не удалось открыть настройки: ${it.message}") }
    }

    fun bridgeToast(message: String) = runOnUiThread { toast(message) }

    /** Flush the save, then reload straight into the freshly installed bundle. */
    fun bridgeReload() = runOnUiThread {
        flushSave()
        webView.postDelayed(
            {
                webView.clearCache(true)
                webView.clearHistory()
                webView.loadUrl("$ASSET_ORIGIN/index.html")
            },
            350,
        )
    }

    private fun flushSave() {
        webView.evaluateJavascript(FLUSH_JS, null)
    }

    // --- behaviour -----------------------------------------------------------

    @Deprecated("Back is offered to the game first, then handled here.")
    override fun onBackPressed() {
        webView.evaluateJavascript(BACK_JS) { result ->
            if (result?.trim('"') == "true") return@evaluateJavascript
            val now = System.currentTimeMillis()
            if (now - lastBackPress < 2000) {
                finish()
            } else {
                lastBackPress = now
                toast("Нажмите НАЗАД ещё раз, чтобы выйти")
            }
        }
    }

    private fun applyWindowChrome() {
        if (Build.VERSION.SDK_INT < 35) {
            @Suppress("DEPRECATION")
            window.statusBarColor = Color.TRANSPARENT
            @Suppress("DEPRECATION")
            window.navigationBarColor = Color.TRANSPARENT
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // Android 15 forces edge to edge; below that the game keeps to its own area
            // and the status bar simply wears the game background.
            val edgeToEdge = Build.VERSION.SDK_INT >= 35
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = if (edgeToEdge) {
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                } else {
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT
                }
            }
        }
        if (Build.VERSION.SDK_INT >= 35) {
            // Android 15 draws every app edge to edge; the game reads its own
            // env(safe-area-inset-*) values, so the content must not be inset here.
            @Suppress("DEPRECATION")
            window.setDecorFitsSystemWindows(false)
        }
    }

    /** A silent check that found something: nudge the player towards the update card. */
    private fun announce(json: String) {
        val event = runCatching { JSONObject(json) }.getOrNull() ?: return
        if (!event.optBoolean("silent") || event.optString("phase") != "available") return
        val message = "${event.optString("message")} ЛЕНТА → ОБНОВЛЕНИЕ."
        if (message == lastNotice) return
        lastNotice = message
        toast(message)
    }

    private fun toast(message: String) {
        runOnUiThread { Toast.makeText(this, message, Toast.LENGTH_LONG).show() }
    }

    private companion object {
        const val ASSET_ORIGIN = "https://appassets.androidplatform.net"
        const val GAME_BG = "#04070a"
        const val FLUSH_JS = "window.__frontierFlush && window.__frontierFlush()"
        const val BACK_JS = "window.__frontierBack ? window.__frontierBack() : false"
    }
}
