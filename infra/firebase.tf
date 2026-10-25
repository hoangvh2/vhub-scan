resource "google_firebase_project" "this" {
  provider = google-beta
  project  = var.project_id

  depends_on = [google_project_service.api]
}

# Only the (default) database gets the free daily quota (50k reads, 20k writes, 1 GiB).
resource "google_firestore_database" "default" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"

  # The data is a copy of what the PC holds, so recovery = run `npm run sync` again; PITR is not needed.
  point_in_time_recovery_enablement = "POINT_IN_TIME_RECOVERY_DISABLED"
  delete_protection_state           = "DELETE_PROTECTION_ENABLED"
  deletion_policy                   = "ABORT"

  depends_on = [google_firebase_project.this]
}

# The same template the emulator tests run against (tests/rules), with the allowlist filled in. Changing
# allowed_emails and applying again is how people are added or removed.
resource "google_firebaserules_ruleset" "firestore" {
  project = var.project_id

  source {
    files {
      name    = "firestore.rules"
      content = replace(file("${path.module}/../firebase/firestore.rules.tmpl"), "__ALLOWED_EMAILS__", join(", ", [for e in var.allowed_emails : "'${lower(e)}'"]))
    }
  }

  depends_on = [google_firestore_database.default]

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_firebaserules_release" "firestore" {
  project      = var.project_id
  name         = "cloud.firestore"
  ruleset_name = google_firebaserules_ruleset.firestore.name
}

# Identifies the project to Firebase Auth and Firestore (not a secret; access is decided by the rules and Google sign-in).
# Restricted to the three APIs the web page and the phone call.
resource "google_apikeys_key" "phone" {
  project      = var.project_id
  name         = "vhub-trend-phone"
  display_name = "VHub Trend phone app"

  restrictions {
    api_targets {
      service = "identitytoolkit.googleapis.com"
    }
    api_targets {
      service = "securetoken.googleapis.com"
    }
    api_targets {
      service = "firestore.googleapis.com"
    }
  }

  depends_on = [google_project_service.api]
}

# ---------------------------------------------------------------- the Android app (optional)
# Registering the app with its signing certificate's SHA-1 creates the Android OAuth client that
# Google sign-in on the phone needs. The package name is fixed in android/app/build.gradle.kts.
resource "google_firebase_android_app" "android" {
  count           = length(var.android_sha1) > 0 ? 1 : 0
  provider        = google-beta
  project         = var.project_id
  display_name    = "VHub Trend Android"
  package_name    = "com.vh.trend"
  sha1_hashes     = [for h in var.android_sha1 : lower(replace(h, ":", ""))]
  deletion_policy = "DELETE"

  depends_on = [google_firebase_project.this]
}
