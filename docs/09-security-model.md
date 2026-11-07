# 09. Security model

- Người đọc: Tech Lead, developer, Admin hệ thống
- Phạm vi: bảo mật của **chính Hub** và an toàn khi Hub kiểm thử hệ thống khác.
- Liên quan: [03-architecture.md](03-architecture.md), [04-database-schema.md](04-database-schema.md), [05-api-specification.md](05-api-specification.md), [13-deployment-operations.md](13-deployment-operations.md)

> Hub là công cụ có thể gửi hàng nghìn request/giây và chạy trình duyệt tới URL do người dùng nhập. Nếu bị lạm dụng, nó là **công cụ tấn công**: DoS, SSRF vào mạng nội bộ, quét lỗ hổng hệ thống của người khác. Mọi quy tắc ở mục 4–6 là bắt buộc, không có cờ tắt trong UI.

---

## 1. Threat model (STRIDE)

| Loại | Mối đe dọa | Biện pháp chính | Mục |
|---|---|---|---|
| **S**poofing | Đánh cắp phiên, đoán mật khẩu, lộ token CI | Argon2id, khóa tài khoản, refresh xoay vòng phát hiện dùng lại, token SA chỉ lưu hash, 2FA cho Admin | 3 |
| **T**ampering | Sửa kết quả test để qua gate; đổi cấu hình sau khi đã duyệt | Kết quả chỉ thêm, không sửa; approval gắn `config_digest`; audit log không có quyền UPDATE/DELETE | 7, 11 |
| **R**epudiation | "Tôi không chạy stress test đó" | Audit log mọi hành động quan trọng, lưu actor, IP, cấu hình | 11 |
| **I**nformation disclosure | User project A đọc dữ liệu project B; secret lộ qua log/screenshot/AI; artifact HTML chạy script trên origin của Hub | Scope bắt buộc ở repository, 404 thay 403, vault mã hóa, redaction, iframe sandbox origin riêng | 2, 4, 9 |
| **D**enial of service | Dùng Hub tấn công website khác; làm sập target của chính công ty; làm sập Hub bằng job nặng | Allowlist + xác minh domain, execution policy, giới hạn cứng trong worker, quota, rate limit API | 5, 6, 7 |
| **E**levation of privilege | SSRF tới metadata/DB nội bộ; thoát container worker; Tester tự duyệt chạy tải; bật nhầm test production; trang web chèn chỉ thị (prompt injection) để AI Explorer làm hành động phá hoại | Egress proxy + chặn IP, sandbox container, four-eyes approval, công tắc production mặc định tắt + audit, AI chỉ trả hành động DSL trong danh sách cho phép | 5, 6, 7, 7.2, 8 |

## 2. Cô lập organization/project

| Lớp | Quy tắc |
|---|---|
| Repository | Mọi hàm truy vấn nhận `scope: { orgId, projectIds }` bắt buộc (kiểu TypeScript không cho bỏ). Không có hàm `findById(id)` trần cho dữ liệu nghiệp vụ |
| Guard | `AuthGuard` (xác thực) → `RbacGuard` (decorator `@Require('test-cases:write')`) → `PolicyService.can(actor, action, resource)` trong service cho quy tắc theo dữ liệu (vd. người duyệt ≠ người yêu cầu, chỉ người thực hiện attempt mới nộp kết quả) |
| Quyền | `effectiveRole = max(org_role, project_role)`; Viewer org chỉ thấy project mình là thành viên trừ Owner/Admin. Quyền đọc từ DB (cache Redis 60 s, xóa cache khi đổi role) |
| Phản hồi | Không có quyền đọc tài nguyên của project khác → `404 NOT_FOUND`, không phải `403`, để không lộ sự tồn tại |
| Worker | Không tin payload queue: đọc lại `run_jobs` từ DB, kiểm `organization_id`/`project_id` khớp mọi đối tượng tham chiếu (secret, environment, request) |
| Kiểm chứng | **Permission matrix test** (integration, chạy trong CI): duyệt mọi route từ metadata Nest, gọi với 7 vai trò + 1 user của project khác + 1 SA sai scope; so với bảng kỳ vọng `test/permissions.matrix.ts`. Route mới chưa có dòng trong bảng → test fail |

