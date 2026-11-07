# 10. Giao diện và trải nghiệm (UI/UX)

- Người đọc: frontend developer, designer, QA Lead
- Thay thế spec 1.0 mục 10. Liên quan: [01-product-requirements.md](01-product-requirements.md), [03-architecture.md](03-architecture.md), [07-reporting-and-scoring.md](07-reporting-and-scoring.md), [11-k6-migration.md](11-k6-migration.md)

---

## 1. Nguyên tắc thiết kế

| # | Nguyên tắc | Áp dụng cụ thể |
|---|---|---|
| U1 | **Desktop-first, responsive** | Tối ưu 1280–1920 px. ≥ 768 px dùng đầy đủ; < 768 px chỉ cần **xem** dashboard, báo cáo, finding, phê duyệt (không cần soạn test case trên điện thoại) |
| U2 | **Hai chế độ hiển thị trên cùng một app** | *Chế độ kỹ thuật* (tester, dev): đủ số liệu, thuật ngữ, log. *Chế độ tổng quan* (quản lý, BA, khách hàng): chỉ số sức khỏe, câu kết luận, lời thường, ẩn p95/5xx/stack trace sau nút "Xem chi tiết kỹ thuật". Mặc định theo role (Viewer → tổng quan, còn lại → kỹ thuật), người dùng đổi ở menu tài khoản, lưu vào `users.settings`. Link chia sẻ báo cáo luôn mở ở chế độ tổng quan |
| U3 | **Trạng thái không chỉ bằng màu** | Mọi badge = icon + chữ + màu (bảng mục 2). Biểu đồ dùng thêm pattern/nhãn trực tiếp khi cần phân biệt |
| U4 | **Đủ 4 trạng thái màn hình** | Loading (skeleton, không spinner toàn trang), Empty (giải thích + hành động tiếp theo), Error (thông điệp người đọc được + `requestId` + nút thử lại), Success (toast ngắn) |
| U5 | **Giải thích thuật ngữ tại chỗ** | Thuật ngữ có gạch chân chấm, hover/focus hiện tooltip từ glossary dùng chung (kế thừa `GLOSSARY` của `k6-perf/ui/app.js`, chuyển thành file i18n `glossary.*`) |
| U6 | **Drill-down mọi con số** | KPI → project → run → item → attempt → log/artifact (spec 1.0 mục 10.3). Mọi số đếm là link |
| U7 | **N/A thay vì 0** | Mẫu số = 0 hoặc chưa có dữ liệu → hiện `N/A` / "Chưa kiểm tra" kèm lý do, không hiện 0% |
| U8 | **Bàn phím** | Manual execution có phím tắt (mục 5.5); `Ctrl+K` command palette (tìm project, test case, run); mọi thao tác dùng được không cần chuột |
| U9 | **Tiếng Việt mặc định** | Mọi chuỗi qua i18next; số và ngày theo locale (`1.234,5`, `07/11/2026 14:30`); thời gian hiển thị theo timezone người dùng, tooltip ghi rõ timezone |
| U10 | **Sáng / tối** | Theme theo hệ thống, đổi được; màu qua CSS variable của shadcn, không hardcode hex trong component |
| U11 | **Hub đạt WCAG 2.1 AA** | Tương phản ≥ 4.5:1, focus ring rõ, label cho mọi input, `aria-live` cho tiến độ chạy và toast. CI chạy axe trên các trang chính của Hub |
| U12 | **Không phải Jira** | Không có menu hay màn hình Sprint, Backlog, Task board, Timesheet, Roadmap. Finding không có board kéo thả |

## 2. Hệ thống trạng thái

Token màu là CSS variable thêm vào theme shadcn (`--status-pass`, ...), có giá trị riêng cho sáng/tối, đã kiểm tương phản.

### 2.1. `test_status`

| Giá trị | Nhãn | Icon (lucide) | Token màu |
|---|---|---|---|
| PENDING | Chờ chạy | `circle-dashed` | `--status-neutral` |
| QUEUED | Trong hàng đợi | `clock` | `--status-neutral` |
| RUNNING | Đang chạy | `loader-circle` (xoay, tắt khi `prefers-reduced-motion`) | `--status-info` |
| PASSED | Đạt | `circle-check` | `--status-pass` |
| FAILED | Không đạt | `circle-x` | `--status-fail` |
| BLOCKED | Bị chặn | `octagon-minus` | `--status-warn` |
| SKIPPED | Bỏ qua | `circle-slash` | `--status-neutral` |
| CANCELLED | Đã hủy | `ban` | `--status-neutral` |
| ERROR | Lỗi hệ thống chạy test | `triangle-alert` | `--status-error` (tím, khác đỏ của FAILED) |
| NOT_APPLICABLE | Không áp dụng | `minus` | `--status-neutral` |

`ERROR` và `FAILED` phải nhìn khác nhau (màu + icon + tooltip "Lỗi do công cụ/môi trường, chưa kết luận được về sản phẩm").

### 2.2. `run_status`

| Giá trị | Nhãn | Icon | Token |
|---|---|---|---|
| PENDING | Đang chuẩn bị | `circle-dashed` | `--status-neutral` |
| WAITING_APPROVAL | Chờ duyệt | `shield-question` | `--status-warn` |
| QUEUED | Trong hàng đợi | `clock` | `--status-neutral` |
| RUNNING | Đang chạy | `loader-circle` | `--status-info` |
| COMPLETED | Hoàn tất | `flag` | `--status-info` (kết quả đạt/không đạt hiện riêng bằng thanh tỉ lệ) |
| CANCELLED | Đã hủy | `ban` | `--status-neutral` |
| ERROR | Lỗi | `triangle-alert` | `--status-error` |

### 2.3. `severity`

| Giá trị | Nhãn | Icon | Token |
|---|---|---|---|
| CRITICAL | Nghiêm trọng | `siren` | `--sev-critical` |
| HIGH | Cao | `arrow-up-circle` | `--sev-high` |
| MEDIUM | Trung bình | `circle-dot` | `--sev-medium` |
| LOW | Thấp | `arrow-down-circle` | `--sev-low` |
| INFO | Thông tin | `info` | `--sev-info` |

### 2.4. `finding_status`

| Giá trị | Nhãn | Icon | Token |
|---|---|---|---|
| OPEN | Mới | `circle` | `--status-fail` |
| CONFIRMED | Đã xác nhận | `circle-check-big` | `--status-fail` |
| IN_PROGRESS | Đang xử lý | `wrench` | `--status-info` |
| RESOLVED | Đã sửa, chờ kiểm lại | `check` | `--status-pass` |
| REOPENED | Mở lại | `rotate-ccw` | `--status-fail` |
| ACCEPTED_RISK | Chấp nhận rủi ro | `shield-alert` | `--status-warn` |
| CLOSED | Đã đóng | `archive` | `--status-neutral` |

### 2.5. Mức sức khỏe (theo [07-reporting-and-scoring.md](07-reporting-and-scoring.md))

| Điểm | Nhãn | Icon | Token |
|---|---|---|---|
| ≥ 90 | Tốt | `circle-check` | `--health-good` |
| 75–89 | Cần chú ý | `eye` | `--health-attention` |
| 50–74 | Có vấn đề | `triangle-alert` | `--health-problem` |
| < 50 | Nghiêm trọng | `siren` | `--health-critical` |
| `null` | Chưa kiểm tra | `circle-help` | `--health-none` (xám, viền nét đứt) |

