# Bật cloud cho web và điện thoại (Firebase, miễn phí) — từng bước

Không bắt buộc. Không làm phần này thì dashboard vẫn chạy trên PC. Làm phần này thì **web và app Android** đều xem được digest ở bất cứ đâu và bấm Giữ/Bỏ/Hoãn; PC nhận thao tác ở lần đồng bộ sau. Đăng nhập bằng **tài khoản Google**, và chỉ các địa chỉ email bạn liệt kê (`allowed_emails`) mới vào được. Không còn mã QR. Kiến trúc: [`docs/SYNC.md`](../docs/SYNC.md).

Chi phí: **0 đồng**. Không cần bật billing. Mọi thứ nằm trong hạn mức miễn phí của Firebase (gói Spark). Thời gian: khoảng 25 phút, làm một lần.

Mọi lệnh chạy **trên PC của bạn**. Windows: dùng PowerShell.

> **Không bao giờ commit** `infra/terraform.tfvars` (có email của bạn), `infra/terraform.tfstate*` và `~/.vhub-trend/cloud.json` (khoá của PC). Các file này đã có trong `.gitignore`.

Thứ tự: Bước 1–5 tạo hạ tầng, **Bước 6 bật đăng nhập Google (làm tay)**, Bước 7 nối PC, Bước 8 web, Bước 9 Android.

## Bước 1. Cài 2 công cụ (một lần)

| Công cụ | Cài | Kiểm tra (mở terminal **mới** sau khi cài) |
|---|---|---|
| Terraform ≥ 1.10 | Windows: `winget install Hashicorp.Terraform`. macOS: `brew install terraform`. Khác: https://developer.hashicorp.com/terraform/install | `terraform version` |
| Google Cloud CLI | https://cloud.google.com/sdk/docs/install | `gcloud --version` |

## Bước 2. Tạo project Google Cloud riêng cho app này

```bash
gcloud auth login
gcloud projects create vhub-trend-482915 --name="VHub Trend"
```

- Thay `482915` bằng 6 số bất kỳ của bạn: Project ID phải là duy nhất trên toàn Google. Báo "already in use" thì đổi số khác.
- **Ghi lại Project ID** (ví dụ `vhub-trend-482915`), các bước sau cần.

## Bước 3. Cho Terraform dùng tài khoản của bạn

```bash
gcloud auth application-default login
```

Trình duyệt mở ra, chọn đúng tài khoản Google vừa tạo project, bấm Allow.

## Bước 4. Khai project cho Terraform

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
```

(Windows PowerShell: `copy terraform.tfvars.example terraform.tfvars`)

Mở `infra/terraform.tfvars`, sửa hai dòng:

```hcl
project_id     = "vhub-trend-482915"        # Project ID của bạn ở Bước 2
allowed_emails = ["ban@gmail.com"]          # Tài khoản Google được vào web và app. Thêm nhiều địa chỉ nếu cần
```

`allowed_emails` được ghi vào Firestore rules: tài khoản ngoài danh sách bị Firestore từ chối đọc và ghi, dù biết địa chỉ web hay có APK. Không phân biệt hoa thường; tài khoản phải có email đã xác minh (mọi tài khoản Google đều có).

## Bước 5. Tạo hạ tầng

Vẫn trong thư mục `infra`:

```bash
terraform init
terraform apply
```

Terraform liệt kê **khoảng 18 thứ sẽ tạo** (bật API, Firebase, Firestore ở Singapore, rules theo `allowed_emails`, API key, service account + khoá cho PC). Gõ `yes`, Enter. Mất 2–5 phút.

Xong khi thấy `Apply complete!`. Báo lỗi: xem [Lỗi thường gặp](#lỗi-thường-gặp).

## Bước 6. Bật đăng nhập Google (làm tay, khoảng 3 phút)

Terraform không tạo được "OAuth client" của Google Sign-In, nên bước này làm trên web:

1. https://console.firebase.google.com → chọn project của bạn → **Build → Authentication → Get started**.
2. Tab **Sign-in method** → **Google** → bật **Enable** → chọn email hỗ trợ (email của bạn) → **Save**. Các phương thức khác để tắt.
3. Bấm lại vào **Google**, mở **Web SDK configuration**, chép **Web client ID** (dạng `1234567890-abc123.apps.googleusercontent.com`).
4. Google Cloud Console → https://console.cloud.google.com/apis/credentials (đúng project) → bấm **Web client (auto created by Google Service)** → mục **Authorized JavaScript origins** → **Add URI** hai lần:
   - `https://<project id>.web.app`
   - `https://<project id>.firebaseapp.com`

   → **Save**. (Thay đổi có thể mất vài phút mới có hiệu lực.)
