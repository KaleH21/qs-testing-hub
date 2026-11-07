# 02. Danh mục loại kiểm thử (Web)

- Người đọc: QA, developer, Product owner
- Liên quan: [04-database-schema.md](04-database-schema.md) (enum `test_type`, `test_purpose`, `test_level`), [06-execution-engine.md](06-execution-engine.md) (runner), [07-reporting-and-scoring.md](07-reporting-and-scoring.md) (khía cạnh sức khỏe), [09-security-model.md](09-security-model.md) (chính sách an toàn)

> Thay thế bảng ở spec 1.0 mục 2 cho phạm vi website. Các loại không áp dụng cho web (Installation, Recovery, Unit chạy native) bị bỏ hoặc chỉ nhận kết quả qua import.

---

## 1. Tổng quan

| test_type | Kiểm tra gì | Runner | Execution mode | Dimension | Phase |
|---|---|---|---|---|---|
| `FUNCTIONAL` | Tính năng chạy đúng nghiệp vụ trên giao diện | manual, playwright | HYBRID | FUNCTIONAL | 2 / 5 |
| `API` | API trả đúng status, dữ liệu, schema, phân quyền | api | NATIVE_RUNNER | FUNCTIONAL | 3 |
| `PERFORMANCE` | Tốc độ và sức chịu tải của API/trang | k6, audit (Lighthouse) | NATIVE_RUNNER | PERFORMANCE | 4 / 5 |
| `SECURITY` | Cấu hình bảo mật, lỗ hổng web phổ biến | audit (headers/TLS/cookie), zap | NATIVE_RUNNER | SECURITY | 5 / 8 |
| `ACCESSIBILITY` | Người khuyết tật dùng được website | audit (axe), manual | HYBRID | ACCESSIBILITY | 5 |
| `COMPATIBILITY` | Chạy được trên nhiều trình duyệt, kích thước màn hình | playwright (matrix), manual | HYBRID | COMPATIBILITY_UI | 5 |
| `VISUAL` | Giao diện không bị thay đổi ngoài ý muốn | visual (playwright) | NATIVE_RUNNER | COMPATIBILITY_UI | 8 |
| `SEO` | Google đọc và hiển thị trang tốt | audit (Lighthouse) | NATIVE_RUNNER | WEB_STANDARDS | 5 |
| `BEST_PRACTICES` | Tuân thủ chuẩn web hiện đại | audit (Lighthouse) | NATIVE_RUNNER | WEB_STANDARDS | 5 |
| `LINK_INTEGRITY` | Không có link hỏng, ảnh/tài nguyên lỗi | audit (links) | NATIVE_RUNNER | FUNCTIONAL | 5 |
| `USABILITY` | Dễ dùng, dễ hiểu | manual (checklist) | MANUAL | COMPATIBILITY_UI | 2 |
| `RELIABILITY` | Ổn định theo thời gian, không chập chờn | k6 (soak), lịch smoke, thống kê flaky | HYBRID | RELIABILITY | 4 / 8 |
| `EXPLORATORY` | Lỗi mà kịch bản có sẵn không nghĩ tới | manual (session) | MANUAL | FUNCTIONAL | 2 |
| `UNIT` | Từng hàm/component trong code | import (JUnit XML) | EXTERNAL_IMPORT | FUNCTIONAL | 7 |
| `INTEGRATION` | Các module/dịch vụ phối hợp đúng | import (JUnit XML) | EXTERNAL_IMPORT | FUNCTIONAL | 7 |

Execution mode theo spec 1.0 mục 2.1: `MANUAL` người làm; `NATIVE_RUNNER` Hub tự chạy; `EXTERNAL_IMPORT` nhận kết quả từ CI; `HYBRID` cả hai.

---

## 2. Chi tiết từng loại

### 2.1. FUNCTIONAL

| Mục | Nội dung |
|---|---|
| Lời thường | Bấm thử từng chức năng như người dùng thật để xem có ra đúng kết quả không. |
| Kiểm tra | Luồng nghiệp vụ, positive/negative/boundary, validation form, thông báo lỗi, phân quyền theo vai trò |
| Cách chạy | Manual (bước bằng lời) hoặc Playwright chạy DSL (bước tự động) trên **cùng một test case** |
| Cấu hình chính | Bước, dữ liệu test (`test_data_sets`), tài khoản theo vai trò (`environment_credentials`), shared flow |
| Kết quả | Trạng thái từng bước (`step_results`), screenshot, video/trace khi fail |
| Tạo test | Recorder, sinh theo luật, AI Explorer hoặc viết tay (mục 5.1) |
| An toàn | Bước có ghi dữ liệu (submit form, tạo/xóa) **không chạy tự động trên production** trừ khi `execution_policies.allow_write_requests = true` |

