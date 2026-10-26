# Bật cloud cho web và điện thoại (Firebase, miễn phí) — từng bước

Không bắt buộc. Không làm phần này thì dashboard vẫn chạy trên PC. Làm phần này thì **web và app Android** đều xem được digest ở bất cứ đâu và bấm Giữ/Bỏ/Hoãn; PC nhận thao tác ở lần đồng bộ sau. Đăng nhập bằng **tài khoản Google**, và chỉ các địa chỉ email bạn liệt kê (`allowed_emails`) mới vào được. Không còn mã QR. Kiến trúc: [`docs/SYNC.md`](../docs/SYNC.md).

Chi phí: **0 đồng**. Không cần bật billing. Mọi thứ nằm trong hạn mức miễn phí của Firebase (gói Spark). Riêng nút "Quét bằng Gemini" (Bước 10, tùy chọn) cần gói Blaze và tính tiền Gemini. Thời gian: khoảng 25 phút, làm một lần.

Mọi lệnh chạy **trên PC của bạn**. Windows: dùng PowerShell.

> **Không bao giờ commit** `infra/terraform.tfvars` (có email của bạn), `infra/terraform.tfstate*` và `~/.vhub-trend/cloud.json` (khoá của PC). Các file này đã có trong `.gitignore`.

Thứ tự: Bước 1–5 tạo hạ tầng, **Bước 6 bật đăng nhập Google (làm tay)**, Bước 7 nối PC, Bước 8 web, Bước 9 Android, Bước 10 quét bằng Gemini (tùy chọn, trả phí).

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

## Bước 10. Nút "Quét bằng Gemini" trên web và điện thoại (tùy chọn, trả phí)

PC với Claude CLI vẫn là đường chính. Nút này để quét khi PC tắt: web hoặc app tạo một yêu cầu, Cloud Function chạy pipeline với Gemini trên bản sao database mà PC đã gửi lên bucket, rồi trả kết quả về snapshot. Tối đa `cloud_scans_per_day` lần mỗi ngày (mặc định 2, theo giờ Việt Nam), do Firestore rules chặn nên app bị sửa cũng không vượt được.

Chi phí: Cloud Functions, Cloud Build, Storage nằm trong hạn mức miễn phí ở mức dùng một người, nhưng **cần gói Blaze** (gắn thẻ). Gemini tính riêng, ước tính khoảng 0,01–0,02 USD mỗi lần quét với `gemini-3.5-flash-lite` (theo bảng giá 2026-10-25; chưa đo trên project thật). Ngân sách token hằng ngày trong config của PC vẫn áp dụng cho lần quét trên cloud.

