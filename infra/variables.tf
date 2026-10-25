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

# ---------------------------------------------------------------- cloud scan with Gemini (scan.tf, optional)
variable "cloud_scan" {
  description = "Turn on the \"Quét bằng Gemini\" button on the web and the phone. Needs the Blaze plan on this project and a Gemini API key (gemini_api_key). Run `npm run cloud:function` before `terraform apply`, and `npm run cloud:connect` after it."
  type        = bool
  default     = false
}

variable "gemini_api_key" {
  description = "Gemini API key from Google AI Studio (project with billing, prepaid). Stored in Secret Manager through a write-only argument: never in terraform.tfstate or a plan. Needed on the apply that creates or rotates it (bump gemini_api_key_version to rotate)."
  type        = string
  default     = ""
  sensitive   = true
  ephemeral   = true
}

variable "gemini_api_key_version" {
  description = "Increase by 1 to store a new gemini_api_key (Terraform cannot see the write-only value, so it uses this number to know it changed)."
  type        = number
  default     = 1
}

variable "gemini_model" {
  description = "Model the cloud scan uses for both AI steps. gemini-3.5-flash-lite: cheapest stable model without a shutdown date (2026-10-25)."
  type        = string
  default     = "gemini-3.5-flash-lite"
  validation {
    condition     = can(regex("^gemini-[a-z0-9.-]{1,60}$", var.gemini_model))
    error_message = "gemini_model is a Gemini model id, e.g. gemini-3.5-flash-lite."
  }
}

variable "cloud_scans_per_day" {
  description = "How many cloud scans may be started per day (Vietnam time). Enforced by the Firestore rules, so it holds even if the app is bypassed. 0 = button switched off (kill switch), keeping everything else."
  type        = number
  default     = 2
  validation {
    condition     = var.cloud_scans_per_day >= 0 && var.cloud_scans_per_day <= 5 && floor(var.cloud_scans_per_day) == var.cloud_scans_per_day
    error_message = "cloud_scans_per_day is a whole number from 0 to 5."
  }
}

variable "cloud_github_token" {
  description = "Also give the cloud scan a GitHub token (github_token), for GitHub's higher rate limit. Without one, searches from Google's shared addresses can hit GitHub's anonymous limit."
  type        = bool
  default     = false
}

variable "github_token" {
  description = "GitHub fine-grained token with public read access only (no repositories, no permissions). Write-only, like gemini_api_key."
  type        = string
  default     = ""
  sensitive   = true
  ephemeral   = true
}

variable "github_token_version" {
  description = "Increase by 1 to store a new github_token."
  type        = number
  default     = 1
}
