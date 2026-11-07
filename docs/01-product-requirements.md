# 01. Product Requirements (PRD): QA Testing Hub, bản Web

- Phiên bản: 2.1 (mở rộng từ `QA-Testing-Hub-Product-Specification.md` v1.0)
- Ngày: 07/11/2026. Bản 2.1: local-first, bật/tắt test theo môi trường, AI mặc định Gemini, AI phân tích nguyên nhân lỗi trong lúc test, Recorder, sơ đồ luồng, AI Explorer, báo cáo 1 trang (D-23 → D-31 ở [14](14-decisions-and-open-questions.md))
- Trạng thái: Draft, chờ duyệt
- Người đọc: Product owner, QA Lead, Tech Lead, team dev

> **Quan hệ với spec 1.0.** Spec 1.0 vẫn là nền. Bộ `docs/` này làm 3 việc:
> (1) thu hẹp đối tượng được kiểm thử về **website, web app và HTTP API của chúng**;
> (2) bổ sung tính năng (Quick Scan, Discovery, sinh test tự động, chỉ số sức khỏe, quality gate...);
> (3) chốt các điểm spec 1.0 còn để mở. Khi hai bên mâu thuẫn, `docs/` thắng.

---

## 1. Bối cảnh

| Hiện trạng | Hệ quả |
|---|---|
| Đã có `k6-perf`: tool load test cho **một** backend (`qs-net-management-be`), chỉ chạy localhost, không đăng nhập, cấu hình bằng file JSON | Không dùng lại được cho dự án khác; chỉ có hiệu năng |
| Test case nằm rải rác ở Excel, Postman, script riêng của từng người | Không có lịch sử, không tổng hợp được |
| Báo cáo là log và số kỹ thuật (p95, 5xx...) | Lãnh đạo, khách hàng, BA không đọc được |
| Mỗi dự án web phải tự lo test bảo mật, accessibility, SEO | Phần lớn dự án bỏ qua các loại test này |

## 2. Mục tiêu (đo được)

| # | Mục tiêu | Cách đo |
|---|---|---|
| G1 | Từ lúc tạo dự án đến báo cáo sức khỏe đầu tiên **≤ 15 phút**, không viết code | Thời gian từ `project.created` đến `quick_scan.completed` |
| G2 | Giảm **≥ 50%** thời gian soạn bộ test case ban đầu | Thời gian từ tạo dự án đến khi bộ test case đầu tiên được duyệt, so với cách làm Excel hiện tại |
| G3 | Người không chuyên trả lời được 3 câu trong **≤ 2 phút** khi đọc báo cáo: *Phát hành được chưa? Vấn đề lớn nhất là gì? Tốt hơn hay tệ hơn lần trước?* | Usability test với 5 người không thuộc team kỹ thuật |
| G4 | **100%** dự án web đang phát triển có kế hoạch kiểm thử và lịch chạy regression | Số project có `schedule` đang bật / tổng project active |
| G5 | Mọi con số trên báo cáo truy được đến lần chạy, test case và bằng chứng | Review: mỗi KPI có link drill-down |
| G6 | **≥ 80%** luồng đã khám phá của một dự án có ít nhất 1 test case | Chỉ số "Độ phủ luồng" (D-28) |
| G7 | Mỗi lỗi có **nguyên nhân có khả năng do AI đưa ra trong ≤ 2 phút** sau khi test fail; **≥ 70%** được người dùng đánh giá đúng hoặc hữu ích | Thời gian `analysis.ready` − thời điểm item fail; feedback 👍/👎 |
| G8 | Phần tóm tắt báo cáo vừa **1 màn hình / 1 trang PDF** | Review báo cáo mẫu |

## 3. Không làm (giữ nguyên spec 1.0 và bổ sung)

- Không quản lý sprint, backlog, task board, timesheet, roadmap. Không thay Jira.
- Không test ứng dụng mobile native, desktop, phần cứng, email/SMS.
- Không chạy load test hoặc security scan chủ động vào hệ thống **không thuộc công ty** hoặc chưa được xác minh.
- Không đo code coverage bằng cách can thiệp mã nguồn; chỉ **nhập** báo cáo coverage có sẵn (giai đoạn sau).
- Không tự kết luận "đạt chất lượng". Hub đánh giá theo **tiêu chí do con người đặt** (quality gate); quyết định phát hành vẫn là người ký.

## 4. Người dùng

| Persona | Cần gì | Màn hình chính |
|---|---|---|
| **Tester / QA** | Soạn và duyệt test case nhanh, chạy manual, ghi bằng chứng, tạo finding | Test Cases, Manual Execution, Findings |
| **Developer** | Test API, xem vì sao test fail, chạy test từ CI | API Testing, Run detail, AI phân tích lỗi |
| **QA Lead / Tech Lead** | Lập kế hoạch, giao việc test, đặt quality gate, duyệt chạy hiệu năng/bảo mật | Test Plans, Approvals, Project Dashboard |
| **Quản lý / BA / Khách hàng** (không chuyên) | Biết sản phẩm có ổn không, rủi ro ở đâu, có tiến bộ không | Báo cáo sức khỏe, link chia sẻ, PDF |
| **Admin** | Thành viên, quyền, domain được phép test, secret, chính sách chạy | Settings |