## 3. Xác thực

| Hạng mục | Thiết lập |
|---|---|
| Mật khẩu | Argon2id `m=19456 KiB, t=2, p=1` (mức tối thiểu OWASP), tối thiểu 10 ký tự, chặn 10.000 mật khẩu phổ biến, không bắt quy tắc ký tự phức tạp |
| Khóa tài khoản | 5 lần sai liên tiếp → khóa 15 phút (tăng dần ×2, tối đa 24 h); cộng rate limit theo IP. Thông báo lỗi chung "Email hoặc mật khẩu không đúng" |
| Access token | JWT HS256/EdDSA, 15 phút, chứa `sub`, `sid`. Khóa ký trong `JWT_SECRET`, xoay vòng hỗ trợ 2 khóa (`kid`) |
| Refresh token | 256-bit ngẫu nhiên, lưu hash SHA-256, sống 14 ngày (trượt), xoay vòng mỗi lần dùng. Token đã thay mà bị dùng lại → thu hồi cả `family_id`, ghi audit `auth.refresh_reuse` |
| Cookie | `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`. CSRF double-submit cho endpoint dùng cookie |
| Thu hồi | Logout, đổi mật khẩu, khóa user, xóa khỏi org → thu hồi refresh token; access token còn tối đa 15 phút nhưng mỗi request kiểm session (`sid` → `refresh_tokens.family_id` bị thu hồi) qua cache (≤ 60 s) |
| Service account | Token `qah_<prefix8>_<secret32>`, lưu hash, so constant-time, có hạn (mặc định 1 năm), cảnh báo trước 14 ngày. Token xuất hiện trong log/HTTP bị redact theo mẫu `qah_[A-Za-z0-9]{8}_\w+` |
| 2FA / SSO | Chỉ ở kiểu Máy chủ (Phase 8): TOTP bắt buộc cho Owner/Admin; OIDC (Google Workspace / Microsoft Entra), map email domain công ty |
| Kiểu Cá nhân (D-32) | Tài khoản Owner tạo lúc cài (màn `/setup` lần đầu hoặc `pnpm hub:create-owner`). Không gửi email: quên mật khẩu thì đặt lại bằng `pnpm hub:reset-password` chạy trên chính máy đó (cần quyền truy cập Docker, ghi audit `auth.password_reset_cli`). Không có lời mời thành viên, SSO, 2FA, link chia sẻ báo cáo; phân quyền vẫn kiểm đầy đủ ở backend để khi chuyển lên kiểu Máy chủ không phải làm lại |

## 4. Secret vault

