# VHub Scan 0.1 — Hướng dẫn test trên điện thoại (benchmark build)

Đây là **bản đo đạc, không phải sản phẩm**. Mục đích: lấy dữ kiện thật từ Tecno Spark 30 Pro để chạy Gate 0–1 trong `docs/RESEARCH.md` §7–8. Chưa có OCR, chưa có dewarp, chưa có cloud.

## Cài đặt
1. GitHub → Actions → run mới nhất của workflow **android** trên nhánh `ccr-409f7fd2-ws5c5a` → tải artifact `vhub-scan-debug-apk` → giải nén → cài `app-debug.apk` (bật "cài từ nguồn không rõ").
2. Lần đầu mở app cấp quyền Camera.

## Thứ tự test (≈ 30 phút)
| # | Việc | Bạn gửi lại cho tôi |
|---|------|---------------------|
| 1 | **Device report** → Share | Dán nguyên văn nội dung. Quan trọng nhất: Android build, danh sách JPEG sizes, `ULTRA_HIGH_RESOLUTION_SENSOR`/`MAXIMUM_RESOLUTION map`, edge/NR modes |
| 2 | **Capture** 1 trang A4 in chữ nhỏ (có dấu tiếng Việt), đặt phẳng, sáng tốt. Dòng "Capture resolution" trên màn hình chụp là độ phân giải thật CameraX chọn | Ảnh chụp màn hình dòng đó |
| 3 | Chụp lại cùng trang với **"Request ISP sharpen/NR off" tắt** rồi bật (2 lần chụp) | So sánh bằng mắt: bản nào nét/noisy hơn |
| 4 | Edit: kéo 4 góc, chọn **A4**, xem 3 chế độ Color/Gray/B&W; vào **inspect** → bấm đúng vào dấu thanh/chữ nhỏ để xem 1:1 | Cảm nhận: dấu có mất/dính không? Có halo quanh chữ đậm không? |
| 5 | Chụp thêm: trang có bóng tay, trang thiếu sáng, trang nghiêng 30°, trang cong | Chế độ nào hỏng, hỏng ở đâu |
| 6 | **Export package** cho 2–3 trang tốt/xấu nhất; **Export PDF** | File zip + PDF + `.log.json` (lấy bằng `adb pull /sdcard/Android/data/com.vhub.scan/files/exports/` hoặc Share) |
| 7 | Ghi lại: thời gian "Export PDF" 1 trang (cảm nhận), máy có nóng/lag/crash/OOM không | Mô tả + ảnh lỗi nếu có |

## Cách đọc kết quả (để feedback chính xác)
- `capture.json`: `storedPixels` = số điểm ảnh ảnh gốc thực tế; `ispOffRequested` chỉ là *yêu cầu* — máy có thể vẫn tự xử lý. Kiểm tra bằng mắt/chart.
- `*.log.json` của PDF: `streamSha256`/`streamBytes` là byte ảnh nhúng đúng như app tạo ra; `effectiveDpi`; `renderMs`.
- PDF không resample ảnh; JPEG q mặc định 95, 4:4:4. B&W là Flate 1-bit lossless. **Không có JBIG2.**
- Corners **chưa xác nhận** (cảnh báo trong danh sách) nghĩa là đang dùng góc tự dò, bạn chưa bấm Save.

## Giới hạn đã biết (đừng tính là lỗi)
- Ảnh rất lớn (nếu máy xuất 108MP) có thể gây hết bộ nhớ khi render full-res: nếu xảy ra, đây là dữ kiện quý — báo lại kích thước và thông báo lỗi.
- Preview trong app là bản thu nhỏ; chỉ "inspect" và PDF/package là full-res.
- Mục "Experimental" (unsharp, CLAHE) mặc định tắt vì chưa qua Gate 1.
- Không có OCR/lớp text, dewarp, đa trang sắp xếp/ghép tách.
- Chưa có benchmark tự động (harness desktop là bước kế tiếp, sau khi có dữ liệu thiết bị).
