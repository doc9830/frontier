package net.doc9830.frontier

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The bundled game sits in `assets/www`, and a wrong mapping here shows up as a
 * blank screen on the phone, so both path shapes the loader can hand out are
 * pinned down.
 */
class WebAssetHandlerTest {
    @Test
    fun mapsEntryPoint() {
        assertEquals("www/index.html", bundledAssetPath("index.html"))
        assertEquals("www/index.html", bundledAssetPath("/index.html"))
    }

    @Test
    fun mapsDirectoryRequestsToTheEntryPoint() {
        assertEquals("www/index.html", bundledAssetPath(""))
        assertEquals("www/index.html", bundledAssetPath("/"))
    }

    @Test
    fun keepsHashedAssetsInPlace() {
        assertEquals("www/assets/index-abc123.js", bundledAssetPath("assets/index-abc123.js"))
        assertEquals("www/assets/index-abc123.js", bundledAssetPath("/assets/index-abc123.js"))
    }

    @Test
    fun toleratesAnAlreadyPrefixedPath() {
        assertEquals("www/index.html", bundledAssetPath("www/index.html"))
        assertEquals("www/icon.svg", bundledAssetPath("/www/icon.svg"))
    }

    @Test
    fun honoursACustomRoot() {
        assertEquals("game/version.json", bundledAssetPath("/version.json", root = "game"))
    }

    @Test
    fun marksTheBundleAsJavaScript() {
        // A module script without a JavaScript MIME type is refused outright, and the
        // screen stays empty — the WebView is strict exactly here.
        assertEquals("text/javascript" to "UTF-8", mimeTypeFor("assets/index-abc123.js"))
        assertEquals("text/javascript" to "UTF-8", mimeTypeFor("/assets/index-abc123.mjs"))
    }

    @Test
    fun marksTheEntryPointAndStylesAsText() {
        assertEquals("text/html" to "UTF-8", mimeTypeFor("index.html"))
        assertEquals("text/css" to "UTF-8", mimeTypeFor("assets/index-abc123.css"))
    }

    @Test
    fun knowsTheSmallFilesAroundTheGame() {
        assertEquals("application/json" to "UTF-8", mimeTypeFor("/version.json"))
        assertEquals("application/manifest+json" to "UTF-8", mimeTypeFor("manifest.webmanifest"))
        assertEquals("image/svg+xml" to "UTF-8", mimeTypeFor("icon.svg"))
    }

    @Test
    fun ignoresCaseAndQueries() {
        assertEquals("text/javascript" to "UTF-8", mimeTypeFor("assets/app.JS"))
        assertEquals("text/css" to "UTF-8", mimeTypeFor("assets/app.css?v=2"))
    }

    @Test
    fun servesBinaryWithoutACharset() {
        assertEquals("image/png" to null, mimeTypeFor("assets/ship.png"))
        assertEquals("font/woff2" to null, mimeTypeFor("assets/fonts/ui.woff2"))
    }

    @Test
    fun fallsBackToBytesInsteadOfGuessing() {
        assertEquals("application/octet-stream" to null, mimeTypeFor("assets/data.bin"))
        assertEquals("application/octet-stream" to null, mimeTypeFor("LICENSE"))
    }
}