| Quy tắc | Chi tiết |
|---|---|
| Mã hóa | AES-256-GCM, IV 96-bit ngẫu nhiên mỗi lần ghi, `auth_tag` lưu riêng, AAD = `organization_id|project_id|name` (chống tráo ciphertext giữa bản ghi) |
| Master key | `SECRETS_MASTER_KEY` (32 byte base64) từ biến môi trường hoặc file `SECRETS_MASTER_KEY_FILE` (Docker secret). Không bao giờ nằm trong DB, image, repo |
| Xoay vòng khóa | `key_version` trên mỗi bản ghi; cấu hình nhiều khóa `SECRETS_KEYS=v1:...,v2:...`, ghi bằng khóa mới nhất, script `rotate-secrets` mã hóa lại dần (runbook ở [13](13-deployment-operations.md) mục 12) |
| Ai giải mã | Chỉ **worker-core** giữ `SECRETS_MASTER_KEY`. Khi dispatch, worker-core giải mã đúng các secret job cần và **niêm phong** chúng vào payload job bằng `JOB_PAYLOAD_KEY` (AES-256-GCM, khóa riêng, không phải master key); Redis chỉ chứa ciphertext, payload bị xóa khi job kết thúc (`removeOnComplete/removeOnFail`). Worker runner chỉ mở được secret của job nó đang chạy, không đọc được vault. API chỉ mã hóa khi ghi; không có endpoint đọc giá trị. Mỗi lần dispatch có secret ghi audit `secret.read_by_worker` (gộp theo job) |
| Trong bộ nhớ | Giải mã ngay trước khi dùng, không ghi ra file; với k6 truyền qua biến môi trường của tiến trình con trong tmpfs, không vào `config_snapshot` |
| Redaction | Một hàm `redact()` dùng chung ở `packages/runner-contracts`: header `Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`, field JSON tên chứa `password|token|secret|apiKey|authorization`, và **mọi giá trị secret đã giải mã trong job** (so khớp chuỗi). Áp dụng cho: log, `request_snapshot`, `response_headers`, body lưu artifact, HAR, thông báo lỗi, `summary.json` của k6 (bỏ `setup_data` như `k6-perf` đang làm) |
| Screenshot/video | Bước DSL `fill` với giá trị từ `{{secret.*}}` được Playwright che (mask) trong screenshot; trace bật chế độ không ghi giá trị input nhạy cảm. Không đảm bảo 100% → artifact cũng thuộc dữ liệu nhạy cảm (mục 11) |
| AI | Trước khi gửi prompt: chạy `redact()`, cắt body dài, bỏ cookie/token, thay email/số điện thoại bằng placeholder. Provider mặc định là Gemini (D-25); mọi provider đi qua cùng pipeline này. Dữ liệu môi trường `kind=PRODUCTION` **không** gửi cho AI bên ngoài (D-33, `ai_provider_configs.send_production_data = false` mặc định); chỉ Admin bật được `send_production_data` (audit `ai.production_data_enabled`); phân tích lỗi tự động trên production khi đó trả `SKIPPED`. API key AI lưu trong `secrets`; worker-core dùng cho phân tích/sinh/tóm tắt; riêng job AI Explorer (chạy ở worker-browser) nhận key niêm phong trong payload như secret khác, gọi AI qua egress proxy (host provider nằm trong allowlist hệ thống) |

## 5. Quyền kiểm thử mục tiêu (target authorization)

Mọi URL trước khi worker gửi request phải khớp một `target_hosts` đã xác minh của **cùng organization** (và cùng project nếu `project_id` có giá trị).

| Cách xác minh | Dùng khi | Quy trình |
|---|---|---|
| `DNS_TXT` | Domain công ty quản lý DNS | Thêm bản ghi TXT `qa-hub-verification=<token>` tại host hoặc domain gốc |
| `WELL_KNOWN_FILE` | Có quyền deploy lên website | Đặt file `/.well-known/qa-hub-verification.txt` chứa token |
| `ADMIN_APPROVAL` | Staging công ty có hostname nội bộ riêng | Owner/Admin duyệt, ghi lý do; audit `target.approve` |
| `LOCAL_NETWORK` | Môi trường `kind=LOCAL`: `localhost`, `127.0.0.1`, IP/hostname LAN (D-23) | Không xác minh DNS. Admin bật **một lần** dải mạng nội bộ cho org (`PUT /organizations/:id/local-network`); mọi host LOCAL phân giải vào dải đó được phép, audit `org.local_network_update` |

- Xác minh có hạn: `DNS_TXT`/`WELL_KNOWN_FILE` kiểm lại mỗi 30 ngày (job định kỳ); mất bản ghi → host chuyển `expired`, run mới bị chặn, thông báo Admin. `ADMIN_APPROVAL` hết hạn sau 180 ngày, duyệt lại.
- Wildcard `*.example.vn` chỉ cho `DNS_TXT` ở domain gốc.
- **Mạng nội bộ công ty.** Spec 1.0 yêu cầu chặn private network, nhưng staging của công ty thường ở LAN. Giải pháp: mặc định chặn; host có `allow_private_network = true` **và** danh sách `allowed_cidrs` cụ thể (vd. `10.20.30.0/24`) thì chỉ IP trong các CIDR đó được phép, chỉ Owner/Admin bật được, kèm audit. Không bao giờ cho phép mục 6.1 nhóm "luôn chặn", kể cả khi CIDR bao trùm.
- **Local-first (D-23): hai kiểu cài**, chọn bằng `DEPLOYMENT_MODE`:

Kiểu **Cá nhân** được làm và phát hành trước (D-32, M1–M2); kiểu Máy chủ hoàn thiện ở Phase 8.

