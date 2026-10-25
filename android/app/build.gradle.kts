import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application") version "8.13.0"
    kotlin("android") version "2.2.20"
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.20"
}

// Release signing comes only from the environment (CI secrets, or your own shell). Nothing is committed.
// CI without the secrets signs with a throwaway key generated in the job (see .github/workflows/android.yml).
fun env(name: String): String? = System.getenv(name)?.takeIf { it.isNotBlank() }

android {
    namespace = "com.vh.trend"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.vh.trend"
        minSdk = 26
        targetSdk = 36
        versionCode = (env("VERSION_CODE") ?: "1").toInt()
        versionName = env("VERSION_NAME") ?: "0.1.0-dev"
        // Identifiers of the Firebase project (GitHub repository variables; `terraform output android_env`). None is a secret.
        // Blank = a build without cloud: the sign-in screen says what to configure.
        fun quoted(v: String?) = "\"" + (v ?: "").replace("\\", "\\\\").replace("\"", "\\\"") + "\""
        buildConfigField("String", "FIREBASE_PROJECT_ID", quoted(env("FIREBASE_PROJECT_ID")))
        buildConfigField("String", "FIREBASE_API_KEY", quoted(env("FIREBASE_API_KEY")))
        buildConfigField("String", "FIREBASE_WEB_CLIENT_ID", quoted(env("FIREBASE_WEB_CLIENT_ID")))
        buildConfigField("String", "FIREBASE_OWNER_UID", quoted(env("FIREBASE_OWNER_UID") ?: "owner"))
    }

    signingConfigs {
        create("release") {
            env("SIGNING_STORE_FILE")?.let { storeFile = file(it) }
            storePassword = env("SIGNING_STORE_PASSWORD")
            keyAlias = env("SIGNING_KEY_ALIAS")
            keyPassword = env("SIGNING_KEY_PASSWORD")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Unsigned when no key is configured; CI always provides one.
            if (env("SIGNING_STORE_FILE") != null) signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all {
            it.systemProperty("roborazzi.test.record", "true")
        }
    }
    lint {
        abortOnError = true
        checkReleaseBuilds = true
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi", "ObsoleteLintCustomCheck")
    }
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

dependencies {
    implementation(project(":core"))

    val composeBom = platform("androidx.compose:compose-bom:2025.09.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.2")
    // Google sign-in: the system account picker (Credential Manager) hands back an ID token; Firebase Auth is called over REST.
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")

    testImplementation(composeBom)
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.16")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    testImplementation("io.github.takahirom.roborazzi:roborazzi:1.50.0")
    testImplementation("io.github.takahirom.roborazzi:roborazzi-compose:1.50.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
