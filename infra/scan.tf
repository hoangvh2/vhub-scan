# ---------------------------------------------------------------- cloud scan with Gemini (optional)
# The "Quét bằng Gemini" button on the web and the phone. Off unless var.cloud_scan = true, which needs the Blaze
# (pay-as-you-go) plan: Cloud Functions, Cloud Build and Cloud Storage do not exist on Spark. At one person's use it
# stays inside the free tiers; the Gemini API is billed separately (see docs/SYNC.md, "Quét trên cloud").
#
#   web/phone ──create──▶ Firestore owners/{uid}/runRequests/{day}-{n}   (rules: n <= cloud_scans_per_day, today only)
#                              │ Eventarc "document created"
#                              ▼
#                      Cloud Function "vhub-trend-scan"  ──▶ Gemini API (key from Secret Manager)
#                              │ reads/writes trend.sqlite + config.json
#                              ▼
#                      bucket <project>-vhub-trend-data  ◀── the PC shares its database here on every sync
locals {
  scan        = var.cloud_scan
  scan_region = var.firestore_location # Firestore triggers fire in the database's region
  scans_today = local.scan ? var.cloud_scans_per_day : 0
  scan_apis = local.scan ? [
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "run.googleapis.com",
    "eventarc.googleapis.com",
    "artifactregistry.googleapis.com",
    "pubsub.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
  ] : []
}

resource "google_project_service" "scan" {
  for_each = toset(local.scan_apis)

  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
  depends_on         = [google_project_service.bootstrap]
}

# One copy of the database and the PC's config. Private: only the PC and the function's service accounts can read it.
resource "google_storage_bucket" "data" {
  count = local.scan ? 1 : 0

  project                     = var.project_id
  name                        = "${var.project_id}-vhub-trend-data"
  location                    = local.scan_region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  # The PC can always upload its database again; deleted copies need not be kept (they would be billed).
  soft_delete_policy {
    retention_duration_seconds = 0
  }

  # Old function source archives (functions/) are only needed while deploying.
  lifecycle_rule {
    condition {
      age            = 30
      matches_prefix = ["functions/"]
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.scan]
}

resource "google_storage_bucket_iam_member" "pc_data" {
  count  = local.scan ? 1 : 0
  bucket = google_storage_bucket.data[0].name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.pc.email}"
}

# ---- secrets: written with write-only arguments, so the key is never stored in terraform.tfstate or a plan file
resource "google_secret_manager_secret" "gemini" {
  count     = local.scan ? 1 : 0
  project   = var.project_id
  secret_id = "vhub-trend-gemini-api-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.scan]
}

resource "google_secret_manager_secret_version" "gemini" {
  count                  = local.scan ? 1 : 0
  secret                 = google_secret_manager_secret.gemini[0].id
  secret_data_wo         = var.gemini_api_key
  secret_data_wo_version = var.gemini_api_key_version
}

resource "google_secret_manager_secret" "github" {
  count     = local.scan && var.cloud_github_token ? 1 : 0
  project   = var.project_id
  secret_id = "vhub-trend-github-token"

  replication {
    auto {}
  }

  depends_on = [google_project_service.scan]
}

resource "google_secret_manager_secret_version" "github" {
  count                  = local.scan && var.cloud_github_token ? 1 : 0
  secret                 = google_secret_manager_secret.github[0].id
  secret_data_wo         = var.github_token
  secret_data_wo_version = var.github_token_version
}

# ---- identities
resource "google_service_account" "scan" {
  count        = local.scan ? 1 : 0
  project      = var.project_id
  account_id   = "vhub-trend-scan"
  display_name = "VHub Trend Scan cloud scan (Gemini)"

  depends_on = [google_project_service.api]
}

# Firestore (requests, inbox, snapshot), receiving the trigger's events, being invoked by them.
resource "google_project_iam_member" "scan" {
  for_each = toset(local.scan ? ["roles/datastore.user", "roles/eventarc.eventReceiver", "roles/run.invoker"] : [])
  project  = var.project_id
  role     = each.key
  member   = "serviceAccount:${google_service_account.scan[0].email}"
}