### 2.2. API

| Mục | Nội dung |
|---|---|
| Lời thường | Kiểm tra "đường ống dữ liệu" phía sau website: hỏi đúng thì phải trả lời đúng, hỏi sai thì phải từ chối đúng. |
| Kiểm tra | Status code, header, body (JSONPath), schema (OpenAPI), thời gian phản hồi, thiếu/sai token → 401/403, chaining nhiều request |
| Cấu hình chính | `api_requests` (method, URL, header, body, auth, assertions, extract), biến môi trường |
| Kết quả | `api_run_results` (request/response đã redact, kết quả từng assertion), thời gian phản hồi |
| An toàn | Request có `is_write = true` bị chặn trên production theo mặc định; secret luôn redact |

### 2.3. PERFORMANCE

| Mục | Nội dung |
|---|---|
| Lời thường | Cho nhiều "người dùng ảo" truy cập cùng lúc để xem website còn nhanh không và chịu được bao nhiêu người. Kèm đo tốc độ tải trang như người dùng thật cảm nhận. |
| Kiểm tra | **k6**: p50/p95/p99 latency, req/s, tỉ lệ thành công, tỉ lệ sẵn sàng theo từng API; điểm bão hòa; chậm dần theo thời gian. **Lighthouse**: LCP, INP (TBT thay thế khi lab), CLS, FCP, TTFB, điểm Performance |
| Profile k6 | `smoke` (1 req/s, 30 s), `load`, `stress`, `spike`, `soak` (kế thừa `k6-perf`, xem [11-k6-migration.md](11-k6-migration.md)) |
| Cấu hình chính | `performance_scenarios` (API request + weight, profile, `rate_scale`, SLO) |
| Kết quả | `run_metrics`, bảng theo từng API, chẩn đoán nguyên nhân (`diagnose`), k6 dashboard HTML (artifact) |
| An toàn | Mọi profile **khác `smoke` cần duyệt**, trừ môi trường LOCAL. Production (khi đã bật): chỉ `smoke` + request chỉ đọc, trừ khi Admin nới policy. Giới hạn cứng `max_perf_rps`, `max_perf_duration_s`, `max_vus` |

### 2.4. SECURITY

| Mục | Nội dung |
|---|---|
| Lời thường | Kiểm tra website có "khóa cửa" cẩn thận không: dùng HTTPS đúng, không lộ thông tin, không dính các lỗ hổng phổ biến mà kẻ xấu hay khai thác. |
| Mức 1: `HEADERS_TLS` | HSTS, CSP, X-Content-Type-Options, frame-ancestors/X-Frame-Options, Referrer-Policy, Permissions-Policy, cookie Secure/HttpOnly/SameSite, phiên bản TLS, hạn chứng chỉ, mixed content, lộ phiên bản server. Chỉ đọc |
| Mức 2: `ZAP_BASELINE` | Spider + passive scan (chỉ quan sát, không tấn công) |
| Mức 3: `ZAP_API` | Quét API theo OpenAPI, có gửi payload kiểm tra |
| Mức 4: `ZAP_FULL` | Active scan: gửi payload tấn công thử (SQLi, XSS...) |
| Kết quả | Finding theo `riskcode` của ZAP, báo cáo HTML/JSON gốc (artifact) |
| An toàn | Mức 1–2 chạy được mọi môi trường đã xác minh. Mức 3–4 **cần duyệt** và **cấm trên production** (không có cờ nới) |

### 2.5. ACCESSIBILITY

| Mục | Nội dung |
|---|---|
| Lời thường | Kiểm tra người khiếm thị (dùng trình đọc màn hình), người chỉ dùng bàn phím hoặc người nhìn màu kém có dùng được website không. |
| Kiểm tra tự động | axe-core với tag `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`: tương phản màu, alt ảnh, label form, cấu trúc heading, ARIA, ngôn ngữ trang |
| Kiểm tra thủ công | Checklist: điều hướng bằng bàn phím, focus nhìn thấy, trình đọc màn hình đọc đúng thứ tự, zoom 200% |
| Kết quả | Vi phạm gom theo rule × impact (critical/serious/moderate/minor), số phần tử bị ảnh hưởng |
| Giới hạn | Công cụ tự động chỉ phát hiện khoảng 30–40% vấn đề WCAG; báo cáo luôn ghi rõ điều này |