Gate: `PASSED` = "Đạt tiêu chí" (`badge-check`), `FAILED` = "Không đạt tiêu chí" (`badge-x`), `INCONCLUSIVE` = "Chưa đủ dữ liệu" (`badge-help`).

### 2.6. Loại môi trường (`environments.kind`, D-23)

Badge loại môi trường xuất hiện ở header dự án, chi tiết run, báo cáo và link chia sẻ. Luôn có chữ, không chỉ màu.

| kind | Nhãn | Icon | Token |
|---|---|---|---|
| LOCAL | Local | `laptop` | `--env-local` (tím) |
| DEV | Dev | `code` | `--env-dev` (xanh dương) |
| STAGING | Staging | `flask-conical` | `--env-staging` (cam) |
| PRODUCTION | Production | `globe` | `--env-prod` (đỏ, viền đậm) |

Môi trường đang **tắt test** (`testing_enabled = false` hoặc công tắc cấp tổ chức đang tắt): badge thêm icon `pause-circle` + chữ "Đang tắt test", nút Chạy bị vô hiệu kèm tooltip nêu lý do và người tắt.

## 3. Sitemap

```text
QA Testing Hub
├── Tổng quan                         (dashboard công ty)
├── Kiểm tra nhanh                    (Quick Scan)
├── Dự án                             (danh sách)
│   └── <Dự án>
│       ├── Tổng quan dự án           (sức khỏe, run gần nhất, finding mở)
│       ├── Khám phá                  (trang, form, API | Sơ đồ luồng | AI khám phá luồng)
│       ├── Kế hoạch                  (test plan)
│       ├── Test case                 (cây suite + danh sách | Hàng đợi duyệt | Ghi luồng)
│       ├── Lần chạy
│       ├── Findings
│       ├── Báo cáo
│       ├── Công cụ
│       │   ├── API
│       │   ├── Hiệu năng
│       │   ├── Bảo mật
│       │   └── Giao diện (Visual)
│       └── Cài đặt dự án
│           ├── Môi trường & biến     (loại LOCAL/DEV/STAGING/PRODUCTION, công tắc bật/tắt test)
│           ├── Tài khoản test
│           ├── Domain & địa chỉ local
│           ├── Quality gate
│           ├── Lịch chạy
│           └── Thành viên dự án
├── AI Assistant
├── Phê duyệt                         (badge số yêu cầu chờ)
└── Cài đặt
    ├── Tổ chức
    ├── Thành viên & quyền            (mời qua email: kiểu Máy chủ, Phase 8)
    ├── Service account
    ├── Domain allowlist & dải IP nội bộ
    ├── Công tắc test                 (Production / Local cho cả tổ chức)
    ├── Chính sách chạy
    ├── AI                            (Gemini mặc định, model theo mục đích)
    ├── Thông báo                     (gửi cho team: kiểu Máy chủ, Phase 8)
    ├── Tình trạng hệ thống
    └── Audit log
```

**Kiểu cài Cá nhân (D-32, mặc định cho M1/M2):** các mục chỉ có ích khi nhiều người dùng chung bị ẩn và ghi chú "kiểu Máy chủ (Phase 8)": mời thành viên qua email, SSO/2FA, link chia sẻ báo cáo, dashboard thành viên, thông báo cho team. Chia sẻ báo cáo ở kiểu Cá nhân = **xuất file PDF/HTML**.

Sidebar hai tầng: khi đang ở trong một dự án, sidebar hiện menu dự án, có ô chọn dự án ở đầu (đổi nhanh). Mục bị ẩn theo quyền (Viewer không thấy Công cụ, Cài đặt dự án).

## 4. Danh mục màn hình

Route dùng `projectKey` (vd. `QSNET`) cho URL dễ đọc. Role: O=Owner, A=Admin, L=QA Lead, T=Tester, D=Developer, V=Viewer.