## 5. Đối tượng được kiểm thử

| Trong phạm vi | Ngoài phạm vi (có thể làm sau) |
|---|---|
| Website và web app: SPA (React/Vue/Angular), SSR, trang truyền thống | gRPC, WebSocket, GraphQL subscription |
| HTTP API: REST/JSON, GraphQL query/mutation qua HTTP | App mobile native, desktop |
| **Ưu tiên website đang chạy ở local** (`localhost` hoặc IP trong LAN) trước khi lên internet; sau đó là staging và production trên internet (phải nằm trong allowlist, xem [09-security-model.md](09-security-model.md)) | Hệ thống của bên thứ ba chưa xác minh quyền |

**Vòng đời môi trường của một dự án** (D-23): `LOCAL` → `DEV` → `STAGING` → `PRODUCTION`. Cùng một bộ test case chạy được ở mọi môi trường, chỉ đổi URL và tài khoản test. Mỗi môi trường **bật/tắt test được** (D-24); production mặc định tắt ở cấp tổ chức.

Hub cài được theo 2 kiểu:
- **Cá nhân** (làm trước, D-32): Docker Compose trên chính máy dev, test thẳng `http://localhost:<port>`. Có từ M1.
- **Máy chủ nội bộ** (Phase 8, M3): một bản cho cả team, test website local qua IP LAN của máy dev (`http://192.168.x.x:<port>`). Chuyển dữ liệu từ bản Cá nhân lên bằng xuất/nhập dự án.

Muốn Hub trung tâm test được `localhost` trên máy của từng dev thì cần "local runner agent" (Phase 9).

## 6. Luồng giá trị chính

```text
 1. Tạo dự án ──► 2. Khai báo môi trường + URL ──► 3. Xác minh quyền test domain
                                                          │
 8. Báo cáo dễ hiểu ◄── 7. Finding tự động ◄── 6. Chạy ◄──┤
        ▲                                                 │
        │            5. Kế hoạch kiểm thử ◄── 4. Khám phá (Discovery) + sinh test case
        └──── so sánh, xu hướng, quality gate, lịch chạy định kỳ
```

1. **Tạo dự án**: tên, mã, mô tả; tùy chọn link repo, file OpenAPI, Postman collection, tài liệu yêu cầu (PDF/DOCX/MD/text).
2. **Môi trường**: Local / Dev / Staging / Production, mỗi môi trường có URL web, URL API, tài khoản test (lưu trong secret vault), biến môi trường, công tắc bật/tắt test.
3. **Xác minh**: môi trường `LOCAL` chỉ cần nằm trong dải IP nội bộ Admin đã cho phép; domain internet xác minh bằng DNS TXT, file `/.well-known/qa-hub-verification.txt`, hoặc Admin duyệt.
4. **Khám phá luồng**, 3 cách bổ sung cho nhau:
   - **Crawler** đi qua website (cả sau đăng nhập), ghi lại trang, form, nút, link, API mà trang gọi; đọc OpenAPI.
   - **Recorder** (trình duyệt ngay trong Hub, không cần cài gì): người dùng tự thao tác một luồng, Hub ghi thành các bước test kèm ảnh chụp.
   - **AI Explorer**: Gemini tự thao tác website như người dùng để tìm luồng nhiều bước mà crawler không thấy.

   Kết quả là **Sơ đồ luồng**: các trang và bước chuyển giữa chúng, tô màu phần đã có test và chưa có test.
5. **Sinh test và kế hoạch**: từ sơ đồ luồng và tài liệu yêu cầu, hệ thống sinh **bản nháp** test plan, suite, test case (bằng luật cố định và AI). Người dùng duyệt hàng loạt trên giao diện trực quan (mỗi bước có ảnh chụp).
6. **Chạy**: một nút "Chạy toàn bộ kế hoạch". Hub chia việc cho từng runner (API, trình duyệt, hiệu năng, bảo mật, accessibility...), hiện tiến độ trực tiếp. **Test nào fail thì AI phân tích nguyên nhân ngay**, hiện trên màn hình đang chạy.
7. **Finding**: lỗi tự động (test fail, cảnh báo bảo mật, vi phạm accessibility) được gom nhóm, chống trùng, thành finding, kèm nguyên nhân AI đề xuất.
8. **Báo cáo ngắn gọn, 1 trang**: câu kết luận, 7 thẻ khía cạnh, tối đa 3 vấn đề quan trọng nhất (chuyện gì, ảnh hưởng, nguyên nhân AI, cách sửa, ảnh minh họa), độ phủ luồng, xu hướng so với lần trước. Chi tiết kỹ thuật ở phụ lục. Xuất PDF/Excel, link chia sẻ.

