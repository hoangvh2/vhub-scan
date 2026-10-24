# Quy ước của project

## Nguyên tắc sản phẩm (không đổi nếu chưa hỏi chủ dự án)

- **Không tự động hoá Facebook** (thu thập, đăng nhập, extension). Điều khoản Meta cấm; rủi ro khoá tài khoản. Nguồn tự động chỉ là các nguồn công khai có điều khoản rõ (GitHub, Hacker News, ...).
- **PC-first.** Pipeline chạy trên PC của chủ dự án với Claude CLI. Cloud (Firebase/GCP + Terraform) chỉ là phần phụ sau MVP, dự án GCP riêng.
- **Phạm vi ý tưởng:** công cụ giúp công việc và đời sống. Loại: xử lý ảnh, video, 3D và các kỹ thuật chuyên sâu không nên vibe code. Danh sách loại nằm ở `scope.exclude` trong config.
- Chỉ lưu thông tin công khai của dự án; không lưu tên, hồ sơ cá nhân.

## Kỹ thuật

- Mã và tên bằng tiếng Anh; chuỗi giao diện và tài liệu người dùng bằng tiếng Việt.
- Mọi tầng của pipeline phải **idempotent** và đọc/ghi trạng thái qua SQLite, để chạy lại sau sự cố cho kết quả giống hệt và không gọi LLM lặp. Có kiểm thử phá giữa chừng cho từng tầng (`test/pipeline.test.ts`); thêm tầng mới thì thêm vào đó.
- Mọi lời gọi LLM đi qua `LlmRunner` (cache theo nội dung + phiên bản prompt, ngân sách token ngày, thử lại có giới hạn). Đổi prompt thì tăng `*_VERSION` trong `src/prompts.ts`.
- Không đưa token, khoá, dữ liệu runtime vào repo. Bí mật lấy từ biến môi trường.
- Kiểm thử không dùng mạng thật và không gọi LLM thật. Dùng `FakeLlm`, `fakeFetch`, `test/fake-claude.mjs`.
- Không ghi "đã kiểm chứng" khi chưa có bằng chứng chạy thật. Ghi rõ cái gì đã đo, cái gì chỉ là giả định (xem `docs/DESIGN.md`).

## Xác nhận trước khi thực hiện thao tác phá huỷ

Mọi thao tác **xoá dữ liệu, xoá nguồn/dự án, đăng xuất** trên web và Android **phải hiện hộp thoại xác nhận** (nút huỷ bên trái, hành động bên phải, màu đỏ), không bao giờ chạy ngay từ một cử chỉ hoặc phím tắt. Giữ/Bỏ/Hoãn không phá huỷ (đổi trạng thái, có Hoàn tác) nên không cần xác nhận. Tính năng mới có thao tác phá huỷ phải kèm test cho cả "Không" và "Xoá".
