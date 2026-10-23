pluginManagement {
    repositories {
        google {
            content { includeGroupByRegex("com\\.android.*|com\\.google.*|androidx.*") }
        }
        mavenCentral()
        gradlePluginPortal()
    }
    plugins {
        id("org.jetbrains.kotlin.jvm") version "2.0.21"
        id("org.jetbrains.kotlin.android") version "2.0.21"
        id("org.jetbrains.kotlin.plugin.compose") version "2.0.21"
        id("com.android.application") version "8.7.3"
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
        google {
            content { includeGroupByRegex("com\\.android.*|com\\.google.*|androidx.*") }
        }
    }
}

rootProject.name = "vhub-scan"

include(":core")
// `-PcoreOnly` builds/tests only the pure-JVM module (no Android SDK needed).
if (!providers.gradleProperty("coreOnly").isPresent) include(":app")
