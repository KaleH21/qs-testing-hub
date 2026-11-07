# Plan: Chuyển `k6-perf` thành QA Testing Hub, nền tảng kiểm thử website nội bộ

Ngày: 07/11/2026 (bản 3: cài kiểu Cá nhân trước, Recorder chạy ngay trong Hub không cần extension, không gửi dữ liệu production cho Gemini)
Phạm vi: lập kế hoạch và tài liệu thiết kế, chưa viết code. Chi tiết ở [docs/](docs/00-README.md).

---

## 1. Tóm tắt

- **Bài toán:** công ty có nhiều dự án web nhưng việc test bị rời rạc: Excel, Postman, script riêng. Tool `k6-perf` hiện có chỉ phục vụ một backend, chỉ đo hiệu năng. Báo cáo thì chỉ người kỹ thuật đọc được.
- **Giải pháp:** một website nội bộ (**QA Testing Hub**) có giao diện trực quan. Mỗi dự án có không gian test riêng. Người dùng nhập URL website (thường đang chạy **ở local**), Hub sẽ:
  1. **Tìm các luồng** của website bằng 3 cách:
     - Crawler tự đi qua các trang.
     - **Recorder**: người dùng thao tác website ngay trong Hub (trình duyệt hiện trong trang, không cần cài extension), Hub ghi lại thành test.
     - **AI Explorer**: Gemini tự thao tác như người dùng để tìm luồng nhiều bước.

     Tất cả hiện trên **sơ đồ luồng**, tô màu phần đã có test và chưa có test.
  2. **Sinh bản nháp** test plan và test case, bằng luật cố định và AI. Người dùng duyệt lại trên giao diện có ảnh chụp từng bước.
  3. **Chạy** mọi loại test: chức năng (thủ công và tự động), API, hiệu năng (k6), bảo mật (OWASP ZAP), accessibility, tương thích trình duyệt, giao diện (visual), SEO, broken link.
  4. **AI phân tích nguyên nhân ngay khi test fail**: cho biết lỗi do sản phẩm, do script test, do môi trường hay do dữ liệu, kèm bằng chứng và cách sửa.
  5. **Báo cáo 1 trang**, vừa một màn hình, gồm:
     - Câu kết luận.
     - 7 thẻ sức khỏe.
     - Tối đa 3 vấn đề quan trọng nhất, mỗi vấn đề có ảnh hưởng, nguyên nhân AI, cách sửa và ảnh minh họa.
     - Độ phủ luồng và xu hướng so với lần trước.

     Chi tiết kỹ thuật để ở phụ lục.
- **Môi trường và công tắc:**
  - Mỗi dự án đi theo các bước `LOCAL` → `DEV` → `STAGING` → `PRODUCTION`, dùng chung một bộ test.
  - **Bật/tắt test** được ở cấp công ty (production mặc định **tắt**, local mặc định **bật**) và ở từng môi trường.
- **AI:** mặc định **Gemini**. Đổi sang OpenAI, Claude hay model chạy nội bộ ngay trong phần cài đặt, không cần sửa code. **Dữ liệu từ production không gửi cho Gemini**; lỗi ở production chỉ được phân tích bằng luật cố định.
- **Dùng lại từ `k6-perf`:** script k6, 20 luật chẩn đoán nguyên nhân, bố cục báo cáo hiệu năng, lịch sử các lần chạy cũ. Chi tiết ở [docs/11](docs/11-k6-migration.md).

## 2. Hai kiểu cài: làm kiểu Cá nhân trước

| Kiểu | Khi nào có | Dùng khi | Test được |
|---|---|---|---|
| **Cá nhân** | **Từ M1** | Mỗi dev cài Hub trên máy mình bằng một lệnh Docker (máy tối thiểu 4 vCPU / 16 GB RAM) | `http://localhost:<port>` trên chính máy đó |
| **Máy chủ nội bộ** | M3 (Phase 8) | Cả team dùng chung một Hub | Website chạy trên máy trong LAN, qua IP (vd. `http://192.168.1.50:3000`) |

Ở kiểu Cá nhân, báo cáo được chia sẻ bằng file PDF/HTML. Link chia sẻ, mời thành viên, SSO và dashboard thành viên có từ kiểu Máy chủ. Có tính năng xuất/nhập dự án để chuyển dữ liệu từ máy cá nhân lên máy chủ.

Muốn Hub chung test được `localhost` trên máy của từng dev thì cần thêm "local runner agent" (sau v1.0).