### 2.6. COMPATIBILITY

| Mục | Nội dung |
|---|---|
| Lời thường | Kiểm tra website hiển thị và hoạt động đúng trên Chrome, Firefox, Safari và trên máy tính, máy tính bảng, điện thoại. |
| Cách chạy | Chạy lại test FUNCTIONAL tự động theo ma trận `test_plans.matrix`: Chromium / Firefox / WebKit × desktop (1366×768) / tablet (768×1024) / mobile (390×844) |
| Kết quả | Pass/fail theo ô ma trận; mỗi ô là một `test_run_item` (`browser`, `viewport`) |
| An toàn | Như FUNCTIONAL |

### 2.7. VISUAL

| Mục | Nội dung |
|---|---|
| Lời thường | Chụp ảnh màn hình và so với ảnh chuẩn đã duyệt để phát hiện chỗ bị lệch, mất, vỡ giao diện. |
| Cách chạy | Bước DSL `visualCompare`; so pixel với `visual_baselines`, ngưỡng mặc định 0,1% pixel khác; vùng động (ngày giờ, quảng cáo) khai báo mask |
| Kết quả | Ảnh hiện tại, ảnh baseline, ảnh diff; người có quyền bấm "Chấp nhận làm baseline mới" |
| An toàn | Chỉ đọc |

### 2.8. SEO và BEST_PRACTICES

| Mục | Nội dung |
|---|---|
| Lời thường | SEO: Google có tìm thấy và hiển thị trang đẹp không. Best practices: website có dùng các cách làm an toàn, hiện đại không (HTTPS, không lỗi console, ảnh đúng tỉ lệ...). |
| Kiểm tra | Lighthouse category `seo` (title, meta description, canonical, robots, hreflang, link crawl được) và `best-practices` |
| Kết quả | Điểm 0–100 theo trang, danh sách audit fail |
| An toàn | Chỉ đọc |

### 2.9. LINK_INTEGRITY

| Mục | Nội dung |
|---|---|
| Lời thường | Đi qua các trang để tìm link dẫn tới trang lỗi, ảnh không hiện, file không tải được. |
| Kiểm tra | Link nội bộ (GET), link ngoài (HEAD, fallback GET), ảnh/script/css lỗi; status ≥ 400, timeout, redirect vòng |
| Kết quả | Danh sách link hỏng, trang chứa link, status |
| An toàn | Link ngoài: chỉ HEAD/GET, tối đa 2 request đồng thời mỗi domain ngoài, không theo link ngoài sang trang khác |

### 2.10. USABILITY

| Mục | Nội dung |
|---|---|
| Lời thường | Người dùng có dễ hiểu, dễ thao tác không, có bị bối rối ở bước nào không. |
| Cách chạy | Manual: checklist heuristic (Nielsen 10 heuristics) do tester chấm Đạt/Không đạt kèm ghi chú |
| Kết quả | Kết quả từng mục checklist, finding |

### 2.11. RELIABILITY

| Mục | Nội dung |
|---|---|
| Lời thường | Website có chạy ổn định lâu dài không, hay lúc được lúc không. |
| Nguồn dữ liệu | k6 profile `soak`; smoke chạy theo lịch (tỉ lệ thành công theo thời gian); `test_case_stats.flip_rate` (test chập chờn) |
| An toàn | `soak` cần duyệt như PERFORMANCE |

### 2.12. EXPLORATORY

| Mục | Nội dung |
|---|---|
| Lời thường | Tester tự do khám phá website trong thời gian giới hạn để tìm lỗi bất ngờ. |
| Cách chạy | Session: mục tiêu (charter), thời gian (vd. 60 phút), ghi chú, screenshot, finding. Lưu là một test case `EXPLORATORY` + 1 attempt |

### 2.13. UNIT và INTEGRATION

| Mục | Nội dung |
|---|---|
| Lời thường | Kết quả kiểm thử do chính lập trình viên viết trong code, được gửi về Hub để xem chung. |
| Cách chạy | CI gửi JUnit XML qua `POST /imports/junit` bằng service account; mỗi `<testcase>` thành `test_run_item` với `external_test_id = classname::name` |
| Kết quả | Pass/fail/skip/error, thời gian, message |
| Ghi chú | Hub không chạy unit test |

---

## 3. Mục đích kiểm thử (`test_purpose`)

Một test case có thể có nhiều mục đích. Đây là **nhãn để chọn test vào kế hoạch**, không phải loại test.

