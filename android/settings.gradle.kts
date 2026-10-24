// The Android module needs an Android SDK and Google's Maven. Pure-JVM work (`:core`: models, sync, offline queue)
// builds and tests anywhere, including machines that have neither (Google's Maven is not even contacted then).
pluginManagement {
    val sdk = System.getenv("ANDROID_HOME") != null || System.getenv("ANDROID_SDK_ROOT") != null || file("local.properties").exists()
    repositories {
        if (sdk) {
            google {
                content {
                    includeGroupByRegex("com\\.android.*")
                    includeGroupByRegex("com\\.google.*")
                    includeGroupByRegex("androidx.*")
                }
            }
        }
        // Same content as mavenCentral(); this host is more reliable behind some proxies.
        maven("https://repo1.maven.org/maven2")
    }
}

val hasAndroidSdk = System.getenv("ANDROID_HOME") != null ||
    System.getenv("ANDROID_SDK_ROOT") != null ||
    file("local.properties").exists()

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        if (hasAndroidSdk) {
            google {
                content {
                    includeGroupByRegex("com\\.android.*")
                    includeGroupByRegex("com\\.google.*")
                    includeGroupByRegex("androidx.*")
                }
            }
        }
        maven("https://repo1.maven.org/maven2")
    }
}

rootProject.name = "VHubTrend"

include(":core")
if (hasAndroidSdk) include(":app")
