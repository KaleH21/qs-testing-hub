# 14. Quyết định đã chốt và câu hỏi còn mở

- Người đọc: Product owner, Tech Lead
- Cách dùng: mỗi quyết định có mã `D-xx`. Muốn đổi quyết định thì sửa dòng này, ghi ngày và lý do, rồi cập nhật tài liệu liên quan (theo spec 1.0 mục 16).

## 1. Quyết định đã chốt (07/11/2026)

| Mã | Quyết định | Lý do | Tài liệu |
|---|---|---|---|
| D-01 | Chỉ kiểm thử **website, web app và HTTP API** | Theo yêu cầu: công cụ chỉ test phần mềm website | 01 §5 |
| D-02 | Giữ stack spec 1.0 (React, NestJS, Drizzle, PostgreSQL, BullMQ); thêm MinIO, egress proxy | Đã thống nhất trong spec; bổ sung phần còn thiếu để chạy an toàn | 03 §3 |
| D-03 | Modular monolith + 4 nhóm worker image | Công cụ nặng cần cô lập và scale riêng | 03 §1 |
| D-04 | Triển khai một tổ chức (công ty), vẫn giữ `organization_id` mọi bảng | Dùng nội bộ, không khóa đường mở rộng | 03 A9 |
| D-05 | Test UI tự động bằng **DSL JSON**, không chạy script người dùng viết | An toàn, AI sinh được, người không code sửa được | 03 A7, 06 |
| D-06 | Một test case có thể vừa chạy thủ công vừa chạy tự động (bước lời + bước DSL) | Không phải duy trì hai bộ test | 01 E4.4 |
| D-07 | Hiệu năng dùng lại API request của module API Testing | Không khai báo endpoint hai lần | 03 A8, 11 |
| D-08 | Chuyển `k6-perf` theo kiểu strangler: giữ script và luật chẩn đoán, bỏ phần gắn với QS, import lịch sử | Phần đã chạy đúng thì giữ | 11 |
| D-09 | `probes.js` (MySQL, CPU) không vào worker; thành Observability integration ở Phase 9 | Worker không được truy cập DB/process của hệ thống được test | 11 §6 |
| D-10 | Mạng nội bộ bị chặn mặc định; Admin mở theo host + CIDR (`allow_private_network`) | Giải quyết mâu thuẫn "chặn private network" với nhu cầu test staging trong LAN | 04 §4, 09 |
| D-11 | Production: không request ghi, không hiệu năng ngoài `smoke` khi chưa duyệt, **không bao giờ** ZAP active | An toàn mặc định (spec 1.0 §7.4) | 02, 09 |
| D-12 | Duyệt gắn với digest cấu hình; đổi cấu hình phải duyệt lại; không tự duyệt | Tránh "duyệt cấu hình nhẹ, chạy cấu hình nặng" | 04 §7 |
| D-13 | Chỉ số sức khỏe theo **7 khía cạnh**, không lấy một con số tổng làm tiêu đề; tiêu đề là câu kết luận theo luật | Spec 1.0 cấm khẳng định chất lượng từ một con số | 07 |
| D-14 | Khía cạnh không có dữ liệu hiển thị "Chưa kiểm tra", không bao giờ là 0 | Tránh hiểu nhầm | 07 |
| D-15 | Dải điểm: ≥ 90 Tốt, 75–89 Cần chú ý, 50–74 Có vấn đề, < 50 Nghiêm trọng | Thống nhất giữa báo cáo và giao diện | 07, 10 |
| D-16 | Mọi test case sinh tự động (luật hoặc AI) ở `DRAFT`, có nguồn và khóa chống trùng | AI chỉ đề xuất (spec 1.0 §1.2) | 01 E5, 06, 08 |
| D-17 | Sinh test theo luật có trước AI | Ra kết quả ổn định, không tốn chi phí, chạy được khi chưa cấu hình AI | 12 Phase 5 vs 7 |
| D-18 | Artifact lưu MinIO ở mọi môi trường | Một đường code | 03 A4 |
| D-19 | Dashboard đọc bảng tổng hợp, không quét bảng kết quả thô | p95 < 2 s | 03 A6, 04 §9 |
| D-20 | PDF xuất bằng Playwright từ chính trang báo cáo HTML | Bản PDF giống bản web, không thêm thư viện | 03 §3 |
| D-21 | Hai chế độ hiển thị: Kỹ thuật và Tổng quan (cho người không chuyên); link chia sẻ luôn ở chế độ Tổng quan | Phục vụ hai nhóm người đọc khác nhau trên cùng dữ liệu | 10 |
| D-22 | ~~Lộ trình 9 phase, M1 tuần 15, M2 tuần 23, M3 tuần 31~~ → thay bằng D-31 | | 12 |

