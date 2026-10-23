# VHub Scan — Research & Technical Design (v0.2 · Fidelity-first)

> Ngày: 2026-10-23 · Trạng thái: **desk-research + thiết kế benchmark. CHƯA có bất kỳ phép đo nào trên Tecno Spark 30 Pro hay trên ảnh thật.**
> Phiên nghiên cứu không có thiết bị, không có máy scan phẳng → mọi mục "chất lượng", "tốc độ" bên dưới là **giả thuyết** cho đến khi chạy benchmark ở §8.
>
> Nhãn: **[V]** đã xác minh từ nguồn trong phiên · **[S]** nguồn thứ cấp/blog · **[K]** kiến thức nền, chưa mở lại nguồn · **[H]** giả thuyết cần thử · **[U]** Unknown.
>
> **Thay đổi so với v0.1:** (1) tiêu chí sản phẩm chuyển từ "ảnh đẹp" sang *trung thực thông tin* (không đổi/mất ký tự, dấu, nét mảnh, chữ viết tay); (2) phân loại mọi bước xử lý theo mức mất/đổi thông tin; (3) thiết kế 3 chế độ + giữ ảnh gốc không phá huỷ; (4) PDF không nén có thể đổi ký tự; (5) benchmark nhỏ nhất đủ loại phương án kém, có tiêu chí đạt/không đạt đặt trước; (6) quy trình xác minh máy thật; (7) bỏ các khuyến nghị v0.1 chưa có bằng chứng (MRC/JBIG2, dewarp mặc định, CLAHE mặc định).

---

## 1. Executive Summary

- **Kiến trúc v0.1 chưa được xác nhận** vì chưa có bằng chứng về chất lượng. Báo cáo này không "chọn công nghệ" mà **chọn các ứng viên + cách loại bỏ chúng**. Kiến trúc chỉ được chốt sau khi qua cổng Gate 1–3 (§8.6).
- **Nguyên tắc thiết kế:** *"Không sinh nội dung mới"*. Phép xử lý mặc định chỉ được (a) biến đổi hình học từ **ảnh gốc, một lần lấy mẫu**, (b) hiệu chỉnh ánh sáng theo hệ số (nhân/chia từng điểm ảnh), không sửa cấu trúc nét. Mọi bước làm đổi nét cục bộ (sharpen, denoise, CLAHE, binarize) mặc định **TẮT**, chỉ bật khi benchmark chứng minh không mất/không thêm nét.
- **Ba chế độ:** Color/Fidelity (mặc định) · Grayscale · Clean Black & White (dẫn xuất, không thay thế gốc). **Ảnh gốc độ phân giải cao luôn được giữ**; chế độ là "view" có thể đổi/quay lại bất kỳ lúc nào.
- **PDF:** nhúng ảnh không resample, JPEG chất lượng cao hoặc lossless; **cấm JBIG2 lossy / symbol-mode** (vụ Xerox 2013 đổi số trong bản scan [V]). Phân biệt rõ *PDF ảnh-thuần* và *PDF có lớp OCR ẩn* (lớp OCR chỉ là lớp phủ, không bao giờ thay pixel).
- **Deep learning:** phân loại theo rủi ro. Mô hình **hình học** (UVDoc: xuất lưới dịch chuyển áp lên ảnh gốc) là *ứng viên có thể chấp nhận* nhưng **không vào pipeline mặc định trừ khi benchmark thắng**. Mô hình **ngoại hình/sinh ảnh** (DocRes appearance/binarize, GAN/ESRGAN, diffusion) **loại khỏi mặc định**; chỉ dùng làm đối chứng âm trong benchmark.
- **Benchmark tối thiểu (§8):** ~12 loại trang × 5 điều kiện ≈ 60 lần chụp, chụp một lần, xử lý offline bằng ~12 ứng viên + app đối thủ (nhập cùng một ảnh). Reference = máy scan phẳng 600 dpi (nếu có) hoặc file nguồn PDF cho trang in. Có **kiểm tra tính hợp lệ của chính metric** bằng mẫu đối chứng âm.
- **Chưa được tuyên bố** "vượt app trả phí" hay "gần máy photocopy cao cấp". Tuyên bố đó chỉ được phép sau khi có bảng so sánh §8 với khoảng tin cậy.

**Quyết định cần bạn xác nhận** (trả lời ngắn): (Q1) Có máy scan phẳng ≥ 600 dpi hoặc máy photocopy chất lượng cao để làm reference không? (Q2) Chấp nhận bộ ngưỡng đạt/không đạt đề xuất ở §8.6 làm điểm khởi đầu (hiệu chỉnh sau pilot) không? (Q3) Có cần hỗ trợ máy không có Google Play Services không (ảnh hưởng ML Kit)?

---

## 2. Evidence đã xác minh (cập nhật)