5. Mở `infra/terraform.tfvars`, thêm: `web_client_id = "<Web client ID vừa chép>"`, rồi chạy lại `terraform apply` trong `infra` (chỉ cập nhật output, vài giây).

Nút "Đăng nhập với Google" trên web cần origin ở mục 4. App Android cần thêm Bước 9.

## Bước 7. Nối PC với cloud

Quay về thư mục gốc của repo:

```bash
cd ..
npm run build
npm run cloud:connect
npm run doctor
```

- `cloud:connect` đọc kết quả Terraform và ghi `~/.vhub-trend/cloud.json` (khoá của PC, Web client ID).
- `doctor` đồng bộ thử và đẩy snapshot lên. Dòng `cloud:` phải là `[ok]`. Nếu có cảnh báo thiếu `web_client_id`: làm lại mục 5 ở Bước 6 rồi `npm run cloud:connect`.
- Muốn đẩy dữ liệu ngay: `npm run sync`. PC cũng đồng bộ sau mỗi `npm run scan` và mỗi 10 phút khi `npm run dashboard` đang chạy.

## Bước 8. Web dashboard (miễn phí)

1. Một lần: `npx firebase-tools@15 login` (đăng nhập đúng tài khoản Google đã tạo project).
2. `npm run web:deploy`: dựng trang rồi đưa lên Firebase Hosting. Không lưu khoá deploy ở đâu cả. Chạy lại sau mỗi lần cập nhật giao diện.
3. Mở `https://<project id>.web.app` → **Đăng nhập với Google** → chọn tài khoản trong `allowed_emails`.

Tài khoản ngoài danh sách thấy thông báo nêu rõ địa chỉ bị từ chối và cách thêm. Trình duyệt nhớ phiên; **Hệ thống → Đăng xuất** xoá nó (có hộp xác nhận). Nếu site mặc định không phải `<project id>.web.app` thì địa chỉ do lệnh deploy in ra là địa chỉ đúng; thêm nó vào Authorized JavaScript origins (Bước 6, mục 4).

Hành vi: Giữ/Bỏ/Hoãn ghi vào inbox và hiện ngay trên trang; PC áp dụng ở lần đồng bộ kế. Web không chạy quét (nút đó chỉ có trên dashboard PC).

## Bước 9. App Android (tùy chọn)

App đăng nhập bằng hộp chọn tài khoản của Android và chỉ chạy được với APK có **SHA-1 chứng chỉ ký** đã đăng ký trong Firebase.

