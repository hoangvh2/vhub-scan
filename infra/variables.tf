variable "project_id" {
  description = "A Google Cloud project used only for VHub Trend Scan (create it first, see infra/README.md). Billing is not required: everything here fits the Firebase Spark (free) plan."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a valid Google Cloud project ID, e.g. vhub-trend-123456."
  }
}

variable "region" {
  description = "Default region for the providers. Nothing regional is created; Firestore uses firestore_location."
  type        = string
  default     = "asia-southeast1"
}

variable "firestore_location" {
  description = "Firestore location. Cannot be changed after the database exists. asia-southeast1 = Singapore, closest to Vietnam."
  type        = string
  default     = "asia-southeast1"
}

variable "owner_uid" {
  description = "Firebase Auth uid the phone signs in as (via a custom token minted by the PC). Must match the PC (cloud.json) and firebase/firestore.rules uses it only through the request path."
  type        = string
  default     = "owner"
  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{1,64}$", var.owner_uid))
    error_message = "owner_uid may contain letters, digits, '-' and '_' only (1-64 characters)."
  }
}

variable "create_pc_key" {
  description = "Create the PC's service-account key here so `npm run cloud:connect` can pick it up. The key is then also in terraform.tfstate on this PC (never commit it). Set false if your organisation forbids keys, then follow README section 'Không tạo được key'."
  type        = bool
  default     = true
}