| | Cá nhân (`personal`, làm trước) | Máy chủ nội bộ (`server`, Phase 8) |
|---|---|---|
| Hub chạy ở | Docker Compose trên chính máy dev | Server trong LAN công ty |
| Target LOCAL hợp lệ | `localhost:<port>`, `127.0.0.1:<port>`, IP LAN | IP/hostname LAN (vd. `http://192.168.1.50:3000`); app phải listen `0.0.0.0` |
| Loopback | Được phép khi Admin bật `allowLoopback`. Worker/egress proxy đổi `localhost`/`127.0.0.1` → `host.docker.internal` (giữ cổng, giữ `Host` header gốc) | **Luôn chặn**: loopback của server là chính Hub |
| Ai truy cập UI | Chỉ máy đó (bind `127.0.0.1`), một Owner tạo lúc cài | Thành viên đăng nhập |
| Chia sẻ báo cáo | Xuất file PDF/HTML | Link chia sẻ có hạn (mục 10) |

  - Test `localhost` trên máy của dev từ Hub máy chủ cần **local runner agent** (Phase 9): dev chạy một worker container trên máy mình, kết nối ra Hub; không mở loopback của server.
  - `host.docker.internal` chỉ được phân giải bởi egress proxy ở kiểu `personal`; ở kiểu `server` tên này nằm trong danh sách chặn.
  - Cờ `ALLOW_LOOPBACK_TARGETS` cũ được thay bằng `DEPLOYMENT_MODE=personal` + `allowLoopback`; khởi động bị từ chối nếu `DEPLOYMENT_MODE=personal` mà `HUB_BIND_ADDRESS` không phải loopback.

## 6. SSRF: phòng thủ nhiều lớp

### 6.1. Lớp 1: kiểm tra trong code worker (`packages/runner-contracts/net-guard`)

1. Parse URL; chỉ cho `http`/`https`; cổng mặc định hoặc cổng nằm trong `target_hosts` (mặc định 80, 443, 8080, 8443 + cổng khai báo).
2. Khớp host với allowlist (mục 5).
3. Phân giải DNS (A + AAAA); **mọi** IP trả về phải hợp lệ, không chỉ IP đầu.
4. Từ chối nếu IP thuộc:

| Nhóm | Dải | Cho phép qua CIDR nội bộ? |
|---|---|---|
| Loopback | `127.0.0.0/8`, `::1` | Chỉ ở kiểu cài `personal` + `allowLoopback` (mục 5), qua `host.docker.internal` |
| Không xác định / broadcast | `0.0.0.0/8`, `255.255.255.255`, `::` | Không |
| Link-local, metadata cloud | `169.254.0.0/16` (gồm `169.254.169.254`), `fe80::/10`, `fd00:ec2::254` | **Không bao giờ** |
| Multicast | `224.0.0.0/4`, `ff00::/8` | Không |
| Private RFC 1918 | `10/8`, `172.16/12`, `192.168/16` | Có, nếu nằm trong `allowed_cidrs` |
| CGNAT | `100.64.0.0/10` | Có, nếu nằm trong `allowed_cidrs` |
| IPv6 ULA | `fc00::/7` | Có, nếu nằm trong `allowed_cidrs` |
| IPv4-mapped IPv6 | `::ffff:0:0/96` | Kiểm theo IPv4 bên trong |
| Mạng nội bộ của chính Hub | Subnet Docker của Hub (postgres, redis, minio, api) | **Không bao giờ** |

5. **Ghim IP** (pin): kết nối tới IP đã kiểm, giữ `Host`/SNI là tên gốc. Với Node HTTP client dùng `lookup` tùy biến trả IP đã kiểm; với Playwright, k6, ZAP thì lớp 2 đảm nhiệm (chúng tự phân giải).
6. **Redirect**: tắt follow tự động trong API runner; mỗi `Location` đi lại từ bước 1. Tối đa 10 redirect.

### 6.2. Lớp 2: egress proxy