| Route | Mục đích | Thành phần chính | Hành động chính | Role | Phase |
|---|---|---|---|---|---|
| `/setup` | **Lần chạy đầu** (kiểu Cá nhân, D-32): tạo tài khoản Owner + tổ chức; chỉ hiện khi DB chưa có user | Form 1 bước | Tạo Owner | – | 1 |
| `/login` | Đăng nhập | Form | Đăng nhập (quên mật khẩu ở kiểu Cá nhân: lệnh `pnpm hub:reset-password`) | mọi | 1 |
| `/forgot-password`, `/invite/:token` | Quên mật khẩu qua email, nhận lời mời | Form | Đặt mật khẩu | mọi | 8 (kiểu Máy chủ) |
| `/` | Dashboard công ty | Filter bar, KPI, trend, bảng project | Lọc, drill-down, xuất | mọi | 6 |
| `/quick-scan` | Kiểm tra nhanh | Ô URL, chọn môi trường, lịch sử scan | Chạy scan | O A L T D | 5 |
| `/projects` | Danh sách dự án | Bảng, thẻ sức khỏe mini | Thêm dự án (wizard) | mọi | 1 |
| `/projects/new` | Wizard thêm dự án | Stepper 6 bước | Tạo, xác minh, chạy | O A L | 1 / 5 |
| `/p/:key` | Tổng quan dự án | Thẻ 7 khía cạnh, run gần nhất, finding mở, xu hướng | Chạy kế hoạch, mở báo cáo | mọi | 2 / 6 |
| `/p/:key/discovery` | Kết quả khám phá | Cây trang, danh sách form, endpoint, ảnh chụp | Chạy khám phá, sinh test case | O A L T D | 5 |
| `/p/:key/flows` | Sơ đồ luồng (mục 5.12) | Đồ thị trang–bước chuyển, tô màu đã/chưa có test, thanh độ phủ luồng | Tạo test cho luồng, ghi bằng Recorder | O A L T D (V xem) | 5 |
| `/p/:key/flows/explore` | AI khám phá luồng (mục 5.13) | Form cấu hình, tiến độ live, danh sách luồng tìm được | Chạy, gửi luồng sang hàng đợi duyệt | O A L T D | 7 |
| `/p/:key/cases/record` | Ghi luồng bằng trình duyệt từ xa trong Hub (mục 5.11) | Khung trình duyệt từ xa + thanh URL + chọn viewport, danh sách bước live; danh sách bản ghi gần đây | Bắt đầu ghi, thêm kiểm tra, kết thúc & lưu | O A L T D | 5 |
| `/p/:key/plans`, `/p/:key/plans/:id` | Kế hoạch | Danh sách; chi tiết: phạm vi, ma trận, gate, lịch sử run | Tạo từ mẫu, chạy | O A L T D (V xem) | 2 |
| `/p/:key/cases` | Test case | Cây suite trái, data-table phải, panel chi tiết | Tạo, import CSV/XLSX, thao tác hàng loạt | O A L T D | 2 |
| `/p/:key/cases/review` | Hàng đợi duyệt | Danh sách draft nhóm theo nguồn, xem trước | Duyệt/sửa/bỏ hàng loạt | O A L T | 5 |
| `/p/:key/cases/:caseKey` | Soạn test case | Thông tin, bước, builder DSL, lịch sử phiên bản, kết quả gần đây | Lưu, chạy thử | O A L T D | 2 / 5 |
| `/p/:key/runs` | Lần chạy | Bảng run, lọc theo nguồn/branch/build | Chạy mới, so sánh 2 run | mọi | 2 |
| `/p/:key/runs/:id` | Chi tiết run (live) | Lane theo job, log, bảng item, panel "Nguyên nhân có khả năng" (AI, Phase 4) | Hủy, retry item lỗi, duyệt | mọi | 3 / 4 |
| `/p/:key/runs/:id/manual` | Manual execution | Danh sách item, bước, ghi chú, đính kèm | Pass/Fail/Blocked/Skip, tạo finding | O A L T D | 2 |
| `/p/:key/runs/:id/items/:itemId` | Kết quả chi tiết | Attempt, bước, request/response, ảnh, trace, AI phân tích (tự động) | Retry, tạo finding, phân tích lại, áp dụng phân loại AI | mọi | 3 / 4 |
| `/p/:key/runs/compare?a=&b=` | So sánh run | Bảng mới fail/mới pass/chậm đi | Xuất | mọi | 6 |
| `/p/:key/findings`, `/p/:key/findings/:id` | Findings | Bảng lọc; chi tiết (mục 5.9) | Đổi trạng thái, giao người, re-test | mọi (V xem) | 2 |
| `/p/:key/reports` | Báo cáo | Chọn loại, bộ lọc, xem trước | Xuất PDF/XLSX/CSV/HTML; tạo link chia sẻ (kiểu Máy chủ, Phase 8) | mọi | 6 |
| `/p/:key/tools/api` | API testing | Cây collection, request builder, response viewer | Gửi, lưu, import OpenAPI/Postman | O A L T D | 3 |
| `/p/:key/tools/performance` | Hiệu năng | Kịch bản, danh sách run, xu hướng p95 | Tạo kịch bản, chạy | O A L D | 4 |
| `/p/:key/tools/performance/runs/:id` | Chi tiết run hiệu năng | Mục 5.7 | Dừng, so sánh, Timeline | mọi | 4 |
| `/p/:key/tools/security` | Bảo mật | Cấu hình scan, lịch sử, alert | Chạy (có duyệt) | O A L D | 8 |
| `/p/:key/tools/visual` | Visual | Lưới ảnh khác biệt, slider so sánh | Duyệt baseline mới | O A L T | 8 |
| `/p/:key/settings/*` | Cài đặt dự án | Form theo mục 3 | Lưu | O A L | 1 / 6 / 8 |
| `/ai` | AI Assistant | Chọn tác vụ, nhập liệu, kết quả draft, feedback | Sinh, gửi sang hàng đợi duyệt | O A L T D | 7 |
| `/approvals` | Phê duyệt | Danh sách yêu cầu, diff cấu hình, giới hạn tải | Duyệt/Từ chối (có ghi chú) | O A L | 4 |
| `/settings/*` | Cài đặt tổ chức | Form, bảng | Theo mục | O A | 1 / 7 / 8 |
| `/settings/testing-switches` | Công tắc test Production/Local (mục 5.10) | 2 công tắc, lịch sử bật/tắt | Bật/tắt (bắt buộc lý do) | O A | 3 |
| `/settings/ai` | Cấu hình AI (mục 5.14) | Provider, model theo mục đích, API key, ngân sách, nút thử kết nối | Lưu, thử kết nối | O A | 4 |
| `/share/:token` | Báo cáo chia sẻ | Báo cáo chế độ tổng quan, không sidebar | Tải PDF | không cần đăng nhập | 8 (kiểu Máy chủ) |

## 5. Luồng chính

### 5.1. Wizard "Thêm dự án"

1. **Thông tin**: tên, mã (tự gợi ý từ tên, kiểm trùng realtime), mô tả, repo URL (tùy chọn).
2. **Môi trường & URL**: mặc định 1 dòng **"Local"** (local-first, D-23); thêm dòng; mỗi dòng: tên, **loại** (`LOCAL`/`DEV`/`STAGING`/`PRODUCTION`), URL web, URL API, công tắc "Cho phép chạy test" (mặc định bật, riêng PRODUCTION mặc định tắt). Chọn PRODUCTION → nhãn cảnh báo về chính sách an toàn. Nhập `localhost` khi Hub cài trên server → gợi ý "Hub không thấy localhost của máy bạn; hãy dùng IP LAN (vd. `192.168.1.50:3000`) và cho app listen `0.0.0.0`".
3. **Xác minh**: liệt kê host rút từ URL.
   - Host internet: đã trong allowlist → tick xanh; host mới → 3 tab: DNS TXT, file `/.well-known/qa-hub-verification.txt`, "Gửi Admin duyệt".
   - Địa chỉ local/LAN: không cần DNS; tick xanh nếu IP nằm trong dải IP nội bộ Admin đã bật, nếu không → nút "Gửi Admin bật dải IP".
   - Có thể bỏ qua bước này nhưng sẽ không chạy test tự động cho tới khi xác minh xong.
4. **Tài khoản test (tùy chọn)**: vai trò, username, mật khẩu (ô password, lưu thẳng vào secret vault, sau khi lưu chỉ hiện `••••`). Nút "Thử đăng nhập" (chạy discovery 1 trang).
5. **Nguồn dữ liệu (tùy chọn)**: upload/nhập URL OpenAPI, Postman collection, tài liệu yêu cầu (PDF/DOCX/MD/text).
6. **Bắt đầu**: checkbox "Chạy Kiểm tra nhanh" và "Khám phá website" (mặc định bật nếu domain đã xác minh) → Tạo → chuyển tới Tổng quan dự án, hiện tiến độ.

