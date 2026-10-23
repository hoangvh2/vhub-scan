# VHub Scan — Research & Technical Design (v0.1)

> Ngày: 2026-10-23 · Trạng thái: **nghiên cứu desk-research, CHƯA có benchmark thực nghiệm trên máy**.
> Quy ước nhãn: **[V]** đã xác minh từ nguồn chính/trang repo trong phiên này · **[S]** nguồn thứ cấp/blog, cần kiểm chứng · **[K]** kiến thức nền của tác giả, chưa kiểm tra lại trong phiên · **[H]** giả thuyết cần thử nghiệm.

## 1. Executive Summary

- **Không thể và không nên tuyên bố "vượt app trả phí" lúc này.** Chưa có số liệu so sánh. Mục tiêu hợp lý: *ngang* ML Kit/Google Drive scan ở bước phát hiện, và *tạo khác biệt có đo được* ở (a) làm sạch nền/khử bóng, (b) PDF nhỏ + searchable, (c) OCR Việt/Nhật, (d) quyền riêng tư 100% offline.
- **Khuyến nghị:** Android native (Kotlin) + CameraX + OpenCV (phối cảnh/enhance) + ML Kit Document Scanner làm **baseline đối chứng** (không phải sản phẩm cuối) + OCR on-device (ML Kit v2 trước, PaddleOCR/ONNX là phương án nâng cấp). **Cloud = 0 ở MVP.** PWA iPhone là Phase sau, giới hạn tính năng.
- **Việc đầu tiên không phải code app mà là bộ benchmark** (dataset + harness). Mọi quyết định công nghệ bên dưới là *giả thuyết cho đến khi chạy qua harness*.
- Chi phí vận hành MVP: **~$0/tháng** (+ $25 Google Play một lần [K]). Cloud chỉ là tuỳ chọn (sync), và hiện **Cloud Storage buộc Blaze** [S] nên rủi ro "không có hard cap" phải được kiểm soát.

## 2. Evidence — những gì đã xác minh