## 7. Danh sách tính năng

Ưu tiên: **M** = Must (MVP), **S** = Should (v1.0), **C** = Could (sau v1.0). Phase tham chiếu [12-implementation-plan.md](12-implementation-plan.md).

### E1. Tài khoản, tổ chức, phân quyền

| ID | Tính năng | Ưu tiên | Phase |
|---|---|---|---|
| E1.1 | Đăng nhập email/mật khẩu, khóa tài khoản sau N lần sai; màn cài lần đầu tạo Owner; đặt lại mật khẩu bằng lệnh CLI (kiểu Cá nhân) | M | 1 |
| E1.2 | Organization, thành viên, gán role (schema và phân quyền đa người dùng ngay từ đầu) | M | 1 |
| E1.8 | Mời thành viên qua email, quên mật khẩu qua email (kiểu Máy chủ) | M | 8 |
| E1.3 | Project member với role riêng theo dự án | M | 1 |
| E1.4 | Service account + API token (hash), scope, hết hạn | M | 1 |
| E1.5 | Audit log | M | 1 |
| E1.6 | SSO OIDC (Google Workspace / Microsoft Entra) | S | 8 |
| E1.7 | 2FA TOTP cho Owner/Admin | S | 8 |

### E2. Dự án, môi trường, dữ liệu test

| ID | Tính năng | Ưu tiên | Phase |
|---|---|---|---|
| E2.1 | CRUD project, lưu trữ (archive) | M | 1 |
| E2.2 | Môi trường theo loại `LOCAL` / `DEV` / `STAGING` / `PRODUCTION`: URL web, URL API, biến, header mặc định | M | 1 |
| E2.8 | **Công tắc bật/tắt test**: cấp tổ chức (production mặc định tắt, local mặc định bật) và từng môi trường; ghi audit + lý do; tắt thì chặn tạo run và tạm dừng lịch | M | 1 |
| E2.9 | Hỗ trợ website `localhost` (kiểu cài Cá nhân, Phase 1) và IP LAN (kiểu cài Máy chủ nội bộ, Phase 8) | M | 1 / 8 |
| E2.10 | Xuất/nhập dự án (test case, plan, môi trường không kèm secret, lịch sử tùy chọn) để chuyển từ bản Cá nhân lên Máy chủ | M | 8 |
| E2.3 | Secret vault: mật khẩu tài khoản test, API key; mã hóa AES-256-GCM, không bao giờ trả về frontend | M | 1 |
| E2.4 | Target allowlist + xác minh domain (DNS/file/Admin duyệt) | M | 1 |
| E2.5 | Môi trường `kind = PRODUCTION` → áp chính sách an toàn mạnh hơn | M | 1 |
| E2.6 | Tài khoản test theo vai trò (admin/user/guest) dùng cho test phân quyền | S | 5 |
| E2.7 | Data set (CSV/bảng) cho data-driven test | S | 5 |

### E3. Khám phá dự án (Discovery)

| ID | Tính năng | Ưu tiên | Phase |
|---|---|---|---|
| E3.1 | Crawler Playwright: giới hạn độ sâu, số trang, cùng origin, có thể đăng nhập trước | M | 5 |
| E3.2 | Ghi lại mỗi trang: URL, title, status, screenshot, form (field, type, required, pattern, maxlength), nút, link, lỗi console, request lỗi | M | 5 |
| E3.3 | Bắt các API mà trang gọi (XHR/fetch) → danh sách endpoint đã quan sát | M | 5 |
| E3.4 | Import OpenAPI 3.x / Swagger 2.0 / Postman collection v2.1 → API collection | M | 3 |
| E3.7 | **Sơ đồ luồng**: đồ thị trang + bước chuyển (link, nút, submit form, redirect), tô màu đã có test / chưa có test, bấm vào bước chuyển để tạo test hoặc ghi luồng | M | 5 |
| E3.8 | **Độ phủ luồng** = bước chuyển có test case `ACTIVE` / bước chuyển đã khám phá | M | 5 |
| E3.9 | **AI Explorer**: Gemini tự thao tác website để tìm luồng nhiều bước; mỗi luồng được chạy lại xác nhận trước khi thành test case nháp; chỉ gửi form/ghi dữ liệu ở `LOCAL`/`DEV` khi người dùng bật | M | 7 |
| E3.5 | Nhận diện công nghệ cơ bản (framework, server header) | C | 9 |
| E3.6 | So sánh hai lần discovery: trang mới, trang mất | C | 9 |

### E4. Quản lý kiểm thử

