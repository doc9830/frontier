package net.doc9830.frontier

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException

/**
 * A web bundle is a zip of the built game: unpacking, the version check and the
 * folder swap are the three places where a bad release could brick the app, so
 * they are covered without an emulator.
 */
class WebBundleTest {
    @get:Rule
    val folder = TemporaryFolder()

    @Test
    fun unpacksBundleAndReadsVersion() {
        val zip = fixture("1.4.0")
        val target = File(folder.root, "www.pending")

        val entries = WebBundle.unpack(zip, target)

        assertEquals(3, entries)
        assertTrue(File(target, "index.html").isFile)
        assertTrue(File(target, "assets/index-abc.js").isFile)
        assertEquals("1.4.0", WebBundle.readVersion(target))
    }

    @Test
    fun rejectsArchiveWithoutEntryPoint() {
        val zip = zipOf(
            "assets/index-abc.js" to "console.log('hi')",
            "version.json" to """{"version":"1.4.0"}""",
        )
        try {
            WebBundle.unpack(zip, File(folder.root, "bad"))
            throw AssertionError("архив без index.html должен быть отклонён")
        } catch (expected: IOException) {
            assertTrue(expected.message!!.contains("index.html"))
        }
    }

    @Test
    fun rejectsPathsOutsideTheBundle() {
        val zip = zipOf("../escape.txt" to "nope", "index.html" to "<html></html>")
        try {
            WebBundle.unpack(zip, File(folder.root, "trav"))
            throw AssertionError("выход за пределы папки должен быть отклонён")
        } catch (expected: IOException) {
            assertTrue(expected.message!!.contains("подозрительный путь"))
        }
        assertFalse(File(folder.root, "escape.txt").exists())
    }

    @Test
    fun activateSwapsTheInstalledBundle() {
        val live = File(folder.root, "www").apply { mkdirs() }
        File(live, "index.html").writeText("старая игра")
        File(live, "version.json").writeText("""{"version":"1.0.0"}""")
        val pending = File(folder.root, "www.pending").apply { mkdirs() }
        File(pending, "index.html").writeText("новая игра")
        File(pending, "version.json").writeText("""{"version":"1.1.0"}""")

        assertTrue(WebBundle.activate(live, pending, File(folder.root, "www.old")))

        assertEquals("новая игра", File(live, "index.html").readText())
        assertEquals("1.1.0", WebBundle.readVersion(live))
        assertFalse(pending.exists())
        assertFalse(File(folder.root, "www.old").exists())
    }

    @Test
    fun activateRefusesIncompleteBundle() {
        val live = File(folder.root, "www").apply { mkdirs() }
        File(live, "index.html").writeText("игра")
        val pending = File(folder.root, "www.pending").apply { mkdirs() }
        File(pending, "version.json").writeText("""{"version":"9.9.9"}""")

        assertFalse(WebBundle.activate(live, pending, File(folder.root, "www.old")))
        assertEquals("игра", File(live, "index.html").readText())
    }

    @Test
    fun readVersionIgnoresUnrelatedFolders() {
        assertNull(WebBundle.readVersion(File(folder.root, "missing")))
    }

    /** A real bundle, written by scripts/lib/zip.mjs, is exercised end to end. */
    private fun fixture(version: String): File {
        val zip = zipOf(
            "index.html" to "<html></html>",
            "assets/index-abc.js" to "console.log('frontier')",
            "version.json" to """{"version":"$version","versionCode":9}""",
        )
        return zip
    }

    private fun zipOf(vararg entries: Pair<String, String>): File {
        val zip = File(folder.root, "bundle-${entries.size}-${System.nanoTime()}.zip")
        val zipWriter = java.util.zip.ZipOutputStream(zip.outputStream())
        zipWriter.use { out ->
            entries.forEach { (name, body) ->
                out.putNextEntry(java.util.zip.ZipEntry(name))
                out.write(body.toByteArray())
                out.closeEntry()
            }
        }
        return zip
    }
}