- Container `egress-proxy` (Squid hoặc proxy Node nhỏ dùng chung `net-guard`) là **đường ra duy nhất**. Network Docker của worker là `internal: true`, không có default route ra Internet/LAN; chỉ nối tới `egress-proxy`, Redis, MinIO, Postgres (worker-core).
- Playwright: `proxy: { server }` ở mức browser; k6: `HTTPS_PROXY`/`HTTP_PROXY`; ZAP: upstream proxy.
- Proxy tự phân giải DNS, áp đúng bảng mục 6.1 với allowlist đồng bộ từ DB (cache 60 s), ghi log mọi kết nối bị chặn (`host, ip, runJobId`). Nhờ proxy phân giải và kết nối trong cùng một bước, DNS rebinding không lách được.
- Proxy giới hạn băng thông và số kết nối đồng thời theo `runJobId` (header nội bộ `X-QAH-Job`, worker không ghi đè được vì proxy kiểm theo IP container + token job).

## 7. An toàn khi chạy test

| Quy tắc | Thực thi ở đâu |
|---|---|
| **Công tắc bật/tắt test (D-24)**: cấp org `production_testing_enabled` (mặc định **tắt**), `local_testing_enabled` (mặc định bật); cấp môi trường `testing_enabled`. Được chạy ⇔ cả hai lớp đều bật | Kiểm ở **ba chỗ**: API khi tạo run (`403 TESTING_DISABLED` / `PRODUCTION_TESTING_DISABLED`), scheduler trước khi tạo run theo lịch (bỏ qua + ghi `schedule.skipped_disabled`), worker-core trước khi dispatch mỗi job (job → `CANCELLED`, `error_code = TESTING_DISABLED`) |
| Ai bật/tắt: công tắc production và môi trường `PRODUCTION` cần Admin; môi trường khác cần QA Lead. Bắt buộc nhập lý do. Tắt khi đang có run: người tắt chọn dừng ngay hay chỉ chặn run mới | Audit `testing.switch` / `environment.testing_toggle` (ai, lúc nào, trước/sau, lý do); thông báo kênh `APPROVAL_REQUESTED` của org khi production được **bật** |
| Bật production **không** nới giới hạn bên dưới: vẫn áp quy tắc dòng tiếp theo | |
| `execution_policies` theo môi trường: loại test được phép, `max_perf_rps`, `max_perf_duration_s`, `max_vus`, `allow_write_requests`, `max_concurrent_jobs_per_host` | API khi tạo run **và** worker trước khi chạy (giới hạn cứng, cắt cấu hình vượt) |
| Môi trường `kind=PRODUCTION` mặc định: không request ghi (POST/PUT/PATCH/DELETE trừ login flow đã khai báo), k6 chỉ `smoke` không cần duyệt, mọi profile khác cần duyệt và ≤ `max_perf_rps`, **ZAP active/API/full scan bị cấm tuyệt đối**, crawler không submit form | Policy mặc định do seed tạo; Admin nới được trừ lệnh cấm ZAP active |
| Duyệt (four-eyes): k6 khác `smoke`, ZAP chủ động, bất kỳ job nào vượt mặc định policy | `execution_approvals`; người duyệt có quyền QA Lead+, **khác người yêu cầu** |
| Approval gắn `config_digest` = SHA-256 của cấu hình chuẩn hóa (target, profile, stages, rate_scale, items, thời lượng). Cấu hình đổi → digest khác → duyệt lại. Approval hết hạn sau 24 h | Worker so digest trước khi chạy |
| Giới hạn cứng toàn hệ thống (ghi trong code, không cấu hình qua UI): `rate_scale ≤ 20`, k6 ≤ 2.000 req/s, ≤ 2 giờ; crawler ≤ 2.000 trang; mỗi job ≤ 4 giờ | Worker |
| Mỗi host đích: tối đa 1 job hiệu năng và 2 job browser đồng thời (BullMQ group theo host) | Queue |
| Nút "Dừng khẩn cấp" cho Admin: hủy mọi job đang chạy tới một host | API `POST /admin/targets/:id/stop-all` → cancel |

### 7.1. Recorder: trình duyệt từ xa (D-27)