| ID | Tính năng | Ưu tiên | Phase |
|---|---|---|---|
| E4.1 | Test plan: mục tiêu, phạm vi (suite, loại test), môi trường, tiêu chí kết thúc, quality gate | M | 2 |
| E4.2 | Mẫu test plan có sẵn: *Kiểm tra nhanh*, *Smoke trước deploy*, *Regression đầy đủ*, *Kiểm thử phát hành*, *Đánh giá bảo mật* | S | 6 |
| E4.3 | Suite dạng cây; test case thuộc nhiều suite (bảng nối) | M | 2 |
| E4.4 | Test case: bước thủ công (lời) + tùy chọn **bước tự động** (DSL, xem [06-execution-engine.md](06-execution-engine.md)) trên cùng một test case | M | 2 / 5 |
| E4.5 | Phân loại: test type, purpose (smoke/regression...), level, priority, tag | M | 2 |
| E4.6 | Lịch sử phiên bản test case (ai sửa gì, khi nào); kết quả cũ giữ snapshot | M | 2 |
| E4.7 | Import/Export test case CSV/XLSX (để chuyển từ Excel sang) | M | 2 |
| E4.8 | Shared flow tái sử dụng (vd. "Đăng nhập bằng tài khoản admin") | S | 5 |
| E4.9 | Tìm kiếm, lọc, phân trang, thao tác hàng loạt | M | 2 |
| E4.10 | **Recorder**: trình duyệt từ xa ngay trong Hub (không cần cài extension), ghi thao tác thành bước test kèm ảnh chụp, che ô mật khẩu, lưu thành test case nháp; ghi được cả website `localhost` | M | 5 |
| E4.11 | **Trình sửa bước trực quan**: mỗi bước là một thẻ có ảnh chụp màn hình, kéo thả đổi thứ tự, "chạy thử bước" | M | 5 |

### E5. Sinh test tự động

| ID | Tính năng | Ưu tiên | Phase |
|---|---|---|---|
| E5.1 | **Sinh theo luật** (không cần AI, kết quả ổn định): smoke mỗi trang, validation mỗi form, kiểm tra mỗi API (status, schema, thiếu token → 401), broken link, a11y mỗi trang | M | 5 |
| E5.2 | **Sinh bằng AI** từ mô tả nghiệp vụ, tài liệu yêu cầu, OpenAPI, form đã khám phá: positive, negative, boundary, edge case, phân quyền | M | 7 |
| E5.3 | Mọi test case sinh ra ở trạng thái `DRAFT`; hàng đợi duyệt (duyệt/sửa/bỏ, duyệt hàng loạt) | M | 5 |
| E5.4 | AI đề xuất **bước tự động** (DSL) cho test case thủ công | S | 7 |
| E5.5 | AI sinh test plan đề xuất từ sơ đồ dự án | S | 7 |

### E6. Thực thi

| ID | Tính năng | Ưu tiên | Phase |
|---|---|---|---|
| E6.1 | Manual execution workspace: từng bước, Pass/Fail/Blocked/Skip, ghi chú, đính kèm, chụp màn hình dán vào | M | 2 |
| E6.2 | API runner: request, biến, chaining, assertion, timeout | M | 3 |
| E6.3 | Browser runner (Playwright) chạy DSL, có screenshot/video/trace | M | 5 |
| E6.4 | Performance runner (k6, chuyển từ `k6-perf`) | M | 4 |
| E6.5 | Audit runner: Lighthouse (hiệu năng trang, SEO, best practice), axe-core (accessibility), broken link, security headers/TLS/cookie | M | 5 |
| E6.6 | Security runner: OWASP ZAP baseline (thụ động) | S | 8 |
| E6.7 | ZAP active scan / API scan: **bắt buộc duyệt**, không chạy trên production | S | 8 |
| E6.8 | Ma trận tương thích: Chromium / Firefox / WebKit × desktop / tablet / mobile viewport | S | 5 |
| E6.9 | Visual regression: chụp baseline, so pixel, duyệt thay đổi | S | 8 |
| E6.10 | Orchestrator "Chạy toàn bộ": chia run thành job theo runner, tổng hợp tiến độ | M | 3 |
| E6.11 | Retry có kiểm soát (không ghi đè attempt), cancel, timeout, trạng thái `ERROR` riêng | M | 3 |
| E6.12 | Approval cho hiệu năng (khác `smoke`) và security chủ động | M | 4 |
| E6.13 | Lịch chạy (cron, timezone) | S | 8 |
| E6.14 | Trigger từ CI bằng API token; nhận JUnit XML | M | 7 |

### E7. Kết quả và bằng chứng

| ID | Tính năng | Ưu tiên | Phase |
|---|---|---|---|
| E7.1 | Run detail: tiến độ trực tiếp (SSE), log, kết quả theo item, attempt | M | 3 |
| E7.2 | Artifact: screenshot, video, Playwright trace, HAR, k6 dashboard HTML, báo cáo Lighthouse/ZAP gốc | M | 3 |
| E7.3 | So sánh hai run (mới fail, mới pass, chậm đi) | S | 6 |
| E7.4 | Phát hiện test chập chờn (flaky): tỉ lệ đổi trạng thái qua N lần chạy gần nhất | S | 6 |

