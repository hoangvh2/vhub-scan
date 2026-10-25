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
  description = "Name of the Firestore folder (owners/<owner_uid>) the PC writes to and the web and phone read from. Not a login. Must match cloud.json; leave the default unless you know why."
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

variable "allowed_emails" {
  description = "Google accounts allowed to sign in to the web dashboard and the Android app (and nobody else). Compared case-insensitively; the account must have a verified address. Goes into the Firestore rules; keep it in terraform.tfvars, which is not committed."
  type        = list(string)
  validation {
    condition     = length(var.allowed_emails) > 0 && alltrue([for e in var.allowed_emails : can(regex("^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)+$", e))])
    error_message = "allowed_emails needs at least one valid address, e.g. [\"you@gmail.com\"]."
  }
}

variable "android_sha1" {
  description = "Optional. SHA-1 fingerprint(s) of the certificate that signs the Android APK (the CI job summary prints it). Registers the app with Firebase so Google sign-in works on the phone."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for h in var.android_sha1 : can(regex("^([0-9A-Fa-f]{2}:?){19}[0-9A-Fa-f]{2}$", h))])
    error_message = "Each android_sha1 entry is a SHA-1 fingerprint like AB:CD:...:EF (20 bytes)."
  }
}

variable "web_client_id" {
  description = "Optional until step 7 of infra/README.md: the Client ID of the OAuth client \"Web client (auto created by Google Service)\", copied from Firebase console > Authentication > Google. Only echoed in outputs for the dashboard build and the APK build."
  type        = string
  default     = ""
  validation {
    condition     = var.web_client_id == "" || can(regex("^[0-9]+-[a-z0-9]+\\.apps\\.googleusercontent\\.com$", var.web_client_id))
    error_message = "web_client_id looks like 1234567890-abc123.apps.googleusercontent.com."
  }
}