| Purpose | Ý nghĩa | Ví dụ dùng |
|---|---|---|
| `SMOKE` | Vài test quan trọng nhất, chạy nhanh để biết bản build có "sống" không | Sau mỗi lần deploy |
| `SANITY` | Kiểm tra nhanh phần vừa sửa | Sau hotfix |
| `REGRESSION` | Kiểm tra lại các tính năng cũ không bị hỏng | Trước release, chạy đêm |
| `RETEST` | Chạy lại test liên quan đến finding đã sửa | Finding chuyển `RESOLVED` |
| `ACCEPTANCE` | Khách hàng/BA xác nhận đúng yêu cầu (UAT) | Trước bàn giao |
| `NEW_FEATURE` | Test cho tính năng mới trong bản này | Trong giai đoạn phát triển |

## 4. Cấp độ kiểm thử (`test_level`)

| Level | Ý nghĩa | Nguồn trong Hub |
|---|---|---|
| `UNIT` | Từng hàm, component | Import |
| `INTEGRATION` | Nhiều module/dịch vụ kết hợp | Import, API |
| `SYSTEM` | Toàn hệ thống qua API/giao diện | API, Playwright, audit, k6, ZAP |
| `E2E` | Trọn luồng người dùng từ đầu đến cuối | Playwright, manual |
| `UAT` | Người dùng/khách hàng nghiệm thu | Manual |

## 5. Loại test × môi trường

Môi trường có `environments.kind` = `LOCAL` / `DEV` / `STAGING` / `PRODUCTION` (D-23). Bảng là mặc định của `execution_policies`; Admin có thể siết thêm, chỉ các ô có dấu `*` được nới.

**Công tắc trước mọi thứ (D-24):** môi trường chỉ chạy được khi công tắc cấp tổ chức **và** `environments.testing_enabled` cùng bật. Mặc định: `organizations.production_testing_enabled = false` (mọi ô cột Production bị chặn cho tới khi Admin bật), `local_testing_enabled = true`. Bật/tắt production cần Admin, các môi trường khác cần QA Lead; mỗi lần ghi audit kèm lý do.

| Loại / chế độ | Local | Dev | Staging / QA | Production (khi đã bật) |
|---|---|---|---|---|
| Manual (mọi loại) | ✓ | ✓ | ✓ | ✓ |
| FUNCTIONAL tự động, chỉ đọc | ✓ | ✓ | ✓ | ✓ |
| FUNCTIONAL tự động có ghi dữ liệu | ✓ | ✓ | ✓ | ✗ * |
| API chỉ đọc (GET/HEAD) | ✓ | ✓ | ✓ | ✓ |
| API ghi (POST/PUT/PATCH/DELETE) | ✓ | ✓ | ✓ | ✗ * |
| PERFORMANCE `smoke` | ✓ | ✓ | ✓ | ✓ (chỉ request đọc) |
| PERFORMANCE `load`/`stress`/`spike`/`soak` | ✓ (không cần duyệt) | Duyệt | Duyệt | ✗ * (nới thì vẫn phải duyệt) |
| Lighthouse, axe, links, headers/TLS | ✓ | ✓ | ✓ | ✓ |
| ZAP baseline (passive) | ✓ | ✓ | ✓ | ✓ |
| ZAP API / full active | Duyệt | Duyệt | Duyệt | ✗ (không nới được) |
| COMPATIBILITY, VISUAL | ✓ | ✓ | ✓ | ✓ (chỉ bước đọc) |
| Discovery crawler | ✓ | ✓ | ✓ | ✓ (không submit form trừ login) |
| AI Explorer | ✓ (ghi khi bật cờ) | ✓ (ghi khi bật cờ) | ✓ chỉ đọc | ✓ chỉ đọc |
| Import JUnit | ✓ | ✓ | ✓ | ✓ |

Ghi chú:
- **LOCAL** = app chạy ở `localhost` hoặc IP LAN, không cần xác minh DNS. Cho phép ghi dữ liệu và chạy hiệu năng không cần duyệt vì chỉ ảnh hưởng máy của dev; **giới hạn cứng toàn hệ thống vẫn áp dụng** (k6 ≤ 2.000 req/s, ≤ 2 giờ, `rate_scale ≤ 20`). Cách Hub với tới `localhost` phụ thuộc kiểu cài (Cá nhân / Máy chủ nội bộ), xem [06](06-execution-engine.md) mục 3.0.
- Host LAN (Local, Dev, Staging nội bộ) phải nằm trong `target_hosts` với `allow_private_network = true` và CIDR được Admin duyệt (xem [09-security-model.md](09-security-model.md)).