### E8. Findings

| ID | Tính năng | Ưu tiên | Phase |
|---|---|---|---|
| E8.1 | Tạo finding thủ công từ kết quả test, kèm bằng chứng | M | 2 |
| E8.2 | Tự tạo finding từ runner (fail, cảnh báo ZAP, vi phạm axe...), **chống trùng bằng fingerprint** | M | 5 |
| E8.3 | Severity, status (theo spec 1.0), người phụ trách, link issue ngoài (Jira/GitHub/GitLab) | M | 2 |
| E8.4 | Re-test: chạy lại đúng các test liên quan đến finding | S | 6 |
| E8.5 | Mô tả "ảnh hưởng tới người dùng" bằng lời thường cho mỗi loại finding | M | 6 |

### E9. Dashboard và báo cáo

| ID | Tính năng | Ưu tiên | Phase |
|---|---|---|---|
| E9.1 | Dashboard công ty (tất cả dự án) và dự án (theo spec 1.0 mục 8) | M | 6 |
| E9.1b | Dashboard thành viên (chỉ có ý nghĩa khi nhiều người dùng chung, kiểu Máy chủ) | M | 8 |
| E9.2 | **Chỉ số sức khỏe** 7 khía cạnh, có độ phủ và độ tin cậy (xem [07-reporting-and-scoring.md](07-reporting-and-scoring.md)) | M | 6 |
| E9.3 | **Báo cáo ngắn gọn, trực quan**: tóm tắt vừa 1 màn hình / 1 trang PDF (≤ ~150 chữ), tối đa 3 vấn đề, có ảnh minh họa; phụ lục kỹ thuật tách riêng | M | 6 |
| E9.8 | Mỗi vấn đề trong báo cáo có **nguyên nhân có khả năng (AI)** + cách khắc phục + độ tin cậy, gắn nhãn "AI đề xuất" | M | 6 |
| E9.4 | Xuất PDF, XLSX, CSV, HTML; lưu bộ lọc, thời điểm, timezone | M | 6 |
| E9.5 | Link chia sẻ chỉ-đọc có hạn dùng (kiểu Máy chủ; ở kiểu Cá nhân chia sẻ bằng file PDF/HTML) | S | 8 |
| E9.6 | Giải thích thuật ngữ ngay trên giao diện (tooltip glossary, kế thừa từ `k6-perf`) | M | 6 |
| E9.7 | Xu hướng theo thời gian và theo build/version | M | 6 |

### E10. Quality gate

| ID | Tính năng | Ưu tiên | Phase |
|---|---|---|---|
| E10.1 | Định nghĩa tiêu chí (vd. pass rate ≥ 95%, 0 finding Critical mở, p95 ≤ 1 s) | M | 6 |
| E10.2 | Kết quả gate: `PASSED` / `FAILED` / `INCONCLUSIVE` (thiếu dữ liệu), kèm lý do từng tiêu chí | M | 6 |
| E10.3 | Sign-off của người có quyền, lưu audit | S | 6 |
| E10.4 | Trả kết quả gate cho CI (exit code / API) | S | 7 |

### E11. AI Assistant

| ID | Tính năng | Ưu tiên | Phase |
|---|---|---|---|
| E11.1 | Provider adapter, **mặc định Gemini**, đổi sang OpenAI / Claude / model local trong Settings → AI không cần sửa code; chọn model theo mục đích | M | 4 |
| E11.2 | Sinh test case (E5.2) | M | 7 |
| E11.3 | **Tự động phân tích nguyên nhân lỗi ngay trong lúc test**: mỗi item FAILED/ERROR được phân tích khi job kết thúc, gom theo chữ ký lỗi, giới hạn số lần/run; hiện trực tiếp ở màn chạy; có bằng chứng, độ tin cậy, bước debug | M | 4 |
| E11.7 | AI Explorer (E3.9) | M | 7 |
| E11.4 | Tóm tắt báo cáo bằng lời thường, mọi kết luận dẫn nguồn | M | 7 |
| E11.5 | Đề xuất sửa locator khi test UI hỏng vì giao diện đổi | C | 9 |
| E11.6 | Theo dõi token, chi phí, feedback | M | 7 |

### E12. Tích hợp và thông báo

| ID | Tính năng | Ưu tiên | Phase |
|---|---|---|---|
| E12.1 | REST API công khai cho CI + ví dụ GitHub Actions / GitLab CI | M | 7 |
| E12.2 | Import JUnit XML (Jest, Vitest, Pytest, JUnit, Playwright reporter) | M | 7 |
| E12.3 | Thông báo: email, Slack, Microsoft Teams, Telegram, webhook chung | S | 8 |
| E12.4 | Tạo issue Jira/GitHub từ finding (chỉ tạo + lưu link, không đồng bộ workflow) | C | 9 |

### E13. Quick Scan (Kiểm tra nhanh)