### 1.1. Bổ sung theo phản hồi (07/11/2026, lần 2)

| Mã | Quyết định | Lý do | Tài liệu |
|---|---|---|---|
| D-23 | **Local-first.** Môi trường có `kind`: `LOCAL` / `DEV` / `STAGING` / `PRODUCTION`. `LOCAL` là app chạy ở `localhost` hoặc IP LAN, là loại hạng nhất (không cần xác minh DNS). Hub hỗ trợ 2 kiểu cài: **Cá nhân** (Docker Compose trên chính máy dev; worker gọi `localhost:<port>` qua `host.docker.internal`, tự đổi địa chỉ) và **Máy chủ nội bộ** (Hub trên server LAN; target là IP/hostname LAN như `http://192.168.1.50:3000`, app phải listen `0.0.0.0`). Admin bật dải IP nội bộ một lần (`allow_private_network` + CIDR). IP metadata cloud (`169.254.169.254`...) luôn bị chặn | Website được test chạy ở local trước khi lên internet | 01, 02, 04, 06, 09, 13 |
| D-24 | **Bật/tắt test theo môi trường.** Hai lớp công tắc: (1) cấp tổ chức: `organizations.production_testing_enabled` (mặc định **tắt**) và `organizations.local_testing_enabled` (mặc định **bật**); (2) cấp môi trường: `environments.testing_enabled`. Tắt → API từ chối tạo run, lịch chạy tạm dừng, worker kiểm tra lại trước khi chạy; run đang chạy hỏi người tắt có dừng ngay không. Bật/tắt production cần Admin, các môi trường khác cần QA Lead; mỗi lần bật/tắt ghi audit kèm lý do. Bật production vẫn giữ giới hạn D-11 | Yêu cầu bật/tắt được test production và local | 01, 04, 05, 09, 10 |
| D-25 | **AI mặc định Gemini**, đổi được sang OpenAI / Claude / model local trong *Settings → AI* mà không sửa code. Chọn model theo mục đích (model nhanh cho phân tích lỗi hàng loạt, model mạnh cho sinh test và khám phá luồng). AI bật khi Admin nhập Gemini API key | Theo yêu cầu | 03, 04, 08 |
| D-26 | **AI tự phân tích nguyên nhân lỗi ngay trong lúc test**: mỗi item `FAILED`/`ERROR` được phân tích ngay khi job của nó kết thúc (gom theo chữ ký lỗi để không phân tích trùng, giới hạn số lần mỗi run). Kết quả hiện trực tiếp ở màn chạy và **đi vào báo cáo** (mỗi vấn đề có "Nguyên nhân có khả năng" + "Cách khắc phục" + độ tin cậy). AI vẫn chỉ đề xuất, không đổi trạng thái test | Theo yêu cầu | 06, 07, 08, 10 |
| D-27 | ~~Recorder là extension Chrome/Edge~~ → **sửa lại (lần 3): Recorder là trình duyệt từ xa ngay trong Hub, không cần cài gì.** Worker-browser mở Chromium (Playwright), hình ảnh trang được truyền về Hub bằng CDP screencast, chuột/bàn phím của người dùng được gửi ngược lại qua WebSocket. Script ghi được gắn vào trang, bắt thao tác (click, nhập, chọn, submit, điều hướng) và sinh bước DSL + ảnh chụp → test case `DRAFT`. Ô mật khẩu ghi thành `{{secret.*}}`. Ghi được website `localhost` vì kiểu cài Cá nhân đổi địa chỉ sang `host.docker.internal`. Cùng engine với runner nên khi chạy lại ổn định hơn. Hạn chế: kéo thả phức tạp, popup đăng nhập bên thứ ba, khóa bảo mật phần cứng | Team không cài được extension (Q12) | 01, 03, 05, 06, 09, 10, 12 |
| D-28 | **Sơ đồ luồng + độ phủ luồng**: Discovery ghi lại các bước chuyển giữa trang (link, nút, submit form) thành đồ thị. Giao diện tô màu luồng đã có test / chưa có test. Chỉ số "Độ phủ luồng" = số bước chuyển có test case `ACTIVE` / số bước chuyển đã khám phá. "Mọi luồng" được định nghĩa là các luồng đã khám phá, ghi lại hoặc khai báo; luồng ẩn (cần dữ liệu đặc biệt) phải ghi bằng Recorder hoặc mô tả cho AI | Không thể hứa test mọi luồng nếu không định nghĩa được "mọi" | 04, 06, 07, 10 |
| D-29 | **AI khám phá luồng (AI Explorer)**: Gemini điều khiển Playwright như một người dùng (đọc cây accessibility + ảnh chụp, chọn thao tác) trong giới hạn số bước và thời gian, để tìm luồng mà crawler không thấy (sau đăng nhập, nhiều bước, form). Mỗi luồng được chạy lại để xác nhận trước khi đề xuất thành test case `DRAFT`. Chỉ được gửi form hoặc ghi dữ liệu ở `LOCAL`/`DEV` khi người dùng bật tùy chọn | "Test mọi luồng" | 06, 08 |
| D-30 | **Báo cáo ngắn gọn, trực quan**: trang tóm tắt vừa **1 màn hình / 1 trang PDF**, gồm: câu kết luận, 7 thẻ khía cạnh, biểu đồ xu hướng nhỏ, **tối đa 3 vấn đề quan trọng nhất** (mỗi vấn đề: chuyện gì, ảnh hưởng, nguyên nhân AI, cách sửa, có ảnh minh họa), độ phủ luồng. Phần tóm tắt tối đa ~150 chữ. Chi tiết kỹ thuật nằm ở phần mở rộng (thu gọn trên web, file phụ lục riêng khi xuất) | Theo yêu cầu | 07, 10 |
| D-32 | **Cài kiểu Cá nhân trước.** M1 và M2 phát hành dạng Cá nhân: Hub chạy trên máy dev bằng Docker Compose, chỉ mở ở `127.0.0.1`, tài khoản Owner tạo lúc cài, quên mật khẩu đặt lại bằng lệnh CLI (không cần email). Những phần chỉ có ích khi nhiều người dùng chung được dời sang kiểu **Máy chủ nội bộ** ở Phase 8 (M3): mời thành viên qua email, SSO/2FA, link chia sẻ báo cáo, dashboard thành viên, thông báo cho team. Ở kiểu Cá nhân, báo cáo chia sẻ bằng file PDF/HTML xuất ra. Có **xuất/nhập dự án** để chuyển từ máy cá nhân lên máy chủ sau này. Schema và phân quyền vẫn giữ đa người dùng ngay từ đầu, không phải làm lại | Trả lời Q11 | 01, 09, 10, 12, 13 |
| D-33 | **Không gửi dữ liệu từ môi trường `PRODUCTION` cho Gemini** (`ai_provider_configs.send_production_data = false`). Lỗi ở production vẫn có phân tích theo luật cố định; Admin có thể bật sau nếu có chính sách dữ liệu | Trả lời Q5b | 08, 09 |
| D-31 | Lộ trình mới: **M1 tuần 17** (manual + API + hiệu năng + AI phân tích lỗi), **M2 tuần 27** (MVP nội bộ: + browser, recorder, sơ đồ luồng, Quick Scan, dashboard, báo cáo), **M3 tuần 37** (lùi 2 tuần theo D-32: thêm khối kiểu Máy chủ nội bộ ở Phase 8) (v1.0: + AI sinh test, AI Explorer, CI, ZAP, lịch chạy...) | Thêm recorder, sơ đồ luồng, AI sớm hơn | 12 |

