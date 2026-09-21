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
}