```text
┌ Thêm dự án ──────────────────────────────────────────────────────────┐
│ ① Thông tin ─ ② Môi trường ─ ③ Xác minh ─ ④ Tài khoản ─ ⑤ Nguồn ─ ⑥ │
│                         ▲ đang ở bước 3                              │
│ [Local] 192.168.1.50:3000  ✓ Trong dải IP nội bộ 192.168.0.0/16      │
│ staging.qsnet.vn        ✓ Đã xác minh (allowlist công ty)            │
│ api.staging.qsnet.vn    ⚠ Chưa xác minh                              │
│   [DNS TXT] [File .well-known] [Gửi Admin duyệt]                     │
│   Thêm bản ghi TXT:  _qa-hub.api.staging.qsnet.vn                    │
│   Giá trị:  qa-hub-verify=8f3c…a91   [Sao chép]   [Kiểm tra lại]     │
│                                                                      │
│ ⓘ Chưa xác minh vẫn tạo được dự án, nhưng chưa chạy test tự động.    │
│                                  [Quay lại]  [Bỏ qua]  [Tiếp tục →]  │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2. Báo cáo sức khỏe / kết quả Kiểm tra nhanh (ngắn gọn, 1 màn hình)

Bố cục và quy tắc chọn nội dung theo [07-reporting-and-scoring.md](07-reporting-and-scoring.md) mục 5.1 (D-30). Toàn bộ phần tóm tắt nằm gọn trong **1 màn hình desktop 1440×900** không cần cuộn; trả lời 3 câu của PRD G3: *Phát hành được chưa? Vấn đề lớn nhất? Tốt hơn hay tệ hơn?*

```text
┌ QSNET · [Staging] · Kiểm tra nhanh 07/11/2026 14:30 (GMT+7) ─────────┐
│ 🚨 Có 2 vấn đề nghiêm trọng cần xử lý trước khi phát hành.           │
│    Tệ hơn lần trước ở Bảo mật, tốt hơn ở Hiệu năng.   ▁▃▅▆▅▃ 30 ngày │
│                                                                      │
│ [✓ Chức năng 94][👁 Hiệu năng 81][🚨 Bảo mật 42][⚠ Truy cập 68]      │
│ [✓ Giao diện 90][✓ Chuẩn web 91][? Ổn định]                          │
│                                                                      │
│ 3 vấn đề cần xử lý                                                   │
│ ┌─────┐ 1 🚨 Cookie đăng nhập gửi được qua kết nối không mã hóa.     │
│ │ ảnh │   Ảnh hưởng: tài khoản có thể bị chiếm trên Wi-Fi công cộng. │
│ └─────┘   ✨ AI đề xuất · tin cậy cao: thiếu cờ Secure khi set cookie│
│           Cách sửa: bật cờ Secure cho cookie phiên.       [Chi tiết] │
│ ┌─────┐ 2 🚨 Trang thanh toán tải 6,2 giây (nên < 2,5 giây). …       │
│ └─────┘ 3 ⚠ …                                                        │
│                                                                      │
│ Độ phủ luồng ███████████░░░░░░ 62% (31/50)                           │
│ Chưa kiểm tra: Ổn định, Firefox/Safari                               │
│ Kết quả của các bài kiểm tra đã chạy, không phải cam kết chất lượng. │
│              [Tải PDF 1 trang] [Chia sẻ] [▸ Chi tiết kỹ thuật]       │
└──────────────────────────────────────────────────────────────────────┘
```

- Thẻ khía cạnh chỉ có icon + tên + điểm. Rê chuột/focus → popover: nhãn, độ phủ, độ tin cậy, chênh lệch ▲/▼ so với lần trước. Click → chi tiết khía cạnh.
- **Tối đa 3 vấn đề**, mỗi vấn đề 4 dòng (chuyện gì · ảnh hưởng · nguyên nhân · cách sửa) + ảnh thu nhỏ (click → phóng to, có ảnh chụp bước lỗi). Dòng nguyên nhân có badge nguồn: `✨ AI đề xuất` (icon `sparkles`) + độ tin cậy, `Đã xác nhận` (icon `user-check`) hoặc `Phân loại tự động` (icon `ruler`), theo 07 mục 5.1.1.
- "Chi tiết kỹ thuật" là khối thu gọn bên dưới (không phải trang khác): bảng số liệu, coverage từng khía cạnh, danh sách finding đầy đủ, run đã dùng.
- Header luôn có badge loại môi trường (mục 2.6); báo cáo LOCAL có dòng nhỏ "Kiểm thử trên máy phát triển".
- Sau Quick Scan có banner đề xuất: "Tạo bộ test case từ kết quả khám phá (45 trang, 12 form, 30 API)".

### 5.3. Hàng đợi duyệt test case

- Nhóm theo nguồn: luật (`rule:form.required`...) hoặc AI (`ai:<generation>`), theo trang/endpoint đích.
- Badge nguồn: `Luật` (icon `ruler`) hoặc `AI` (icon `sparkles`) + tên luật/model; tooltip "Vì sao có case này" (rationale).
- Case trùng gần giống case đã có → hiện diff với case cũ và gợi ý "Bỏ" hoặc "Gộp".
- Hành động: duyệt / sửa nhanh inline / bỏ (→ `REJECTED`, không sinh lại); chọn nhiều + duyệt hàng loạt; "Duyệt tất cả nhóm này"; bộ lọc theo test type, priority.

```text
┌ Hàng đợi duyệt (86 bản nháp) ──── [Lọc: Loại ▾ Ưu tiên ▾ Nguồn ▾] ──┐
│ ☐ Chọn tất cả   [✓ Duyệt 12 đã chọn] [✗ Bỏ]                         │
│ ▾ Form "Đăng ký" · /register · Luật (14)          [Duyệt cả nhóm]   │
│   ☑ Luật  Bỏ trống Email → báo lỗi bắt buộc       HIGH   [Sửa][✗]   │
│   ☑ Luật  Email sai định dạng "abc@" → báo lỗi    MEDIUM [Sửa][✗]   │
│   ☐ Luật  Họ tên vượt 100 ký tự                   LOW    ⚠ Giống    │
│           TC-0042 (diff: bước 2 khác)  [Xem diff][Gộp][Bỏ]           │
│ ▾ Thanh toán · AI gemini-2.5 (9)                                     │
│   ☐ AI    Thanh toán với thẻ hết hạn → từ chối   HIGH   [Sửa][✗]   │
│           Vì sao: tài liệu yêu cầu mục 3.2 nhắc kiểm tra hạn thẻ    │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.4. Soạn test case (bước thủ công + bước tự động)

- Bên trái: thông tin case (title, loại, purpose, level, priority, tag, suite, precondition).
- Bên phải: danh sách bước. Mỗi bước có 3 ô: **Thao tác** (lời), **Dữ liệu**, **Kết quả mong đợi**. Công tắc "Tự động hóa" mở **step builder** cho bước đó:
  - Chọn action (goto, click, fill, expect...; danh sách theo [06-execution-engine.md](06-execution-engine.md)).
  - **Locator picker**: chọn trang đã khám phá → hiện ảnh chụp + danh sách phần tử (role, label, text) lấy từ discovery; click chọn → điền locator ưu tiên `role+name` > `label` > `text` > `testId` > `css`. Có cảnh báo khi dùng `css`.
  - Biến `{{...}}` có autocomplete từ biến môi trường, tài khoản test, data set; secret hiện dạng `{{secret.name}}`, không bao giờ hiện giá trị.
  - Nút **"Chạy thử bước"**: chạy từ bước 1 tới bước hiện tại trên môi trường chọn, hiện ảnh chụp kết quả.
- Có thể soạn bước tự động trước rồi bấm "Sinh mô tả" để tạo lời thủ công tương ứng (hai chiều, `packages/test-dsl`).
- **Chế độ xem trực quan** (mặc định với case có bước tự động, D-27): mỗi bước là một **thẻ** gồm ảnh thu nhỏ (lấy từ lần ghi Recorder hoặc lần "Chạy thử" gần nhất, phần tử được thao tác có khung tô sáng), câu mô tả, action + locator rút gọn, trạng thái lần chạy gần nhất. Kéo thả thẻ để đổi thứ tự (bàn phím: `Alt+↑/↓`), nút chèn bước giữa hai thẻ, nhân bản, xóa. Chuyển qua lại "Thẻ ↔ Bảng" bằng toggle; cả hai sửa cùng dữ liệu.
- Nút **"Ghi tiếp bằng Recorder"**: mở Recorder trong Hub (mục 5.11) tại trang của bước đang chọn (chạy lại các bước trước đó để tới đúng trạng thái), các bước ghi được nối vào sau bước đang chọn.
- Tab "Lịch sử": các phiên bản, diff giữa 2 phiên bản. Tab "Kết quả gần đây": 20 lần chạy, nhãn flaky nếu có.
- Lưu không hợp lệ (Zod) → lỗi hiện ngay dưới ô, focus vào ô lỗi đầu tiên.