### 1.2. Bổ sung khi triển khai Phase 1 (07/11/2026)

| Mã | Quyết định | Lý do | Tài liệu |
|---|---|---|---|
| D-34 | Kiểu Cá nhân: màn `/setup` (và `pnpm hub:create-owner`) tạo tổ chức với `localNetwork.allowLoopback = true`; kiểu Máy chủ mặc định `false` | Hub Cá nhân chỉ mở ở `127.0.0.1`, test `localhost` là việc chính (G1 ≤ 15 phút) | 05 §3.1, 09 §5 |
| D-35 | Phase 1 thêm thành viên **trực tiếp** (`POST /organizations/:id/members`), user mới nhận mật khẩu tạm hiện một lần; lời mời qua email vẫn ở Phase 8 | docs/12 mục 1.4 cần thêm thành viên trước khi có email | 05 §3.2 |
| D-36 | Guard chỉ **xác thực**; quyền kiểm trong service qua `AccessService` dùng một ma trận quyền chung (`packages/validation/permissions.ts`) cho cả backend và `useCan` ở frontend. Test ma trận gọi mọi route đã đăng ký với 7 vai trò + người ngoài dự án + người tổ chức khác + service account; route chưa khai báo → test fail | Phần lớn quy tắc phụ thuộc dữ liệu (môi trường thuộc dự án nào, `kind = PRODUCTION` cần Admin); một nguồn sự thật cho UI và API | 09 §2 |
| D-37 | Dải IP nội bộ cho môi trường `LOCAL` lưu ở `organizations.settings.localNetwork { allowedCidrs, allowLoopback }`, không tạo dòng `target_hosts`. Danh sách mật khẩu phổ biến lấy từ SecLists NCSC 100k, giữ mục ≥ 10 ký tự | Cấu hình một lần cho cả tổ chức, luôn đọc cùng bản ghi tổ chức | 04 §4, 09 §3 |