| ID | Tính năng | Ưu tiên | Phase |
|---|---|---|---|
| E13.1 | Nhập URL đã xác minh → trong ≤ 15 phút chạy tổ hợp test **an toàn, chỉ đọc**: smoke trang, broken link, Lighthouse, axe, security headers/TLS/cookie, ZAP passive, k6 smoke 1 req/s | M | 5 |
| E13.2 | Ra báo cáo sức khỏe ngay, đề xuất bước tiếp theo ("Tạo bộ test case từ kết quả khám phá") | M | 6 |

### E14. Quản trị và vận hành

| ID | Tính năng | Ưu tiên | Phase |
|---|---|---|---|
| E14.1 | Execution policy: giới hạn tải tối đa, thời gian tối đa, loại test được phép theo môi trường | M | 4 |
| E14.2 | Quota: số job đồng thời theo organization/project | S | 8 |
| E14.3 | Retention: artifact 90 ngày, log 30 ngày, kết quả giữ vĩnh viễn (cấu hình được) | M | 8 |
| E14.4 | Backup/restore có kiểm thử định kỳ | M | 8 |

## 8. User story trọng tâm (kèm tiêu chí chấp nhận)

### US-01. Kiểm tra nhanh một website (E13)
*Là quản lý dự án, tôi nhập URL website để biết ngay nó có vấn đề gì lớn.*
- Cho URL thuộc domain đã xác minh, khi bấm "Kiểm tra nhanh", thì trong ≤ 15 phút (website ≤ 50 trang) có báo cáo với 7 khía cạnh.
- Khía cạnh nào không chạy được hiển thị **"Chưa kiểm tra"** và lý do, không hiển thị 0 điểm.
- URL chưa xác minh → bị từ chối, có hướng dẫn xác minh.
- Không gửi request ghi (POST/PUT/DELETE) vào website, trừ form đăng nhập đã khai báo.

### US-02. Sinh bộ test case từ website (E3 + E5)
*Là tester, tôi muốn có sẵn bộ test case nháp để không phải viết từ đầu.*
- Sau discovery, mỗi form có ít nhất: 1 case hợp lệ, 1 case bỏ trống trường bắt buộc, 1 case sai định dạng cho mỗi field có `type`/`pattern`, 1 case vượt `maxlength`.
- Mỗi API trong OpenAPI có: case thành công, case thiếu xác thực (nếu endpoint có security), case body sai schema.
- Mọi case ở `DRAFT`, có nguồn sinh (`rule:<tên luật>` hoặc `ai:<generation_id>`), duyệt hàng loạt được.
- Chạy discovery lần 2 không sinh trùng case đã có (khóa chống trùng theo nguồn + đối tượng).

### US-03. Chạy toàn bộ kế hoạch (E6.10)
*Là QA Lead, tôi bấm một nút để chạy hết các loại test trong kế hoạch.*
- Run tách thành các job theo runner; mỗi job có tiến độ, log riêng; run tổng hợp trạng thái.
- Job hiệu năng/bảo mật chủ động cần duyệt thì run ở `WAITING_APPROVAL` cho phần đó, các phần khác vẫn chạy.
- Hủy run → mọi job dừng trong ≤ 30 giây, item chưa chạy thành `CANCELLED`.
- Worker chết giữa chừng → job được nhận lại hoặc đánh `ERROR`, không treo `RUNNING` quá timeout.

### US-04. Đọc báo cáo khi không biết kỹ thuật (E9.3, E9.8)
*Là giám đốc, tôi mở link báo cáo để quyết định có cho phát hành không.*
- Phần tóm tắt vừa **1 màn hình** (1 trang PDF), không phải cuộn: câu kết luận, 7 thẻ khía cạnh (màu + chữ + icon, không chỉ màu), biểu đồ xu hướng nhỏ, **tối đa 3 vấn đề** quan trọng nhất, độ phủ luồng, một dòng "Chưa kiểm tra: …".
- Mỗi vấn đề có 4 dòng: chuyện gì xảy ra, ảnh hưởng tới người dùng, nguyên nhân có khả năng (nhãn "AI đề xuất" + độ tin cậy), cách khắc phục; kèm ảnh chụp minh họa.
- Báo cáo ghi rõ môi trường (`LOCAL` hay `PRODUCTION`...).
- Mọi thuật ngữ kỹ thuật có tooltip giải thích; chi tiết kỹ thuật nằm ở phụ lục, mặc định thu gọn.
- Bản PDF giống bản web, có thời điểm tạo, timezone, bộ lọc.

### US-06. Ghi lại một luồng bằng cách tự thao tác (E4.10, E4.11)
*Là tester, tôi thao tác luồng "đặt hàng" trên website local của mình và muốn có ngay test tự động.*
- Bấm "Ghi luồng" trong Hub → trang website hiện ngay trong Hub (trình duyệt từ xa), thao tác như bình thường, bấm "Kết thúc" → Hub có test case `DRAFT` với từng bước kèm ảnh chụp, locator theo role/label/text. Không phải cài gì.
- Trong lúc ghi, bấm "Thêm kiểm tra" rồi chọn một phần tử để thêm bước kiểm tra (hiện/ẩn, đúng chữ).
- Ô mật khẩu và giá trị nhạy cảm không bị ghi; thay bằng biến `{{secret.*}}` để người dùng chọn.
- Bấm "Chạy thử" trong Hub → chạy lại luồng trên môi trường đã chọn và báo bước nào hỏng.

