# VHub Trend Scan

A personal, **PC-first** pipeline that finds small tools and ideas worth building (productivity, automation, daily life, developer workflow), narrows hundreds of items to a handful, explains each in Vietnamese, and shows them on a local dashboard (web now, Android next).

It does **not** touch Facebook. Facebook is where you find people; this finds their public projects (GitHub, Show HN) on its own, so it keeps working when you are busy.

## Status (honest)

| Part | State |
|---|---|
| Pipeline: collect, dedupe, rules, score, triage, card, digest, checkpoints, token budget | Built, 82 automated tests pass |
| Claude CLI adapter | Verified against the real `claude` CLI 2.1.310 (see `docs/DESIGN.md`, "Measured") |
| GitHub and Hacker News connectors | Built and tested against recorded-shape fixtures. GitHub: one live run from the build sandbox on 2026-10-24 (no token, 89 items collected, 5 in the digest). Hacker News: **not yet run live** (the sandbox blocks it); first live run is yours (`npm run scan`) |
| Local web dashboard (`npm run dashboard`) | Built, API tested; the page itself has not been opened in a browser by me |
| Android app, APK release in CI | **Not built yet** |
| Terraform / Firebase / cloud sync | **Not built yet** (cloud is optional, after the MVP) |
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

Hằng ngày: `npm run scan` (hoặc `npm run schedule` để in lệnh đặt lịch tự chạy), `npm run status` để xem lần chạy gần nhất. Các lệnh khác: `npm run trend -- help`.

Trong `config.json`, các khoá bắt đầu bằng `_` (ví dụ `_huong_dan`) chỉ là ghi chú, chương trình bỏ qua. Mục nào không có trong file thì dùng giá trị mặc định trong `packages/pipeline/src/config.ts`. Gõ sai tên khoá sẽ bị báo lỗi, không bị lờ đi.

`npm run trend -- serve --lan` lets your phone open the dashboard over your home network. Anyone on the network with the link can read and change your list; the token in the link is the only protection.

## What stays where

Everything lives in `~/.vhub-trend` (or `$VHUB_TREND_HOME`): `trend.sqlite`, `config.json`, `token`. Secrets come from the environment (`GITHUB_TOKEN`), never from files in this repository. Only public project information is stored (name, description, numbers, links); no personal profiles.

## Develop

```sh
npm run typecheck && npm test      # 82 tests, no network, no real LLM
```

Design, decisions and acceptance gates: [`docs/DESIGN.md`](docs/DESIGN.md). Repository conventions: [`CLAUDE.md`](CLAUDE.md).
