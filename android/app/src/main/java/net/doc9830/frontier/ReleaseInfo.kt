package net.doc9830.frontier

import org.json.JSONObject

/** One downloadable file attached to a GitHub release. */
data class ReleaseAsset(val name: String, val url: String, val size: Long)

/**
 * The slice of `GET /repos/:owner/:repo/releases/latest` the updater cares about.
 * The web bundle and the APK travel as release assets, so publishing a release
 * is the only thing needed to ship an update.
 */
data class ReleaseInfo(
    val tag: String,
    val title: String,
    val notes: String,
    val publishedAt: String,
    val assets: List<ReleaseAsset>,
) {
    /** `v0.2.0` → `0.2.0`, the form stored in version.json and the APK manifest. */
    val version: String get() = Version.clean(tag)

    val webAsset: ReleaseAsset? get() = assets.firstOrNull { it.name == WEB_ASSET }
    val apkAsset: ReleaseAsset? get() = assets.firstOrNull { it.name.endsWith(".apk") }

    /** Empty when the release carries nothing the shell can install. */
    val installable: Boolean get() = webAsset != null || apkAsset != null

    companion object {
        const val WEB_ASSET = "frontier-web.zip"

        fun parse(json: String): ReleaseInfo {
            val root = JSONObject(json)
            if (!root.has("tag_name")) {
                val message = root.optString("message")
                throw IllegalStateException(message.ifEmpty { "неизвестный ответ GitHub" })
            }
            val assets = ArrayList<ReleaseAsset>()
            val array = root.optJSONArray("assets")
            if (array != null) {
                for (index in 0 until array.length()) {
                    val item = array.optJSONObject(index) ?: continue
                    val name = item.optString("name")
                    val url = item.optString("browser_download_url")
                    if (name.isEmpty() || url.isEmpty()) continue
                    assets.add(ReleaseAsset(name, url, item.optLong("size")))
                }
            }
            return ReleaseInfo(
                tag = root.optString("tag_name"),
                title = root.optString("name"),
                notes = root.optString("body").take(600),
                publishedAt = root.optString("published_at"),
                assets = assets,
            )
        }
    }
}