resource "google_storage_bucket_iam_member" "scan_data" {
  count  = local.scan ? 1 : 0
  bucket = google_storage_bucket.data[0].name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.scan[0].email}"
}

resource "google_secret_manager_secret_iam_member" "scan_gemini" {
  count     = local.scan ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.gemini[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.scan[0].email}"
}

resource "google_secret_manager_secret_iam_member" "scan_github" {
  count     = local.scan && var.cloud_github_token ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.github[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.scan[0].email}"
}

# Builds the function's container; its own account so no broad default account is needed.
resource "google_service_account" "build" {
  count        = local.scan ? 1 : 0
  project      = var.project_id
  account_id   = "vhub-trend-build"
  display_name = "VHub Trend Scan function build"

  depends_on = [google_project_service.api]
}

resource "google_project_iam_member" "build" {
  count   = local.scan ? 1 : 0
  project = var.project_id
  role    = "roles/cloudbuild.builds.builder"
  member  = "serviceAccount:${google_service_account.build[0].email}"
}

# ---- the function. Its source is built by `npm run cloud:function` (infra/build/scan-function, not committed).
data "archive_file" "scan" {
  count       = local.scan ? 1 : 0
  type        = "zip"
  source_dir  = "${path.module}/build/scan-function"
  output_path = "${path.module}/build/scan-function.zip"
  excludes    = ["node_modules"]
}

resource "google_storage_bucket_object" "scan_source" {
  count  = local.scan ? 1 : 0
  bucket = google_storage_bucket.data[0].name
  name   = "functions/scan-${data.archive_file.scan[0].output_md5}.zip"
  source = data.archive_file.scan[0].output_path
}

resource "google_cloudfunctions2_function" "scan" {
  count    = local.scan ? 1 : 0
  project  = var.project_id
  name     = "vhub-trend-scan"
  location = local.scan_region

  build_config {
    runtime         = "nodejs22"
    entry_point     = "scan"
    service_account = google_service_account.build[0].id
    source {
      storage_source {
        bucket = google_storage_bucket.data[0].name
        object = google_storage_bucket_object.scan_source[0].name
      }
    }
  }

  service_config {
    # One scan at a time: a second event waits or is dropped, it never runs alongside.
    max_instance_count               = 1
    min_instance_count               = 0
    max_instance_request_concurrency = 1
    available_memory                 = "512Mi"
    timeout_seconds                  = 540
    ingress_settings                 = "ALLOW_INTERNAL_ONLY"
    all_traffic_on_latest_revision   = true
    service_account_email            = google_service_account.scan[0].email

    environment_variables = {
      PROJECT_ID      = var.project_id
      OWNER_UID       = var.owner_uid
      DATA_BUCKET     = google_storage_bucket.data[0].name
      GEMINI_MODEL    = var.gemini_model
      GEMINI_THINKING = "minimal"
      SCANS_PER_DAY   = tostring(local.scans_today)
    }

    secret_environment_variables {
      key        = "GEMINI_API_KEY"
      project_id = var.project_id
      secret     = google_secret_manager_secret.gemini[0].secret_id
      version    = "latest"
    }

    dynamic "secret_environment_variables" {
      for_each = var.cloud_github_token ? [1] : []
      content {
        key        = "GITHUB_TOKEN"
        project_id = var.project_id
        secret     = google_secret_manager_secret.github[0].secret_id
        version    = "latest"
      }
    }
  }

  event_trigger {
    trigger_region        = local.scan_region
    event_type            = "google.cloud.firestore.document.v1.created"
    retry_policy          = "RETRY_POLICY_DO_NOT_RETRY" # a failed scan reports on its request; it is never re-run by itself
    service_account_email = google_service_account.scan[0].email

    event_filters {
      attribute = "database"
      value     = "(default)"
    }
    event_filters {
      attribute = "document"
      value     = "owners/${var.owner_uid}/runRequests/{request}"
      operator  = "match-path-pattern"
    }
  }

  depends_on = [
    google_project_iam_member.scan,
    google_project_iam_member.build,
    google_secret_manager_secret_version.gemini,
    google_secret_manager_secret_iam_member.scan_gemini,
    google_secret_manager_secret_iam_member.scan_github,
    google_storage_bucket_iam_member.scan_data,
  ]
}
