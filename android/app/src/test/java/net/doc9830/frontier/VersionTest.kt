package net.doc9830.frontier

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The updater only ever compares versions, so this is where updates are won or lost. */
class VersionTest {
    @Test
    fun stripsTagPrefix() {
        assertEquals("1.2.3", Version.clean(" v1.2.3 "))
    }

    @Test
    fun comparesNumerically() {
        assertTrue(Version.compare("0.10.0", "0.9.9") > 0)
        assertTrue(Version.compare("1.0.0", "1.0.1") < 0)
        assertEquals(0, Version.compare("v1.2.3", "1.2.3"))
    }

    @Test
    fun treatsMissingPartsAsZero() {
        assertEquals(0, Version.compare("1.2", "1.2.0"))
        assertTrue(Version.isNewer("1.3", "1.2.9"))
    }

    @Test
    fun ignoresSuffixes() {
        assertEquals(0, Version.compare("1.2.3-beta+7", "1.2.3"))
        assertFalse(Version.isNewer("1.2.3-beta", "1.2.3"))
    }

    @Test
    fun anythingBeatsNothing() {
        assertTrue(Version.isNewer("0.0.1", ""))
        assertFalse(Version.isNewer("", "0.0.1"))
    }
}