### US-07. Bật/tắt test production (E2.8)
*Là Admin, tôi chỉ cho phép test production trong khung giờ đã thống nhất.*
- Production mặc định tắt. Bật cần nhập lý do; hệ thống ghi audit.
- Khi tắt: không tạo được run cho môi trường production (lỗi `PRODUCTION_TESTING_DISABLED`), lịch chạy tạm dừng; nếu đang có run, hệ thống hỏi có dừng ngay không.
- Bật production vẫn giữ giới hạn an toàn: không request ghi, hiệu năng ngoài `smoke` phải duyệt, không bao giờ ZAP active.

### US-08. Biết ngay vì sao test fail (E11.3)
*Là developer, khi test fail tôi muốn biết nguyên nhân có khả năng mà không phải đọc log.*
- Trong ≤ 2 phút sau khi item fail, màn chạy hiện "Nguyên nhân có khả năng": loại lỗi (lỗi sản phẩm / lỗi script test / môi trường / dữ liệu / mạng), giải thích, bằng chứng (dòng log, ảnh, request), độ tin cậy, bước nên kiểm tra.
- 10 item fail cùng một lỗi chỉ phân tích 1 lần.
- AI không đổi trạng thái test, không đóng finding.

### US-09. Biết luồng nào chưa được test (E3.7, E3.8)
*Là QA Lead, tôi muốn thấy luồng nào của website chưa có test.*
- Sơ đồ luồng tô xanh bước chuyển đã có test, xám bước chưa có; hiện % độ phủ.
- Bấm một bước chuyển chưa có test → chọn "Sinh test", "Ghi bằng Recorder" hoặc "Để AI khám phá tiếp".

### US-05. Chặn phát hành bằng quality gate (E10)
*Là Tech Lead, tôi muốn CI fail khi chất lượng không đạt tiêu chí đã thống nhất.*
- CI gọi API tạo run với `wait=true` hoặc poll; nhận `gate.result`.
- Thiếu dữ liệu cho một tiêu chí → `INCONCLUSIVE`, không tự coi là PASSED.

## 9. Phân quyền (tóm tắt, chi tiết ở [09-security-model.md](09-security-model.md))

| Hành động | Owner | Admin | QA Lead | Tester | Developer | Viewer | Service account |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Quản lý thành viên, role | ✓ | ✓ | | | | | |
| Domain allowlist, secret, execution policy | ✓ | ✓ | | | | | |
| Bật/tắt test **production** (cấp tổ chức và môi trường) | ✓ | ✓ | | | | | |
| Bật/tắt test môi trường `LOCAL`/`DEV`/`STAGING` | ✓ | ✓ | ✓ (project được giao) | | | | |
| Cấu hình AI (provider, model, API key, ngân sách) | ✓ | ✓ | | | | | |
| Dùng Recorder, chạy AI Explorer | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| Tạo/sửa project, môi trường | ✓ | ✓ | ✓ (project được giao) | | | | |
| Tạo/sửa test plan, suite, case | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| Duyệt test case AI/luật sinh | ✓ | ✓ | ✓ | ✓ | | | |
| Chạy manual / API / browser / audit | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ (theo scope) |
| Yêu cầu chạy hiệu năng / security chủ động | ✓ | ✓ | ✓ | | ✓ | | ✓ (theo scope) |
| **Duyệt** chạy hiệu năng / security chủ động | ✓ | ✓ | ✓ | | | | |
| Tạo/sửa finding | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ (tự động) |
| Xem dashboard, báo cáo | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Tạo link chia sẻ báo cáo | ✓ | ✓ | ✓ | | | | |
| Sign-off quality gate | ✓ | ✓ | ✓ | | | | |

Người duyệt không được tự duyệt yêu cầu của chính mình (trừ Owner khi organization chỉ có 1 người).

## 10. Yêu cầu phi chức năng (bổ sung cho spec 1.0 mục 14)

| Hạng mục | Mục tiêu |
|---|---|
| Quy mô nội bộ | 100 user, 50 project, 20 job tự động chạy đồng thời, 1 triệu test result/năm |
| Dashboard | p95 < 2 s nhờ bảng tổng hợp theo ngày (không quét bảng kết quả thô) |
| Tải lên mục tiêu | Mỗi host đích có hàng đợi riêng, mặc định tối đa 1 job hiệu năng và 2 job browser cùng lúc |
| Lưu trữ | Kết quả: vĩnh viễn. Log thô: 30 ngày. Artifact: 90 ngày (artifact gắn finding đang mở thì giữ đến khi đóng) |
| Hub tự đạt chuẩn | Giao diện Hub đạt WCAG 2.1 AA; hỗ trợ Chrome, Edge, Firefox bản mới |
| Ngôn ngữ | Tiếng Việt mặc định, tiếng Anh; mọi chuỗi qua i18n, không hardcode |
| Thời gian | Lưu UTC, hiển thị theo timezone người dùng (mặc định `Asia/Ho_Chi_Minh`) |

