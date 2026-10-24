output "project_id" {
  value = var.project_id
}

output "owner_uid" {
  value = var.owner_uid
}

output "api_key" {
  description = "Firebase Web API key used by the phone (identifies the project; not a secret)."
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

output "next_step" {
  value = "Chạy ở thư mục gốc repo:  npm run cloud:connect   (đọc output này, ghi ~/.vhub-trend/cloud.json, rồi kiểm tra kết nối)"
}
