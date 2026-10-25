output "project_id" {
  value = var.project_id
}

output "owner_uid" {
  value = var.owner_uid
}

output "api_key" {
  description = "Firebase Web API key used by the web page and the phone (identifies the project; not a secret)."
  value       = google_apikeys_key.phone.key_string
  sensitive   = true
}

output "pc_service_account" {
  value = google_service_account.pc.email
}

output "pc_key_json" {
  description = "Service-account key for the PC, base64 JSON. Read by `npm run cloud:connect`; do not print or share it."
  value       = var.create_pc_key ? google_service_account_key.pc[0].private_key : null
  sensitive   = true
}

output "web_client_id" {
  description = "Google sign-in Client ID (var.web_client_id), used by the dashboard build and the APK build."
  value       = var.web_client_id
}

output "android_env" {
  description = "Settings to put in GitHub > Settings > Secrets and variables > Actions > Variables so the APK can sign in (identifiers, not secrets)."
  value = {
    FIREBASE_PROJECT_ID    = var.project_id
    FIREBASE_API_KEY       = google_apikeys_key.phone.key_string
    FIREBASE_WEB_CLIENT_ID = var.web_client_id
    FIREBASE_OWNER_UID     = var.owner_uid
  }
  sensitive = true
}

output "next_step" {
  value = "Chạy ở thư mục gốc repo:  npm run cloud:connect   (đọc output này, ghi ~/.vhub-trend/cloud.json, rồi kiểm tra kết nối)"
}
