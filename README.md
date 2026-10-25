# VHub Trend Scan

A personal, **PC-first** pipeline that finds small tools and ideas worth building (productivity, automation, daily life, developer workflow), narrows hundreds of items to a handful, explains each in Vietnamese, and shows them on a local dashboard (web and Android).

It does **not** touch Facebook. Facebook is where you find people; this finds their public projects (GitHub, Show HN) on its own, so it keeps working when you are busy.

## Status (honest)

| Part | State |
|---|---|
| Pipeline: collect, dedupe, rules, score, triage, card, digest, checkpoints, token budget | Built, 82 automated tests pass |
| Claude CLI adapter | Verified against the real `claude` CLI 2.1.310 (see `docs/DESIGN.md`, "Measured") |
| GitHub and Hacker News connectors | Built and tested against recorded-shape fixtures. GitHub: one live run from the build sandbox on 2026-10-24 (no token, 89 items collected, 5 in the digest). Hacker News: **not yet run live** (the sandbox blocks it); first live run is yours (`npm run scan`) |
| Local web dashboard (`npm run dashboard`) | Built, API tested; rendered in headless Chromium at desktop, tablet and phone sizes, light and dark (CI artifact `dashboard-screens`). Not checked on Safari/iOS |
| Hosted web dashboard (Firebase Hosting, same page reading Firestore, Google sign-in + email allowlist; `npm run web:deploy`) | Built. Tested in headless Chromium against the Firebase emulators (sign-in with a stubbed Google button, allowlist refusal, read snapshot, act, PC applies, sign-out confirm). **Not deployed to a real project; real Google sign-in and real Firestore CORS from a `web.app` origin unverified** |
| Android app (Compose, Google sign-in via Credential Manager, Firestore REST, offline queue), APK signed in CI | Built (MVP). Core and UI tested in CI (JVM + Robolectric screenshots), release APK signature verified with `apksigner`. **Not yet installed on a real phone; real Google account picker untried.** Guide: [`android/README.md`](android/README.md) |
| Cloud sync for web and phone: Terraform (Firebase Spark, free), Firestore rules with an email allowlist, PC sync | Built. `terraform plan` without credentials, rules (allowlist cases) and PC↔web/phone sync tested in CI against the Firebase emulators. **Not yet applied to a real Google project** (your first `terraform apply`). Guide: [`infra/README.md`](infra/README.md), design: [`docs/SYNC.md`](docs/SYNC.md) |
| Scheduling on Windows | Command printed by `trend schedule`; **not verified on a real Windows PC** |

## Bắt đầu nhanh (lần đầu, khoảng 10 phút)

Cần có trước: Node >= 22.13 và Claude Code CLI (`claude`). Gõ `claude` một lần trong terminal để đăng nhập, rồi thoát.

Mọi lệnh dưới đây chạy trong thư mục repo này.

| Bước | Chạy | Kết quả / việc của bạn |
|---|---|---|
| 1 | `npm ci` | Cài thư viện |
| 2 | `npm run setup` | Build, tạo `~/.vhub-trend/config.json` và in hướng dẫn 3 bước, có sẵn lệnh mở file |
| 3 | Mở `~/.vhub-trend/config.json` | **Bắt buộc:** thay mọi chữ `TODO:` trong `projects[].summary` bằng 1–2 câu mô tả dự án (làm gì, cho ai). Không muốn khai dự án nào thì xoá cả khối `{ ... }` của nó. Không bắt buộc: thêm tài khoản GitHub muốn theo dõi vào `sources.github.seeds`, ví dụ `["anthropics"]` |
| 4 | Đặt `GITHUB_TOKEN` (nên làm) | Tạo token ở https://github.com/settings/personal-access-tokens/new, chọn "Public repositories", không cần quyền nào. Windows: `setx GITHUB_TOKEN "github_pat_..."` rồi mở terminal mới. macOS/Linux: thêm `export GITHUB_TOKEN="github_pat_..."` vào `~/.zshrc` hoặc `~/.bashrc` |
| 5 | `npm run doctor` | Kiểm tra Node, config, token, và gọi thử Claude một lần rất nhỏ. Dòng `[LỖI]` nào cũng có `cách sửa:` ngay bên dưới. Chạy lại tới khi in `Sẵn sàng` |
| 6 | `npm run scan` | Một lần quét đầy đủ (vài phút) |
| 7 | `npm run dashboard` | In link `http://localhost:4173/?t=<token>`, mở link đó trong trình duyệt |

Xem trên web và điện thoại: bật cloud miễn phí một lần theo [`infra/README.md`](infra/README.md) (khoảng 25 phút), rồi đăng nhập bằng tài khoản Google nằm trong `allowed_emails`; ở đâu cũng xem được, không cần mở dashboard, không có mã QR. Chưa bật cloud thì chỉ xem được trên PC.

Hằng ngày: `npm run scan` (hoặc `npm run schedule` để in lệnh đặt lịch tự chạy), `npm run status` để xem lần chạy gần nhất. Các lệnh khác: `npm run trend -- help`.

Trong `config.json`, các khoá bắt đầu bằng `_` (ví dụ `_huong_dan`) chỉ là ghi chú, chương trình bỏ qua. Mục nào không có trong file thì dùng giá trị mặc định trong `packages/pipeline/src/config.ts`. Gõ sai tên khoá sẽ bị báo lỗi, không bị lờ đi.

`npm run trend -- serve --lan` lets another device on your network open the PC dashboard. Anyone on the network with the link can read and change your list; the token in the link is the only protection.

## What stays where

Everything lives in `~/.vhub-trend` (or `$VHUB_TREND_HOME`): `trend.sqlite`, `config.json`, `token`, and `cloud.json` (PC key for Firebase, mode 0600) when cloud is on. With cloud on, a copy of the digest, kept list and run summary is published to your own Firestore; nothing else leaves the PC. Secrets come from the environment (`GITHUB_TOKEN`), never from files in this repository. Only public project information is stored (name, description, numbers, links); no personal profiles.

## Develop

```sh
npm run typecheck && npm test      # 107 tests, no network, no real LLM
npm ci --prefix tests && npm test --prefix tests   # Firestore rules + PC-phone sync on the Firebase emulators (needs Java 21)
```

Design, decisions and acceptance gates: [`docs/DESIGN.md`](docs/DESIGN.md). Repository conventions: [`CLAUDE.md`](CLAUDE.md).