## 11. Nghiệm thu

### MVP nội bộ (hết Phase 6)
- [ ] Cài kiểu Cá nhân bằng một lệnh Docker Compose trên máy dev (tối thiểu 4 vCPU / 16 GB), màn cài lần đầu tạo Owner; Hub chỉ mở ở `127.0.0.1`.
- [ ] Phân quyền theo organization/project đã có ở backend (test tự động kiểm chứng), dù kiểu Cá nhân thường chỉ một người dùng.
- [ ] Tạo project, ≥ 2 môi trường (trong đó có `LOCAL`), xác minh domain; test được website `localhost` trên chính máy cài Hub.
- [ ] Công tắc bật/tắt test production và local hoạt động ở API, worker và lịch chạy (test tự động kiểm chứng).
- [ ] Discovery + sơ đồ luồng + độ phủ luồng; sinh test case theo luật; duyệt hàng loạt.
- [ ] Recorder (trình duyệt trong Hub, không cài extension) ghi một luồng trên website `localhost` thành test case chạy lại được.
- [ ] AI (Gemini) tự phân tích nguyên nhân lỗi trong lúc test; đổi provider/model trong Settings không cần deploy lại.
- [ ] Báo cáo tóm tắt 1 trang có nguyên nhân AI cho từng vấn đề.
- [ ] Manual run có người thực hiện; retry không ghi đè attempt.
- [ ] API test (assertion, chaining, secret redaction), browser test chạy DSL, k6 chạy được mọi profile cũ của `k6-perf`.
- [ ] Quick Scan ra báo cáo 7 khía cạnh.
- [ ] Dashboard công ty (tất cả dự án) và dự án, chỉ số sức khỏe, xuất PDF/XLSX/CSV/HTML.
- [ ] Quality gate trên một run.
- [ ] Target allowlist + SSRF guard có test tự động.

### v1.0 (hết Phase 8)
- [ ] Tất cả mục MVP + AI sinh test, AI Explorer, AI tóm tắt báo cáo, JUnit import, CI API, ZAP, visual regression, lịch chạy, backup/restore đã diễn tập.
- [ ] **Kiểu Máy chủ nội bộ**: test website qua IP LAN, mời thành viên qua email, SSO, dashboard thành viên, link chia sẻ báo cáo, thông báo cho team, xuất/nhập dự án từ bản Cá nhân.

## 12. Chỉ số thành công của chính sản phẩm

- Số project có hoạt động test trong 30 ngày.
- Tỉ lệ test case sinh tự động được duyệt (đo chất lượng generator; < 40% là generator kém).
- Số finding được phát hiện trước release so với sau release (nếu có dữ liệu bug production).
- Số lượt mở link báo cáo chia sẻ.

## 13. Rủi ro sản phẩm

| Rủi ro | Giảm thiểu |
|---|---|
| Test sinh tự động nhiều nhưng vô nghĩa, người dùng bỏ qua | Luật sinh có kiểm soát số lượng; đo tỉ lệ duyệt; cho tắt từng luật |
| Điểm sức khỏe bị hiểu là "đạt chất lượng" | Luôn hiện độ phủ, "chưa kiểm tra", và câu "Đây là kết quả của các bài kiểm tra đã chạy, không phải cam kết chất lượng" |
| Test UI tự động hỏng liên tục khi giao diện đổi | Ưu tiên locator theo role/label/text; theo dõi flaky; AI đề xuất sửa (C) |
| Chạy nhầm tải lớn vào production | Execution policy + approval + allowlist + giới hạn cứng trong worker (xem [09](09-security-model.md)) |
| Người dùng hiểu "test mọi luồng" là đảm bảo 100% | Định nghĩa rõ: luồng đã khám phá/ghi/khai báo; luôn hiện độ phủ luồng và phần chưa kiểm tra |
| AI phân tích sai nguyên nhân, người dùng tin tuyệt đối | Nhãn "AI đề xuất", độ tin cậy, bằng chứng đi kèm; luật cố định phân loại trước; đo độ đúng qua feedback |
| Chi phí Gemini tăng khi phân tích tự động mọi lỗi | Gom theo chữ ký lỗi, giới hạn số phân tích/run, ngân sách token/tháng, dùng model Flash cho phân tích |
| Phạm vi phình ra thành Jira | Danh sách "Không làm" ở mục 3; mọi đề xuất tính năng mới phải trả lời "nó giúp kiểm thử thế nào?" |
