# PC ↔ điện thoại: kiến trúc và hợp đồng dữ liệu

PC là nơi giữ dữ liệu thật (`~/.vhub-trend/trend.sqlite`). Điện thoại chỉ xem và gửi thao tác (Giữ, Bỏ, Hoãn, Đang thử, Xong, Hoàn tác). Cloud là tuỳ chọn.

```
                 cùng Wi-Fi (LAN, nhanh, trực tiếp)
   ┌────────┐  GET /api/snapshot, POST /api/feedback   ┌──────────────┐
   │  PC    │◀─────────────────────────────────────────│ Android app  │
   │ SQLite │                                          │ (cache, hàng │
   │ trend  │  sync mỗi 10 phút khi dashboard chạy,    │  đợi offline)│
   │ serve  │  và sau mỗi lần scan                     └──────┬───────┘
   └───┬────┘                                                 │ ra ngoài
       │ service account (IAM)                                │ Firebase Auth (custom token)
       ▼                                                      ▼
   ┌───────────────── Firestore (Spark, miễn phí) ─────────────────┐
   │ owners/{uid}/snapshot/latest   PC ghi, điện thoại chỉ đọc      │
   │ owners/{uid}/inbox/{eventId}   điện thoại chỉ tạo, PC đọc và xoá│
   └────────────────────────────────────────────────────────────────┘
```

| Quyết định | Lý do |
|---|---|
| PC là nguồn sự thật, cloud chỉ là bản sao | Pipeline và Claude CLI chạy trên PC; mất cloud không mất dữ liệu (`npm run sync` dựng lại) |
| Một document snapshot (JSON trong field `payload`) | Điện thoại mở app = 1 lần đọc Firestore. Giới hạn 1 MiB: PC tự cắt `explore` rồi `kept` cuối danh sách, không bao giờ cắt digest |
| Thao tác từ xa đi qua inbox, PC áp dụng | Không có hai nơi cùng sửa một bản ghi. Mỗi event có id riêng, PC ghi nhận vào bảng `cloud_event` nên áp dụng đúng một lần |
| Điện thoại đăng nhập bằng custom token do PC ký khi ghép nối | Không cần Google Sign-In, SHA-1, `google-services.json`, Firebase SDK. Rules chỉ cho uid chủ (`owner`) với `sign_in_provider == 'custom'` |
| LAN trước, cloud sau | Ở nhà có dữ liệu mới nhất và tìm kiếm đầy đủ; ra ngoài vẫn xem và thao tác được |

Chi phí ước tính (1 người dùng): PC sync 10 phút/lần khi dashboard mở ≈ 150 lượt đọc inbox/ngày + vài lượt ghi; điện thoại ≈ vài chục lượt đọc/ngày. Hạn mức miễn phí: 50.000 đọc, 20.000 ghi mỗi ngày. Đây là ước tính, chưa đo trên project thật.

## Snapshot (schema 1)

Cùng một JSON ở hai nơi: `GET /api/snapshot` (LAN, cần token) và field `payload` (string) của `owners/{uid}/snapshot/latest`. Các field khác của document: `schema` (int), `generatedAt` (string ISO), `day` (string hoặc null).

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

Rules kiểm tra đúng bảng này (`firebase/firestore.rules`, test ở `tests/rules`). PC áp dụng theo thứ tự `at`; thao tác nào tới sau (theo `at`) thắng.

## Mã ghép nối

JSON, quét bằng QR (dashboard → Hệ thống → Kết nối điện thoại) hoặc dán (`npm run pair`):

```json
{"v":1,"lan":["http://192.168.1.5:4173"],"t":"<token dashboard>","fb":{"p":"<project id>","k":"<api key>","u":"owner","ct":"<custom token, hạn 1 giờ>"}}
```

`fb` chỉ có khi cloud đã bật. Mã chứa token dashboard: ai có mã thì xem và sửa được danh sách, nên chỉ quét trên điện thoại của bạn.