Recorder là Chromium chạy trong worker-browser, người dùng điều khiển qua WebSocket (chi tiết [06](06-execution-engine.md) mục 10.1). Không có extension, không có token cá nhân.

| Rủi ro | Biện pháp |
|---|---|
| Người khác chiếm phiên | WebSocket `GET /recorder/sessions/:id/ws` xác thực bằng cookie phiên đăng nhập; kiểm `Origin` trùng origin của Hub (chặn cross-site WebSocket hijacking); phiên gắn với đúng `user_id` tạo nó, người khác (kể cả Admin) không kết nối được. Đăng xuất hoặc bị thu hồi phiên → đóng WebSocket ngay |
| Lạm dụng luồng nhập | Rate limit 60 sự kiện/giây/phiên; chỉ nhận đúng các loại sự kiện chuột/bàn phím/cuộn/dán theo schema Zod; sự kiện sai schema bị bỏ |
| Dùng Recorder để duyệt web tùy ý (proxy trá hình) | URL bắt đầu và mọi điều hướng phải khớp `target_hosts` của môi trường project; đi qua cùng SSRF guard + egress proxy (mục 6) và công tắc test (mục 7) như mọi runner; điều hướng ra host khác bị chặn và báo |
| Lộ dữ liệu qua hình ảnh | Khung hình screencast chỉ truyền trực tiếp, **không lưu** ở Redis/MinIO (pub/sub không giữ lại). Chỉ lưu ảnh chụp của từng bước, đã che (`mask`) ô mật khẩu/thẻ/OTP |
| Ghi nhầm mật khẩu, dữ liệu cá nhân | Ô `type=password`, `autocomplete` dạng `cc-*`/`one-time-code`, hoặc name/id khớp mẫu nhạy cảm: giá trị gõ vào không bao giờ ghi vào bước, thay bằng `{{secret.<tên>}}`. `redact()` chạy ở worker và lại ở server; server từ chối bước chứa chuỗi trùng secret đã lưu |
| Rò rỉ giữa các phiên / dùng cookie thật của người dùng | Mỗi phiên một profile Chromium **mới trong tmpfs**, xóa khi phiên đóng; không chạm trình duyệt hay cookie thật trên máy người dùng |
| Phiên treo chiếm tài nguyên | Rảnh 10 phút hoặc quá 30 phút → worker đóng trình duyệt, kill process group; mỗi user 1 phiên; giới hạn CPU/RAM như runner browser (mục 8) |
| Truy vết | Audit `recorder.session_start`, `recorder.session_end` (user, project, môi trường, URL bắt đầu, số bước) |

### 7.2. AI Explorer (D-29)

| Quy tắc | Thực thi ở đâu |
|---|---|
| Mặc định **chỉ đọc**: chỉ điều hướng, click link/nút không phải submit, mở menu/tab; không gửi form, không gửi request ghi | Runner chặn hành động trước khi thực hiện + egress proxy chặn method ghi theo `runJobId` |
| Ghi dữ liệu (gửi form) chỉ khi `allowWrites=true`, chỉ ở `kind=LOCAL\|DEV`, người bật cần QA Lead; **không bao giờ** ở `PRODUCTION` (cũng không ở `STAGING` trừ khi Admin nới policy) | API (`403 POLICY_VIOLATION`) + worker kiểm lại |
| Danh sách hành động cấm dù được ghi: link/nút có nhãn hoặc URL dạng xóa, hủy, thanh toán, đăng xuất, đổi mật khẩu, gửi email/tin nhắn | Danh sách từ khóa vi/en trong runner, cấu hình thêm theo project |
| Ngân sách: `maxSteps ≤ 200`, `maxMinutes ≤ 30`, giới hạn token theo `monthly_token_budget` | Worker; hết ngân sách → dừng, giữ kết quả đã có |
| Mọi request đi qua net-guard + egress proxy như runner khác; chỉ trong host của môi trường đang test | Mục 6 |
| Nội dung trang gửi cho AI đã qua `redact()`; giá trị ô nhập từ `{{secret.*}}` không bao giờ xuất hiện trong prompt; văn bản trên trang là **dữ liệu**, không phải chỉ thị (chống prompt injection: AI chỉ được trả về một hành động thuộc danh sách DSL cho phép) | Worker, schema Zod của hành động |
| Luồng đề xuất phải chạy lại thành công bằng runner DSL thường trước khi thành test case `DRAFT` | Worker |

