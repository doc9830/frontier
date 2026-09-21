package net.doc9830.frontier

/**
 * Version maths for the two update channels. Tags arrive as `v1.2.3`, the web
 * bundle reports `1.2.3`, and only the numeric parts decide what is newer.
 */
object Version {
    /** `v1.2.3` → `1.2.3`; anything unparsable collapses to empty. */
    fun clean(raw: String): String = raw.trim().removePrefix("v").trim()

    /** Compared part by part in numbers, so 0.10.0 beats 0.9.9. */
    fun compare(left: String, right: String): Int {
        val a = parts(left)
        val b = parts(right)
        for (index in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(index) { 0 }
            val y = b.getOrElse(index) { 0 }
            if (x != y) return if (x > y) 1 else -1
        }
        return 0
    }

    /** True when `candidate` is strictly newer than `installed`. */
    fun isNewer(candidate: String, installed: String): Boolean =
        compare(clean(candidate), clean(installed)) > 0

    /** `1.2.3-beta+4` → [1, 2, 3]: a suffix never outranks a release by accident. */
    private fun parts(raw: String): List<Int> {
        val core = clean(raw).substringBefore('-').substringBefore('+')
        if (core.isEmpty()) return listOf(0)
        return core.split('.').map { chunk -> chunk.takeWhile { it.isDigit() }.toIntOrNull() ?: 0 }
    }
}