| # | Fact | Nhãn | Nguồn |
|---|------|------|-------|
| E1 | Xerox WorkCentre (2013): scan bị **đổi chữ số** (vd 21.11m → 14.13m; 6↔8) do JBIG2 tái dùng mảnh ảnh "giống nhau"; chế độ nén cao nhất bị lỗi, và nâng chất lượng không loại trừ hoàn toàn | V | [Network World](https://www.networkworld.com/article/677764/data-center-xerox-scanners-found-to-sometimes-alter-numbers.html) · [TidBITS](https://tidbits.com/2013/08/05/researcher-finds-some-copiers-can-alter-scanned-numbers/) · [Computerworld](https://www.computerworld.com/?p=1398177) |
| E2 | jbig2enc có 2 kiểu mã hoá: *generic region* và *symbol extraction/classification + text region*; README không cảnh báo về hoán đổi ký tự; license không nêu rõ trên trang (Leptonica "Apache-ish") | V (một phần) | [repo](https://github.com/agl/jbig2enc) |
| E3 | Super-resolution có thể **bịa nét** (serif, mảnh glyph) trong ảnh văn bản nhoè, làm tăng IoU nhưng đổi nghĩa; khẳng định "Real-ESRGAN không hallucinate" chỉ là lời tác giả, chưa có số đo | S | [arXiv 2506.06953](https://arxiv.org/pdf/2506.06953) |
| E4 | Real-ESRGAN: BSD-3-Clause, 37.2k★, huấn luyện bằng dữ liệu tổng hợp; bản NCNN có thể tạo seam do cắt tile | V | [repo](https://github.com/xinntao/Real-ESRGAN) |
| E5 | DocRes (CVPR'24): làm dewarp, deshadow, appearance, deblur, binarize trong 1 mô hình; repo nhãn **MIT**, 680★, 27 commit; trọng số tải từ OneDrive; **giấy phép dữ liệu huấn luyện không nêu** | V / U | [repo](https://github.com/ZZZHANG-jx/DocRes) · [paper](https://arxiv.org/pdf/2405.04408) |
| E6 | UVDoc: MIT, 251★, 3 commit; MS-SSIM 0.785 vs DocTr 0.697, DewarpNet 0.589 (số đã hiệu chỉnh); ONNX cộng đồng input 720×496, xuất lưới → `cv2.remap`; PaddleOCR liệt kê 30.3MB / 869ms CPU (thiết bị không rõ) | V/S | [repo](https://github.com/tanguymagne/UVDoc) · [HF ONNX](https://huggingface.co/fredcallagan/uvdoc-grid-onnx) · [PaddleOCR](https://www.paddleocr.ai/latest/en/version3.x/module_usage/text_image_unwarping.html) |
| E7 | Danh mục dewarp/deshadow/illumination/binarization + dataset (DocUNet, Doc3D, DIR300, RDD, SD7K, DIBCO…) có tại một repo tổng hợp; dewarp mới nhất tới 2026 (ForCenNet, D2Dewarp, TextFlow) | V | [Recommendations-Document-Image-Processing](https://github.com/ZZZHANG-jx/Recommendations-Document-Image-Processing) |
| E8 | DIBCO dùng F-measure, pseudo-F (nhấn mạnh nét mảnh/skeleton), PSNR, DRD; nên dùng công cụ chính thức, công thức một số paper bị đảo recall/precision | V | [arXiv 2401.11831](https://arxiv.org/pdf/2401.11831) |
| E9 | Slanted-edge SFR theo ISO 12233; công cụ mở: MTF Mapper (sai số MTF50 thường < 2% theo một người dùng), sfrmat (Burns) | V/S | [Imatest](https://www.imatest.com/docs/validating_slanted_edge) · [kasson](https://blog.kasson.com/?p=5809) |
| E10 | Android 12+ (API 31): chế độ pixel *MAXIMUM_RESOLUTION* chỉ có trên cảm biến khai báo capability ULTRA_HIGH_RESOLUTION_SENSOR; mặc định cảm biến **binning**; có stream-config map riêng | V | [API diff 31](https://developer.android.com/sdk/api_diff/31/changes/android.hardware.camera2.CameraMetadata) |
| E11 | Tecno Spark 30 Pro theo GSMArena: Helio G100, camera 108MP 1/1.52", xuất xưởng Android 14. **Đã bị thiết bị thật phản bác một phần — xem §7.1** (máy test báo Android 15, SoC MT6789, camera sau 12MP 5.22×3.92mm) | V (thiết bị) | [GSMArena](https://m.gsmarena.com/tecno_spark_30_pro-13357.php) · §7.1 |
| E12 | OpenCV: Apache-2.0, 91.3k★ · PdfBox-Android: Apache-2.0, 1.2k★, dựa PDFBox 2.0.27, README nói "most features implemented" (bảo trì thấp) · DocAligner: Apache-2.0, 120★, ONNX | V | [OpenCV](https://github.com/opencv/opencv) · [PdfBox-Android](https://github.com/TomRoush/PdfBox-Android) · [DocAligner](https://github.com/docsaidlab/DocAligner) |
| E13 | ML Kit Doc Scanner: UI trọn gói, JPEG/PDF, minSdk 21, RAM ≥ 1.7GB; ML Kit Text v2 tách script, Japanese riêng, bundled ~4MB/script. Việt nằm trong Latin hay không: **chưa xác minh** | V / U | [doc scanner](https://developers.google.com/ml-kit/vision/doc-scanner/android) · [text v2](https://developers.google.com/ml-kit/vision/text-recognition/v2) |
| E14 | PaddleOCR Apache-2.0, 3.7.0 (2026-06-11), PP-OCRv6 Trung/Anh/Nhật + 46 Latin; Việt không nêu tên | V / U | [repo](https://github.com/PaddlePaddle/PaddleOCR) |
| E15 | Text ẩn trong PDF dùng text render mode 3 — chỉ là lớp text, không đổi ảnh | V | [PDF Kung Foo](https://leanpub.com/read/pdfkungfoo/make-ocr-visible) |

**Không tìm được (và sẽ không suy diễn):** benchmark độc lập, trên mobile, về *độ trung thực chi tiết* của Adobe Scan / CamScanner / Genius Scan / Lens / ML Kit; số đo UVDoc/DocRes trên Helio G100; bằng chứng ML Kit/Paddle đọc dấu tiếng Việt tốt.

---

## 3. Pipeline xử lý ảnh — phân tích theo bảo toàn thông tin

### 3.1 Phân loại mọi phép biến đổi theo mức rủi ro thông tin

| Tier | Loại | Ví dụ | Khả năng làm mất/đổi nét | Quy tắc |
|---|---|---|---|---|
| **T0** | Hình học, 1 lần lấy mẫu từ ảnh gốc | Homography, remap lưới dewarp, Lanczos/bicubic | Làm mờ nhẹ do nội suy; sai lệch nếu hình học sai | Cho phép mặc định. **Gộp mọi phép hình học thành 1 bản đồ rồi remap 1 lần** (không warp nhiều lần) |
| **T1** | Điểm ảnh theo hệ số cục bộ mượt | Chia cho nền ước lượng (illumination normalization), cân bằng trắng | Không đổi cấu trúc nét nếu nền mượt & ước lượng không "ăn" mực | Cho phép mặc định nếu qua benchmark; giữ tuyến tính hoá/gamma nhất quán, chặn hệ số tối đa |
| **T2** | Lọc cục bộ phi tuyến | Denoise (NLM, bilateral), CLAHE, unsharp mask, deconvolution | Xoá nét mảnh, dấu tiếng Việt, chữ viết tay nhạt; halo/ringing; khuếch đại nhiễu | **TẮT mặc định**; chỉ bật có điều kiện & có mặt nạ |
| **T3** | Bất khả đảo | Nhị phân hoá (Otsu/Sauvola/Wolf), giảm màu | Mất nét nhạt, mất anti-aliasing, dính/đứt nét | Chỉ trong chế độ B&W dẫn xuất; luôn giữ gốc |
| **T4** | Sinh/khôi phục bằng học sâu | ESRGAN/diffusion SR, GAN enhance, DocRes appearance/binarize | **Có thể bịa/đổi ký tự** [E3] | **Cấm trong mặc định.** Chỉ làm đối chứng âm trong benchmark |

> Bài học E1: một lỗi "nhìn vẫn sạch đẹp" nhưng đổi số liệu là lỗi nghiêm trọng nhất của sản phẩm scan. Vì vậy mọi ứng viên T2–T4 phải qua phép đo *false-ink / lost-ink* (§8.4), không chỉ OCR hay "nhìn đẹp".

### 3.2 Từng khâu

| Khâu | Phương án | Bảo toàn thông tin | Rủi ro/Ghi chú | Trạng thái |
|---|---|---|---|---|
| **Capture** | Camera2 (không chỉ CameraX): chọn độ phân giải tối đa mà máy *thật sự* phơi ra; khoá AF khi nét; AE/ISO/exposure giới hạn để tránh rung; tắt flash; ưu tiên JPEG chất lượng cao hoặc RAW/DNG nếu có; đặt `EDGE_MODE`, `NOISE_REDUCTION_MODE` về thấp nhất nếu máy cho phép (vendor ISP thường tự sharpen/denoise) | Quyết định phần lớn chất lượng cuối; không hậu kỳ nào cứu được ảnh mờ/binning | Vendor ISP của HiOS có thể áp NR/sharpen không tắt được — **[U] phải đo** bằng chart slanted-edge. Multi-frame: chọn khung nét nhất (Laplacian/độ nét) là T0-an toàn; **fusion/super-res nhiều khung = giả thuyết [H]** (có thể tăng chi tiết thật, nhưng cần test false-ink) | Test ở Phase 0 |
| **Phát hiện 4 góc** | Model nhỏ + OpenCV tinh chỉnh subpixel; kiểm tra tứ giác hợp lệ; cho phép chỉnh tay | Sai góc → biến dạng hình học (ảnh hưởng thẳng hàng/tỉ lệ) | Người dùng luôn có handle chỉnh tay là điều kiện bắt buộc | Ứng viên |
| **Perspective** | Homography từ 4 góc; **ước lượng tỉ lệ khung thật** (từ góc + tiêu cự, hoặc chọn khổ giấy), không suy từ pixel kéo giãn; nội suy Lanczos/bicubic; kích thước đầu ra ≥ độ phân giải cạnh gần camera nhất (không hạ mẫu) | T0 | Sai tỉ lệ khung làm chữ méo [H] — đo aspect error | Ứng viên chính |
| **Dewarp** | (a) Không dewarp; (b) UVDoc lưới → remap lên ảnh gốc; (c) DocRes dewarp; (d) phương pháp cổ điển theo dòng chữ | (b),(c) là T0 nhưng **lưới sai làm vỡ/cong nét**; mô hình có thể sai trên bảng/ảnh/đường kẻ | Ngoài miền (bảng, chữ Nhật dọc, trang nhiều ảnh) chưa rõ [U]. Chỉ vào mặc định nếu thắng trên trang cong mà **không** làm giảm trang phẳng (§8.6) | Ứng viên tuỳ chọn |
| **Shadow / illumination** | (a) Chia cho nền (large-kernel morph close/median, hoặc fit bề mặt + loại mực bằng mặt nạ); (b) Retinex; (c) DL (DocRes deshadow, BGShadowNet…) | (a) là T1, minh bạch, kiểm soát được; (c) có thể xoá cả nét/ghi chú mờ | Rủi ro (a): "ăn" nét đậm lớn → halo; vùng tối quá khiến khuếch đại nhiễu → cần chặn hệ số. Rủi ro (c): T4 | (a) ứng viên mặc định; (c) đối chứng |
| **Denoise** | NLM/bilateral/BM3D; hay chỉ trên chroma/vùng nền | Dễ xoá nét mảnh/dấu | Mặc định TẮT. Nếu bật: chỉ mặt nạ nền (không mực), cường độ thấp | T2, benchmark |
| **Sharpen** | USM vs deconvolution theo PSF đo từ slanted-edge vs không làm gì | USM tạo overshoot/halo, "ép" nét giả; deconv trung thực hơn nhưng ringing/nhạy nhiễu | Mục tiêu "sắc nét" nên đạt chủ yếu nhờ **capture đúng + nội suy tốt**, không nhờ hậu kỳ [H] | T2, benchmark |
| **Adaptive threshold** | Otsu, Sauvola, Wolf, Niblack; DL (DocRes, DeepOtsu…) | T3: mất nét nhạt/anti-alias; chữ viết tay nhẹ tay, đường kẻ 0.25pt dễ đứt | Dẫn xuất, không thay gốc; thử thêm "gray 4-level"/"soft threshold" giữ anti-aliasing | T3 |
| **Giữ màu** | Cân bằng trắng theo nền giấy + giữ nguyên độ bão hoà; không "pop" màu | ΔE so với reference (cần target màu hoặc scanner) | Con người thường thích ảnh "pop" nhưng đó là sai trung thực — chấm riêng 2 trục | T1 |

### 3.3 OpenCV truyền thống vs Deep learning — kết luận có điều kiện

| | OpenCV/cổ điển | Deep learning |
|---|---|---|
| Hình học (corner, warp) | Cần heuristic; ổn khi tương phản tốt; thất bại nền khó [H] | Mạnh hơn trên nền khó [H] — dùng để *đề xuất*, OpenCV tinh chỉnh + kiểm tra |
| Dewarp trang cong | Khó | UVDoc/DocTr… tốt hơn trên benchmark của họ [E6]; **giá trị trên ảnh tài liệu thực của bạn chưa biết** |
| Ánh sáng/bóng | Chia nền: minh bạch, kiểm soát được | Có thể sạch hơn nhưng **không kiểm chứng được từng pixel** → rủi ro T4 |
| Nhị phân | Sauvola/Wolf: xác định, giải thích được | DL có điểm DIBCO cao [E7,E8] nhưng đo trên tài liệu lịch sử, không phải dấu tiếng Việt/chữ Nhật nhỏ từ ảnh điện thoại [U] |
| Sắc nét | Không sinh nội dung | SR/GAN: có thể "đẹp hơn" nhưng đổi nét [E3] |
| Giấy phép/triển khai | Apache-2.0, nhẹ [E12] | Trọng số có thể bị ràng buộc dữ liệu huấn luyện; nặng, tốn pin |

**Kết luận (giả thuyết cần kiểm chứng):** kỹ thuật bảo toàn thông tin tốt nhất là *capture tốt + một lần remap hình học + chia nền có mặt nạ mực + (tuỳ chọn) nhị phân hoá dẫn xuất*; DL chỉ nên nằm ở *đề xuất góc* và *lưới dewarp*. Điều này chưa được chứng minh — benchmark §8 là để chứng minh hoặc bác bỏ.

---

## 4. Thiết kế chế độ scan & ảnh gốc (non-destructive)

**Mô hình dữ liệu mỗi trang:**
- `original`: ảnh gốc độ phân giải tối đa máy cho (JPEG chất lượng cao; DNG/RAW nếu hỗ trợ và đo được lợi ích). **Không bao giờ bị ghi đè.**
- `edit` (sidecar JSON, có version): 4 góc, tuỳ chọn dewarp (lưới), chế độ, tham số (ngưỡng, hệ số nền…), phiên bản thuật toán → render lại tái lập được.
- `render`: cache đầu ra, xoá/tạo lại được.

| Chế độ | Mô tả | Xử lý áp dụng | Rủi ro | Khi nào dùng |
|---|---|---|---|---|
| **Original** | Chỉ cắt/nắn phối cảnh (hoặc không) | T0 | Thấp nhất | Bằng chứng, tài liệu nhạy cảm số liệu |
| **Color / Fidelity** *(mặc định)* | Nền trắng đều, màu trung thực | T0 + T1 (nếu qua gate) | Halo nhẹ nếu chia nền sai | Hầu hết trang, ảnh/biểu đồ màu |
| **Grayscale** | Luma cố định (BT.709) sau T0+T1 | T0 + T1 | Mất phân biệt màu | Văn bản, dung lượng thấp hơn |
| **Clean B&W** | Nhị phân thích nghi từ gray; tuỳ chọn 4-level | T0 + T1 + T3 | Mất nét nhạt, đứt đường mảnh, dấu | Chỉ văn bản in rõ; luôn kèm cảnh báo & so sánh trước/sau |

- Enhancement mạnh **không bắt buộc** cho mọi trang; mỗi trang có thể ở chế độ khác nhau (batch có "áp dụng cho tất cả" nhưng ghi đè từng trang được).
- UI cần có công cụ **so sánh gốc ↔ kết quả (zoom 1:1, kéo thanh)** để người dùng phát hiện mất nét.
- Chi phí lưu trữ gốc: ảnh 108MP JPEG có thể rất lớn [H, chưa đo] → cần chính sách giữ/nén gốc (vd giữ gốc cho đến khi người dùng xác nhận "đã xong", hoặc xuất gói gốc kèm PDF). Số đo thực ở Phase 0.

---

## 5. PDF — đánh giá

| Hạng mục | Quy tắc đề xuất | Lý do |
|---|---|---|
| Ảnh nhúng | Nhúng **đúng pixel của render**, không resample, không chuyển mã âm thầm. Màu/gray: JPEG q ≥ ngưỡng đo được (ví dụ khởi điểm 92–95, 4:4:4, không chroma subsampling) hoặc lossless (Flate). B&W: **CCITT G4 hoặc Flate (lossless)** | Tránh double-compression; 4:2:0 làm mờ viền màu của chữ |
| JBIG2 | **Cấm lossy và symbol/text-region mode.** Nếu sau này muốn dùng: chỉ *generic region lossless* và chỉ khi chứng minh bit-exact (giải nén so từng pixel với nguồn) trên toàn bộ bộ test | E1 — đổi ký tự/số |
| MRC (tách lớp chữ/nền) | **Không vào MVP.** Chỉ đánh giá sau, với kiểm tra false/lost-ink vì mask lớp chữ là nhị phân | Giả thuyết giảm dung lượng, nhưng T3 áp lên chữ |
| JPEG2000 | Tuỳ chọn, chỉ lossless; độ tương thích viewer cần test | |
| Độ phân giải & tỉ lệ trang | Đặt `MediaBox` theo kích thước vật lý ước lượng (khổ giấy nhận diện hoặc người dùng chọn), DPI = pixel/kích thước; không ép về 72/150 dpi; tỉ lệ ảnh = tỉ lệ trang, không bóp méo | Giữ hình học |
| Xác minh | Sau khi xuất: `pdfimages -list`/trích ảnh, so checksum/PSNR = ∞ với render dự kiến (đối với lossless) hoặc chênh ≤ ngưỡng JPEG đã biết; qpdf/veraPDF kiểm hợp lệ | Phát hiện "giảm chất lượng âm thầm" |
| **PDF ảnh-thuần** | Chỉ chứa ảnh; không search/copy; trung thực tuyệt đối với ảnh | Mặc định an toàn nhất |
| **PDF có lớp OCR (searchable)** | Ảnh nguyên vẹn + text render mode 3 [E15] đặt theo bounding box; **luôn nói rõ lớp text có thể sai** (đặc biệt dấu tiếng Việt, kanji) và cho phép tắt | OCR sai không được ảnh hưởng ảnh |
| PDF/A | Hoãn | Không phải ưu tiên chất lượng ảnh |
| Thư viện | Tự viết writer tối giản (kiểm soát hoàn toàn byte ảnh) hoặc PdfBox-Android (Apache-2.0, bảo trì thấp [E12]); tránh AGPL (iText, MuPDF) [K] | Giấy phép/độ kiểm soát |

---

## 6. Re-evaluate lựa chọn công nghệ

| Công nghệ | Dùng cho | Giấy phép | Bảo trì | Rủi ro | Quyết định |
|---|---|---|---|---|---|
| Camera2 (+ CameraX cho preview nếu tiện) | Capture full-res, kiểm soát AF/AE/NR/Edge | AOSP/Jetpack [K] | Tốt [K] | Hành vi vendor; CameraX có thể không phơi ULTRA_HIGH_RES [U] | **Dùng Camera2 cho chụp**; xác minh trên máy |
| OpenCV | Warp, morph, threshold, tiện ích | Apache-2.0 [V] | Tốt (91k★) | Kích thước APK; JNI | Dùng |
| ML Kit Document Scanner | **Baseline đối chứng** | Điều khoản Google [K] | Google | Hộp đen; cần Play Services; chất lượng PDF không kiểm soát | Chỉ làm baseline/ fallback |
| UVDoc (ONNX) | Lưới dewarp | MIT [V]; dataset UVDoc cần kiểm [U] | Thấp (3 commit) [V] | Lưới sai; hiệu năng chưa đo; ONNX cộng đồng chưa chính thức | Ứng viên, **không mặc định** |
| DocRes | Đối chứng (deshadow/binarize), có thể dewarp | MIT repo [V]; **trọng số/dữ liệu huấn luyện [U]** | Thấp (27 commit) | T4; nặng; license dữ liệu | Đối chứng âm/ứng viên nghiên cứu; không ship nếu license chưa rõ |
| Real-ESRGAN | Đối chứng âm (hallucination) | BSD-3 [V] | Trung bình | T4; seam tile [V] | Chỉ trong benchmark |
| DocAligner | Ứng viên phát hiện góc | Apache-2.0 [V] | Thấp (120★) | Chưa có số liệu; dataset nguồn [U] | Ứng viên |
| PaddleOCR / RapidOCR (ONNX) | OCR | Apache-2.0 [V] | Tốt | Việt [U]; nặng pin | Ứng viên OCR |
| ML Kit Text v2 | OCR | ML Kit terms [K] | Google | Việt [U] | Ứng viên OCR |
| Tesseract | OCR fallback | Apache-2.0 [K] | Tốt | Chậm, độ chính xác ảnh chụp [U] | Fallback |
| jbig2enc | — | License không rõ trên trang [V] | — | E1 | **Loại khỏi MVP** |
| MTF Mapper / sfrmat | Đo độ nét | Công cụ đo, không ship | — | — | Dùng trong benchmark |

Chi phí cloud: giữ nguyên kết luận v0.1 — **xử lý local, cloud = 0 ở MVP**; sync tuỳ chọn là Phase muộn (Cloud Storage cần Blaze, không hard-cap [S]). Ước tính v0.1 (≈$0 local; ≈$5–18/tháng ở 10.000 user nếu 20% bật sync, 15MB/user/tháng) giữ làm tham khảo, **nhưng nếu giữ ảnh gốc độ phân giải cao thì dung lượng/user cao hơn nhiều lần → sync gốc lên cloud không còn "gần 0"**; mặc định chỉ sync PDF, gốc ở local/ xuất thủ công.

---

## 7. Xác minh thiết bị Tecno Spark 30 Pro (phải làm trước khi tin bất kỳ số nào)

Tôi **không có quyền truy cập thiết bị** trong phiên này, nên không có số đo. Checklist bắt buộc (ghi kết quả vào `docs/device-report.md`):

| Hạng mục | Cách xác minh | Mục đích |
|---|---|---|
| Android/build | `adb shell getprop ro.build.version.release`, `ro.build.version.sdk`, `ro.build.display.id`, `ro.build.version.security_patch` | Xác nhận Android 15 hay 14 (GSMArena: xuất xưởng 14 [V]) |
| Camera thật | Camera2 `CameraCharacteristics`: danh sách camera ID (logical/physical), `SCALER_STREAM_CONFIGURATION_MAP` (kích thước JPEG/YUV tối đa), `REQUEST_AVAILABLE_CAPABILITIES` (RAW, ULTRA_HIGH_RESOLUTION_SENSOR), `INFO_SUPPORTED_HARDWARE_LEVEL`, `LENS_INFO_MINIMUM_FOCUS_DISTANCE`, `EDGE_AVAILABLE_EDGE_MODES`, `NOISE_REDUCTION_AVAILABLE_MODES`; `adb shell dumpsys media.camera` | Biết 108MP có thực sự ra được không [E10], có tắt được sharpen/NR không |
| Chất lượng quang học thực | Chụp chart slanted-edge + resolution wedge ở khoảng cách A4/A5; đo MTF50, overshoot bằng MTF Mapper | Khoảng sắc nét tối đa của phần cứng — **trần chất lượng** mà hậu kỳ không vượt được |
| Bộ nhớ | `adb shell cat /proc/meminfo`, `getprop dalvik.vm.heapgrowthlimit`, `dalvik.vm.heapsize`; `dumpsys meminfo <pkg>` khi xử lý 12/27/108MP | Giới hạn RAM native/Java, ngưỡng OOM |
| Hiệu năng | Thời gian từng khâu, p50/p95, trên máy thật; CPU/GPU/NNAPI thực dụng được | Không suy từ desktop |
| Nhiệt/pin | `dumpsys thermalservice`, `dumpsys batterystats --reset` → chạy 15 phút quét liên tục, độ sáng cố định, chế độ bay; nhiệt kế ngoài | Throttling của Helio G100 |

### 7.1 Kết quả đo thiết bị thật (device_report, 2026-10-23) — [V] trừ khi ghi khác

| Mục | Kết quả | Hệ quả |
|---|---|---|
| Máy/Build | `TECNO KM6`, **Android 15 (SDK 35)**, build `KM6-15.1.2.195`, patch 2026-09-05 | Android 15 xác nhận. Edge-to-edge bắt buộc → UI phải xử lý inset (đã sửa v0.1.1) |
| SoC | `MT6789` (8 nhân), 7682MB RAM (trống ~2264MB lúc đo), memoryClass 256/512MB | **Lệch với GSMArena (Helio G100).** MT6789 thường là Helio G99 [K, chưa kiểm]. Chưa chắc "KM6" = Spark 30 Pro: cần bạn xác nhận Settings → About phone |
| Camera sau (id 0) | pixel array **4080×3072 (12.5MP)**, cảm biến **5.22×3.92 mm**, f/1.6, tiêu cự 4.11mm, hardware level FULL | **Không có đường truy cập 108MP/1/1.52" cho app bên thứ ba** trên máy này (có thể do biến thể máy, hoặc 108MP chỉ mở cho app camera hãng). Kích thước vật lý 5.22mm không khớp 1/1.52" (~8.4mm) |
| Độ phân giải tối đa xuất được | JPEG/YUV **4064×3048 (12.4MP)**, RAW_SENSOR 4080×3072; `MAXIMUM_RESOLUTION map: none`, không có ULTRA_HIGH_RESOLUTION_SENSOR | **Trần phần cứng cho benchmark = 12MP.** A4 ở 12MP ≈ 3048px/297mm ≈ **260 dpi lý thuyết, thực tế thấp hơn** (viền/ghép/phối cảnh). Kỳ vọng "gần photocopy 300–600 dpi" phải hạ cho tới khi có số đo |
| Capability | MANUAL_SENSOR, MANUAL_POST_PROCESSING, **RAW**, BURST_CAPTURE (+ capability "5" = READ_SENSOR_SETTINGS [K]) | **RAW (DNG) khả dụng → đường tránh ISP sharpen/NR của hãng**; BURST cho phép chọn khung nét nhất. Cả hai là giả thuyết cần thử, chưa triển khai |
| Chế độ ISP | EDGE: 0,1,2 (có OFF); NR: 0,1,2,3 (có OFF) | Yêu cầu tắt hợp lệ; *ISP thật có tuân thủ hay không* vẫn phải đo bằng slanted-edge |
| AF | AF modes 0–4 có; `LENS_INFO_MINIMUM_FOCUS_DISTANCE = null` (không báo) | Không suy được khoảng lấy nét gần nhất → đo thực nghiệm ở khoảng cách A4/A5 |
| Camera trước | 13MP, không AF | Không dùng để scan |

**Phản hồi từ ảnh chụp màn hình màn hình Edit (bản 0.1.0):**
1. **Bug UI:** Android 15 vẽ nội dung dưới thanh trạng thái → handle góc trên-trái bị đồng hồ che; handle ở sát mép khung không kéo được vì vùng chạm nằm ngoài ảnh. Đã sửa: tôn trọng inset + lề 32dp quanh ảnh.
2. **Dò góc sai:** khung xanh ôm sát mép dưới/trái của ảnh thay vì mép giấy (nền lộn xộn, trang bị cắt ở mép trái). Đã đổi bộ dò: nhiều ứng viên + chấm điểm "giấy sáng hơn viền ngoài" thay vì chọn contour lớn nhất. **Chưa kiểm chứng** vì tôi không có ảnh gốc để chạy.
3. **Lỗi chụp:** trang có vẻ bị cắt ở mép trái (không đủ khung). Không thuật toán nào dựng lại được phần ngoài khung → app giờ cảnh báo khi góc sát mép. Quy trình test phải chụp đủ cả trang kèm lề.
4. Từ ảnh chụp màn hình **không thể đánh giá độ nhoè/mất nét** (ảnh bị thu nhỏ khi hiển thị) → đánh giá fidelity chỉ dùng "inspect" 1:1/gói export.
5. **Riêng tư:** trang trong ảnh có vẻ là tài liệu y tế có thông tin cá nhân. Gói export sẽ gửi cho tôi nên **dùng tài liệu không nhạy cảm** (hoặc che thông tin) cho benchmark.

Quy tắc: số **desktop** chỉ dùng cho *đo fidelity* (xác định, không phụ thuộc phần cứng); mọi số **tốc độ/RAM/pin/nhiệt** phải đo trên Spark 30 Pro.

---

## 8. Benchmark bắt buộc (nhỏ nhất nhưng đủ loại phương án kém)

### 8.1 Mục tiêu & nguyên tắc
- Trả lời 3 câu: (1) ứng viên nào **làm mất/đổi nét**; (2) ứng viên nào **cải thiện thật** (đồng đều ánh sáng, hình học, đọc được) mà **không** vi phạm (1); (3) so với app đối thủ trên **cùng đầu vào**.
- Chụp **một lần**, xử lý **offline** bằng mọi ứng viên → so sánh công bằng, không phụ thuộc may mắn lúc chụp.
- Pre-registration: ngưỡng đạt/không đạt (§8.6) được chốt **trước** khi chạy.

### 8.2 Bộ tài liệu & reference

| Loại trang | Nội dung | Reference |
|---|---|---|
| T1 Chữ nhỏ Latin | 4/6/8/10/12 pt, serif & sans | PDF nguồn + scan phẳng |
| T2 Tiếng Việt | Đoạn dày dấu chồng (ệ, ẫ, ử, ợ…) cỡ 8–12pt; cặp gần nhau như ă/â, ơ/ô | như trên |
| T3 Tiếng Nhật | Kanji phức tạp (鬱, 響…), kana cỡ 6–10pt, dọc & ngang, furigana | như trên |
| T4 Chữ viết tay | Bút bi/chì/mực nhạt, nét ép nhẹ, chữ ký — *trang thật* | **Chỉ scan phẳng** làm reference |
| T5 Bảng số liệu | Bảng 0.25pt/0.5pt, số nhỏ gần nhau (6/8/0, 1/7) | PDF nguồn + scan phẳng |
| T6 Đường kẻ mảnh & hình học | Lưới, hình tròn, đường chéo | PDF nguồn |
| T7 Biểu đồ | Đường mảnh, marker, chú thích nhỏ | PDF nguồn |
| T8 Ảnh màu | Ảnh + ColorChecker/IT8 in hoặc target màu (nếu có) | Scan phẳng + giá trị target |
| T9 Chart đo | ISO 12233 slanted-edge, resolution wedge (đặt cạnh trang) | Lý thuyết/ MTF Mapper |
| T10 Hoá đơn nhiệt / giấy mỏng lộ chữ mặt sau | Tương phản thấp | Scan phẳng |
| T11 Trang đã photocopy / giấy ngả vàng | Nền không trắng | Scan phẳng |
| T12 Trang sách gáy cong | Dewarp | Scan phẳng trang ép phẳng nếu được; hoặc phiên bản in rời |

**Điều kiện chụp (mỗi trang):** C1 phẳng, sáng tốt (đối chứng) · C2 bóng đổ (tay/điện thoại) · C3 ánh sáng yếu (~50–100 lux) · C4 nghiêng 30° + nền khó · C5 cong (T12, hoặc giấy uốn nhẹ). Tối thiểu 12×5 = **60 lần chụp**; mỗi cái chụp 3 khung liền để đo độ ổn định.

**Reference:** (a) **Máy scan phẳng ≥ 600 dpi, tắt mọi "enhance/descreen"**, lưu TIFF — cần xác nhận bạn có không (Q1). Nếu không: dùng PDF nguồn cho trang in (nội dung chuẩn nhưng chịu sai lệch máy in) và ghi rõ giới hạn; T4/T10/T11 sẽ thiếu reference đáng tin → báo cáo là "đánh giá người, không số".
**Đăng ký (registration):** căn ảnh ứng viên với reference bằng ECC/feature + homography/TPS; đo sai số đăng ký và **trừ ra** khỏi metric (nếu sai số > 0.5 px hiệu dụng thì cặp đó bị loại khỏi metric pixel-level).

### 8.3 Ứng viên (cùng đầu vào là ảnh C1–C5)

| ID | Pipeline | Vai trò |
|---|---|---|
| B0 | Chỉ homography (Lanczos) từ ảnh gốc | **Baseline fidelity**: không ứng viên nào được tệ hơn B0 về fidelity |
| B1 | B0 + gray | |
| B2 | B1/B0 + chia nền (T1) | Ứng viên mặc định chính |
| B3 | B2 + CLAHE | |
| B4 | B2 + unsharp mask (vài mức) | |
| B5 | B2 + deconvolution theo PSF đo | |
| B6 | B2 + denoise (NLM/bilateral, có/không mặt nạ) | |
| B7 | B2 + Sauvola / B8 Wolf / B9 Otsu / B10 gray-4-level | Clean B&W |
| D1 | B0 + dewarp UVDoc→remap | Ứng viên hình học DL |
| D2 | DocRes (deshadow, binarize, end2end) | Ứng viên/đối chứng DL |
| N1 | **Đối chứng âm**: Real-ESRGAN ×2 | Kiểm tra metric phát hiện hallucination |
| N2 | **Đối chứng âm**: làm mờ Gaussian σ=1; N3: USM mạnh (halo); N4: mô phỏng nén thay thế mảnh kiểu JBIG2 symbol | Kiểm tra metric nhạy |
| A1–A5 | ML Kit Scanner (các filter), Adobe Scan, CamScanner, Genius Scan, Google Drive scan (+ Apple Notes nếu có iPhone); Microsoft Lens nếu còn hỗ trợ [U] | App đối thủ |

**App đối thủ — hai nhánh riêng, không trộn:** (i) **Import cùng ảnh gốc** vào app qua gallery/import (so sánh *hậu kỳ* trên cùng đầu vào; [K] hầu hết app cho import, cần xác nhận từng app) ; (ii) **Chụp trực tiếp trong app** trên giá cố định cùng điều kiện (so sánh *toàn pipeline gồm capture*). Xuất mỗi app ở chất lượng/độ phân giải cao nhất; ghi lại phiên bản, ngày, cài đặt. Nếu app chỉ xuất PDF, trích ảnh bằng `pdfimages` (không render lại) để không thêm biến.

### 8.4 Metric (ưu tiên: trung thực → sắc nét → hình học → tốc độ → dung lượng)

OCR **chỉ là 1 chỉ số trong nhiều** và chỉ dùng như "chốt chặn", không phải bằng chứng chất lượng ảnh.

**A. Trung thực / chi tiết (ưu tiên 1) — so với reference sau đăng ký, trên ảnh nhị phân hoá *bằng cùng một thuật toán cố định* hoặc trên gray:**

| Metric | Định nghĩa | Phát hiện cái gì |
|---|---|---|
| **Lost-ink rate** | % pixel mực của reference (đã dilate bán kính r nhỏ) không có mực tương ứng ở output (≈ pRecall của DIBCO [E8]) | Mất nét mảnh, dấu, chữ nhạt |
| **False-ink rate** | % pixel mực output không nằm trong vùng reference dilate | Nét bịa/hallucination, halo, nhiễu |
| **Skeleton/stroke fidelity** | Hausdorff & độ lệch độ rộng nét trên skeleton | Nét bị dày/mỏng/đổi hình |
| **Component integrity** | Số thành phần liên thông và so khớp từng thành phần với reference, **riêng cho vùng dấu tiếng Việt** (dấu tách ra khỏi chữ) và kanji phức tạp | Dấu mất/dính, chữ dính |
| **Thin-line continuity** | % chiều dài đường kẻ 0.25–0.5pt còn liên tục | Đứt đường bảng/biểu đồ |
| **DRD / pFM / PSNR** (DIBCO, công cụ chính thức) | Với chế độ B&W | Chuẩn so sánh được |
| **Cảm nhận người (forced-choice 2AFC 1:1 zoom)** | ≥ 15 người chấm "bản nào giống reference hơn/ đọc dấu chắc chắn hơn"; riêng chữ viết tay | Bổ sung metric pixel; bắt buộc cho T4 |
| **Color ΔE00** | Trên ô target màu & trắng giấy so reference | Trung thực màu |

**B. Sắc nét (ưu tiên 2):** MTF50 và overshoot (%) từ slanted-edge (MTF Mapper) **trên chính output cuối** — mục tiêu sắc nét *mà không tăng overshoot/false-ink*; cỡ chữ nhỏ nhất đọc chắc chắn (người + OCR).

**C. Hình học/bố cục (ưu tiên 3):** độ thẳng đường kẻ (RMS lệch px quy 300 dpi), sai số tỉ lệ khung (%), sai góc vuông (độ), corner error/IoU, sai lệch toạ độ các điểm đặc trưng sau đăng ký rigid (đo méo cục bộ).

**D. Độ đồng đều ánh sáng:** độ lệch chuẩn L* vùng nền trắng, chênh lệch trung bình giữa vùng bóng và không bóng, **halo score** (độ sáng quầng quanh mảng mực lớn).

**E. OCR (chốt chặn):** CER/WER bằng ≥ 2 engine cố định (Tesseract vie/jpn/eng + PaddleOCR/ML Kit), chuẩn hoá Unicode NFC; **báo riêng tỉ lệ lỗi dấu thanh tiếng Việt**; không dùng OCR để kết luận hơn-kém khi false/lost-ink nói ngược lại.

**F. PDF:** dung lượng/trang; tính hợp lệ (qpdf/veraPDF); ảnh trích ra có bằng ảnh dự kiến không (lossless: bit-exact); kiểm tra searchable (đúng văn bản, đúng vị trí).

**G. Thiết bị (chỉ chạy cho ứng viên sống sót):** thời gian từng khâu p50/p95 tại 12MP và độ phân giải tối đa; peak PSS, tỉ lệ OOM khi batch 30 trang; nhiệt độ & % pin sau 15 phút liên tục.

### 8.5 Kiểm tra hợp lệ của benchmark (bắt buộc, vì đây là chỗ dễ tự lừa)
1. **Đối chứng âm phải bị bắt:** N1–N4 phải bị các metric A/B đánh dấu là kém (false-ink tăng với N1/N3, MTF50 tụt với N2, component integrity tụt với N4). Nếu không → metric vô dụng, sửa trước khi dùng.
2. **Đối chứng dương:** "reference tự so với chính nó sau đăng ký + nhiễu nhỏ" phải cho điểm gần tối đa.
3. **Độ lặp:** 3 khung/điều kiện → độ lệch giữa khung phải nhỏ hơn khác biệt giữa ứng viên, nếu không kết luận không có ý nghĩa.
4. **Thống kê:** bootstrap CI 95% trên từng metric; chỉ nói "A tốt hơn B" khi CI không chồng nhau.

### 8.6 Tiêu chí đạt / không đạt (đề xuất khởi điểm — cần bạn duyệt; hiệu chỉnh sau pilot 2–3 trang, rồi **khoá**)

> Các ngưỡng số bên dưới là **đề xuất của tôi, chưa dựa trên dữ liệu**. Cách đặt tương đối với B0 để tránh phụ thuộc cảnh chụp.

**Gate 1 — Fidelity (loại ngay, bắt buộc với mọi ứng viên vào mặc định):**
- Lost-ink ≤ B0 + 0.5 điểm %; false-ink ≤ B0 + 0.5 điểm % (mọi loại trang, đặc biệt T2, T3, T4, T5, T6).
- Component integrity vùng dấu Việt/kanji ≥ 99% so với B0.
- Thin-line continuity ≥ 99% so với B0.
- MTF50 ≥ 95% của B0 (không làm mờ) và overshoot ≤ 10%.
- Không có CER/dấu-thanh tệ hơn B0 quá 0.2 điểm % tuyệt đối (chốt chặn).
- Chữ viết tay: 2AFC không bị đánh giá "mất nét" hơn B0 một cách có ý nghĩa thống kê.
→ Vi phạm bất kỳ mục nào ⇒ **ứng viên không được là mặc định** (có thể còn là tuỳ chọn có cảnh báo nếu mục đích rõ, ví dụ B&W).

**Gate 2 — Có lợi ích thật (mới được vào mặc định):**
- Đồng đều ánh sáng: giảm ≥ 50% độ lệch L* nền ở điều kiện C2/C3 so với B0, **không** vi phạm Gate 1.
- Hình học: trên C4/C5, độ thẳng RMS ≤ 0.5 px@300dpi (phẳng) hoặc cải thiện có ý nghĩa vs B0 (cong) **và** không làm xấu trang phẳng (C1).
- Sai tỉ lệ khung ≤ 1%; corner IoU trung vị ≥ baseline ML Kit.
→ Dewarp (D1) chỉ vào mặc định nếu thoả Gate 2 trên C5 mà trang phẳng không bị tệ (ngưỡng "không tệ" = Gate 1 so với B0).

**Gate 3 — Thiết bị (chỉ ứng viên qua Gate 1–2, trên Spark 30 Pro):**
- Chạy mặc định không OOM trên batch 30 trang ở độ phân giải đã chọn; thời gian xử lý mỗi trang p95 và peak RAM/ nhiệt/ pin *ngưỡng đặt sau khi có số đo cơ sở* (tốc độ là ưu tiên thấp hơn fidelity, nên chấp nhận chậm nếu fidelity cao hơn; chỉ loại khi không dùng được).

**Gate 4 — Tuyên bố so sánh với app:** chỉ được viết "tốt hơn app X ở metric M" khi CI 95% không chồng và Gate 1 của VHub đã đạt. "Gần máy photocopy/scan cao cấp" chỉ được viết sau khi so với reference flatbed: ví dụ MTF50, lost/false-ink trong phạm vi sai khác nhỏ đã định trước, **và** người đánh giá không phân biệt được trong 2AFC ở mức ngẫu nhiên.

### 8.7 Thứ tự chạy (rẻ → đắt, để loại sớm)
1. **Ngày 1:** Xác minh thiết bị (§7), chụp chart slanted-edge → biết trần phần cứng & ISP có tự sharpen/NR không. *Nếu máy chỉ ra 12MP binned và ISP bật sharpen cứng, kỳ vọng "gần scanner" phải hạ trước khi tốn công.*
2. **Ngày 2–3:** In bộ trang, scan phẳng, chụp 60 ảnh + 3 khung.
3. **Ngày 4–5:** Viết harness đăng ký + metric A–D (Python/OpenCV, desktop, **không phải sản phẩm**). Chạy kiểm tra hợp lệ §8.5.
4. **Ngày 6–7:** Chạy B0–B10, N1–N4 (loại sớm ứng viên vi phạm Gate 1).
5. **Tuần 2:** Chạy D1, D2 (cần chuyển ONNX/chạy desktop), app A1–A5 (nhánh i rồi ii).
6. **Chỉ sau đó:** đo thiết bị cho ứng viên sống sót (Gate 3); người chấm 2AFC.
7. **Quyết định kiến trúc** dựa bảng kết quả — không trước.

---

## 9. Kiến trúc (điều kiện, sẽ chốt sau Gate 1–3)

Giữ khung v0.1 nhưng sửa theo fidelity:

```
Android (Kotlin; Camera2 cho capture)
 Preview/ImageAnalysis (thấp phân giải) → đề xuất 4 góc + độ ổn định + độ nét → auto-capture (tuỳ chọn)
 Capture full-res (độ phân giải tối đa THẬT SỰ đo được) → lưu ORIGINAL không phá huỷ
 Edit sidecar (góc, dewarp lưới, chế độ, tham số)
 Render (tile-based, 1 lần remap) → Original | Color/Fidelity | Gray | Clean B&W (dẫn xuất)
 PDF writer (nhúng pixel y nguyên, lossless/high-quality) ; lớp OCR ẩn tuỳ chọn
 Local only. Cloud: không xử lý ảnh; sync (nếu có) chỉ PDF, mã hoá phía client, Phase muộn
iPhone/Web PWA: giữ như v0.1 (capture bằng <input capture> để dùng camera gốc, xử lý WASM);
 chỉ khả thi nếu cùng bộ test fidelity cho ra kết quả tương đương — chạy lại §8 trên iPhone thật. [U]
```
Các phần "MRC/JBIG2", "CLAHE mặc định", "dewarp mặc định" của v0.1 **bị gỡ** cho đến khi có bằng chứng.

---

## 10. Kế hoạch giai đoạn (điều chỉnh)

| Phase | Nội dung | Exit gate |
|---|---|---|
| **0** | Xác minh thiết bị §7 + benchmark §8 (code chỉ là harness desktop/script) | Bảng kết quả + ứng viên sống sót + ngưỡng khoá |
| **1** | Capture Camera2 + lưu gốc + homography (B0) + chỉnh góc tay + PDF ảnh-thuần lossless/high-q + xác minh PDF | Bằng B0 trong benchmark; PDF bit-exact |
| **2** | Chia nền / chế độ Color-Fidelity & Gray (nếu qua Gate 1–2) ; Clean B&W (nếu qua) | Gate 1–3 |
| **3** | OCR + lớp text ẩn (sau khi biết engine nào đọc Việt/Nhật tốt) | CER/ dấu thanh đạt ngưỡng |
| **4** | Dewarp (nếu thắng) | Gate 2 trang cong |
| **5** | PWA iPhone (chạy lại §8) | |
| **6** | Sync (tuỳ chọn) | Kill-switch chi phí |

---

## 11. Rủi ro & Unknown chưa giải quyết

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Phần cứng/ISP giới hạn độ nét: **đã xác nhận trần 12MP** (§7.1); sharpen/NR cứng của hãng còn chưa đo | Cao [V một phần] | Đo slanted-edge; thử RAW/burst; hạ kỳ vọng xuống "đọc rõ chữ nhỏ ở ~250 dpi" cho tới khi có số |
| Không có reference flatbed → không chứng minh được fidelity tuyệt đối | Cao [U] | Q1; PDF nguồn + đánh giá người |
| Metric tự lừa mình | Trung bình | §8.5 đối chứng âm/dương |
| Dấu Việt / kanji nhỏ bị mất ở hầu hết thuật toán T2–T3 | Cao [H] | Gate 1 component integrity |
| DL (DocRes/UVDoc) giấy phép dữ liệu/trọng số, bảo trì thấp | Trung bình [U] | Chỉ ship sau khi xác minh giấy phép |
| Ảnh gốc lớn → bộ nhớ/ lưu trữ, tăng chi phí sync | Trung bình | Chính sách giữ gốc, sync chỉ PDF |
| ML Kit phụ thuộc Play Services, điều khoản | Trung bình | Chỉ baseline |
| Việt/Nhật OCR chưa xác minh | Trung bình [U] | Benchmark §8.4E |
| Mục [K] (giấy phép Tesseract, AGPL iText/MuPDF, phí store) chưa mở lại nguồn | Thấp | Kiểm tra trước khi tích hợp |
| Dữ liệu: Microsoft Lens còn khả dụng không | Thấp [U] | Kiểm tra khi chọn app đối thủ |

**Technical debt dự kiến:** pipeline có sidecar version → cần migration khi đổi thuật toán; harness benchmark nên được giữ lại làm regression test cho mọi thay đổi pipeline.

---

## 12. Nguồn tham khảo

- Xerox/JBIG2: https://www.networkworld.com/article/677764/data-center-xerox-scanners-found-to-sometimes-alter-numbers.html · https://tidbits.com/2013/08/05/researcher-finds-some-copiers-can-alter-scanned-numbers/ · https://www.computerworld.com/?p=1398177
- jbig2enc: https://github.com/agl/jbig2enc
- Super-resolution & hallucination: https://arxiv.org/pdf/2506.06953 · Real-ESRGAN: https://github.com/xinntao/Real-ESRGAN
- DocRes: https://github.com/ZZZHANG-jx/DocRes · https://arxiv.org/pdf/2405.04408
- UVDoc: https://github.com/tanguymagne/UVDoc · https://arxiv.org/abs/2302.02887 · ONNX: https://huggingface.co/fredcallagan/uvdoc-grid-onnx
- Tổng hợp dewarp/deshadow/illumination/binarization + dataset: https://github.com/ZZZHANG-jx/Recommendations-Document-Image-Processing
- DIBCO metrics: https://arxiv.org/pdf/2401.11831
- Slanted-edge/MTF: https://www.imatest.com/docs/validating_slanted_edge · https://blog.kasson.com/?p=5809 (MTF Mapper và sfrmat: cần lấy link repo chính thức khi triển khai harness)
- Camera2 high-res/pixel mode: https://developer.android.com/sdk/api_diff/31/changes/android.hardware.camera2.CameraMetadata
- Tecno Spark 30 Pro: https://m.gsmarena.com/tecno_spark_30_pro-13357.php
- OpenCV: https://github.com/opencv/opencv · PdfBox-Android: https://github.com/TomRoush/PdfBox-Android · DocAligner: https://github.com/docsaidlab/DocAligner
- PaddleOCR: https://github.com/PaddlePaddle/PaddleOCR · RapidOCR: https://github.com/RapidAI/RapidOCR · PaddleOCR unwarp: https://www.paddleocr.ai/latest/en/version3.x/module_usage/text_image_unwarping.html
- ML Kit: https://developers.google.com/ml-kit/vision/doc-scanner/android · https://developers.google.com/ml-kit/vision/text-recognition/v2
- Phát hiện góc (SmartDoc/MIDV-500): https://arxiv.org/pdf/2008.02615 · DocCornerDataset (MIDV-500 research-only [S]): https://huggingface.co/datasets/mapo80/DocCornerDataset
- Firebase: https://firebase.google.com/pricing · https://dev.to/androve2k/spark-vs-blaze-the-firebase-pricing-guide-i-wish-id-read-sooner-onb
- iOS PWA: https://firt.dev/notes/pwa-ios/ · https://bugs.webkit.org/show_bug.cgi?id=275527 · https://discussions.apple.com/thread/256081579
- PDF text ẩn: https://leanpub.com/read/pdfkungfoo/make-ocr-visible