## 8. Sandbox worker

| Biện pháp | Thiết lập |
|---|---|
| User | Chạy non-root (UID 10001); Playwright image dùng user `pwuser` |
| Filesystem | `read_only: true`; thư mục làm việc `tmpfs` (`/work`, giới hạn 2 GB), xóa sau mỗi job; không mount thư mục host; **không** mount Docker socket |
| Kernel | `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, seccomp mặc định của Docker. Chromium giữ sandbox của nó (dùng seccomp profile do Playwright cung cấp), **không** chạy `--no-sandbox` |
| Tài nguyên | `cpus`, `mem_limit`, `pids_limit` theo service (xem [13](13-deployment-operations.md) mục 2); mỗi tiến trình con (k6, chromium) có timeout và bị kill cả process group khi hết giờ |
| Mạng | Network `internal`, chỉ ra ngoài qua `egress-proxy` (mục 6.2) |
| Code | Worker chỉ chạy runner trong registry; DSL được diễn dịch, không `eval`. Không có tính năng "chạy script tùy ý" cho tới Phase 9 (và khi đó dùng sandbox riêng, ví dụ gVisor) |
| Credential của worker | Mỗi loại worker có user DB riêng với quyền tối thiểu (worker-browser, worker-k6, worker-security **không** có quyền DB; gửi kết quả qua worker-core bằng queue `results.ingest`), MinIO access key chỉ ghi vào prefix `org/` |

## 9. Artifact và HTML của bên thứ ba

- k6 dashboard, báo cáo Lighthouse, ZAP là HTML có script. Phục vụ từ **origin riêng** (`ARTIFACT_PUBLIC_ORIGIN`, vd. `https://artifacts.qa-hub.company.vn`), không chia sẻ cookie với app.
- Header khi trả HTML: `Content-Security-Policy: sandbox allow-scripts; default-src 'self' 'unsafe-inline' data:; connect-src 'none'`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-site`.
- App nhúng bằng `<iframe sandbox="allow-scripts">` (không `allow-same-origin`).
- Upload của người dùng: kiểm kích thước (mặc định ≤ 50 MB, video ≤ 200 MB), kiểm magic bytes khớp `mime_type`, chỉ cho danh sách loại được phép (ảnh, video, pdf, txt, json, xml, csv, xlsx, har, zip trace). File SVG/HTML do người dùng tải lên luôn trả `Content-Disposition: attachment`.

## 10. Bảo mật ứng dụng web của Hub

| Hạng mục | Thiết lập |
|---|---|
| Header | `helmet`: CSP chặt (`default-src 'self'; script-src 'self'; frame-src <artifact-origin>; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`), HSTS 1 năm, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` tối thiểu |
| CORS | Chỉ origin của web app; không `*` |
| Input | Zod ở biên API (cùng schema với frontend), giới hạn body 1 MB (trừ upload qua presign), giới hạn độ dài chuỗi, `strip` field lạ |
| SQL | Chỉ qua Drizzle query builder / tham số hóa; cấm nối chuỗi SQL (lint rule) |
| Output | React tự escape; cấm `dangerouslySetInnerHTML` trừ markdown đã qua sanitizer (DOMPurify) cho mô tả test case/finding |
| Xuất CSV/XLSX | Ô bắt đầu bằng `= + - @ \t \r` được thêm tiền tố `'` để chống formula injection |
| Link chia sẻ (chỉ kiểu Máy chủ, D-32) | Token 256-bit, lưu hash, có hạn, thu hồi được, trang có `noindex`, không chứa email/tên người dùng (thay bằng vai trò) |
| Lỗi | Không trả stack trace, câu SQL, đường dẫn file; chi tiết chỉ nằm ở log kèm `requestId` |
| Phụ thuộc | Lockfile, Renovate, `pnpm audit` + quét image trong CI (mục 13) |

## 11. Audit log

Bắt buộc ghi (bảng `audit_logs`, chỉ thêm, phân vùng theo tháng, giữ ≥ 1 năm):

