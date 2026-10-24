locals {
  apis = [
    "iam.googleapis.com",
    "firebase.googleapis.com",
    "firestore.googleapis.com",
    "firebaserules.googleapis.com",
    "identitytoolkit.googleapis.com", # Firebase Auth: the phone signs in with a custom token
    "securetoken.googleapis.com",     # Firebase Auth: refresh tokens
    "apikeys.googleapis.com",
  ]
}

resource "google_project_service" "bootstrap" {
  provider = google.bootstrap
  for_each = toset(["serviceusage.googleapis.com", "cloudresourcemanager.googleapis.com"])

  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
}

resource "google_project_service" "api" {
  for_each = toset(local.apis)

  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
  depends_on         = [google_project_service.bootstrap]
}