### 5.1. Test luồng nghiệp vụ và độ phủ luồng

"Luồng" là chuỗi bước chuyển giữa các trang (bấm link/nút, gửi form, redirect). Hub lập **Sơ đồ luồng** (D-28) và tô màu bước chuyển đã có test / chưa có test. Có 4 cách tạo test FUNCTIONAL cho luồng:

| Cách | Ai dùng | Kết quả | Phase |
|---|---|---|---|
| **Recorder** (trình duyệt từ xa ngay trong Hub, không cần cài gì) | Tester, BA: thao tác trên website như bình thường trong khung trình duyệt của Hub | Test case tự động `DRAFT`, mỗi bước có ảnh; ghi được cả website `localhost` (kiểu cài Cá nhân) | 5 |
| **Sinh theo luật** từ Discovery | Tự động | Smoke trang, validation form, kiểm API ([06](06-execution-engine.md) mục 11) | 5 |
| **AI Explorer** | Nhập mục tiêu ("Đặt một đơn hàng") hoặc để AI tự đề xuất | Luồng đã chạy lại xác nhận → test case `DRAFT` có DSL | 7 |
| **Viết tay** trong editor trực quan | Tester | Bước lời + bước tự động | 2 / 5 |

`Độ phủ luồng = bước chuyển có test case ACTIVE / bước chuyển đã biết`. "Mọi luồng" nghĩa là mọi luồng **đã khám phá, đã ghi hoặc đã khai báo**; luồng cần dữ liệu đặc biệt mà crawler và AI không tự tới được phải ghi bằng Recorder hoặc mô tả mục tiêu cho AI Explorer. Báo cáo luôn hiện độ phủ này để người đọc biết phần nào chưa được kiểm thử.

---

## 6. Quick Scan (Kiểm tra nhanh)

Preset cố định, không cần test case, **chỉ đọc**. Chạy được trên **LOCAL** (thường là lần chạy đầu tiên khi website còn ở máy dev), Dev, Staging và Production (khi công tắc production đã bật). Một `test_run` với `kind = QUICK_SCAN`.

| Bước | Kiểm tra | Runner | Giới hạn | Timebox |
|---|---|---|---|---|
| 1 | Discovery: crawl trang (không đăng nhập, trừ khi chọn tài khoản test) | discovery | ≤ 50 trang, độ sâu ≤ 3, cùng origin, 2 trang song song | 4 phút |
| 2 | Smoke mỗi trang: status < 400, không lỗi JS console, không request tài nguyên lỗi | audit | Trang từ bước 1 | (cùng bước 1) |
| 3 | Link integrity | audit (links) | Link từ ≤ 50 trang; link ngoài HEAD, 2 request/domain | 2 phút |
| 4 | Lighthouse (mobile preset) | audit | Trang chủ + tối đa 4 trang có nhiều link trỏ tới nhất | 3 phút |
| 5 | axe-core WCAG 2.1 AA | audit | Tối đa 10 trang | 1 phút |
| 6 | Security headers / TLS / cookie | audit | Trang chủ + 1 trang sau đăng nhập (nếu có) | 0,5 phút |
| 7 | ZAP baseline: spider + **passive only** | zap | ≤ 50 URL, không active scan | 3 phút |
| 8 | k6 smoke trên trang chủ + tối đa 4 trang | k6 | **1 req/s, 30 giây**, chỉ GET | 1 phút |
| | **Tổng** | | | **≤ 14,5 phút** (+ 0,5 phút tính điểm, tạo báo cáo) |

Quy tắc:
- Bước 2–8 chạy song song khi có worker trống; timebox là trần cho từng bước. Hết timebox → bước dừng, phần đã có vẫn được tính, phần còn lại ghi "Chưa kiểm tra (hết thời gian)".
- Không gửi request ghi; không submit form (trừ form login đã khai báo).
- URL phải thuộc `target_hosts` đã xác minh; với LOCAL là host/CIDR nội bộ đã được Admin cho phép (không cần xác minh DNS).
- Kết quả: báo cáo sức khỏe 7 khía cạnh; FUNCTIONAL chỉ dựa trên smoke + link nên luôn ghi độ phủ thấp; COMPATIBILITY_UI và RELIABILITY thường "Chưa kiểm tra" (Quick Scan chỉ chạy một trình duyệt, một lần).
- Sau khi xong, gợi ý: "Tạo bộ test case từ kết quả khám phá" (sinh theo luật, xem [06-execution-engine.md](06-execution-engine.md) mục 10).
