locals {
  apis = [
    "iam.googleapis.com",
    "firebase.googleapis.com",
    "firestore.googleapis.com",
    "firebaserules.googleapis.com",
    "identitytoolkit.googleapis.com", # Firebase Auth: Google sign-in from the web page and the phone
    "securetoken.googleapis.com",     # Firebase Auth: refresh tokens
    "apikeys.googleapis.com",
    "firebasehosting.googleapis.com", # the web dashboard (default site, created with the Firebase project)
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
