#!/usr/bin/env bash
# Creates the release signing key for the Android app, outside the repo, and (optionally) uploads it
# to the GitHub repository secrets that .github/workflows/android.yml reads.
#   bash android/scripts/new-keystore.sh            # create key, print the secret values
#   bash android/scripts/new-keystore.sh --upload   # create key and set the 4 secrets with `gh`
set -euo pipefail

dir="${VHUB_TREND_HOME:-$HOME/.vhub-trend}"
ks="$dir/android-release.jks"
alias_name="vhubtrend"
repo="${GITHUB_REPOSITORY:-hoangvh2/vhub-scan}"

command -v keytool >/dev/null || { echo "Thiếu keytool: cài JDK 17 (vd. Temurin 17) rồi chạy lại." >&2; exit 1; }
mkdir -p "$dir"

if [ -e "$ks" ]; then
  echo "Đã có khóa tại $ks — không tạo đè (mất khóa cũ = không cập nhật được app đã cài)." >&2
  echo "Muốn dùng lại khóa này cho CI: chạy với --upload và nhập đúng mật khẩu cũ." >&2
  [ "${1:-}" = "--upload" ] || exit 1
  read -r -s -p "Mật khẩu keystore hiện có: " pass; echo
else
  pass="$(od -An -tx1 -N24 /dev/urandom | tr -d ' \n')"
  keytool -genkeypair -keystore "$ks" -storetype PKCS12 -storepass "$pass" -keypass "$pass" \
    -alias "$alias_name" -keyalg RSA -keysize 4096 -validity 10000 \
    -dname "CN=VHub Trend, O=VH" -noprompt
  chmod 600 "$ks"
  printf '%s' "$pass" > "$dir/android-release.password"
  chmod 600 "$dir/android-release.password"
  echo "Đã tạo khóa: $ks"
  echo "Mật khẩu lưu ở: $dir/android-release.password"
fi

b64="$(base64 < "$ks" | tr -d '\n')"

if [ "${1:-}" = "--upload" ]; then
  command -v gh >/dev/null || { echo "Thiếu GitHub CLI (gh). Cài từ https://cli.github.com rồi 'gh auth login'." >&2; exit 1; }
  printf '%s' "$b64"        | gh secret set ANDROID_KEYSTORE_BASE64  --repo "$repo"
  printf '%s' "$pass"       | gh secret set ANDROID_KEYSTORE_PASSWORD --repo "$repo"
  printf '%s' "$alias_name" | gh secret set ANDROID_KEY_ALIAS        --repo "$repo"
  printf '%s' "$pass"       | gh secret set ANDROID_KEY_PASSWORD     --repo "$repo"
  echo "Đã đặt 4 secret cho $repo. Lần chạy workflow Android kế tiếp sẽ ký bằng khóa thật."
else
  echo
  echo "Chưa upload. Thêm 4 secret ở GitHub → Settings → Secrets and variables → Actions:"
  echo "  ANDROID_KEYSTORE_BASE64   = nội dung file $dir/android-release.b64 (vừa ghi ra)"
  echo "  ANDROID_KEYSTORE_PASSWORD = nội dung file $dir/android-release.password"
  echo "  ANDROID_KEY_ALIAS         = $alias_name"
  echo "  ANDROID_KEY_PASSWORD      = giống ANDROID_KEYSTORE_PASSWORD"
  printf '%s' "$b64" > "$dir/android-release.b64"
  chmod 600 "$dir/android-release.b64"
fi
echo
echo "QUAN TRỌNG: sao lưu $ks và mật khẩu vào nơi an toàn (vd. trình quản lý mật khẩu). Không commit vào repo."
