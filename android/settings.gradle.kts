/*
 * FRONTIER Android shell.
 *
 * The web game is the product; this module only wraps it in a WebView and adds
 * the in-app updater. Repositories default to the official ones; set
 * FRONTIER_MAVEN_MIRROR=aliyun to pull through the Aliyun mirrors instead
 * (much faster on some networks, identical artifacts).
 */
pluginManagement {
    val mirror = System.getenv("FRONTIER_MAVEN_MIRROR")?.lowercase()
    repositories {
        if (mirror == "aliyun") {
            maven("https://maven.aliyun.com/repository/gradle-plugin")
            maven("https://maven.aliyun.com/repository/google")
            maven("https://maven.aliyun.com/repository/public")
        }
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        val mirror = System.getenv("FRONTIER_MAVEN_MIRROR")?.lowercase()
        if (mirror == "aliyun") {
            maven("https://maven.aliyun.com/repository/google")
            maven("https://maven.aliyun.com/repository/public")
        }
        google()
        mavenCentral()
    }
}

rootProject.name = "Frontier"
include(":app")