```text
┌ TC-0123 Đăng nhập thành công ─────────────── [Chạy thử] [Lưu] ──────┐
│ Loại: Chức năng  Ưu tiên: CRITICAL  Purpose: Smoke, Regression      │
│ ─ Bước ──────────────────────────────────────────────────────────── │
│ 1 Mở trang đăng nhập              │ –            │ Thấy form         │
│   ⚙ Tự động: goto {{webBaseUrl}}/login                         [▶]  │
│ 2 Nhập email                      │ {{cred.admin.username}} │ –      │
│   ⚙ Tự động: fill  [role=textbox name="Email" ▾ chọn từ trang]  [▶] │
│ 3 Bấm "Đăng nhập"                 │ –            │ Vào dashboard     │
│   ⚙ Tự động: click [role=button name="Đăng nhập"]               [▶] │
│   ⚙ expectUrl  /dashboard                                           │
│ [+ Thêm bước] [+ Dùng shared flow]                                  │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.5. Manual execution workspace

- Trái: danh sách item của run được giao cho tôi (lọc: của tôi / tất cả / chưa chạy), mỗi dòng có badge trạng thái.
- Giữa: case hiện tại, precondition, các bước; mỗi bước chọn trạng thái + ô "Kết quả thực tế".
- Phải: ghi chú, đính kèm (kéo thả, **dán ảnh từ clipboard** `Ctrl+V`), nút "Tạo finding" mở form inline đã điền sẵn tiêu đề, bước tái hiện, bằng chứng, môi trường.
- Kết quả case = suy ra từ bước (có bước Fail → Fail), cho phép sửa tay kèm lý do.
- Tự lưu nháp mỗi 5 giây (localStorage + server), không mất dữ liệu khi đóng tab.
- Phím tắt (hiện bảng bằng `?`):

| Phím | Tác dụng |
|---|---|
| `P` / `F` / `B` / `S` | Bước hiện tại: Đạt / Không đạt / Bị chặn / Bỏ qua |
| `↑` / `↓` | Bước trước / sau |
| `Enter` | Hoàn tất case, sang case tiếp |
| `N` | Ghi chú cho bước |
| `Ctrl+V` | Dán ảnh chụp màn hình |
| `Shift+F` | Tạo finding |

Phím tắt tắt khi focus đang ở ô nhập liệu.

```text
┌ Run #57 Regression 1.4.0 · Manual ──────────── 23/40 · ▓▓▓▓▓░░░ ─────┐
│ Của tôi ▾       │ TC-0087 Đổi mật khẩu          │ Ghi chú            │
│ ✓ TC-0081       │ Precondition: đã đăng nhập    │ [               ]  │
│ ✗ TC-0084       │ 1 Mở Hồ sơ → Đổi mật khẩu  ✓P │ Đính kèm           │
│ ▶ TC-0087       │ 2 Nhập mật khẩu cũ sai     ✗F │ [ảnh-1.png] ⌫      │
│ ○ TC-0090       │   Thực tế: [Không báo lỗi  ]  │ Dán ảnh: Ctrl+V    │
│ ○ TC-0091       │ 3 Nhập mật khẩu mới…       ○  │ [Tạo finding ⇧F]   │
│                 │ P Đạt F Lỗi B Chặn S Bỏ qua ? │                    │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.6. Chi tiết run (live)

- Header: tên run, plan, môi trường, branch/build, người trigger hoặc service account, trạng thái, thời gian chạy; nút Hủy.
- **Banner chờ duyệt** khi có job `WAITING_APPROVAL`: "Phần Hiệu năng đang chờ QA Lead duyệt (tải tối đa 50 req/s, 10 phút)" + nút Duyệt (nếu có quyền).
- **Lane theo job** (mỗi runner một dòng): icon runner, thanh tiến độ `done/total`, đếm đạt/không đạt/lỗi, trạng thái. Click lane → lọc bảng item và log theo job.
- Log stream (SSE): font mono, tự cuộn (tắt khi người dùng cuộn lên), lọc theo level, tìm kiếm; `aria-live="polite"` chỉ cho thay đổi trạng thái, không đọc từng dòng log.
- Bảng item: tên, loại, browser/viewport, trạng thái, attempt, thời gian, finding; chọn nhiều → "Chạy lại các item lỗi" (tạo attempt mới, không ghi đè).
- Mất kết nối SSE → banner "Đang kết nối lại…", tự nối lại với `Last-Event-ID`.
- **Panel "Nguyên nhân có khả năng" (D-26, Phase 4)**: cột phải, hiện ngay khi nhận sự kiện SSE `analysis.ready` (không cần chờ run xong). Mỗi mục là một nhóm lỗi cùng chữ ký: số item bị ảnh hưởng, câu nguyên nhân, phân loại (`failure_category`), độ tin cậy, bằng chứng (link tới log/ảnh/request), bước nên làm. Badge `✨ AI đề xuất`; nút "Áp dụng phân loại" (ghi `failure_category_source = HUMAN`), "Không đúng" (feedback), "Phân tích lại". Đang phân tích → skeleton + "AI đang phân tích 3 lỗi…". AI tắt/hết ngân sách → panel hiện phân loại theo luật, nhãn "Phân loại tự động". AI không bao giờ đổi trạng thái item.

