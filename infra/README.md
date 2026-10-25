# Bật cloud cho điện thoại (Firebase, miễn phí) — từng bước

Không bắt buộc. Không làm phần này thì app Android vẫn chạy khi điện thoại **cùng Wi-Fi** với PC. Làm phần này thì ra ngoài vẫn xem được digest và bấm Giữ/Bỏ/Hoãn; PC nhận thao tác ở lần đồng bộ sau. Kiến trúc: [`docs/SYNC.md`](../docs/SYNC.md).

Chi phí: **0 đồng**. Không cần bật billing. Mọi thứ nằm trong hạn mức miễn phí của Firebase (gói Spark). Thời gian: khoảng 15 phút, làm một lần.

Mọi lệnh chạy **trên PC của bạn**. Windows: dùng PowerShell.

> **Không bao giờ commit** `infra/terraform.tfvars`, `infra/terraform.tfstate*` và `~/.vhub-trend/cloud.json`. State và cloud.json chứa khoá của PC. Các file này đã có trong `.gitignore`.

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

Mở `infra/terraform.tfvars`, sửa đúng một dòng:

```hcl
project_id = "vhub-trend-482915"   # Project ID của bạn ở Bước 2
```

## Bước 5. Tạo hạ tầng

Vẫn trong thư mục `infra`:

```bash
terraform init
terraform apply
```

Terraform liệt kê **17 thứ sẽ tạo** (bật API, Firebase, Firestore ở Singapore, rules, API key cho điện thoại, service account + khoá cho PC). Gõ `yes`, Enter. Mất 2–5 phút.

Xong khi thấy `Apply complete! Resources: 17 added`. Báo lỗi: xem [Lỗi thường gặp](#lỗi-thường-gặp).

## Bước 6. Nối PC với cloud

Quay về thư mục gốc của repo:

```bash
cd ..
npm run build
npm run cloud:connect
npm run doctor
```

- `cloud:connect` đọc kết quả Terraform và ghi `~/.vhub-trend/cloud.json`.
- `doctor` đồng bộ thử, rồi **đăng nhập thử như điện thoại** và đọc dữ liệu qua rules. Các dòng `cloud:` phải là `[ok]`.

> ### Có thể phải làm bằng tay (1 cú nhấp)
> Nếu `doctor` báo **"Firebase Authentication chưa được khởi tạo"**: mở https://console.firebase.google.com → chọn project của bạn → **Build → Authentication → Get started**. Không cần bật nhà cung cấp đăng nhập nào. Chạy lại `npm run doctor`.
> (Chưa kiểm chứng trên project thật bước này có cần hay không; doctor phát hiện được và báo đúng cách sửa.)

## Bước 7. Ghép nối điện thoại

1. Trên PC chạy `npm run pair`: in mã QR (hạn 1 giờ) và mã dạng chữ. Hoặc mở dashboard trên PC → **Hệ thống → Kết nối điện thoại**.
2. Trên điện thoại: mở app **VHub Trend** → **Kết nối với PC** → **Quét mã**.

Xong. App đọc dữ liệu PC đã đẩy lên cloud, ở đâu cũng xem được; không cần mở dashboard hay cùng Wi-Fi. (Tùy chọn: nếu muốn app hỏi thẳng PC cho nhanh khi cùng Wi-Fi, chạy `npm run dashboard -- --lan` và giữ cửa sổ mở; app tự ưu tiên đường đó khi thấy PC.)

Về mã: nó chứa "chìa khóa" Firebase để điện thoại đọc dữ liệu của bạn (app không có màn đăng nhập), nên đừng chia sẻ. PC đồng bộ sau mỗi `npm run scan` và mỗi 10 phút khi dashboard đang chạy; muốn ngay: `npm run sync`.

## Việc thường làm

| Việc | Lệnh |
|---|---|
| Đồng bộ ngay | `npm run sync` |
| Ghép thêm/lại điện thoại | `npm run pair` hoặc dashboard → Hệ thống |
| Đổi khoá PC (nghi lộ `cloud.json`) | `cd infra && terraform apply -replace=google_service_account_key.pc[0]` rồi `cd .. && npm run cloud:connect` |
| Thu hồi điện thoại bị mất | Đổi token dashboard: xoá `~/.vhub-trend/token`, chạy lại `npm run dashboard -- --lan`. Với cloud: Firebase console → Authentication → Users → xoá user `owner` (điện thoại mất quyền khi token hết hạn, tối đa 1 giờ), rồi ghép lại điện thoại mới |

## Lỗi thường gặp

| Thấy | Làm |
|---|---|
| `terraform: command not found` | Chưa cài, hoặc chưa mở terminal mới sau khi cài (Bước 1) |
| `could not find default credentials` | Chưa làm Bước 3 |
| `Error 403 ... has not been used in project ... or it is disabled` | API vừa bật cần vài phút; chạy lại `terraform apply` |
| `Permission denied to create service account key` / `iam.disableServiceAccountKeyCreation` | Tài khoản thuộc tổ chức cấm tạo khoá. Đặt `create_pc_key = false` trong `terraform.tfvars`, `terraform apply`, rồi dùng project trên tài khoản Gmail cá nhân (không thuộc tổ chức). Cách không cần khoá chưa được hỗ trợ |
| `Database already exists` | Project đã có Firestore. Dùng project mới (Bước 2) hoặc nhập: `terraform import google_firestore_database.default "projects/<id>/databases/(default)"` |
| `doctor`: Google từ chối khoá của PC | Khoá bị xoá hoặc sai project: chạy lại `terraform apply` rồi `npm run cloud:connect` |
| `doctor`: Firestore rules chặn điện thoại | Chạy lại `terraform apply` (rules lấy từ `firebase/firestore.rules`) |

## Gỡ bỏ

Firestore được bảo vệ chống xoá nhầm, nên `terraform destroy` sẽ dừng ở database. Cách sạch nhất: `gcloud projects delete <project id>` (Google giữ 30 ngày rồi xoá hẳn), xoá `~/.vhub-trend/cloud.json`, xoá `infra/terraform.tfstate*`.

## Đã kiểm chứng và chưa

| Mục | Trạng thái |
|---|---|
| `terraform validate`, `terraform plan` (17 resource) không cần tài khoản Google | Chạy trong CI mỗi lần push |
| Firestore rules (chủ đọc snapshot, chỉ tạo event đúng dạng; người khác bị chặn) | 7 test trên emulator, chạy trong CI |
| PC → Firestore → điện thoại và ngược lại (REST, custom token, rules) | Test đầu-cuối trên emulator Firestore + Auth, chạy trong CI |
| `terraform apply` trên project Google thật | **Chưa chạy** (không có tài khoản Google trong môi trường build). Lần đầu là của bạn |
| Bước "Get started" của Authentication có bắt buộc không | **Chưa biết**; doctor phát hiện và chỉ cách sửa |
| Định dạng khoá PC được Google chấp nhận | Đã gọi thật tới `oauth2.googleapis.com` bằng khoá giả: Google đọc được JWT và trả `account not found` (đúng như mong đợi với khoá giả) |
