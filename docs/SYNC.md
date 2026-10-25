# PC ↔ điện thoại: kiến trúc và hợp đồng dữ liệu

PC là nơi giữ dữ liệu thật (`~/.vhub-trend/trend.sqlite`). Điện thoại chỉ xem và gửi thao tác (Giữ, Bỏ, Hoãn, Đang thử, Xong, Hoàn tác). Cloud là tuỳ chọn.

```
   ┌────────┐   service account (IAM)   ┌──────────────── Firestore (Spark, miễn phí) ────────────────┐
   │  PC    │──────────────────────────▶│ owners/{uid}/snapshot/latest   PC ghi, người dùng chỉ đọc    │
   │ SQLite │  sync mỗi 10 phút khi     │ owners/{uid}/inbox/{eventId}   người dùng chỉ tạo; PC đọc,   │
   │ trend  │  dashboard chạy, và sau   │                                áp dụng rồi xoá                │
   │ serve  │  mỗi lần scan             └───────────────▲──────────────────────────▲───────────────────┘
   └────────┘                                           │ REST + ID token          │ REST + ID token
                                                  ┌─────┴──────┐            ┌──────┴───────┐
                                                  │ Web (Hosting)│          │ Android app  │
                                                  └─────┬──────┘            └──────┬───────┘
                                                        └── Đăng nhập Google ──────┘
                                                  (ID token Google → Firebase Auth signInWithIdp)
```

| Quyết định | Lý do |
|---|---|
| PC là nguồn sự thật, cloud chỉ là bản sao | Pipeline và Claude CLI chạy trên PC; mất cloud không mất dữ liệu (`npm run sync` dựng lại) |
| Một document snapshot (JSON trong field `payload`) | Điện thoại mở app = 1 lần đọc Firestore. Giới hạn 1 MiB: PC tự cắt `explore` rồi `kept` cuối danh sách, không bao giờ cắt digest |
| Thao tác từ xa đi qua inbox, PC áp dụng | Không có hai nơi cùng sửa một bản ghi. Mỗi event có id riêng, PC ghi nhận vào bảng `cloud_event` nên áp dụng đúng một lần |
| Web và Android đăng nhập bằng Google; Firestore rules chỉ cho địa chỉ trong allowlist | Không mã QR, không token để lộ. Rules: `email_verified`, `sign_in_provider == 'google.com'`, `email.lower() in [allowlist]`. Allowlist nằm trong `terraform.tfvars` (`allowed_emails`), không nằm trong repo công khai. Không dùng Firebase SDK: cả web (Google Identity Services) và app (Credential Manager) lấy ID token của Google rồi gọi Firebase Auth/Firestore qua REST |
| Đường dữ liệu `owners/{uid}` là tên thư mục, không phải tài khoản | Mọi tài khoản trong allowlist dùng chung một danh sách (hệ thống một người dùng); `uid` mặc định `owner` |

Chi phí ước tính (1 người dùng): PC sync 10 phút/lần khi dashboard mở ≈ 150 lượt đọc inbox/ngày + vài lượt ghi; điện thoại ≈ vài chục lượt đọc/ngày. Hạn mức miễn phí: 50.000 đọc, 20.000 ghi mỗi ngày. Đây là ước tính, chưa đo trên project thật.

## Snapshot (schema 1)

Cùng một JSON ở hai nơi: `GET /api/snapshot` của dashboard PC (cần token; để gỡ lỗi) và field `payload` (string) của `owners/{uid}/snapshot/latest`. Các field khác của document: `schema` (int), `generatedAt` (string ISO), `day` (string hoặc null).

Mẫu đầy đủ, do test sinh ra và test Android đọc lại: [`docs/contract/snapshot.v1.json`](contract/snapshot.v1.json). Đổi định dạng thì: tăng `SNAPSHOT_SCHEMA` (`packages/pipeline/src/snapshot.ts`), chạy `UPDATE_CONTRACT=1 npm test`, cập nhật app.

| Field | Kiểu | Ghi chú |
|---|---|---|
| `digest` | Item[] | Digest gần nhất (ngày `day`), đúng thứ tự |
| `kept` | Item[] | Đã giữ + đang thử |
| `explore` | Item[] | Ý đã phân tích, chưa quyết định (để lướt khi ra ngoài) |
| `health.lastRun` | object hoặc null | `startedAt, finishedAt, status, error, collected, created, merged, triaged, carded, digest, llmCalls, cacheHits, dropped, degraded, sourceErrors` |
| `health.tokens` | object | `used, limit, calls, costUsd` (hôm nay) |
| `health.counts` | object | Số mục theo trạng thái `new, kept, skipped, snoozed, trying, done` |

Item = đúng dạng `/api/entities` (`id, title, description, url, author, license, topics, stage, userState, triage{score,cat,why}, heuristic, card{what,learn,apply[{project,how}],effort,risk} | null, stars, points, sources, firstSeen, shownAt, shownReason?`) cộng `series`: số sao/điểm theo ngày, cũ trước, tối đa 30.

## Inbox event

`owners/{uid}/inbox/{eventId}`; `eventId` 8–64 ký tự `[A-Za-z0-9_-]`, do điện thoại sinh (UUID), gửi lại cùng id thì Firestore báo đã tồn tại và app coi là thành công.

| Field | Kiểu | Bắt buộc |
|---|---|---|
| `entityId` | string 1–300 | có |
| `action` | `keep, skip, snooze, trying, done, reset` | có |
| `at` | int, mili giây Unix lúc bấm | có |
| `days` | int 1–90, chỉ cho `snooze` | không (mặc định 7) |
| `device` | string ≤ 40 | không |

Rules kiểm tra đúng bảng này (`firebase/firestore.rules.tmpl`, test ở `tests/rules`). PC áp dụng theo thứ tự `at`; thao tác nào tới sau (theo `at`) thắng.

## Đăng nhập và allowlist

1. Người dùng bấm "Đăng nhập với Google". Web dùng Google Identity Services, Android dùng Credential Manager với cùng `Web client ID`; cả hai nhận một **ID token của Google**.
2. Client gọi `POST identitytoolkit.googleapis.com/v1/accounts:signInWithIdp` với `postBody=id_token=<token>&providerId=google.com` và nhận ID token + refresh token của Firebase (làm mới qua `securetoken.googleapis.com`).
3. Mọi lần đọc/ghi Firestore mang `Authorization: Bearer <ID token Firebase>`; rules quyết định theo email trong token.

Thêm hoặc bớt người: sửa `allowed_emails`, `terraform apply`. Địa chỉ ngoài danh sách nhận 403 từ Firestore; web và app hiện địa chỉ bị từ chối cùng cách sửa. Cần Android: SHA-1 của khóa ký APK đăng ký trong Firebase, và 4 biến `FIREBASE_*` lúc build (xem `infra/README.md`).
