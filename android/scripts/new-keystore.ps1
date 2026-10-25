# Creates the release signing key for the Android app, outside the repo, and (optionally) uploads it
# to the GitHub repository secrets that .github/workflows/android.yml reads.
#   powershell -ExecutionPolicy Bypass -File android\scripts\new-keystore.ps1
#   powershell -ExecutionPolicy Bypass -File android\scripts\new-keystore.ps1 -Upload
param([switch]$Upload)
$ErrorActionPreference = 'Stop'

$dir = if ($env:VHUB_TREND_HOME) { $env:VHUB_TREND_HOME } else { Join-Path $HOME '.vhub-trend' }
$ks = Join-Path $dir 'android-release.jks'
$alias = 'vhubtrend'
$repo = if ($env:GITHUB_REPOSITORY) { $env:GITHUB_REPOSITORY } else { 'hoangvh2/vhub-scan' }

if (-not (Get-Command keytool -ErrorAction SilentlyContinue)) { throw 'Thiếu keytool: cài JDK 17 (vd. Temurin 17) rồi chạy lại.' }
New-Item -ItemType Directory -Force -Path $dir | Out-Null

if (Test-Path $ks) {
  Write-Host "Đã có khóa tại $ks — không tạo đè (mất khóa cũ = không cập nhật được app đã cài)."
  if (-not $Upload) { exit 1 }
  $passFile = Join-Path $dir 'android-release.password'
  if (Test-Path $passFile) {
    $pass = (Get-Content -Raw $passFile).Trim()
    Write-Host "Dùng lại mật khẩu đã lưu ở $passFile"
  } else {
    $sec = Read-Host 'Mật khẩu keystore hiện có' -AsSecureString
    $pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  }
} else {
  $chars = [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $pass = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
  & keytool -genkeypair -keystore $ks -storetype PKCS12 -storepass $pass -keypass $pass `
    -alias $alias -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=VHub Trend, O=VH' -noprompt
  if ($LASTEXITCODE -ne 0) { throw 'keytool lỗi.' }
  Set-Content -NoNewline -Path (Join-Path $dir 'android-release.password') -Value $pass
  Write-Host "Đã tạo khóa: $ks"
  Write-Host "Mật khẩu lưu ở: $(Join-Path $dir 'android-release.password')"
}

$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($ks))

if ($Upload) {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "Thiếu GitHub CLI (gh). Cài từ https://cli.github.com rồi 'gh auth login'." }
  # Native commands do not stop the script on failure, so every call is checked.
  & gh auth status *> $null
  if ($LASTEXITCODE -ne 0) { throw "gh chưa đăng nhập. Chạy 'gh auth login' rồi chạy lại script." }
  $secrets = [ordered]@{
    ANDROID_KEYSTORE_BASE64   = $b64
    ANDROID_KEYSTORE_PASSWORD = $pass
    ANDROID_KEY_ALIAS         = $alias
    ANDROID_KEY_PASSWORD      = $pass
  }
  foreach ($name in $secrets.Keys) {
    & gh secret set $name --repo $repo --body $secrets[$name]
    if ($LASTEXITCODE -ne 0) { throw "Không đặt được secret $name cho $repo (gh báo lỗi ở trên). Kiểm tra quyền ghi secrets của tài khoản gh." }
  }
  $have = (& gh secret list --repo $repo) -join "`n"
  $missing = $secrets.Keys | Where-Object { $have -notmatch "(?m)^$_\s" }
  if ($missing) { throw "Đã đặt nhưng chưa thấy trong 'gh secret list': $($missing -join ', ')" }
  Write-Host "Đã đặt và kiểm tra đủ 4 secret trên $repo. Lần chạy workflow Android kế tiếp sẽ ký bằng khóa thật."
} else {
  $b64file = Join-Path $dir 'android-release.b64'
  Set-Content -NoNewline -Path $b64file -Value $b64
  Write-Host ''
  Write-Host 'Chưa upload. Thêm 4 secret ở GitHub → Settings → Secrets and variables → Actions:'
  Write-Host "  ANDROID_KEYSTORE_BASE64   = nội dung file $b64file"
  Write-Host "  ANDROID_KEYSTORE_PASSWORD = nội dung file $(Join-Path $dir 'android-release.password')"
  Write-Host "  ANDROID_KEY_ALIAS         = $alias"
  Write-Host '  ANDROID_KEY_PASSWORD      = giống ANDROID_KEYSTORE_PASSWORD'
}
Write-Host ''
Write-Host "QUAN TRỌNG: sao lưu $ks và mật khẩu vào nơi an toàn. Không commit vào repo."