| # | Fact | Nhãn | Nguồn |
|---|------|------|-------|
| 1 | ML Kit Document Scanner: UI trọn gói (viewfinder + preview), xuất JPEG/PDF, giới hạn số trang, import gallery, minSdk 21, RAM ≥ 1.7GB, +~300KB, lần đầu có thể phải tải model | V | [doc](https://developers.google.com/ml-kit/vision/doc-scanner/android) |
| 2 | ML Kit Text Recognition v2 tách theo script (Latin, Japanese, Chinese, Devanagari, Korean); bundled ~4MB/script/arch, unbundled ~260KB (tải qua Play Services) | V | [doc](https://developers.google.com/ml-kit/vision/text-recognition/v2) · [languages](https://developers.google.com/ml-kit/vision/text-recognition/v2/languages) |
| 3 | **Vietnamese có nằm trong Latin recognizer hay không và độ chính xác dấu: CHƯA xác minh** → phải test | Unknown | — |
| 4 | UVDoc (dewarp): **MIT**, 251★, repo ít commit (3) [V]; MS-SSIM 0.785 / AD 0.119 trên UVDoc benchmark (số đã hiệu chỉnh), DocTr 0.697/0.160, DewarpNet 0.589/0.193 [V]; có ONNX export cộng đồng (input cố định 720×496, output grid → `cv2.remap`) [S]; PaddleOCR liệt kê model 30.3MB, CPU 869ms (không rõ thiết bị) [S] | V/S | [repo](https://github.com/tanguymagne/UVDoc) · [paper](https://arxiv.org/abs/2302.02887) · [HF ONNX grid](https://huggingface.co/fredcallagan/uvdoc-grid-onnx) · [PaddleOCR unwarp](https://www.paddleocr.ai/latest/en/version3.x/module_usage/text_image_unwarping.html) |
| 5 | PaddleOCR: **Apache-2.0**; release 3.7.0 (2026-06-11); PP-OCRv6 một model cho Trung/Anh/Nhật + 46 ngôn ngữ Latin (tổng 50); có tier tiny/small/medium cho edge/mobile; Việt *không được nêu tên* trên trang | V (Việt: Unknown) | [repo](https://github.com/PaddlePaddle/PaddleOCR) |
| 6 | RapidOCR: **Apache-2.0**, 8.3k★, chạy ONNX Runtime/OpenVINO/MNN; Android chỉ thấy thư mục `android`, chưa xác nhận ngôn ngữ | V (một phần) | [repo](https://github.com/RapidAI/RapidOCR) |
| 7 | Tecno Spark 30 Pro: Helio G100 (6nm), Mali-G57 MC2, 8GB RAM, camera 108MP 1/1.52", pin 5000mAh. **Máy xuất xưởng Android 14/HiOS 14** — nếu máy bạn đã là Android 15 thì đó là bản cập nhật, cần ghi lại build number | V/S | [GSMArena](https://m.gsmarena.com/tecno_spark_30_pro-13357.php) |
| 8 | Firebase: Cloud Storage cần Blaze từ 2026-02-03; free 5GB sau đó ~$0.10/GB (blog lệch giá, **phải đọc lại trang giá chính thức**) | S | [pricing](https://firebase.google.com/pricing) · [guide](https://dev.to/androve2k/spark-vs-blaze-the-firebase-pricing-guide-i-wish-id-read-sooner-onb) |
| 9 | iOS: `getUserMedia` có từ iOS 13; PWA home-screen từng lỗi camera/đóng băng (WebKit bug 2019, 2024 iOS 17.5.1) và re-prompt quyền (2025). Cần test thiết bị thật; ImageCapture trên Safari: **Unknown** | S | [firt.dev](https://firt.dev/notes/pwa-ios/) · [WebKit 275527](https://bugs.webkit.org/show_bug.cgi?id=275527) · [Apple thread](https://discussions.apple.com/thread/256081579) |
| 10 | Phát hiện góc: SmartDoc 2015 và MIDV-500 là benchmark chuẩn (Jaccard/IoU); các paper hay tự chia train/test nên **điểm không so sánh được chéo**. DocAligner dùng heatmap regression cho góc | V/S | [arXiv 2008.02615](https://arxiv.org/pdf/2008.02615) · [DocAligner](https://pypi.org/project/docaligner-docsaid/) |
| 11 | OCR text layer trong PDF dùng text render mode 3 (invisible), tìm kiếm/copy hoạt động bình thường | V | [PDF Kung Foo](https://leanpub.com/read/pdfkungfoo/make-ocr-visible) |
| 12 | Blog so sánh PaddleOCR CER 4.5% vs Tesseract 18.2% không nêu dataset → **không dùng làm bằng chứng** | S (yếu) | [codesota](https://codesota.com/ocr/paddleocr-vs-tesseract) |

**Không tìm được:** benchmark mobile độc lập (latency/RAM/pin) cho UVDoc, PaddleOCR trên Helio G100; so sánh ML Kit vs Paddle vs Tesseract cho tiếng Việt; bất kỳ benchmark độc lập nào so sánh chất lượng enhance của Adobe Scan/CamScanner/Lens. Các tuyên bố "tốt nhất" của vendor (Scanbot, Dynamsoft…) coi là quảng cáo.

## 3. Bảng so sánh giải pháp

Cột "Chất lượng / Tốc độ" là **[H]** trừ khi ghi khác. Giấy phép: [V] nếu đã thấy ở trên, còn lại [K] — *phải kiểm tra LICENSE trước khi dùng*.

### 3.1 Phát hiện tài liệu / bốn góc

| Giải pháp | Giấy phép | Chất lượng | Tốc độ/RAM | Chi phí | Rủi ro |
|---|---|---|---|---|---|
| **A. ML Kit Document Scanner** (UI trọn gói) | Điều khoản Google/ML Kit [K] | Tốt, đã dùng rộng [H] | Rất nhanh, +300KB [V] | 0 | Hộp đen: không tinh chỉnh, không lấy được realtime quad để làm auto-capture riêng, phụ thuộc Play Services, khó tạo khác biệt |
| **B. OpenCV cổ điển** (Canny/contour/Hough + chọn tứ giác) | Apache-2.0 [K] | Tốt khi nền tương phản; thất bại trên nền nhiễu/giấy trắng trên bàn trắng [H] | Nhanh trên ảnh 640px | 0 | Cần nhiều heuristic, dễ flicker |
| **C. Model nhỏ (heatmap/segmentation) TFLite/ONNX** (kiểu DocAligner; tự train trên SmartDoc/MIDV-500/dữ liệu riêng) | Dataset: MIDV-500 research-only [S] → **không dùng thương mại**; cần tự thu dữ liệu | Tiềm năng cao nhất trên nền khó [H] | 10–30ms/frame mục tiêu [H] | Công train | Rủi ro dữ liệu/giấy phép; thời gian |
| **D. B + C lai** (model đề xuất, OpenCV tinh chỉnh subpixel + kiểm tra tứ giác hợp lệ + làm mượt theo thời gian) | — | **Khuyến nghị** [H] | — | — | Độ phức tạp vừa |

### 3.2 Enhance (khử bóng, nền, chữ)

| Kỹ thuật | Chất lượng | Rủi ro artefact |
|---|---|---|
| Chia ảnh cho nền ước lượng (blur lớn/morph close) — "background division" | Khử bóng rất tốt trên giấy in [H] | Halo quanh ảnh/chữ đậm |
| CLAHE | Tăng tương phản cục bộ | Khuếch đại nhiễu |
| Sauvola/Wolf adaptive threshold (B&W) | Chữ sắc cho tài liệu in | Mất nét mảnh, nuốt dấu tiếng Việt/Nhật nếu tham số sai → **phải test CER** |
| Mô hình học sâu (DocRes, DocTr illumination) | Có thể tốt hơn [H] | Nặng, có thể "bịa" nét chữ (hallucination) → không chấp nhận cho tài liệu pháp lý. Giấy phép từng repo chưa xác minh (DocTr repo URL tôi thử trả 404) |
| Chế độ màu: giữ màu + chuẩn trắng nền (white-balance theo nền) | Khác biệt dễ thấy | Ít rủi ro |

→ **Chọn:** pipeline cổ điển, xác định (deterministic), tham số hoá, 4 chế độ (Màu / Xám / B&W / "Giữ ảnh gốc"). ML enhance chỉ cân nhắc sau khi có số đo.

### 3.3 Dewarp trang cong

| Giải pháp | Giấy phép | Kích thước/Tốc độ | Nhận định |
|---|---|---|---|
| UVDoc | MIT [V] | ~30MB; 870ms CPU (thiết bị ?) [S] | Số liệu paper tốt nhất trong nhóm [V]; bắt buộc đo trên Helio G100 |
| DocTr / DewarpNet | Chưa xác minh | Nặng hơn | Không ưu tiên |
| Không dewarp, chỉ perspective | — | 0 | Đủ cho >80% ca thực tế [H]; là MVP |

→ Dewarp = **tính năng tuỳ chọn, chạy sau khi chụp (không realtime)**, ở độ phân giải thấp rồi áp grid lên ảnh full-res bằng `remap`.

### 3.4 OCR

| Engine | Giấy phép | Việt | Nhật | Ghi chú |
|---|---|---|---|---|
| ML Kit v2 (Latin + Japanese) | ML Kit terms [K] | **Unknown — test** | Có script Japanese [V] | Nhanh, nhỏ; không trả về font/PDF layer sẵn, phải tự dựng text layer từ bounding box |
| PaddleOCR PP-OCRv6 (ONNX) | Apache-2.0 [V] | Có thể (Latin) nhưng chưa xác nhận | Có [V] | Chính xác hơn tiềm năng; nặng hơn, cần tự tích hợp ONNX Runtime Mobile; đo pin/nhiệt |
| Tesseract (vie/jpn/eng) | Apache-2.0 [K] | Có traineddata `vie` [K] | Có | Chậm hơn, kém trên ảnh chụp tự nhiên [S yếu]; làm fallback |

### 3.5 Tạo PDF

| Lựa chọn | Giấy phép | Ghi chú |
|---|---|---|
| `android.graphics.pdf.PdfDocument` | AOSP | Không hỗ trợ text layer invisible tốt, không nén tối ưu |
| **Tự viết PDF writer tối giản** (JPEG/JBIG2/MRC + text mode 3) | Của mình | Kiểm soát kích thước & searchable; công sức vừa, **khuyến nghị** |
| PDFBox-Android | Apache-2.0 [K] | Nặng nhưng an toàn giấy phép |
| iText, MuPDF | **AGPL** [K] | **Tránh** (copyleft/thương mại) |
| pdf-lib (web) | MIT [K] | Cho PWA |

Điểm khác biệt tiềm năng: **MRC/JBIG2** (tách lớp chữ nhị phân + nền JPEG thấp) cho PDF nhỏ hơn nhiều so với JPEG phẳng [H]; jbig2enc license cần xác minh.

## 4. Kiến trúc đề xuất

```
┌─────────────── Android (Kotlin, ưu tiên) ───────────────┐
│ CameraX Preview + ImageAnalysis (~640px, YUV)           │
│   └─ Detector (B/D) → quad + confidence + temporal smooth│
│   └─ Auto-capture: quad ổn định N frame + sharpness (Laplacian var) + không rung (gyro) │
│ CameraX ImageCapture (full-res JPEG, MAX_QUALITY)        │
│ Pipeline (background thread, tile-based để giới hạn RAM) │
│   warp(OpenCV) → [dewarp UVDoc, tuỳ chọn] → enhance → mode │
│ OCR (ML Kit v2 → tuỳ chọn Paddle ONNX) → text boxes     │
│ PDF writer (ảnh nén + invisible text) → file local       │
│ Storage: app-private + mã hoá (Keystore) ; project/page DB (Room/SQLite) │
└──────────────────────────────────────────────────────────┘
        │ (tuỳ chọn, Phase cuối, opt-in) mã hoá phía client → sync
        ▼
   Cloud: KHÔNG có xử lý ảnh. Chỉ lưu blob đã mã hoá (nếu cần)

┌──────────── iPhone/Web PWA ────────────┐
│ getUserMedia + <canvas>; OpenCV.js (WASM) / onnxruntime-web │
│ Chụp full-res bằng <input capture> (camera gốc) làm đường chính │
│ pdf-lib; OCR: PaddleOCR.js/Tesseract.js; IndexedDB local    │
└────────────────────────────────────────┘
```

**Nguyên tắc:** toàn bộ xử lý local; cloud không chạy bất kỳ model nào. Đo-đạc (telemetry) mặc định tắt/ẩn danh.

**Phương án iPhone/Web — đánh giá thẳng:**
- Khả thi: chọn ảnh bằng `<input type=file accept=image/* capture>` → dùng camera gốc iOS (chất lượng tốt, full-res, không dính lỗi PWA camera [S]) → xử lý ảnh trong WASM. *Mất* live edge-detection & auto-capture ổn định.
- Live-camera trong PWA: **làm sau và chỉ khi test thiết bị thật đạt** (rủi ro đóng băng/re-prompt, giới hạn RAM/canvas của Safari [K]).
- Hạn chế dự kiến [K/H]: OpenCV.js ~nhiều MB, tab bị kill khi hết RAM, giới hạn kích thước canvas, lưu trữ có thể bị eviction nếu không cài đặt. Dewarp/PaddleOCR trên Safari chậm → tuỳ chọn.
- Native iOS (Swift) chỉ khi cần: $99/năm [K] — **không khuyến nghị** cho tới khi PWA chứng minh nhu cầu.

**Phản biện quyết định:**
- *Vì sao không dùng thẳng ML Kit Scanner?* Nhanh nhất ra MVP, nhưng không có khác biệt và không kiểm soát chất lượng/PDF. → Dùng làm **baseline** và **fallback** (có thể ship như "chế độ nhanh").
- *Vì sao không Flutter/React Native?* CameraX + pipeline ảnh nặng ở native; cross-platform tăng độ trễ/RAM. Android-first nên Kotlin; code lõi C++ (OpenCV) chỉ cần nếu Kotlin+OpenCV Java quá chậm [H].
- *Vì sao không cloud AI?* Quyền riêng tư, chi phí, độ trễ, mâu thuẫn mục tiêu ~0$.

## 5. Chi phí theo tháng (ước tính, có giả định)

**Giả định:** 10 scan-session/user/tháng × ~1.5MB PDF đã nén = 15MB/user/tháng; Hosting PWA tĩnh trên Cloudflare Pages/Firebase Hosting/GitHub Pages (free tier, băng thông PWA ≪ giới hạn) [K]; tỉ lệ bật sync = 20%; giá lưu trữ $0.026–0.10/GB-tháng (khoảng giá do nguồn lệch [S]); egress & thao tác bỏ qua (nhỏ); lưu tích luỹ 6 tháng.

| Kịch bản | Local-only (khuyến nghị) | Có sync opt-in, Blaze (tháng thứ 6, tích luỹ) |
|---|---|---|
| 100 user | ~$0 | 20 user × 90MB = 1.8GB → trong 5GB free → ~$0 (nhưng **vẫn phải bật Blaze**) |
| 1.000 user | ~$0 | 200 × 90MB = 18GB → ~$0.3–1.3/tháng |
| 10.000 user | ~$0 | 2.000 × 90MB = 180GB → ~$4.7–18/tháng |

Chi phí cố định: Google Play $25 một lần [K]; domain ~\$10–15/năm [K]. **Rủi ro chính không phải đơn giá mà là không có hard cap**: Blaze chỉ có budget *alert*, không tự dừng [K]; lỗi vòng lặp/abuse có thể tạo hoá đơn lớn. Giảm thiểu: App Check, quota rule, size limit, budget alert + kill-switch thủ công, hoặc chọn sync không qua Firebase (người dùng tự xuất sang Drive/Share Sheet = $0).

## 6. Kế hoạch MVP (ưu tiên khác biệt + chi phí thấp)

| Phase | Nội dung | Exit gate (đo được) |
|---|---|---|
| **0 – Benchmark first** (1–2 tuần) | Dataset, GT góc, jig chụp, harness đo, baseline ML Kit + 2–3 app đối thủ | Có bảng số baseline có thể tái lập |
| **1 – Capture core** | CameraX, detector B (OpenCV) → D, chỉnh góc tay, warp, auto-capture | Corner error & IoU ≥ ML Kit baseline trên bộ test; không flicker |
| **2 – Enhance + PDF** | 4 chế độ màu, khử bóng, PDF writer, batch/sắp xếp/ghép tách trang | Thắng blind A/B vs ML Kit enhance ở nhóm "bóng/ánh sáng xấu"; PDF ≤ X MB/trang |
| **3 – OCR + searchable** | ML Kit Latin/JP; test Việt; Paddle ONNX nếu CER ML Kit kém | CER Việt/Nhật đạt ngưỡng đặt trước; tìm kiếm trong PDF đúng |
| **4 – Dewarp (tuỳ chọn)** | UVDoc ONNX, chỉ khi đo được lợi ích & ≤ ngưỡng thời gian/nhiệt | Cải thiện CER trên trang cong ≥ ngưỡng |
| **5 – PWA iPhone** | `capture` input + WASM pipeline | Chạy ổn Safari thật trên ≥ 2 iPhone |
| **6 – Sync (opt-in)** | Chỉ khi có nhu cầu thật | Có kill-switch chi phí |

Cắt có chủ đích: không làm cloud AI, không ký/annotation, không template CV/ID, không đa nền tảng native sớm.

## 7. Bộ test & tiêu chí đo khách quan

**Dataset (tự thu, quyền sở hữu rõ, ≥ 300 ảnh, chia theo điều kiện):** tài liệu in A4 / hoá đơn nhiệt / sách gáy cong / bảng trắng / tài liệu Việt có dấu / tài liệu Nhật dọc-ngang; nền trơn-nhiễu-trắng-trên-trắng; ánh sáng tốt / bóng tay / ngược sáng / thiếu sáng; góc nghiêng 0–45°. Dùng SmartDoc/MIDV-500 chỉ để tham chiếu nội bộ (kiểm tra giấy phép dataset trước khi huấn luyện thương mại).

| Hạng mục | Metric | Cách đo |
|---|---|---|
| Bốn góc | Mean corner error / đường chéo (%), Jaccard IoU, tỉ lệ IoU > 0.95, tỉ lệ thất bại | GT gán tay 2 người, đo đồng thuận |
| Độ đọc chữ | CER/WER bằng **cùng một OCR engine** cố định trên output của mọi app (tách chất lượng ảnh khỏi OCR); thêm OCR thứ 2 để kiểm tra độc lập | Trang chuẩn có text GT |
| Chất lượng ảnh | Độ đồng đều nền (std vùng trắng), độ nét cạnh chữ (MTF/edge width), artefact (halo) | Script tự động + xem tay |
| Cảm nhận | Blind A/B, ≥ 20 rater, MOS 1–5, Wilcoxon/bootstrap CI | Ẩn tên app, ngẫu nhiên thứ tự |
| PDF | Kích thước/trang ở 200/300 dpi, hợp lệ (qpdf/veraPDF), searchable (trích text đúng), tương thích Acrobat/Chrome/Preview | Công cụ chuẩn |
| Tốc độ | Capture→xem trước, capture→PDF xong (p50/p95); FPS detector | Trace trên Spark 30 Pro |
| RAM | Peak PSS, OOM rate khi batch 50 trang | `dumpsys meminfo` |
| Pin/nhiệt | % pin & nhiệt sau 15 phút quét liên tục, cùng độ sáng | `batterystats`, `thermalservice`, nhiệt kế ngoài |

**So sánh:** cùng máy, cùng jig, cùng ánh sáng, cùng chạy lặp 3 lần: ML Kit Scanner (Google Drive scan), Adobe Scan, CamScanner, Genius Scan, Microsoft Lens (kiểm tra còn được hỗ trợ không [Unknown]), và Apple Notes scan trên iPhone. Kết quả công bố kèm CI và phiên bản app/ngày test. **Chỉ được nói "vượt" ở hạng mục nào có khác biệt có ý nghĩa thống kê.**

## 8. Khuyến nghị (xếp hạng)

1. **(Khuyến nghị) Android native, pipeline OpenCV tự chủ + detector lai, ML Kit scanner làm baseline/fallback, PDF writer riêng, local-only.** Chi phí ~0, kiểm soát chất lượng, nhiều đường tạo khác biệt. Rủi ro: công phát triển detector/enhance.
2. Ship nhanh bằng ML Kit Document Scanner + OCR + PDF tối giản. Rẻ nhất/nhanh nhất, nhưng không có khác biệt, khó "vượt" ai. Dùng nếu cần giá trị trong vài ngày.
3. PWA-first (cross-platform). Phủ iPhone sớm nhưng chất lượng live-capture/RAM kém và kém tin cậy [S]; không hợp ưu tiên "chất lượng → độ tin cậy".

## 9. Rủi ro / Unknown chưa giải quyết

- Việt hoá OCR: ML Kit & PaddleOCR có đọc dấu tiếng Việt đủ tốt không? (**cần test ngay Phase 0/3**)
- Latency/nhiệt của UVDoc & Paddle trên Helio G100: chưa có số.
- Giấy phép: DocTr/DocRes/DocAligner/jbig2enc/dataset huấn luyện — chưa xác minh; MIDV-500 research-only [S].
- ML Kit scanner: điều khoản dùng thương mại, phụ thuộc Play Services (máy không có GMS?).
- Lỗi PWA camera iOS: trạng thái hiện tại (2026) chưa kiểm tra; WebGPU/ImageCapture trên Safari chưa rõ.
- Firebase: giá/hạn mức chính xác phải đọc lại trang chính thức trước khi quyết định bật Blaze; không có hard cap.
- Android 14 vs 15 trên máy test — ghi lại build để tái lập.
- Một số mục [K] (giấy phép OpenCV/Tesseract/PDFBox/pdf-lib, AGPL của iText/MuPDF, $25 Play, $99 Apple) là kiến thức nền, chưa mở lại nguồn trong phiên này.

## 10. Nguồn tham khảo

- ML Kit Document Scanner: https://developers.google.com/ml-kit/vision/doc-scanner/android
- ML Kit Text Recognition v2: https://developers.google.com/ml-kit/vision/text-recognition/v2 · languages: https://developers.google.com/ml-kit/vision/text-recognition/v2/languages
- UVDoc: https://github.com/tanguymagne/UVDoc · https://arxiv.org/abs/2302.02887 · ONNX grid: https://huggingface.co/fredcallagan/uvdoc-grid-onnx
- DewarpNet/DocUnwarp (Stony Brook): https://www3.cs.stonybrook.edu/~cvl/projects/DocUnwarp/
- Danh mục paper/dewarp: https://github.com/ZZZHANG-jx/Recommendations-Document-Image-Processing
- PaddleOCR: https://github.com/PaddlePaddle/PaddleOCR · unwarp module: https://www.paddleocr.ai/latest/en/version3.x/module_usage/text_image_unwarping.html
- RapidOCR: https://github.com/RapidAI/RapidOCR
- DocAligner: https://pypi.org/project/docaligner-docsaid/ · Document detection (SmartDoc/MIDV-500): https://arxiv.org/pdf/2008.02615 · DocCornerDataset: https://huggingface.co/datasets/mapo80/DocCornerDataset
- Tecno Spark 30 Pro: https://m.gsmarena.com/tecno_spark_30_pro-13357.php
- Firebase pricing: https://firebase.google.com/pricing · https://dev.to/androve2k/spark-vs-blaze-the-firebase-pricing-guide-i-wish-id-read-sooner-onb
- iOS PWA: https://firt.dev/notes/pwa-ios/ · https://bugs.webkit.org/show_bug.cgi?id=275527 · https://discussions.apple.com/thread/256081579
- Invisible OCR text (render mode 3): https://leanpub.com/read/pdfkungfoo/make-ocr-visible
- Cần tìm thêm ở Phase 0 (chưa có link xác minh): OpenCV, Tesseract, OCRmyPDF, jbig2enc, PDFBox-Android, CameraX docs, DocRes, DocTr.