## 3. Không làm

- Không phải Jira: không có sprint, backlog, task board.
- Không test app mobile native hay desktop.
- Không chạy tải hoặc scan bảo mật chủ động vào hệ thống chưa xác minh quyền; production tắt mặc định, và khi bật vẫn không bao giờ chạy scan tấn công.
- Không tự kết luận "đạt chất lượng". AI và Hub chỉ đề xuất; người có trách nhiệm ký phát hành.
- "Test mọi luồng" nghĩa là mọi luồng **đã được khám phá, ghi lại hoặc mô tả**. Hub luôn hiện độ phủ và phần chưa kiểm tra, không hứa 100%.

## 4. Kiến trúc trong một hình

```text
Trình duyệt ──────────► Web (React) ─► API (NestJS) ─► PostgreSQL
Recorder (trong Hub) ◄═ WebSocket ═►      │
                                            ├─► Redis/BullMQ ─► Worker: API · Playwright · AI Explorer · k6 · ZAP · Lighthouse/axe
                                            │                       │
                                            ├─► Gemini (đổi được)   └─► Egress proxy (allowlist, chặn SSRF) ─► Website được test (local / internet)
                                            └─► MinIO (ảnh, video, log, báo cáo)
```

Chi tiết ở [docs/03](docs/03-architecture.md).

## 5. Lộ trình (team 3 dev + 1 QA bán thời gian)

| Mốc | Tuần | Dùng được gì |
|---|---|---|
| **M1 – Alpha** (Cá nhân) | 17 | Quản lý test case, chạy thủ công, test API, test hiệu năng (thay `k6-perf`), **AI Gemini phân tích nguyên nhân lỗi**, công tắc bật/tắt môi trường |
| **M2 – MVP nội bộ** (Cá nhân) | 27 | + Test trình duyệt, **Recorder**, **sơ đồ luồng**, Kiểm tra nhanh, sinh test theo luật, accessibility, SEO, dashboard, **báo cáo 1 trang**, quality gate |
| **M3 – v1.0** | 37 | + **kiểu Máy chủ nội bộ** (dùng chung cả team, link chia sẻ, SSO), AI sinh test, **AI Explorer**, AI tóm tắt báo cáo, nhận kết quả từ CI, bảo mật ZAP, visual regression, lịch chạy, thông báo, backup |

Lộ trình dài hơn bản đầu 6 tuần. Lý do: thêm Recorder dạng trình duyệt trong Hub, sơ đồ luồng, AI Explorer, đưa AI lên sớm, và tách kiểu Máy chủ thành một khối riêng. Thêm 1 dev thì rút còn khoảng 29 tuần. Chi tiết ở [docs/12](docs/12-implementation-plan.md).

## 6. Rủi ro lớn nhất

1. **Chạy nhầm tải lớn hoặc scan tấn công vào production.** Giảm thiểu bằng 5 lớp: công tắc production (mặc định tắt), allowlist, execution policy theo môi trường, phê duyệt gắn với đúng cấu hình được duyệt, giới hạn cứng trong worker và egress proxy.
2. **AI phân tích sai, hoặc chi phí Gemini tăng.** Giảm thiểu: luật cố định phân loại trước; AI luôn kèm bằng chứng và độ tin cậy; lỗi giống nhau chỉ phân tích một lần; có giới hạn số lần phân tích và ngân sách token.
3. **Test UI (ghi lại hoặc sinh tự động) dễ vỡ khi giao diện đổi.** Giảm thiểu: ưu tiên locator theo role/label/text; chạy lại xác nhận ngay sau khi ghi; theo dõi test chập chờn.

## 7. Còn cần anh/chị trả lời

Các câu hỏi lớn đã có câu trả lời. Phần còn lại ở [docs/14](docs/14-decisions-and-open-questions.md) mục 2 có phương án mặc định, nên không chặn việc bắt đầu:

- Quy mô team và ngày bắt đầu.
- Cấu hình máy của dev.
- Kênh thông báo.
- Mức tải tối đa.

## 8. Bước tiếp theo

1. Duyệt bộ tài liệu.
2. Chọn 3 website đang chạy local của công ty làm bộ mẫu để kiểm chứng crawler, Recorder và AI Explorer.
3. Tạo Gemini API key cho môi trường thử nghiệm.
4. Bắt đầu Phase 0: khởi tạo repo, CI, Docker Compose.
