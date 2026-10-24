# VHub Trend cho Android

App điện thoại xem và xử lý danh sách ý tưởng mà PC đã quét. PC vẫn là nơi giữ dữ liệu; app chỉ đọc bản chụp (snapshot) và gửi lại thao tác của bạn (giữ, bỏ, để sau…).

- Ở nhà, cùng Wi-Fi: app gọi thẳng PC (`npm run dashboard -- --lan`).
- Ra ngoài: app đọc bản chụp trên Firestore (cần bật cloud một lần theo [`infra/README.md`](../infra/README.md)). Thao tác làm khi ở ngoài được PC áp dụng ở lần đồng bộ kế tiếp.
- Không mạng: app hiện bản chụp gần nhất, ghi thao tác vào hàng đợi và gửi khi có mạng.

## Trạng thái (thật)

| Phần | Trạng thái | Bằng chứng |
|---|---|---|
| Lõi Kotlin (đọc mã ghép nối, LAN, Firestore REST, hàng đợi, bộ nhớ đệm) | MVP | 14 test JVM, đọc lại mẫu `docs/contract/snapshot.v1.json` do test PC sinh ra |
| Giao diện Compose (điện thoại, máy tính bảng, sáng/tối) | MVP | Test Robolectric + ảnh chụp màn hình trong artifact `android-screenshots` của CI |
| APK release ký trong CI | MVP | Workflow `Android`, bước `apksigner verify` (chữ ký v2) |
| Cài lên điện thoại thật, quét QR thật, đồng bộ qua Firebase thật | **Chưa kiểm** | Việc đầu tiên của bạn, theo các bước dưới |

## Cài app (5 phút)

1. Mở https://github.com/hoangvh2/vhub-scan/actions/workflows/android.yml → bấm lần chạy mới nhất có dấu xanh → kéo xuống **Artifacts** → tải `VHubTrend-apk-release` (hoặc `VHubTrend-apk-throwaway` nếu chưa đặt khóa, xem bên dưới). Khi đã có bản phát hành, lấy file `.apk` ở mục **Releases** của repo cho tiện.
2. Giải nén, chép file `.apk` sang điện thoại (Google Drive, cáp USB, Zalo "Cloud của tôi"…), mở file.
3. Android hỏi "Cài ứng dụng không rõ nguồn gốc" → cho phép với ứng dụng bạn dùng để mở file → **Cài đặt**.
4. Trên PC: chạy `npm run dashboard -- --lan` và giữ cửa sổ mở. Mở một terminal khác, chạy `npm run pair` để in mã QR (hoặc mở trang **Hệ thống** trên dashboard web, mã QR ở đó). Đã bật cloud thì cùng mã này dùng được cả khi ra ngoài.
5. Trong app: **Quét mã QR** → hướng camera vào mã. Không quét được thì bấm **Không quét được? Dán mã dạng chữ** và dán đoạn chữ in dưới mã QR.

Yêu cầu: Android 8.0 trở lên. Quét QR dùng trình quét của Google Play services, app không xin quyền camera.

## Khóa ký APK (làm một lần, 5 phút)

Mỗi bản cập nhật phải ký cùng một khóa thì mới cài đè được bản cũ. Khóa nằm **ngoài repo** (mặc định `~/.vhub-trend/android-release.jks`) và được đưa lên GitHub dưới dạng secret; repo không bao giờ chứa khóa hay mật khẩu.

Chưa đặt khóa thì CI vẫn build và ký bằng một khóa dùng một lần (artifact `VHubTrend-apk-throwaway`): cài được để thử, nhưng **không cập nhật** được lên bản đó sau này và không bao giờ được phát hành.

| Bước | Windows (PowerShell) | macOS / Linux |
|---|---|---|
| 0. Cần có | JDK 17 (`keytool`), GitHub CLI `gh` đã `gh auth login` | như bên trái |
| 1. Tạo khóa + đặt 4 secret | `powershell -ExecutionPolicy Bypass -File android\scripts\new-keystore.ps1 -Upload` | `bash android/scripts/new-keystore.sh --upload` |
| 2. Sao lưu | Chép `%USERPROFILE%\.vhub-trend\android-release.jks` và `android-release.password` vào trình quản lý mật khẩu / ổ an toàn | `~/.vhub-trend/android-release.jks` và `android-release.password` |
| 3. Chạy lại CI | GitHub → Actions → **Android** → **Run workflow** (tích **publish** nếu muốn tạo bản phát hành) | như bên trái |

Không dùng `gh`: bỏ `-Upload`/`--upload`, script in ra 4 giá trị; thêm tay ở GitHub → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Giá trị |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | nội dung file `~/.vhub-trend/android-release.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | nội dung file `~/.vhub-trend/android-release.password` |
| `ANDROID_KEY_ALIAS` | `vhubtrend` |
| `ANDROID_KEY_PASSWORD` | giống `ANDROID_KEYSTORE_PASSWORD` |

Mất khóa = phải gỡ app cũ rồi cài lại (mất ghép nối, ghép lại 1 phút). Script từ chối tạo đè khóa đã có.

## Phát hành

- Mỗi lần push lên `main` có thay đổi trong `android/`: CI build, ký bằng khóa thật và tạo bản phát hành `android-v0.1.<số lần chạy>` kèm file `.apk`.
- Muốn phát hành ngay từ nhánh khác: Actions → **Android** → **Run workflow** → tích **publish**.
- Số phiên bản tự tăng theo số lần chạy CI, nên bản mới luôn cài đè được bản cũ.

## Phát triển

Cần Android SDK (Android Studio cài sẵn). Không có SDK thì Gradle chỉ nạp module `core` (Kotlin thuần), vẫn chạy được test lõi.

```bash
cd android
./gradlew :core:test                 # lõi, không cần SDK
./gradlew :app:testDebugUnitTest     # giao diện (Robolectric), ảnh ra app/build/screenshots/
./gradlew :app:assembleDebug         # APK debug, ký bằng khóa debug của máy
```

Dữ liệu mẫu cho ảnh chụp: `app/src/test/resources/demo-snapshot.json`, xuất từ máy chủ demo (`npx vite-node packages/pipeline/test/demo/serve.ts -- 4180`, rồi `curl -H 'Authorization: Bearer demo-token' localhost:4180/api/snapshot`).

Đổi định dạng snapshot: xem [`docs/SYNC.md`](../docs/SYNC.md) mục hợp đồng dữ liệu; `ContractTest` sẽ đỏ nếu app không đọc được mẫu mới.