| Nhóm | Hành động |
|---|---|
| Auth | `auth.login`, `auth.login_failed`, `auth.locked`, `auth.refresh_reuse`, `auth.password_changed`, `auth.2fa_*`, `auth.logout_all`, `auth.password_reset_cli` |
| Thành viên | `member.invite`, `member.role_change`, `member.remove`, `service_account.create/rotate/revoke` |
| Cấu hình nhạy cảm | `secret.create/update/delete`, `secret.read_by_worker`, `target.create/verify/approve/expire/delete`, `policy.update`, `ai_provider.update` |
| Thực thi | `run.create`, `run.cancel`, `approval.request/approve/reject`, `admin.requeue`, `admin.stop_all`, run tới môi trường production (ghi thêm cấu hình), `ai_explorer.start` (kèm `allowWrites`) |
| Công tắc và mạng | `testing.switch`, `environment.testing_toggle`, `org.local_network_update`, `schedule.skipped_disabled`, `ai.production_data_enabled`, `ai.settings_update` |
| Recorder | `recorder.session_start`, `recorder.session_end`, `recorder.case_created` |
| Kết quả | `result.failure_category_change`, `finding.status_change`, `finding.accepted_risk`, `gate.sign_off`, `gate.override` |
| Dữ liệu ra ngoài | `report.export`, `report.share_create/revoke`, `audit.export`, `ai.request` (loại, provider, không lưu prompt) |

Metadata gồm: actor (user hoặc SA), IP, user agent, `requestId`, giá trị trước/sau với thay đổi cấu hình (đã bỏ secret). User DB của ứng dụng chỉ có quyền `INSERT, SELECT` trên `audit_logs`.

## 12. Lưu giữ dữ liệu và quyền riêng tư

- Response body, screenshot, video, HAR có thể chứa **dữ liệu cá nhân** của người dùng thật (nhất là khi test production). Mặc định: không lưu response body cho môi trường production (chỉ status, header đã redact, kích thước); video tắt cho production.
- Retention mặc định (cấu hình được theo org): log thô 30 ngày, artifact 90 ngày (artifact gắn finding đang mở giữ đến khi đóng + 30 ngày), kết quả chuẩn hóa vĩnh viễn, audit ≥ 1 năm, AI `output` 180 ngày.
- Job dọn dẹp hằng đêm: xóa object MinIO theo `retain_until`, drop partition log cũ, ghi số lượng đã xóa vào log hệ thống.
- Xóa user: ẩn danh hóa (`display_name = "Người dùng đã xóa"`, xóa email) nhưng giữ id trong lịch sử kết quả và audit để bảo toàn truy vết.
- AI provider bên ngoài: chỉ bật sau khi Admin xác nhận điều khoản xử lý dữ liệu; có tùy chọn provider local (Ollama/vLLM) để dữ liệu không rời mạng công ty.

## 13. Kiểm thử bảo mật cho chính Hub

| Việc | Khi nào |
|---|---|
| Permission matrix test (mục 2) | Mỗi PR |
| Unit test `net-guard` với bộ IP/URL tấn công: `http://169.254.169.254`, `http://[::ffff:127.0.0.1]`, `http://0x7f000001`, `http://127.1`, DNS trả cả IP công khai lẫn nội bộ, redirect sang `localhost`, `http://user@evil@host` | Mỗi PR |
| Test redaction: secret xuất hiện trong header, body, URL, lỗi, log k6 → không còn trong dữ liệu lưu | Mỗi PR |
| `pnpm audit --prod`, quét image (Trivy) mức HIGH/CRITICAL fail build | Mỗi PR + hằng đêm |
| Secret scanning (gitleaks) trên repo | Mỗi PR (pre-commit + CI) |
| Semgrep/ESLint security rules | Mỗi PR |
| **Dùng chính Hub**: ZAP baseline + Quick Scan vào Hub staging | Hằng tuần (schedule) |
| ZAP full scan vào Hub staging, review thủ công kết quả | Trước mỗi release |
| Pentest nội bộ / bên ngoài | Trước v1.0, sau đó hằng năm |