1. Firebase console → **Upgrade** project lên Blaze. Nên đặt **Budget alert** (Billing → Budgets & alerts, ví dụ 2 USD/tháng).
2. [Google AI Studio](https://aistudio.google.com/apikey) → tạo API key (nên chọn chính project này) và bật billing cho key. Nếu dùng trả trước: nạp 5 USD và **tắt auto-reload**, hết tiền thì Gemini trả lỗi 402 và lần quét báo thất bại, không phát sinh thêm.
3. `infra/terraform.tfvars` thêm:
   ```hcl
   cloud_scan     = true
   gemini_api_key = "AIza..."   # chỉ được ghi vào Secret Manager, không nằm trong terraform.tfstate hay plan
   # cloud_scans_per_day = 2    # 0 = tắt nút (kill switch), tối đa 5
   # gemini_model        = "gemini-3.5-flash-lite"
   ```
   Không muốn để key trong file: bỏ dòng `gemini_api_key` và chạy `TF_VAR_gemini_api_key=AIza... terraform apply`. Cần Terraform ≥ 1.11.
4. Ở thư mục gốc repo: `npm run cloud:function` (đóng gói code function vào `infra/build/`, không commit).
5. `cd infra && terraform init && terraform apply`. Lần đầu mất khoảng 3–5 phút (bật API, build function).
6. `cd .. && npm run cloud:connect` (để PC biết bucket), rồi `npm run sync`: PC gửi database và config lên bucket. Từ đây mỗi lần sync PC lấy kết quả quét trên cloud về trước, rồi mới gửi bản của mình lên.
7. Web hoặc app → tab **Hệ thống** → **Quét bằng Gemini**. Kết quả (token, chi phí, số mục) hiện trong danh sách lần quét.

Mỗi ngày tối đa `cloud_scans_per_day` lượt **chạy được**. Lượt lỗi, bị từ chối, hoặc không có kết quả sau 15 phút ("Quá thời gian") không tính; có thêm tối đa 3 lần thử lại mỗi ngày cho các lượt như vậy.

**Lượt quét đứng ở "Đang chờ" hoặc "Quá thời gian"**: function không chạy. Xem log (thay project nếu khác):
```
gcloud functions logs read vhub-trend-scan --gen2 --region=asia-southeast1 --project=vhub-trend-482915 --limit=50
```
- `Signature type: http` hoặc `bỏ qua sự kiện không phải yêu cầu quét`: bản function cũ (trước bản sửa CloudEvent). Cập nhật repo, rồi `npm run cloud:function` và `terraform apply`.
- Không có dòng log nào: trigger chưa có hoặc chưa gọi được function. Kiểm tra `gcloud eventarc triggers list --location=asia-southeast1 --project=...` và chạy lại `terraform apply`.
- `Lỗi trên cloud: ...`: lỗi được ghi lên chính lượt quét, đọc nội dung để sửa (quyền, secret, bucket).

| Việc | Cách làm |
|---|---|
| Tắt nút ngay | `cloud_scans_per_day = 0` → `terraform apply` (rules từ chối mọi yêu cầu mới) |
| Đổi key Gemini | Sửa `gemini_api_key`, tăng `gemini_api_key_version` (ví dụ 2) → `terraform apply`. Thiếu bước tăng version thì Terraform không ghi key mới |
| Cập nhật code function | `npm run cloud:function` → `terraform apply` |
| Gỡ tính năng | `cloud_scan = false` → `terraform apply`. Bucket có dữ liệu sẽ không bị xoá tự động (xoá tay trong Cloud Storage nếu muốn) |

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
| `Permission denied while using the Eventarc Service Agent`, `Error 403 ... eventarc` hoặc `Cloud Build ... permission` khi apply Bước 10 | Terraform đã tự đợi 90 giây sau khi cấp quyền, nhưng Google đôi khi cần lâu hơn: đợi vài phút rồi chạy lại `terraform apply` |
| `Inconsistent dependency lock file` | Vừa cập nhật repo có thêm provider: chạy `terraform init` rồi apply lại |
| `Billing account ... not found` / `requires billing` khi apply Bước 10 | Chưa lên gói Blaze (Bước 10, mục 1) |
| Lần quét báo "PC chưa gửi dữ liệu lên cloud" | Chạy `npm run cloud:connect` rồi `npm run sync` trên PC (Bước 10, mục 6) |
| Lần quét báo "PC vừa cập nhật dữ liệu trong lúc quét" | PC sync đúng lúc cloud đang quét; kết quả cloud bị bỏ để không ghi đè. Bấm quét lại (lượt lỗi không tính) |
| Lần quét thất bại với `402` | Hết tiền trả trước ở AI Studio |
| "Hết lượt quét hôm nay" | Đã có đủ `cloud_scans_per_day` lượt chạy được (hoặc đã dùng hết 3 lần thử lại); lượt mới từ 0 giờ (giờ Việt Nam) |
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
| Quét bằng Gemini: giới hạn lượt/ngày trong rules, nút trên web tạo yêu cầu và function chạy pipeline trên bản sao database, hai lượt rồi "Hết lượt" | Rules + web trên emulator (Chromium thật), function chạy với LLM giả. **Chưa gọi Gemini thật, chưa deploy Cloud Function thật** |
| Lượt lỗi hoặc quá 15 phút không tính, thử lại tối đa 3 lần/ngày | Rules trên emulator, function với LLM giả, lõi Android (JVM) |
| Function nhận sự kiện Firestore dạng CloudEvent (`entry.js`) | Chạy Functions Framework trên máy build: bản mới nhận đúng yêu cầu; bản cũ (HTTP) bỏ qua sự kiện và treo, đúng triệu chứng "Đang chờ". **Chưa kiểm chứng trên Cloud Functions thật** |
| Trao database PC ↔ bucket (không mất thao tác của PC, không ghi đè khi hai bên cùng ghi) | Test với bucket giả có kiểm tra generation như GCS |
| `terraform plan` với `cloud_scan = true` (47 resource, key không xuất hiện trong plan) | CI |
| `terraform apply` trên project Google thật, bật Google ở Firebase, SHA-1 | **Chưa chạy** (không có tài khoản Google trong môi trường build). Lần đầu là của bạn |