```text
┌ Run #58 Kế hoạch phát hành 1.4.0 · Staging · build 312 · ● Đang chạy ┐
│ ⚠ Hiệu năng chờ duyệt: 50 req/s × 10 phút.        [Duyệt] [Từ chối] │
│ API        ▓▓▓▓▓▓▓▓▓▓ 64/64   ✓60 ✗3 ⚠1      Hoàn tất               │
│ Trình duyệt▓▓▓▓▓░░░░░ 21/40   ✓19 ✗2         Đang chạy (chromium)   │
│ Audit      ▓▓▓▓▓▓▓░░░ 35/50   ✓30 ✗5         Đang chạy              │
│ Hiệu năng  ░░░░░░░░░░  –      🛡 Chờ duyệt                           │
│ ── Log (Trình duyệt) ─────────── [Level ▾] [Tìm…] ──────────────────│
│ 14:32:05 INFO  TC-0123 chromium/desktop PASSED 4.2 s                 │
│ 14:32:09 WARN  TC-0130 retry 1/2: locator timeout                    │
│ ── Kết quả ───────────── [Chỉ lỗi ☑] [Chạy lại 6 item lỗi] ─────────│
│ ── ✨ Nguyên nhân có khả năng (AI đề xuất) ──────────────────────────│
│ 3 item · API /orders trả 500 khi mã giảm giá hết hạn · tin cậy cao  │
│   Lỗi sản phẩm · [Xem log] [Xem request]  [Áp dụng] [Không đúng]    │
│ 2 item · Không tìm thấy nút "Thanh toán" (đổi tên?) · trung bình    │
│   Lỗi script test · [Xem ảnh]              [Áp dụng] [Không đúng]   │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.7. Chi tiết run hiệu năng (chuyển từ `k6-perf/ui/app.js`)

Giữ đầy đủ nội dung của màn "Chi tiết" hiện tại, đổi sang React + Recharts:

1. **KPI** (6 ô; 3 ô SLO có badge Đạt/Không đạt): req/s đạt được, tổng request, p95 (SLO), tỉ lệ thành công (SLO), tỉ lệ sẵn sàng (SLO), request bị bỏ (dropped iterations).
2. **Nguyên nhân có khả năng**: danh sách từ `diagnose()`, sắp theo mức (Nghiêm trọng/Cảnh báo/Lưu ý); mỗi mục: dấu hiệu, nguyên nhân, **độ tin cậy**, việc nên làm, API liên quan.
3. **Biểu đồ cột ngang p95 theo API** có vạch SLO (và p95 baseline production nếu có).
4. **Bảng theo API** (sắp xếp được, mặc định p95 giảm dần): tên + method/path, request, req/s, avg, p50, p90, p95, p99, max, size, lỗi phân loại (`timeout×n · 429×n · 5xx×n · 4xx×n · body×n`), SLO, Đạt/Không đạt, p95 production, Δ.
5. **Biểu đồ theo cửa sổ thời gian**: req/s thực tế vs mục tiêu (line) + p95 (trục phải) theo 12 cửa sổ → thấy điểm bão hòa.
6. Nút **Timeline**: mở `dashboard.html` của k6 trong `<iframe sandbox>` (artifact, presigned URL).
7. **So sánh 2 run**: chọn run khác → Δ p95, Δ tỉ lệ thành công theo API, xanh = tốt hơn, đỏ = chậm hơn > 10%, kèm mũi tên và số.
8. Phần CPU/RAM và Top SQL chỉ hiện khi có dữ liệu observability (Phase 9); không có thì ẩn hẳn, không hiện ô trống.

Chế độ tổng quan chỉ hiện: câu kết luận ("Hệ thống chịu được 12 người dùng/giây với thời gian phản hồi 0,8 giây — đạt mục tiêu"), 3 ô SLO và top 3 nguyên nhân.

### 5.8. Dashboard công ty

- **Filter bar** cố định trên cùng, đồng bộ vào URL query: khoảng thời gian (preset 7/30/90 ngày, tùy chọn), project (nhiều), môi trường, test type, level, branch/build, execution source, người thực hiện, người trigger, runner; nút "Lưu bộ lọc" (preset theo người dùng). Filter áp dụng cho **mọi** KPI, biểu đồ, bảng (spec 1.0 mục 8.1).
- Chọn chế độ đếm retry: *Kết quả cuối* (mặc định) / *Lần chạy đầu* / *Tất cả attempt*.
- KPI: luôn hiện số tuyệt đối + mẫu số + %, vd. "Pass rate 92,4% (1.204/1.303)".
- Biểu đồ theo spec 1.0 mục 8.2; bảng "Project cần chú ý" (sắp theo khía cạnh thấp nhất).
- Thống kê thành viên (chỉ hiện ở kiểu Máy chủ, Phase 8, D-32) ghi rõ "Thống kê hoạt động, không phải bảng xếp hạng"; tách cột "Do người thực hiện" và "Do CI/service account".

```text
┌ Tổng quan ───────────────────────────────────────────────────────────┐
│ [30 ngày ▾][Project: tất cả ▾][Môi trường ▾][Loại test ▾][+ Lọc]     │
│ [Đếm: Kết quả cuối ▾]                             [Lưu bộ lọc][Xuất] │
│ Lần chạy  Test đã chạy  Pass rate         Lỗi hệ thống  Finding mở   │
│ 412       18.230        92,4%             1,1%          🚨3 ▲7 ●21   │
│                         (16.010/17.330)   (201/18.230)               │
│ ┌ Xu hướng kết quả theo ngày ─────┐┌ Kết quả theo loại test ───────┐ │
│ │ line: pass rate, error rate     ││ stacked bar ngang             │ │
│ └─────────────────────────────────┘└───────────────────────────────┘ │
│ Project cần chú ý                                                    │
│ QSNET   Bảo mật 🚨42   Hiệu năng 👁81   run gần nhất 2 giờ trước      │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.9. Chi tiết finding

- Header: tiêu đề, severity, trạng thái, category, nguồn (Thủ công/Runner/AI + `rule_id`), người phụ trách, link issue ngoài.
- **Ảnh hưởng tới người dùng** (lời thường) và **Khuyến nghị** ở đầu, trên phần kỹ thuật.
- Bằng chứng: ảnh, video, trace, request/response (đã redact), selector/URL.
- **Lần xuất hiện**: bảng `finding_occurrences` (run, ngày, vị trí), số lần, lần đầu/lần cuối.
- Hành động: đổi trạng thái (theo `finding_status`, không có kéo thả board), giao người, "Re-test" (tạo run `RETEST` chỉ gồm test liên quan), "Tạo issue Jira/GitHub" (Phase 9), "AI phân tích".
- Bình luận đơn giản (`finding_comments`), lịch sử thay đổi từ audit log.
- Finding đóng mà xuất hiện lại → banner "Đã mở lại tự động ngày …, run #…".
- Khối **"Nguyên nhân có khả năng"** ngay dưới phần Ảnh hưởng: lấy theo thứ tự ở 07 mục 5.1.1, có badge nguồn và độ tin cậy.

### 5.10. Công tắc bật/tắt test (D-24)

- **Cấp tổ chức** (`/settings/testing-switches`, O A): hai công tắc lớn "Cho phép test Production" (mặc định tắt) và "Cho phép test Local" (mặc định bật), kèm lịch sử (ai, khi nào, lý do).
- **Cấp môi trường**: công tắc "Cho phép chạy test" ở trang Môi trường và **ngay trên header dự án** (cạnh ô chọn môi trường). Môi trường PRODUCTION chỉ Admin bật/tắt được; các loại khác QA Lead trở lên.
- Bật/tắt mở **hộp thoại xác nhận**: ô "Lý do" bắt buộc (≥ 10 ký tự). Bật Production thêm dòng nhắc giới hạn an toàn vẫn áp dụng (không ghi dữ liệu, không ZAP active, hiệu năng cần duyệt) và yêu cầu gõ tên môi trường để xác nhận.
- Tắt khi có run đang chạy → hộp thoại hỏi thêm: "Dừng ngay N run đang chạy" / "Để các run đang chạy hoàn tất".
- Trạng thái tắt hiển thị:
  - Banner vàng đầu trang dự án: "Đang tắt test trên môi trường Production (Admin Nguyễn A tắt lúc 07/11 10:00: bảo trì)".
  - Nút Chạy / Kiểm tra nhanh / Chạy thử bước bị vô hiệu kèm tooltip lý do; lịch chạy hiện nhãn "Tạm dừng".
  - Công tắc cấp tổ chức đang tắt → công tắc cấp môi trường bị khóa, ghi "Đã tắt ở cấp tổ chức".

