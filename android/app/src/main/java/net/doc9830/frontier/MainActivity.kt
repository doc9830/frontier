package net.doc9830.frontier

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
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

    /**
     * Shown only when something went wrong: an empty game screen has no other way to
     * speak, and the phone may have no cable attached.
     */
    private lateinit var diagnosticsPanel: LinearLayout
    private lateinit var diagnosticsText: TextView
    private lateinit var diagnosticsButton: Button

    /** Rebuilt after a bundle install: the handlers decide which files the page sees. */
    @Volatile
    private var assetLoader: WebViewAssetLoader = WebViewAssetLoader.Builder().build()

    lateinit var updater: Updater
        private set

    private val consoleTail = ArrayDeque<String>()
    private var lastBackPress = 0L
    /**
     * Android 13 stopped asking the activity about back presses: the system consults
     * the window's dispatcher instead, and without a registration there the player
     * leaves the app from any screen. The callback lives here so it can be removed.
     */
    private var backCallback: OnBackInvokedCallback? = null
    private var lastRendererRestart = 0L
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
        diagnosticsPanel = createDiagnostics()
        root.addView(
            diagnosticsPanel,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM,
            ),
        )
        setContentView(root)
        registerBackHandler()

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
        unregisterBackHandler()
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

    /**
     * The panel that speaks when the game cannot: the console tail, the load errors and,
     * because a broken screen would otherwise be a dead end, a way to pull a new APK.
     */
    private fun createDiagnostics(): LinearLayout {
        diagnosticsText = TextView(this).apply {
            setTextColor(DIAGNOSTICS_FG)
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setTextIsSelectable(true)
            setOnClickListener { diagnosticsPanel.visibility = View.GONE }
        }
        diagnosticsButton = Button(this).apply {
            setText(R.string.diagnostics_update)
            visibility = View.GONE
            setOnClickListener {
                visibility = View.GONE
                toast("Загружаю новую сборку приложения…")
                updater.applyApkUpdate()
            }
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(DIAGNOSTICS_BG)
            setPadding(28, 28, 28, 28)
            visibility = View.GONE
            addView(
                diagnosticsText,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ),
            )
            addView(
                diagnosticsButton,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ),
            )
        }
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
                record("${message.message()} @${message.lineNumber()}")
                return true
            }
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun onPageFinished(view: WebView, url: String) {
                // A check may have finished before the page was ready; replay the last
                // state so the update card shows what the shell already knows.
                val last = UpdateEvents.last
                if (last.isNotEmpty()) {
                    view.evaluateJavascript("window.__frontierUpdate && window.__frontierUpdate($last)", null)
                }
                view.postDelayed({ probe(view) }, PROBE_DELAY_MS)
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                // A missing subresource is noise; an empty main frame is the whole problem.
                if (request.isForMainFrame) {
                    showDiagnostics(
                        "Страница не открылась: ${error.errorCode} ${error.description}\n${request.url}",
                        offerUpdate = true,
                    )
                } else {
                    record("не отдано: ${request.url} (${error.errorCode} ${error.description})")
                }
            }

            override fun onReceivedHttpError(
                view: WebView,
                request: WebResourceRequest,
                response: WebResourceResponse,
            ) {
                record("HTTP ${response.statusCode}: ${request.url}")
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                showDiagnostics(
                    "Процесс отрисовки остановлен (авария=${detail.didCrash()}). Перезапускаю приложение.",
                    offerUpdate = true,
                )
                val now = System.currentTimeMillis()
                if (now - lastRendererRestart > RESTART_GUARD_MS) {
                    lastRendererRestart = now
                    recreate()
                }
                return true
            }

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
                // The loader is rebuilt here: until the page is served through the new
                // handlers, a reload would still show the game that came with the APK.
                assetLoader = buildAssetLoader().build()
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

    // --- diagnostics ---------------------------------------------------------

    /** Everything the page says lands here, so an empty screen can explain itself. */
    private fun record(line: String) {
        Log.d(TAG, line)
        synchronized(consoleTail) {
            consoleTail.addLast(line)
            while (consoleTail.size > CONSOLE_TAIL) consoleTail.removeFirst()
        }
    }

    /**
     * The game is one big script: if it never runs, the screen simply stays empty and a
     * player has no way to tell why. This panel puts the console output and the load
     * errors on top of that emptiness, so a phone without a cable can still speak.
     */
    private fun showDiagnostics(header: String, offerUpdate: Boolean = false) {
        val tail = synchronized(consoleTail) { consoleTail.toList() }
        val text = buildString {
            append(header)
            if (tail.isNotEmpty()) {
                append("\n\n")
                append(tail.joinToString("\n"))
            }
            append("\n\nНажмите на текст, чтобы скрыть.")
        }
        runOnUiThread {
            if (!::diagnosticsPanel.isInitialized) return@runOnUiThread
            diagnosticsText.text = text
            diagnosticsButton.visibility = if (offerUpdate) View.VISIBLE else View.GONE
            diagnosticsPanel.visibility = View.VISIBLE
            diagnosticsPanel.bringToFront()
        }
    }

    /** A page that loaded but stayed empty means the game bundle never ran. */
    private fun probe(view: WebView) {
        view.evaluateJavascript(PROBE_JS) { result ->
            val value = result?.trim('"').orEmpty()
            val bridge = value.substringAfter("bridge:", "?")
            when {
                value.startsWith("noroot") -> showDiagnostics(
                    "Страница открылась без #root — файлы игры повреждены (bridge: $bridge).",
                    offerUpdate = true,
                )
                value.startsWith("count:0") -> showDiagnostics(
                    "Игра не отрисовалась: #root пуст (bridge: $bridge).",
                    offerUpdate = true,
                )
                bridge != "object" ->
                    showDiagnostics("Мост оболочки недоступен (bridge: $bridge): обновления работать не будут.")
            }
        }
    }

    // --- behaviour -----------------------------------------------------------

    /**
     * Back belongs to the game: the page closes its topmost screen and only a second
     * press within two seconds leaves the app. On Android 12 and older this is the
     * entry point the system uses; from Android 13 the dispatcher below calls the
     * very same handler.
     */
    @Deprecated("Back is offered to the game first, then handled here.")
    override fun onBackPressed() {
        offerBackToGame()
    }

    /**
     * Android 13+ (API 33) hands back presses to the window dispatcher and never calls
     * onBackPressed() again, so the same handler has to be registered there. Below that
     * release the manifest flag is ignored and onBackPressed() keeps working.
     */
    private fun registerBackHandler() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val callback = OnBackInvokedCallback { offerBackToGame() }
        backCallback = callback
        window.onBackInvokedDispatcher.registerOnBackInvokedCallback(
            OnBackInvokedDispatcher.PRIORITY_DEFAULT,
            callback,
        )
    }

    private fun unregisterBackHandler() {
        val callback = backCallback ?: return
        backCallback = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            window.onBackInvokedDispatcher.unregisterOnBackInvokedCallback(callback)
        }
    }

    /**
     * The press goes to the page first: it answers `true` when it closed a screen of its
     * own. Only an unanswered press counts towards leaving the app.
     */
    private fun offerBackToGame() {
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

    /**
     * A silent check that found something: nudge the player towards the update card.
     * While the game cannot draw, the same events are worth saying out loud — a blank
     * screen has no card to read them from.
     */
    private fun announce(json: String) {
        val event = runCatching { JSONObject(json) }.getOrNull() ?: return
        val phase = event.optString("phase")
        val message = event.optString("message")
        if (diagnosticsPanelVisible() && phase in SPOKEN_PHASES) {
            if (message != lastNotice) {
                lastNotice = message
                toast(message)
            }
            return
        }
        if (!event.optBoolean("silent") || phase != "available") return
        val hint = "$message ЛЕНТА → ОБНОВЛЕНИЕ."
        if (hint == lastNotice) return
        lastNotice = hint
        toast(hint)
    }

    private fun diagnosticsPanelVisible(): Boolean =
        ::diagnosticsPanel.isInitialized && diagnosticsPanel.visibility == View.VISIBLE

    private fun toast(message: String) {
        runOnUiThread { Toast.makeText(this, message, Toast.LENGTH_LONG).show() }
    }

    private companion object {
        const val ASSET_ORIGIN = "https://appassets.androidplatform.net"
        const val GAME_BG = "#04070a"
        const val FLUSH_JS = "window.__frontierFlush && window.__frontierFlush()"
        const val BACK_JS = "window.__frontierBack ? window.__frontierBack() : false"
        const val TAG = "FrontierShell"
        const val CONSOLE_TAIL = 12
        const val PROBE_DELAY_MS = 1200L
        const val RESTART_GUARD_MS = 5000L
        val DIAGNOSTICS_BG = 0xE60A0F14.toInt()
        val DIAGNOSTICS_FG = 0xFF9BE8C4.toInt()

        /** Phases worth a toast while the game cannot draw its own card. */
        val SPOKEN_PHASES = setOf("error", "busy", "installing", "permission", "ready")

        /** Reports how many children `#root` ended up with and whether the bridge is alive. */
        const val PROBE_JS = "(function(){var r=document.getElementById('root');" +
            "var b=typeof window.FrontierAndroid;" +
            "if(!r)return 'noroot|bridge:'+b;" +
            "return 'count:'+r.childElementCount+'|bridge:'+b;})()"
    }
}
