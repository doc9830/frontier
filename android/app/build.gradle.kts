import groovy.json.JsonSlurper
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/*
 * version.json in the repository root is the single source of truth: the APK and
 * the downloadable web bundle always carry the same version, so the updater only
 * has to compare two numbers.
 */
val versionInfo = JsonSlurper().parse(rootProject.file("../version.json")) as Map<*, *>
val appVersionName = versionInfo["version"] as String
val appVersionCode = (versionInfo["versionCode"] as Number).toInt()

// The release keystore has to stay stable forever: Android refuses to update an
// installed app with a differently signed APK, and this app updates itself.
val keystoreProps = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "net.doc9830.frontier"
    compileSdk = 36

    defaultConfig {
        applicationId = "net.doc9830.frontier"
        minSdk = 26
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersionName

        // Kept in the manifest so the updater can name the repository without a rebuild.
        buildConfigField("String", "REPO", "\"${versionInfo["repo"] ?: "doc9830/frontier"}\"")
        buildConfigField("String", "WEB_VERSION", "\"$appVersionName\"")
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (keystoreProps.getProperty("storeFile") != null) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += setOf("META-INF/*.version", "META-INF/*.kotlin_module")
    }

    // The built web game is copied into the APK as assets: the app works offline
    // from the very first launch, and updates arrive as downloadable bundles.
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("web-assets"))

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

/**
 * Packs `<repo>/dist` (or a freshly built one) into the APK assets.
 * `npm run build` owns producing dist; Gradle only copies it.
 */
val copyWebApp by tasks.registering(Copy::class) {
    val distDir = rootProject.file("../dist")
    onlyIf { distDir.isDirectory }
    from(distDir)
    into(layout.buildDirectory.dir("web-assets/www"))
}

tasks.named("preBuild") {
    dependsOn(copyWebApp)
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.webkit:webkit:1.12.1")

    testImplementation("junit:junit:4.13.2")
    // Real org.json on the unit-test classpath instead of the Android stub.
    testImplementation("org.json:json:20240303")
}