```text
┌ QSNET  [Môi trường: Production ▾]  [⏸ Đang tắt test  ○──]  ──────────┐
│ ⚠ Test trên Production đang tắt ở cấp tổ chức. Liên hệ Admin để bật.│
└──────────────────────────────────────────────────────────────────────┘
┌ Bật test trên "Production"? ─────────────────────────────────────────┐
│ Giới hạn vẫn áp dụng: không ghi dữ liệu · không quét bảo mật chủ    │
│ động · hiệu năng cần duyệt.                                          │
│ Lý do *  [Kiểm tra sau deploy 1.4.0                              ]   │
│ Gõ "Production" để xác nhận  [            ]                          │
│                                          [Hủy]  [Bật test]           │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.11. Recorder: ghi luồng bằng trình duyệt từ xa trong Hub (D-27)

Không cần cài gì: trình duyệt chạy trong worker-browser, hình ảnh được truyền về trang Hub, chuột/bàn phím của người dùng được gửi ngược lại (cơ chế ở [06-execution-engine.md](06-execution-engine.md)).

1. **Bắt đầu**: từ "Ghi luồng" (`/p/:key/cases/record`), nút "Ghi bằng Recorder" ở sơ đồ luồng hoặc "Ghi tiếp" ở trình soạn case. Chọn môi trường, suite đích, viewport (Desktop 1280×800 · Tablet 768×1024 · Mobile 390×844), URL bắt đầu (mặc định trang gốc của môi trường). Ghi được cả website `localhost` ở kiểu cài Cá nhân.
2. **Ghi**: khung trái là trang web thật; người dùng click, gõ, cuộn như bình thường.
   - Mỗi click/nhập/chọn/submit/điều hướng → một bước DSL + ảnh chụp có khung phần tử, hiện ngay ở cột phải.
   - Ô mật khẩu được ghi thành `{{secret.…}}`, **không** lưu giá trị gõ vào; người dùng chọn secret tương ứng khi xem lại.
   - **[Thêm kiểm tra]**: con trỏ chuyển sang chế độ chọn phần tử (viền tô sáng khi rê chuột) → chọn expectVisible / expectText / expectUrl / expectCount.
   - Upload file: khi trang mở hộp chọn file, Hub hiện hộp chọn file của Hub; file được lưu thành artifact và ghi bước `upload`.
   - **[Tạm dừng]**: vẫn thao tác được nhưng không ghi bước (vd. để đóng banner cookie).
3. **Kết thúc & lưu** → màn xem lại: danh sách thẻ bước như chế độ trực quan mục 5.4; sửa locator, gộp các bước gõ phím liên tiếp, xóa bước thừa; đặt tên, priority; nút "Chạy lại để kiểm tra" (báo bước nào không lặp lại được).
4. **Lưu** → test case `DRAFT` (`source = RECORDER`), vào hàng đợi duyệt; các bước chuyển trang gắn vào sơ đồ luồng.

```text
┌ Ghi luồng · [Local] localhost:3000 · Suite: Thanh toán ▾ ──────────────────────────────────────┐
│ ┌────────────────────────────────────────────────────────────────┐ ┌ Bước (5) ───────────────┐ │
│ │ ◀ ▶ ⟳ │ localhost:3000/cart │ Desktop ▾ │ ● Đang ghi 04:12     │ │ ┌──┐ 1 Mở /           ✓ │ │
│ │ ────────────────────────────────────────────────────────────── │ │ ┌──┐ 2 Bấm "Áo thun"   ✓│ │
│ │                                                                │ │ ┌──┐ 3 Thêm vào giỏ    ✓│ │
│ │   (trang web thật, thao tác trực tiếp bằng chuột/phím)         │ │ ┌──┐ 4 Nhập "SALE10"   ✓│ │
│ │                                                                │ │ ┌──┐ 5 Kiểm tra        ✓│ │
│ │                                                                │ │        "Giảm 10%"       │ │
│ │                                                                │ │ [Thêm kiểm tra]         │ │
│ │                                                                │ │ [Tạm dừng]              │ │
│ │                                                                │ │ [Kết thúc & lưu]        │ │
│ └────────────────────────────────────────────────────────────────┘ └─────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Trạng thái và giới hạn hiển thị rõ:
- Mỗi người 1 phiên ghi; không thao tác 10 phút → phiên tạm dừng, cảnh báo trước 1 phút; tối đa 30 phút/phiên (các bước đã ghi vẫn được giữ để lưu).
- Worker bận (đang chạy test trình duyệt khác) → "Đang chờ trình duyệt rảnh…" kèm vị trí trong hàng đợi.
- Không hỗ trợ tốt: kéo thả phức tạp, popup đăng nhập bên thứ ba (Google/Microsoft SSO), khóa bảo mật phần cứng → hiện gợi ý "thêm bước thủ công" tại vị trí đó.
- Mất kết nối WebSocket → tự nối lại, các bước đã ghi không mất.

### 5.12. Sơ đồ luồng (D-28)

- Đồ thị: **nút** = trang (`site_pages`, nhóm theo `normalized_path`, có ảnh thu nhỏ khi zoom gần), **cạnh** = bước chuyển (`site_transitions`: link, nút, submit form), mũi tên theo chiều đi.
- Màu cạnh luôn kèm kiểu nét + chú thích: **đã có test** (liền, xanh, icon ✓), **chưa có test** (nét đứt, xám), **test gần nhất lỗi** (liền, đỏ, icon ✕).
- Thanh trên cùng: "Độ phủ luồng 62% (31/50)" (07 mục 2.8), bộ lọc: chỉ luồng chưa có test, theo vai trò đăng nhập, theo nguồn (crawler / Recorder / AI Explorer).
- Click **cạnh** → panel phải: trang nguồn → trang đích, phần tử kích hoạt, test case đang phủ (link), nút **"Tạo test cho luồng này"** (sinh case nháp theo luật) và **"Ghi bằng Recorder"** (mở Recorder trong Hub tại trang nguồn).
- Click **nút** → thông tin trang, form, lỗi console, test case liên quan.
- Layout tự động (dagre/ELK), kéo được, zoom, "vừa màn hình"; > 300 nút → gom theo thư mục path, mở rộng khi click.
- Truy cập: có chế độ **danh sách** thay thế đồ thị (bảng bước chuyển: nguồn, đích, trạng thái phủ) cho người dùng bàn phím/screen reader.

```text
┌ Sơ đồ luồng · [Local] ── Độ phủ luồng 62% (31/50) ── [Chỉ chưa có test ☐] [Danh sách] ┐
│   [/] ──✓──► [/products] ──✓──► [/products/:id] ──✓──► [/cart]         │
│    │                                                  ┆               │
│    └──✓──► [/login] ──✕──► [/account]                ┆ chưa có test   │
│                                                       ▼               │
│                                                  [/checkout]          │
│ Cạnh chọn: /cart → /checkout (nút "Thanh toán")                       │
│ Chưa có test.   [Tạo test cho luồng này]  [Ghi bằng Recorder]         │
└───────────────────────────────────────────────────────────────────────┘
```

### 5.13. AI khám phá luồng (D-29, Phase 7)

- **Khởi chạy** (`/p/:key/flows/explore`): chọn môi trường, vai trò đăng nhập, mục tiêu tùy chọn (vd. "các luồng mua hàng"), giới hạn (số bước, phút), công tắc **"Cho phép gửi form / ghi dữ liệu"** (chỉ hiện với LOCAL/DEV, mặc định tắt). Ước tính chi phí token trước khi chạy.
- **Đang chạy**: ảnh chụp trình duyệt mới nhất + nhật ký hành động ("Bấm 'Đăng ký' vì muốn tìm luồng tạo tài khoản"), số luồng đã tìm, nút Dừng.
- **Kết quả**: danh sách luồng tìm được, mỗi luồng là chuỗi thẻ bước có ảnh; trạng thái xác nhận phát lại (✓ phát lại được / ✕ không lặp lại được, chỉ luồng ✓ được gửi duyệt). Chọn luồng → "Gửi sang hàng đợi duyệt" (test case `DRAFT`, nguồn AI). Bước chuyển mới tự thêm vào sơ đồ luồng với nguồn "AI Explorer".

