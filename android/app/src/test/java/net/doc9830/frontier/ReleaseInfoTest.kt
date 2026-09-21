package net.doc9830.frontier

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The GitHub payload is the only input the updater trusts, so it is parsed defensively. */
class ReleaseInfoTest {
    private val payload = """
        {
          "tag_name": "v0.3.0",
          "name": "FRONTIER 0.3.0",
          "body": "Новые трассы и баланс.",
          "published_at": "2026-09-21T10:00:00Z",
          "assets": [
            {"name": "frontier-web.zip", "size": 240000, "browser_download_url": "https://example.com/frontier-web.zip"},
            {"name": "frontier-0.3.0.apk", "size": 2400000, "browser_download_url": "https://example.com/frontier-0.3.0.apk"}
          ]
        }
    """.trimIndent()

    @Test
    fun readsVersionAndAssets() {
        val release = ReleaseInfo.parse(payload)

        assertEquals("0.3.0", release.version)
        assertEquals("Новые трассы и баланс.", release.notes)
        assertEquals(2, release.assets.size)
        assertEquals("frontier-web.zip", release.webAsset?.name)
        assertEquals("frontier-0.3.0.apk", release.apkAsset?.name)
        assertTrue(release.installable)
    }

    @Test
    fun ignoresAssetEntriesWithoutUrl() {
        val release = ReleaseInfo.parse(
            """{"tag_name":"v1.0.0","assets":[{"name":"broken-apk.apk","size":10}]}""",
        )

        assertNull(release.apkAsset)
        assertFalse(release.installable)
    }

    @Test
    fun reportsApiErrors() {
        try {
            ReleaseInfo.parse("""{"message":"Not Found"}""")
            throw AssertionError("ответ без релиза должен приводить к ошибке")
        } catch (expected: IllegalStateException) {
            assertEquals("Not Found", expected.message)
        }
    }

    @Test
    fun toleratesMissingFields() {
        val release = ReleaseInfo.parse("""{"tag_name":"v2.0.0"}""")

        assertEquals("2.0.0", release.version)
        assertEquals(0, release.assets.size)
        assertEquals("", release.notes)
    }
}