1. Đã có khoá ký trong GitHub secrets ([`android/README.md`](../android/README.md)) và workflow Android chạy xong trên `main`. Mở lần chạy đó → **Summary**: mục **Signing certificate SHA-1** có chuỗi dạng `AB:CD:…`.
2. `infra/terraform.tfvars`: thêm `android_sha1 = ["AB:CD:…"]` → `terraform apply` (đăng ký app `com.vh.trend` và tạo Android OAuth client; mất khoảng 1–2 phút để Google áp dụng).
3. In các giá trị để app biết project: `cd infra && terraform output -json android_env` (Windows PowerShell cũng dùng được). Vào GitHub repo → **Settings → Secrets and variables → Actions → Variables** → tạo 4 biến cùng tên: `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `FIREBASE_WEB_CLIENT_ID`, `FIREBASE_OWNER_UID`. Đây là mã định danh, không phải bí mật (nhưng đừng commit vào repo). Lỡ tạo ở tab **Secrets** cùng tên cũng được. Sau đó chạy workflow **Android** (Run workflow, tick publish) và cài APK mới nhất: APK build trước đó vẫn không đăng nhập được. Thiếu biến thì workflow báo lỗi và không publish.
4. Chạy lại workflow **Android** (Actions → Android → Run workflow, bật publish). Tải APK mới ở Releases, cài, mở app → **Đăng nhập với Google**.

APK build trước khi có biến `FIREBASE_*` hiện thông báo cấu hình thay vì nút đăng nhập.

## Việc thường làm

| Việc | Cách làm |
|---|---|
| Đồng bộ ngay | `npm run sync` |
| Thêm hoặc bớt người được vào | Sửa `allowed_emails` trong `infra/terraform.tfvars` → `terraform apply`. Có hiệu lực ngay ở lần đọc kế tiếp |
| Thu hồi một thiết bị bị mất | Đăng xuất Google khỏi máy đó, hoặc Firebase console → Authentication → Users → xoá user; nếu cần chặn hẳn tài khoản: bỏ khỏi `allowed_emails` rồi `terraform apply` |
| Đổi khoá PC (nghi lộ `cloud.json`) | `cd infra && terraform apply -replace=google_service_account_key.pc[0]` rồi `cd .. && npm run cloud:connect` |
| Cập nhật giao diện web | `npm run web:deploy` |

## Lỗi thường gặp

| Thấy | Làm |
|---|---|
| `terraform: command not found` | Chưa cài, hoặc chưa mở terminal mới sau khi cài (Bước 1) |
| `could not find default credentials` | Chưa làm Bước 3 |
| `Error 403 ... has not been used in project ... or it is disabled` | API vừa bật cần vài phút; chạy lại `terraform apply` |
| `Permission denied to create service account key` / `iam.disableServiceAccountKeyCreation` | Tài khoản thuộc tổ chức cấm tạo khoá. Đặt `create_pc_key = false` trong `terraform.tfvars`, `terraform apply`, rồi dùng project trên tài khoản Gmail cá nhân (không thuộc tổ chức). Cách không cần khoá chưa được hỗ trợ |
| `Database already exists` | Project đã có Firestore. Dùng project mới (Bước 2) hoặc nhập: `terraform import google_firestore_database.default "projects/<id>/databases/(default)"` |
| `doctor`: Google từ chối khoá của PC | Khoá bị xoá hoặc sai project: chạy lại `terraform apply` rồi `npm run cloud:connect` |
| Web báo "Firebase từ chối đăng nhập (CONFIGURATION_NOT_FOUND…)" | Chưa bật Google ở Bước 6 (mục 1–2) |
| Nút Google không hiện, hoặc cửa sổ Google báo `origin_mismatch` | Thiếu địa chỉ web trong **Authorized JavaScript origins** (Bước 6, mục 4); đợi vài phút |
| "Tài khoản … không nằm trong danh sách được phép" | Thêm địa chỉ vào `allowed_emails`, `terraform apply`; hoặc đăng nhập tài khoản khác |
| Web/app: "PC chưa đẩy dữ liệu lên cloud" | Trên PC chạy `npm run sync` |
| Android: `Đăng nhập Google không thành công (TYPE_NO_CREDENTIAL…)` hoặc lỗi 16 | SHA-1 của APK chưa đăng ký (Bước 9, mục 2), `FIREBASE_WEB_CLIENT_ID` sai, hoặc vừa apply (đợi vài phút); máy cần có tài khoản Google và Google Play services |

## Gỡ bỏ

Firestore được bảo vệ chống xoá nhầm, nên `terraform destroy` sẽ dừng ở database. Cách sạch nhất: `gcloud projects delete <project id>` (Google giữ 30 ngày rồi xoá hẳn), xoá `~/.vhub-trend/cloud.json`, xoá `infra/terraform.tfstate*`.

## Đã kiểm chứng và chưa

| Mục | Trạng thái |
|---|---|
| `terraform validate`, `terraform plan` (19 resource, có `android_sha1`) không cần tài khoản Google | Chạy trong CI mỗi lần push |
| Firestore rules: chỉ tài khoản Google trong danh sách (không phân biệt hoa thường, email đã xác minh) đọc snapshot và tạo event đúng dạng; người ngoài, chưa đăng nhập, hoặc đăng nhập kiểu khác bị chặn | Test trên emulator, chạy trong CI |
| PC → Firestore → web/điện thoại và ngược lại | Test đầu-cuối trên emulator Firestore + Auth, chạy trong CI |
| Trang web: đăng nhập, bị từ chối, đọc dữ liệu, bấm Giữ tới PC, phiên còn sau khi tải lại, đăng xuất có xác nhận | Chromium thật + emulator, chạy trong CI. **Hộp đăng nhập của Google được thay bằng bản giả**: chưa thử với Google thật |
| Lõi Android (đổi token Google lấy phiên Firebase, quyền, hàng đợi offline) | 13 test JVM, chạy trong CI |
| Màn hình Android (đăng nhập, bị từ chối, chưa cấu hình, đăng xuất có xác nhận) | Robolectric trong CI. **Chưa cài trên điện thoại thật; chưa thử hộp chọn tài khoản Google thật** |
| `terraform apply` trên project Google thật, bật Google ở Firebase, SHA-1 | **Chưa chạy** (không có tài khoản Google trong môi trường build). Lần đầu là của bạn |