| D-38 | **ID bản ghi là số tự tăng** (`bigint identity`) ở DB, API và URL, thay cho UUID v7 (docs/04 §1 cũ). Mã bí mật không phải ID (mã phiên `sid`, token xác minh, token service account, refresh token) vẫn là chuỗi ngẫu nhiên. Hệ quả đã chấp nhận: (1) ID lộ quy mô dữ liệu và đoán được, an toàn vẫn dựa vào kiểm quyền (404 khi không có quyền); (2) **xuất/nhập dự án ở Phase 8 phải đánh số lại toàn bộ id và khóa ngoại** vì mỗi bản cài đánh số từ 1; (3) link chia sẻ báo cáo (Phase 8) dùng token ngẫu nhiên, không dùng id | Yêu cầu của chủ dự án (07/11/2026) | 04 §1, 05 §1 |

## 2. Câu hỏi cần anh/chị trả lời

Các câu dưới ảnh hưởng thiết kế hoặc lộ trình. Cột "Mặc định" là phương án tài liệu đang dùng nếu chưa có câu trả lời.

| # | Câu hỏi | Mặc định đang dùng | Ảnh hưởng nếu khác |
|---|---|---|---|
| Q1 | Team thực tế bao nhiêu người, bao giờ bắt đầu? | 3 dev + 1 QA bán thời gian | Lộ trình [12](12-implementation-plan.md) co giãn tương ứng |
| Q2 | Hub chạy ở đâu: server nội bộ hay cloud? Cấu hình máy? | Một server nội bộ 8 vCPU / 32 GB / 500 GB SSD, Docker Compose | Cloud thì dùng S3 thật, có thể chạy worker trên máy riêng |
| ~~Q3~~ | ~~Website được test nằm ở đâu?~~ **Đã trả lời:** ở local trước, sau đó lên internet → D-23 | | |
| ~~Q4~~ | ~~Có được test production không?~~ **Đã trả lời:** bật/tắt được cả production và local → D-24 | | |
| ~~Q5~~ | ~~Dùng AI nào?~~ **Đã trả lời:** Gemini, đổi được model khác → D-25 | | |
| ~~Q5b~~ | ~~Dữ liệu production có gửi cho Gemini không?~~ **Đã trả lời:** không → D-33 | | |
| ~~Q11~~ | ~~Cài kiểu nào trước?~~ **Đã trả lời:** Cá nhân → D-32 | | |
| ~~Q12~~ | ~~Cài được extension không?~~ **Đã trả lời:** không → Recorder là trình duyệt từ xa trong Hub (D-27 sửa lại) | | |
| Q13 | Máy cá nhân của dev cấu hình bao nhiêu? | Tối thiểu 4 vCPU / 16 GB RAM / 30 GB trống; khuyến nghị 8 vCPU / 32 GB nếu chạy trình duyệt và k6 cùng lúc | Máy yếu hơn → tắt ZAP và chỉ chạy 1 job một lúc |
| Q6 | Đăng nhập bằng tài khoản công ty (Google Workspace / Microsoft 365)? | Email + mật khẩu, SSO ở Phase 8 | Cần SSO sớm thì đưa lên Phase 1 (+4 d) |
| Q7 | Kênh thông báo công ty đang dùng? | Email + webhook chung; Slack/Teams/Telegram | Zalo cần tích hợp riêng (Zalo OA) |
| Q8 | Có khách hàng bên ngoài cần xem báo cáo không? | Có, qua link chia sẻ có hạn | Nếu không thì bỏ link chia sẻ (−2 d) |
| Q9 | Mức tải hiệu năng tối đa cho phép mặc định? | 100 req/s, 30 phút (giống profile stress cũ) | Policy theo môi trường |
| Q10 | Có cần thử nghiệm với 3 website mẫu nào của công ty ngay từ Phase 0? | Chưa chọn | Cần để kiểm chứng crawler và luật sinh test |