### 5.14. Cài đặt AI (D-25)

- **Provider**: mặc định Gemini; dropdown đổi sang OpenAI / Anthropic Claude / OpenAI-compatible (model local). Ô API key (lưu vào secret vault, chỉ hiện `••••` sau khi lưu).
- **Model theo mục đích**: bảng 4 dòng (Phân tích lỗi · Sinh test case · Khám phá luồng · Tóm tắt báo cáo), mỗi dòng chọn provider + model; gợi ý mặc định: model nhanh cho phân tích lỗi và tóm tắt, model mạnh cho sinh test và khám phá.
- **Thử kết nối**: gửi một prompt mẫu không chứa dữ liệu dự án, hiện thời gian phản hồi và lỗi (sai key, hết quota) bằng lời dễ hiểu.
- **Ngân sách**: token/tháng theo tổ chức, mức cảnh báo 80%; số đã dùng tháng này.
- **Dữ liệu**: công tắc "Gửi dữ liệu môi trường Production cho AI" (mặc định tắt); với từng dự án có thể tắt AI bên ngoài (buộc dùng model local).

## 6. Biểu đồ

| Dữ liệu | Biểu đồ | Ghi chú |
|---|---|---|
| Xu hướng pass rate, error rate, điểm sức khỏe theo thời gian | Line | Điểm `null` → đứt đoạn, không nối qua và không vẽ 0 |
| Kết quả theo test type / project | Stacked bar ngang | Thứ tự màu cố định theo `test_status` |
| p95 theo API/trang | Bar ngang + vạch SLO (`ReferenceLine`) | Nhãn giá trị ở đầu cột |
| req/s vs mục tiêu + p95 theo cửa sổ | Composed: line req/s + line mục tiêu (nét đứt) + line p95 trục phải | Từ `windowsOf()` |
| Finding theo severity | Bar dọc | Không dùng donut |
| Tỉ lệ 2–4 nhóm (vd. pass/fail/error) | Donut được phép | **> 5 nhóm thì không dùng donut/pie** |
| Hoạt động thành viên | Bar | Không sắp hạng, sắp theo tên mặc định |
| 7 khía cạnh sức khỏe | Thẻ (card), **không** dùng radar | Radar khó đọc với người không chuyên và không hiện được "Chưa kiểm tra" |

Quy tắc chung:
- Tooltip luôn có: giá trị + đơn vị, mẫu số nếu là %, khoảng thời gian/bucket, timezone.
- Tiêu đề biểu đồ ghi khoảng thời gian và bộ lọc đang áp dụng.
- Không có dữ liệu → empty state trong khung biểu đồ ("Chưa có lần chạy nào trong 30 ngày"), không vẽ trục rỗng.
- Mỗi biểu đồ có nút "Xem dạng bảng" (cũng là phương án accessibility cho screen reader).
- Màu series lấy từ token, kiểm tương phản cả sáng và tối.

## 7. Kiến trúc frontend

```text
apps/web/src/
├── app/            router, store, providers (theme, i18n, auth), layout (sidebar, topbar)
├── features/<module>/
│   ├── api.ts      RTK Query endpoints (injectEndpoints vào baseApi)
│   ├── pages/      component theo route (lazy load)
│   ├── components/
│   └── hooks/
├── components/     ui/ (shadcn), data-table/, status/ (StatusBadge, HealthCard), charts/, glossary/
├── lib/            api base, sse, format (số, ngày, ms, bytes), permissions
└── i18n/           vi/, en/ (namespace theo module) + glossary
```

| Chủ đề | Quy ước |
|---|---|
| Server state | RTK Query, một `baseApi` + `injectEndpoints` theo feature. Có thể sinh endpoint từ OpenAPI của API (`@rtk-query/codegen-openapi`), không bắt buộc. Tag invalidation theo entity (`Run`, `TestCase`...) |
| Client state | Redux Toolkit chỉ cho: phiên đăng nhập, org/project đang chọn, chế độ hiển thị, preference. Không copy dữ liệu server vào slice |
| Auth | Access token trong bộ nhớ; refresh qua cookie httpOnly; `baseQuery` tự refresh khi 401 rồi thử lại 1 lần |
| SSE | Hook `useRunEvents(runId)` dùng `EventSource` (cookie auth), nối lại với `Last-Event-ID`, gộp log 500 ms, cập nhật cache RTK Query bằng `updateQueryData` |
| Form | React Hook Form + `zodResolver` với schema từ `packages/validation` (cùng schema API dùng). Lỗi server 422 map vào field |
| Bảng | Một component `DataTable` (TanStack Table theo mẫu shadcn data-table): phân trang/sắp xếp/lọc **phía server**, chọn nhiều, ẩn cột, lưu cột hiển thị theo người dùng |
| Filter | Đồng bộ vào URL query (`useSearchParams`), nên link chia sẻ giữ đúng bộ lọc; preset lưu server |
| i18n | Key dạng `module.screen.element` (vd. `runs.detail.cancelButton`); thuật ngữ ở `glossary.<term>`; enum ở `enum.test_status.PASSED`. Lint chặn chuỗi tiếng Việt hardcode trong JSX |
| Quyền | Hook `useCan(action, projectId)` đọc quyền từ `/auth/me`; ẩn/disable nút không có quyền. Backend vẫn kiểm mọi request; UI chỉ để trải nghiệm |
| Trạng thái màn hình | Component dùng chung `QueryState` xử lý loading/empty/error cho mọi query |
| Format | Hàm dùng chung `ms()`, `pct()`, `num()`, `bytes()`, `when()` (port từ `k6-perf/ui/app.js`, đổi sang `Intl` theo locale) |
| Test | Vitest + Testing Library cho component có logic; Playwright E2E cho các luồng ở mục 5; axe trong E2E |

## 8. Kiểm thử khả dụng báo cáo cho người không chuyên

Mục tiêu: kiểm chứng PRD **G3**. Làm ở cuối Phase 6, trước khi chốt MVP; lặp lại sau mỗi thay đổi lớn của trang báo cáo.

| Mục | Nội dung |
|---|---|
| Người tham gia | 5 người ngoài team kỹ thuật (quản lý, BA, kế toán, sale...), chưa từng xem Hub |
| Tài liệu | 2 báo cáo thật (1 dự án tốt, 1 dự án có vấn đề Critical), bản web và PDF |
| Cách làm | Mỗi người 15 phút, nói to suy nghĩ; người điều phối không gợi ý |
| Câu hỏi | (1) Sản phẩm này phát hành được chưa, vì sao? (2) Vấn đề lớn nhất là gì, ảnh hưởng tới ai? (3) So với lần trước tốt hơn hay tệ hơn? |
| Đo | Đúng/sai mỗi câu; thời gian tới câu trả lời; thuật ngữ khiến họ hỏi lại; chỗ họ nhìn đầu tiên |
| Đạt | ≥ 4/5 người trả lời đúng cả 3 câu, mỗi người ≤ 2 phút tổng; không ai hiểu "điểm cao" là "chắc chắn không có lỗi" |
| Không đạt | Sửa câu kết luận, thẻ, glossary; test lại với 3 người mới |
