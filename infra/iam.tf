# The PC's identity: writes the snapshot, reads and clears the phone's inbox, and signs the custom
# tokens that pair a phone. Nothing else.
resource "google_service_account" "pc" {
  project      = var.project_id
  account_id   = "vhub-trend-pc"
  display_name = "VHub Trend Scan PC sync"

  depends_on = [google_project_service.api]
}

resource "google_project_iam_member" "pc_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.pc.email}"
}

resource "google_service_account_key" "pc" {
  count              = var.create_pc_key ? 1 : 0
  service_account_id = google_service_account.pc.name
}
