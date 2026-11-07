# 05. API specification (REST `/api/v1`)

- Người đọc: developer backend, frontend, người tích hợp CI
- Bản này **thay thế** spec 1.0 mục 11. Tên bảng và enum theo [04-database-schema.md](04-database-schema.md).
- Nguồn sự thật khi chạy: OpenAPI sinh từ DTO tại `GET /api/docs` (UI) và `GET /api/docs.json`. Tài liệu này là thiết kế; khi code khác tài liệu thì sửa một trong hai trong cùng PR.

---

## 1. Quy ước chung

| Mục | Quy ước |
|---|---|
| Base path | `/api/v1`. Đổi không tương thích → `/api/v2`, giữ v1 tối thiểu 6 tháng. Thêm field mới không tính là đổi không tương thích; client phải bỏ qua field lạ |
| Định dạng | JSON UTF-8, field `camelCase`, thời gian ISO 8601 UTC (`2026-11-07T03:15:00Z`), id là số nguyên (D-38) |
| Tạo mới | `201` + body là đối tượng vừa tạo. Tác vụ dài (chạy test, import, xuất file) trả `202` + `{ id, status }` để theo dõi |
| Sửa | `PATCH` chỉ gửi field cần đổi. Bản ghi có `version`/`updatedAt` → gửi header `If-Match: <updatedAt>` để chống ghi đè, sai thì `409 CONFLICT` |
| Xóa | Đối tượng định nghĩa (project, suite, case, plan) là **archive** (`POST .../archive`). Kết quả chạy không có endpoint xóa |
| Phân trang | Cursor: `?cursor=<opaque>&limit=50` (mặc định 50, tối đa 100). Response: `{ data: [...], nextCursor: string \| null }`. Không có `total` mặc định; cần thì `?withTotal=true` (chỉ cho danh sách nhỏ) |
| Lọc | Query param phẳng: `?status=FAILED,ERROR&testType=API&createdFrom=2026-11-01&createdTo=2026-11-07&q=login`. Nhiều giá trị cách bằng dấu phẩy. Khoảng thời gian luôn là `xxxFrom`/`xxxTo`, nửa mở `[from, to)` |
| Sắp xếp | `?sort=-createdAt,priority` (dấu `-` là giảm dần). Chỉ cho sắp theo field có index; field khác → `400 VALIDATION_FAILED` |
| Validation | DTO kiểm bằng Zod (schema ở `packages/validation`, dùng chung với frontend). Field lạ bị loại bỏ (`strip`) |
| Idempotency | `POST` tạo run, import, xuất báo cáo, gọi AI: nhận header `Idempotency-Key` (≤ 128 ký tự). Cùng key + cùng user trong 24 giờ → trả lại đúng response lần đầu; cùng key khác body → `409 IDEMPOTENCY_MISMATCH` |
| Request id | Mọi response có header `X-Request-Id`; client gửi lên thì giữ nguyên, không thì server sinh |
| Timezone | Endpoint thống kê nhận `?tz=Asia/Ho_Chi_Minh` (mặc định: timezone của user, rồi của org) |
| Ngôn ngữ | `Accept-Language: vi` / `en` cho thông báo lỗi và văn bản sinh từ template |

### 1.1. Định dạng lỗi

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Dữ liệu không hợp lệ",
    "details": [{ "path": "stages[0].target", "message": "Phải ≤ 200" }],
    "requestId": "01JC8Z3K9W2Q7F0M5N4R6T8V1X"
  }
}
```

| HTTP | `code` | Khi nào |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Body/query sai schema |
| 400 | `INVALID_DSL` | Bước tự động không hợp lệ theo `packages/test-dsl` |
| 401 | `UNAUTHENTICATED` | Thiếu/hết hạn token |
| 401 | `TOKEN_REUSED` | Refresh token đã dùng → cả phiên bị thu hồi |
| 403 | `FORBIDDEN` | Có đăng nhập nhưng thiếu quyền |
| 403 | `TARGET_NOT_ALLOWED` | Host không nằm trong `target_hosts` đã xác minh |
| 403 | `POLICY_VIOLATION` | Vi phạm `execution_policies` (vd. request ghi lên production, vượt `max_perf_rps`) |
| 403 | `TESTING_DISABLED` | Môi trường đang tắt test (`testing_enabled=false`) hoặc công tắc tổng `local_testing_enabled` của org đang tắt (D-24). `details` có `reason`, `toggledBy`, `toggledAt` |
| 403 | `PRODUCTION_TESTING_DISABLED` | Môi trường `kind=PRODUCTION` trong khi `production_testing_enabled=false` (mặc định) |
| 404 | `NOT_FOUND` | Không tồn tại **hoặc** không có quyền thấy (không tiết lộ sự tồn tại của dữ liệu project khác) |
| 409 | `CONFLICT` | Sai `If-Match`, trùng khóa (`case_key`, `project.key`...) |
| 409 | `IDEMPOTENCY_MISMATCH` | Xem 1 |
| 409 | `INVALID_STATE` | Chuyển trạng thái không hợp lệ (vd. cancel run đã `COMPLETED`, duyệt approval đã hết hạn) |
| 409 | `APPROVAL_REQUIRED` | Job cần duyệt (trả kèm `approvalId`) |
| 409 | `RECORDER_BUSY` | User đã có một phiên Recorder đang mở (mỗi user 1 phiên) |
| 410 | `RECORDER_SESSION_EXPIRED` | Phiên Recorder đã hết hạn (rảnh 10 phút hoặc quá 30 phút) hoặc đã đóng |
| 413 | `PAYLOAD_TOO_LARGE` | Vượt giới hạn body/upload |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | File import sai loại |
| 422 | `IMPORT_PARSE_FAILED` | File JUnit/OpenAPI/CSV không đọc được (kèm dòng lỗi trong `details`) |
| 429 | `RATE_LIMITED` | Vượt rate limit (kèm `Retry-After`) |
| 429 | `QUOTA_EXCEEDED` | Vượt quota job đồng thời hoặc ngân sách token AI |
| 500 | `INTERNAL` | Lỗi không lường trước (không trả stack trace) |
| 503 | `DEPENDENCY_UNAVAILABLE` | DB/Redis/MinIO/AI provider không sẵn sàng |

### 1.2. Rate limit (Redis, theo user hoặc service account)

| Nhóm | Giới hạn |
|---|---|
| `POST /auth/login`, `/auth/forgot-password` | 10 / 15 phút / IP + 5 / 15 phút / email |
| API thường | 600 / phút / user |
| Tạo run, discovery, quick scan | 30 / phút / user; 120 / phút / service account |
| AI | 20 / phút / user, thêm ngân sách token theo `ai_provider_configs.monthly_token_budget` |
| `GET /share/:token` (công khai, chỉ kiểu Máy chủ) | 60 / phút / IP |
| Sự kiện nhập qua WebSocket Recorder | 60 sự kiện / giây / phiên (gộp `mousemove`); vượt thì bỏ bớt, không đóng phiên |

Response có `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.

## 2. Xác thực

| Cách | Dùng cho | Chi tiết |
|---|---|---|
| Access token (JWT, 15 phút) | Web app | `Authorization: Bearer <jwt>`. Claim: `sub`, `sid` (session), `iat`, `exp`. **Không** nhét role vào JWT; quyền đọc từ DB/cache mỗi request để đổi role có hiệu lực ngay |
| Refresh token | Web app | Cookie `qah_rt`: `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`. Xoay vòng mỗi lần refresh; dùng lại token cũ → thu hồi cả `family_id` (`401 TOKEN_REUSED`) |
| CSRF | Endpoint dùng cookie (`/auth/refresh`, `/auth/logout`) | Header `X-CSRF-Token` khớp cookie `qah_csrf` (double submit) |
| Service account token | CI, công cụ ngoài | `Authorization: Bearer qah_<prefix>_<secret>`. `prefix` 8 ký tự để tra bản ghi, `secret` so bằng hash (constant-time). Quyền = `scopes` ∩ `project_ids` |
| Link chia sẻ | Người xem báo cáo không có tài khoản | `GET /share/:token`, chỉ đọc đúng một `report_snapshot`. **Chỉ có ở kiểu Máy chủ (Phase 8)**; kiểu Cá nhân chia sẻ bằng file PDF/HTML xuất ra (D-32) |
| WebSocket Recorder | Trình duyệt từ xa của Recorder | `GET /recorder/sessions/:id/ws`: cookie phiên đăng nhập (như SSE), kiểm `Origin` trùng origin của Hub, phiên gắn với đúng user tạo nó |

Scope của service account: `runs:create`, `runs:read`, `results:import`, `gates:read`, `findings:read`, `findings:write`. Service account **không** quản lý thành viên, secret, target, policy.

Header org/project: mọi endpoint con của project nhận `projectId` ở path; endpoint cấp org nhận `X-Organization-Id` (web app gửi org đang chọn). Server luôn kiểm user là thành viên org đó.

## 3. Endpoint

Cột **Quyền**: role tối thiểu theo ma trận ở [01-product-requirements.md](01-product-requirements.md) mục 9 (`Owner > Admin > QA Lead > Tester/Developer > Viewer`). `Member` = mọi thành viên project. `SA:<scope>` = service account có scope đó. Quyền project tính theo `max(org_role, project_role)`.

### 3.1. Auth và tài khoản

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/setup` | Công khai | `{ needsSetup, deploymentMode }`: `needsSetup = true` khi DB chưa có user (màn `/setup`, D-32) |
| POST | `/setup` | Công khai | `{ email, password, displayName, organizationName }` → tạo Owner + tổ chức, trả access token như login. Chỉ chạy được khi chưa có user (`409 INVALID_STATE`); kiểu Cá nhân bật sẵn `localNetwork.allowLoopback` (D-34) |
| POST | `/auth/register` | Công khai | Chỉ bật khi org cho tự đăng ký; mặc định tắt (dùng lời mời). **Chưa làm** ở Phase 1 |
| POST | `/auth/login` | Công khai | Trả access token, set cookie refresh. Sai N lần → khóa tạm |
| POST | `/auth/refresh` | Cookie + CSRF | Xoay vòng refresh token |
| POST | `/auth/logout` | Đăng nhập | Thu hồi session hiện tại |
| POST | `/auth/logout-all` | Đăng nhập | Thu hồi mọi session của user |
| GET | `/auth/me` | Đăng nhập | User + danh sách org và role |
| PATCH | `/auth/me` | Đăng nhập | Tên, avatar, `locale`, `timezone` |
| POST | `/auth/change-password` | Đăng nhập | Thu hồi các session khác |
| POST | `/auth/forgot-password` · `/auth/reset-password` | Công khai | Luôn trả 202 (không lộ email có tồn tại). **Kiểu Máy chủ (Phase 8)**; kiểu Cá nhân đặt lại mật khẩu bằng `pnpm hub:reset-password` (D-32) |
| GET | `/auth/sessions` · DELETE `/auth/sessions/:id` | Đăng nhập | Xem/thu hồi phiên đăng nhập |
| GET | `/auth/oidc/:provider/start` · `/auth/oidc/:provider/callback` | Công khai | SSO, **kiểu Máy chủ (Phase 8)** |
| POST | `/auth/2fa/setup` · `/auth/2fa/verify` · DELETE `/auth/2fa` | Đăng nhập | TOTP, **kiểu Máy chủ (Phase 8)** |

### 3.2. Organization, thành viên, service account

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/organizations` | Đăng nhập | Org mà user là thành viên |
| POST | `/organizations` | Đăng nhập | Bản nội bộ: tắt sau khi tạo org đầu tiên (cấu hình `ALLOW_ORG_CREATE`) |
| GET · PATCH | `/organizations/:id` | Viewer · Admin | Tên, timezone mặc định, `settings` |
| PATCH | `/organizations/:id/testing-switches` | Admin | `{ productionTesting?, localTesting?, reason }` (D-24). `reason` bắt buộc. Tắt khi có run đang chạy trên môi trường bị ảnh hưởng → trả `409 INVALID_STATE` kèm danh sách run, gọi lại với `stopRunning: true` để dừng chúng, hoặc `stopRunning: false` để chỉ chặn run mới. Ghi audit `testing.switch` |
| GET | `/organizations/:id/members` | Viewer | |
| POST | `/organizations/:id/members` | Admin | Thêm trực tiếp (D-35): `{ email, displayName, role }`. Email chưa có tài khoản → tạo user, trả `temporaryPassword` **một lần**; đã có → chỉ thêm membership. Chỉ Owner gán được role `OWNER` |
| PATCH · DELETE | `/organizations/:id/members/:userId` | Admin | Đổi role / xóa. Không xóa/hạ được Owner cuối cùng |
| GET · POST | `/organizations/:id/invitations` | Admin | Mời qua email, token hết hạn 7 ngày. **Kiểu Máy chủ (Phase 8)**; kiểu Cá nhân chỉ có Owner tạo lúc cài |
| DELETE | `/organizations/:id/invitations/:invId` | Admin | Thu hồi lời mời |
| POST | `/invitations/:token/accept` | Công khai / đăng nhập | Tạo tài khoản nếu chưa có |
| GET · POST | `/service-accounts` | Admin | Token bí mật chỉ trả **một lần** trong response tạo |
| PATCH | `/service-accounts/:id` | Admin | Tên, scope, project, hạn |
| POST | `/service-accounts/:id/rotate` | Admin | Tạo token mới, token cũ hết hiệu lực sau `graceMinutes` (mặc định 0) |
| DELETE | `/service-accounts/:id` | Admin | Thu hồi (`revoked_at`) |

### 3.3. Project, môi trường, secret, target, policy

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/projects` | Đăng nhập | Chỉ project user thấy được. Lọc `q`, `archived` |
| POST | `/projects` | Admin | |
| GET · PATCH | `/projects/:projectId` | Member · QA Lead | `settings` gồm trọng số điểm, SLO mặc định, luật sinh test bật/tắt |
| POST | `/projects/:projectId/archive` · `/unarchive` | Admin | |
| POST | `/projects/:projectId/export` | Admin | Phase 8 (D-32): xuất file `.qahub.zip` gồm test case, suite, plan, shared flow, data set, API collection, scenario, môi trường **không kèm secret** (chỉ tên secret), tùy chọn `includeRunHistory`. `202` → artifact tải về |
| POST | `/projects/import` | Admin | Phase 8: nhận file `.qahub.zip` để chuyển dự án từ máy Cá nhân lên Máy chủ. Trùng `key` → `409 CONFLICT` (cho đổi `key`); secret phải nhập lại sau khi import |
| GET · POST | `/projects/:projectId/members` | Member · QA Lead | |
| PATCH · DELETE | `/projects/:projectId/members/:userId` | QA Lead | |
| GET · POST | `/projects/:projectId/environments` | Member · QA Lead | Body có `kind: LOCAL\|DEV\|STAGING\|PRODUCTION`. Tạo môi trường `LOCAL` với URL `localhost`/IP LAN tự kiểm tra host nằm trong dải mạng nội bộ Admin đã bật (D-23); chưa bật → `403 TARGET_NOT_ALLOWED` kèm hướng dẫn |
| GET · PATCH · DELETE | `/environments/:envId` | Member · QA Lead · Admin | Xóa chỉ khi chưa có run; có run thì `isActive=false`. Đổi `kind` sang/khỏi `PRODUCTION` cần Admin |
| PATCH | `/environments/:envId/testing` | QA Lead (Admin nếu `kind=PRODUCTION`) | `{ enabled, reason, stopRunning? }` bật/tắt chạy test cho môi trường (D-24). Tắt → lịch chạy của môi trường tạm dừng; `stopRunning` xử lý như công tắc org. Ghi audit `environment.testing_toggle` |
| GET · PUT | `/environments/:envId/variables` | Member · QA Lead | PUT thay toàn bộ danh sách; biến secret trả `{ key, secretId, masked: true }` |
| GET · POST | `/environments/:envId/credentials` | Member · QA Lead | Tài khoản test theo vai trò; mật khẩu gửi lên được lưu vào `secrets`, không bao giờ trả về |
| PATCH · DELETE | `/environments/:envId/credentials/:id` | QA Lead | |
| GET | `/secrets?projectId=` | QA Lead | Chỉ `id, name, createdAt, lastRotatedAt` |
| POST | `/secrets` | QA Lead (project) / Admin (org) | Body `{ name, value, projectId? }`. **Write-only** |
| PUT | `/secrets/:id` | QA Lead / Admin | Thay giá trị (xoay vòng) |
| DELETE | `/secrets/:id` | Admin | Từ chối nếu đang được tham chiếu (`409 CONFLICT`, kèm danh sách nơi dùng) |
| GET · POST | `/targets` | Member · Admin | Allowlist host. POST trả `verificationToken` + hướng dẫn |
| POST | `/targets/:id/verify` | Admin | Kiểm DNS TXT `qa-hub-verification=<token>` hoặc file `/.well-known/qa-hub-verification.txt` |
| POST | `/targets/:id/approve` | Owner/Admin | `ADMIN_APPROVAL` cho domain nội bộ; bắt buộc `allowedCidrs` nếu `allowPrivateNetwork` |
| PUT | `/organizations/:id/local-network` | Owner/Admin | `{ allowedCidrs[], allowLoopback }`: bật một lần dải mạng nội bộ cho mọi host `LOCAL` (`verification_method=LOCAL_NETWORK`). `allowLoopback` chỉ có hiệu lực ở kiểu cài Cá nhân (`DEPLOYMENT_MODE=personal`); dải metadata cloud luôn bị từ chối |
| DELETE | `/targets/:id` | Admin | |
| GET · PUT | `/execution-policies?environmentId=` | QA Lead · Admin | Mặc định org hoặc riêng môi trường |

### 3.4. Định nghĩa kiểm thử

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET · POST | `/projects/:projectId/test-plans` | Member · QA Lead | POST nhận `templateKey` để tạo từ mẫu |
| GET · PATCH | `/test-plans/:id` | Member · QA Lead | |
| POST | `/test-plans/:id/archive` | QA Lead | |
| GET | `/test-plans/:id/preview` | Member | Danh sách item sẽ chạy (sau khi áp scope + matrix) và job theo runner, chưa tạo run |
| GET · POST | `/projects/:projectId/test-suites` | Member · Tester | GET trả cây (`?flat=true` để trả danh sách) |
| PATCH | `/test-suites/:id` | Tester | Đổi tên, `parentId`, `sortOrder` |
| POST | `/test-suites/:id/archive` | QA Lead | |
| PUT | `/test-suites/:id/cases` | Tester | Gán/sắp xếp case trong suite |
| GET | `/projects/:projectId/test-cases` | Member | Lọc `status, testType, purpose, priority, suiteId, tag, source, automationStatus, q, flaky` |
| POST | `/projects/:projectId/test-cases` | Tester | Kèm `steps[]`; `automation` của bước kiểm bằng DSL validator |
| GET · PATCH | `/test-cases/:id` | Member · Tester | PATCH tạo `test_case_versions` mới |
| POST | `/test-cases/:id/archive` | Tester | |
| GET | `/test-cases/:id/versions` · `/versions/:version` | Member | Lịch sử và snapshot |
| GET | `/test-cases/:id/history` | Member | Kết quả các lần chạy gần nhất + `test_case_stats` |
| POST | `/projects/:projectId/test-cases/bulk` | Tester | `{ action: approve\|reject\|archive\|tag\|untag\|move\|setPriority, ids[], payload }`, tối đa 500 id |
| POST | `/projects/:projectId/test-cases/drafts/approve` | Tester | Duyệt draft theo bộ lọc (vd. mọi draft từ `discoveryRunId`) |
| POST | `/projects/:projectId/test-cases/import` | Tester | multipart CSV/XLSX, `?dryRun=true` trả preview + lỗi từng dòng. `202` |
| GET | `/projects/:projectId/test-cases/export?format=csv\|xlsx` | Member | Theo cùng bộ lọc với danh sách |
| GET | `/projects/:projectId/test-cases/import-template?format=xlsx` | Member | File mẫu |
| GET · POST | `/projects/:projectId/tags` · PATCH · DELETE `/tags/:id` | Member · Tester | |
| GET · POST | `/projects/:projectId/shared-flows` | Member · Tester | |
| GET · PATCH · DELETE | `/shared-flows/:id` | Member · Tester | Xóa bị chặn nếu đang được dùng |
| GET · POST | `/projects/:projectId/data-sets` | Member · Tester | POST nhận JSON hoặc CSV (≤ 5.000 dòng) |
| GET · PATCH · DELETE | `/data-sets/:id` | Member · Tester | |

### 3.5. API testing

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET · POST | `/projects/:projectId/api-collections` | Member · Developer | |
| GET · PATCH · DELETE | `/api-collections/:id` | Member · Developer | |
| POST | `/projects/:projectId/api-collections/import` | Developer | multipart hoặc `{ url }`; `format=openapi\|postman`; `202`, trả số request tạo/cập nhật; `?generateCases=true` sinh draft case |
| GET · POST | `/api-collections/:id/requests` | Member · Developer | |
| GET · PATCH · DELETE | `/api-requests/:id` | Member · Developer | |
| POST | `/api-requests/:id/execute` | Developer, `SA:runs:create` | Chạy thử một request trên `environmentId`; tạo run `AD_HOC` (vẫn qua queue, allowlist, policy). `202` |
| GET | `/api-requests/:id/history` | Member | `api_run_results` gần nhất (đã redact) |

### 3.6. Hiệu năng và bảo mật

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/performance-profiles` | Member | Profile hệ thống + của org |
| POST · PATCH · DELETE | `/performance-profiles[/:id]` | Admin | Không sửa được profile `isSystem` |
| GET · POST | `/projects/:projectId/performance-scenarios` | Member · Developer | |
| GET · PATCH · DELETE | `/performance-scenarios/:id` | Member · Developer | |
| POST | `/performance-scenarios/:id/run` | Developer | Tạo run `PERF`; profile khác `smoke` → job `WAITING_APPROVAL` |
| GET | `/performance-scenarios/:id/compare?runA=&runB=` | Member | Δ p95, Δ tỉ lệ thành công theo item (màn So sánh của `k6-perf`) |
| GET · POST | `/projects/:projectId/security-configs` | Member · QA Lead | |
| GET · PATCH · DELETE | `/security-configs/:id` | Member · QA Lead | |
| POST | `/security-configs/:id/run` | Developer | `ZAP_API`/`ZAP_FULL` → cần duyệt; production + chủ động → `403 POLICY_VIOLATION` |

### 3.7. Discovery, sinh test, Quick Scan

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| POST | `/projects/:projectId/discovery-runs` | Tester | `{ environmentId, startUrls, maxDepth, maxPages, credentialRole? }`. `202`. Crawler (`mode=CRAWLER`) |
| GET | `/projects/:projectId/flow-map` | Member | Sơ đồ luồng (D-28): `{ nodes: [{pageId, path, title, screenshotUrl, requiresAuth}], edges: [{transitionId, from, to, trigger, source, coveredBy: [testCaseId]}], coverage: { covered, total, ratio } }`. Lọc `environmentId`, `onlyUncovered` |
| POST | `/projects/:projectId/flow-map/edges/:transitionId/generate-case` | Tester | Tạo test case `DRAFT` đi qua bước chuyển chưa có test (đường đi ngắn nhất từ trang bắt đầu) |
| POST | `/recorder/sessions` | Tester | Mở Recorder (D-27, trình duyệt từ xa): `{ projectId, environmentId, startUrl, viewport: desktop\|tablet\|mobile, suiteId?, appendToCaseId? }`. Kiểm công tắc test, target allowlist như một run. Mỗi user 1 phiên (`409 RECORDER_BUSY`). `201` → `{ sessionId, wsUrl, expiresAt }` |
| GET | `/recorder/sessions/:id` | Chủ phiên | Trạng thái (`STARTING\|ACTIVE\|FINISHING\|CLOSED`), URL hiện tại, danh sách bước đã ghi (DSL + mô tả + ảnh), cảnh báo locator CSS |
| GET | `/recorder/sessions/:id/ws` | Chủ phiên | **WebSocket** (ngoại lệ duy nhất của quy tắc realtime chỉ dùng SSE): server → client gửi khung hình JPEG + sự kiện `step.recorded`, `page.changed`, `dialog`; client → server gửi sự kiện chuột/bàn phím/cuộn/dán (rate limit). Hết hạn → đóng với mã `RECORDER_SESSION_EXPIRED` |
| POST | `/recorder/sessions/:id/assertions` | Chủ phiên | Thêm bước kiểm tra cho phần tử người dùng chọn: `{ x, y, type: expectVisible\|expectText, text? }` |
| PATCH · DELETE | `/recorder/sessions/:id/steps/:index` | Chủ phiên | Sửa mô tả/biến hoặc xóa bước trước khi lưu |
| POST | `/recorder/sessions/:id/upload` | Chủ phiên | Chọn file cho ô upload đang chờ (artifact `ATTACHMENT`, ≤ 20 MB) → `setInputFiles` |
| POST | `/recorder/sessions/:id/finish` | Chủ phiên | `{ title, verify?: true }` → tạo test case `DRAFT` (`source=RECORDER`) hoặc nối vào `appendToCaseId`, gắn `test_case_transitions`. Bước DSL sai → `400 INVALID_DSL` kèm số bước; server từ chối giá trị trùng secret đã lưu. `verify=true` → chạy lại ngay, trả `runId` |
| DELETE | `/recorder/sessions/:id` | Chủ phiên | Hủy phiên, bỏ các bước chưa lưu |
| POST | `/ai/explore` | Tester (QA Lead nếu `allowWrites`) | Chạy AI Explorer (D-29): `{ projectId, environmentId, goal?, startUrl?, credentialRole?, maxSteps ≤ 200, maxMinutes ≤ 30, allowWrites=false }`. `allowWrites=true` chỉ nhận ở `kind=LOCAL\|DEV`, khác → `403 POLICY_VIOLATION`. Tạo `discovery_runs` `mode=AI_EXPLORER` + run `kind=AI_EXPLORER`. `202`; luồng đã chạy lại xác nhận thành test case `DRAFT` |
| GET | `/projects/:projectId/discovery-runs` · `/discovery-runs/:id` | Member | |
| POST | `/discovery-runs/:id/cancel` | Tester | |
| GET | `/projects/:projectId/site-pages` | Member | Lọc `discoveryRunId`, `hasForms`, `httpStatus` |
| GET | `/site-pages/:id` | Member | Form, lỗi console, request lỗi, screenshot |
| GET | `/projects/:projectId/discovered-endpoints` | Member | |
| POST | `/discovered-endpoints/promote` | Developer | `{ ids[], collectionId }` → tạo `api_requests` |
| GET | `/generators/rules` | Member | Danh sách luật sinh, mô tả, bật/tắt theo project |
| POST | `/projects/:projectId/generators/run` | Tester | `{ discoveryRunId?, collectionId?, rules[]? }` → tạo test case `DRAFT` (chống trùng theo `dedup_key`). `202`, trả số tạo/bỏ qua |
| POST | `/projects/:projectId/quick-scans` | Tester | `{ environmentId, url? }` → discovery giới hạn + audit + ZAP passive + k6 smoke. `202`, trả `runId` |
| GET | `/projects/:projectId/quick-scans` | Member | Danh sách run `kind=QUICK_SCAN` |

### 3.8. Test run, kết quả, manual execution

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| POST | `/projects/:projectId/test-runs` | Tester/Developer, `SA:runs:create` | Theo plan hoặc ad-hoc (`caseIds`, `suiteIds`). Hỗ trợ `Idempotency-Key`. `202` |
| GET | `/projects/:projectId/test-runs` | Member, `SA:runs:read` | Lọc `status, kind, environmentId, branch, buildNumber, executionSource, triggeredBy, createdFrom/To` |
| GET | `/test-runs` | Viewer (org) | Danh sách toàn org theo project user được thấy |
| GET | `/test-runs/:id` | Member | Run + `resultSummary` + jobs + gate evaluation |
| POST | `/test-runs/:id/cancel` | Người trigger, QA Lead | `202`; dừng mọi job trong ≤ 30 s |
| POST | `/test-runs/:id/retry` | Tester/Developer | `{ scope: failed\|errored\|items, itemIds? }` → thêm **attempt mới** cho item, không tạo run mới, không ghi đè |
| POST | `/test-runs/:id/rerun` | Tester/Developer | Tạo run mới cùng cấu hình (`kind=RETEST` nếu từ finding) |
| GET | `/test-runs/:id/events` | Member | **SSE**. Event: `snapshot`, `run.status`, `job.status`, `job.progress`, `item.result`, `analysis.ready` (`{ itemId, testResultId, generationId, category, summary, confidence }`, D-26), `log`, `end`. Hỗ trợ `Last-Event-ID` |
| GET | `/test-runs/:id/jobs` · `/run-jobs/:jobId` | Member | |
| GET | `/test-runs/:id/items` | Member | Lọc `status, testType, browser, viewport, assignedTo` |
| GET | `/run-items/:itemId` | Member | Item + mọi attempt + result + step results |
| GET | `/test-attempts/:id` | Member | Attempt, `api_run_results`, artifacts |
| GET | `/test-runs/:id/results?mode=final\|first\|all` | Member | Theo spec 1.0 mục 8.5; mặc định `final` |
| GET | `/run-jobs/:jobId/logs` | Member | Phân trang theo `ts`; log dài trả link artifact |
| GET | `/run-jobs/:jobId/metrics` | Member | `run_metrics` (k6, Lighthouse) |
| GET | `/test-runs/:id/artifacts` | Member | Metadata; tải bằng presign (3.10) |
| GET | `/test-runs/compare?a=&b=` | Member | Mới fail, mới pass, chậm đi, biến mất |
| PATCH | `/run-items/:itemId` | QA Lead | `assignedToUserId` cho manual |
| POST | `/run-items/:itemId/manual/start` | Người được giao / Tester | Tạo attempt mới `RUNNING`, `executed_by` = user hiện tại |
| PUT | `/test-attempts/:id/steps/:stepOrder` | Người thực hiện attempt | `{ status, actual?, screenshotArtifactId? }` (lưu từng bước, tránh mất dữ liệu) |
| POST | `/test-attempts/:id/complete` | Người thực hiện attempt | `{ status, actualResult?, summary? }`; attempt đã hoàn tất không sửa được |
| PATCH | `/test-results/:id` | QA Lead | Chỉ `failureCategory` (+ `failureCategorySource=HUMAN`); không đổi status |
| GET | `/test-results/:id/analysis` | Member | Phân tích nguyên nhân tự động (D-26): `{ status: PENDING\|COMPLETED\|SKIPPED\|FAILED, skippedReason?, category, likelyCauses[{cause, confidence, evidence[]}], fixSuggestions[], sharedWith: n }`. `SKIPPED` kèm `skippedReason`: `AI_NOT_CONFIGURED`, `BUDGET_EXCEEDED`, `MAX_ANALYSES_REACHED`, `PRODUCTION_DATA_NOT_ALLOWED` (D-33) |

### 3.9. Approval

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/approvals?status=PENDING` | QA Lead | Yêu cầu trong các project mình duyệt được |
| GET | `/approvals/:id` | Member | Cấu hình đầy đủ (đã bỏ secret), target, tải tối đa, thời gian |
| POST | `/approvals/:id/approve` | QA Lead, **khác người yêu cầu** | Lưu `config_digest`; hết hạn sau 24 h nếu chưa chạy |
| POST | `/approvals/:id/reject` | QA Lead | Bắt buộc `note`; job → `CANCELLED` |

### 3.10. Finding và artifact

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/projects/:projectId/findings` · `/findings` (org) | Member · Viewer | Lọc `status, severity, category, source, assignee, ruleId, environmentId, createdFrom/To` |
| POST | `/projects/:projectId/findings` | Tester/Developer, `SA:findings:write` | Kèm `testResultId?`, `artifactIds[]` |
| GET · PATCH | `/findings/:id` | Member · Tester/Developer | PATCH status theo bảng chuyển trạng thái; `ACCEPTED_RISK` cần QA Lead + `note` |
| GET | `/findings/:id/occurrences` | Member | |
| GET · POST | `/findings/:id/comments` | Member | |
| PUT | `/findings/:id/external-issue` | Developer | `{ url, key? }` |
| POST | `/findings/:id/retest` | Tester | Tạo run `RETEST` gồm các item liên quan |
| POST | `/artifacts/presign-upload` | Member | `{ projectId, fileName, mimeType, fileSize, purpose }` → `{ artifactId, uploadUrl, headers }`, hết hạn 10 phút |
| POST | `/artifacts/:id/complete` | Người upload | Server kiểm `checksum`, `mime_type` thật (magic bytes), kích thước |
| GET | `/artifacts/:id/download` | Member | `302` tới presigned URL 10 phút; HTML bên thứ ba trả qua origin riêng (xem [09](09-security-model.md) mục 8) |

### 3.11. Dashboard và báo cáo

Bộ lọc chung (spec 1.0 mục 8.1), áp dụng **giống nhau** cho mọi endpoint dashboard: `projectIds`, `from`, `to`, `tz`, `environmentIds`, `testTypes`, `testLevels`, `branch`, `commitSha`, `buildNumber`, `executionSources`, `executedBy`, `triggeredBy`, `runners`, `resultMode=final|first|all`.

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/dashboards/company` | Viewer | KPI + chuỗi xu hướng (`?granularity=day\|week\|month`) |
| GET | `/dashboards/projects/:projectId` | Member | KPI, health scores, run gần nhất, finding mở, module nhiều lỗi |
| GET | `/dashboards/members/:userId` | Bản thân, QA Lead, Admin | Thống kê hoạt động; không có xếp hạng. **Kiểu Máy chủ (Phase 8)** |
| GET | `/dashboards/test-types` | Viewer | Phân bố theo `test_type` |
| GET | `/projects/:projectId/health?environmentId=&runId=` | Member | 7 dimension: `score` (null = chưa kiểm tra), `coverage`, `confidence`, `inputs` |
| GET · POST | `/dashboards/presets` · DELETE `/dashboards/presets/:id` | Viewer | Bộ lọc đã lưu (per-user, lưu trong `users.settings`) |
| POST | `/reports` | Viewer | `{ reportType, filter, tz }` → `report_snapshot` (số liệu đông cứng tại lúc tạo). `202` |
| GET | `/reports` · `/reports/:id` | Viewer | |
| POST | `/reports/:id/export` | Viewer | `{ format: pdf\|xlsx\|csv\|html }` → `202`, trả artifact khi xong |
| POST | `/reports/:id/shares` | QA Lead | `{ expiresInDays ≤ 90 }` → URL chứa token (chỉ hiện một lần). **Kiểu Máy chủ (Phase 8)**; kiểu Cá nhân trả `403 FORBIDDEN` |
| GET · DELETE | `/reports/:id/shares[/:shareId]` | QA Lead | Thu hồi |
| GET | `/share/:token` | Công khai | Snapshot chỉ-đọc, `noindex`, không chứa email người dùng |

`reportType`: `COMPANY_QUALITY`, `PROJECT_TEST`, `TEST_RUN`, `TEST_TYPE`, `MEMBER_ACTIVITY`, `FINDINGS`, `PERFORMANCE`, `SECURITY`, `RELEASE_SUMMARY`.

### 3.12. Quality gate, lịch, thông báo

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/quality-gates/metrics` | Member | Danh sách `metric` hợp lệ cho `rules` |
| GET · POST | `/projects/:projectId/quality-gates` | Member · QA Lead | |
| GET · PATCH · DELETE | `/quality-gates/:id` | Member · QA Lead | |
| POST | `/quality-gates/:id/evaluate` | Member | `{ runId }` → `gate_evaluation` (tự động chạy khi run có plan gắn gate) |
| GET | `/test-runs/:id/gate` | Member, `SA:gates:read` | |
| POST | `/gate-evaluations/:id/sign-off` | QA Lead | `{ note }`; không sign-off được gate `FAILED` trừ khi `override=true` + note (audit) |
| GET · POST | `/projects/:projectId/schedules` | Member · QA Lead | Kiểm cron hợp lệ, tối thiểu mỗi 15 phút |
| PATCH · DELETE | `/schedules/:id` | QA Lead | |
| POST | `/schedules/:id/run-now` | QA Lead | |
| GET · POST | `/notification-channels` | Admin | Webhook URL/token lưu vào `secrets` |
| PATCH · DELETE | `/notification-channels/:id` | Admin | |
| POST | `/notification-channels/:id/test` | Admin | Gửi tin thử |
| GET · POST | `/notification-rules` · PATCH · DELETE `/notification-rules/:id` | QA Lead | |

### 3.13. AI

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| POST | `/ai/generate-test-cases` | Tester | `{ projectId, sources: { text?, artifactIds?, sitePageIds?, collectionId? }, types[], maxCases ≤ 50 }` → `202`, kết quả thành case `DRAFT` (`source=AI`) |
| POST | `/ai/generate-steps` | Tester | `{ testCaseId }` → đề xuất DSL, chưa ghi vào case |
| POST | `/ai/analyze-failure` | Member | `{ testResultId, force? }` → phân tích lại thủ công (bình thường đã chạy tự động, xem `GET /test-results/:id/analysis`). Không đổi status |
| POST | `/ai/summarize-report` | Viewer | `{ reportId }` → tóm tắt có trích dẫn số liệu nguồn |
| GET | `/ai/generations/:id` | Người yêu cầu, QA Lead | |
| POST | `/ai/feedback` | Đăng nhập | `{ generationId, rating, reasonCode?, feedback? }` |
| GET · PUT | `/settings/ai` | Viewer · Admin | Cấu hình AI của org (D-25): `{ enabled, default: { provider: "gemini", model }, perPurpose: { ANALYSIS?, GENERATION?, SUMMARY?, EXPLORATION? }: { provider, model }, sendProductionData: false, monthlyTokenBudget, maxAnalysesPerRun }`. API key gửi qua `apiKey` (write-only, lưu `secrets`), GET chỉ trả `hasApiKey`. Đổi provider/model có hiệu lực từ lần gọi tiếp theo, không cần deploy |
| POST | `/settings/ai/test` | Admin | `{ provider, model, apiKey? }` gửi một prompt mẫu không chứa dữ liệu dự án → `{ ok, latencyMs, error? }` |
| GET | `/settings/ai/models?provider=` | Admin | Danh sách model provider trả về (để chọn trong dropdown) |
| GET | `/ai/usage?from=&to=` | Admin | Token, chi phí theo user/project |

### 3.14. Import, CI

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| POST | `/projects/:projectId/imports/junit` | Developer, `SA:results:import` | multipart (≤ 50 MB, nhiều file), field `environmentId, branch, commitSha, buildNumber, testType, testLevel`. `202` → run `kind=IMPORT` |
| GET | `/imports/:id` | Member | Trạng thái, số test, lỗi parse |
| POST | `/ci/runs` | `SA:runs:create` | Xem ví dụ 4.2. `wait=true` giữ kết nối tối đa 10 phút; quá thì trả `202` để poll |
| GET | `/ci/runs/:id/status` | `SA:runs:read` | `{ status, resultSummary, gate: { result, ruleResults } }`. Exit code đề xuất cho CLI: `0` PASSED, `1` FAILED, `2` INCONCLUSIVE (`--strict` coi là fail), `3` run lỗi hoặc timeout (theo [07](07-reporting-and-scoring.md)) |
| GET | `/ci/projects/:projectKey/badge.svg?environment=&metric=gate\|passRate` | Token trong query `?t=` (badge token chỉ đọc) | SVG cache 5 phút |

### 3.15. Audit, quản trị

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/audit-logs` | Admin | Lọc `actor, action, entityType, entityId, from, to`. Không có ghi/xóa |
| GET | `/audit-logs/export?format=csv` | Owner | |
| GET | `/admin/system-health` | Admin | Worker online (heartbeat), độ dài queue, job lỗi gần nhất, dung lượng MinIO |
| GET | `/admin/queues` | Admin | Số job theo queue/trạng thái |
| POST | `/admin/run-jobs/:id/requeue` | Admin | Đưa job `ERROR`/kẹt về `QUEUED` (audit) |
| POST | `/admin/targets/:id/stop-all` | Admin | Dừng khẩn cấp mọi job đang chạy tới một host (audit `admin.stop_all`) |
| GET | `/health/live` · `/health/ready` | Công khai (chỉ mạng nội bộ) | Không đi qua `/api/v1` |
| GET | `/metrics` | Mạng nội bộ | Prometheus |

## 4. Ví dụ

### 4.1. Tạo run theo test plan

```http
POST /api/v1/projects/0193a7c2-.../test-runs
Authorization: Bearer eyJhbGciOi...
Idempotency-Key: 6f1d0c8e-run-release-1.4.0
Content-Type: application/json

{
  "testPlanId": "0193a7c5-...",
  "environmentId": "0193a7c3-...",
  "name": "Regression trước release 1.4.0",
  "appVersion": "1.4.0",
  "branch": "release/1.4.0",
  "commitSha": "a1b2c3d",
  "options": { "retryFailed": 1, "matrix": { "browsers": ["chromium", "firefox"], "viewports": ["desktop"] } }
}
```

```http
HTTP/1.1 202 Accepted
Location: /api/v1/test-runs/0193a7d0-...

{
  "id": "0193a7d0-...",
  "status": "RUNNING",
  "kind": "PLAN",
  "executionSource": "WEB",
  "itemsScheduled": 248,
  "jobs": [
    { "id": "0193a7d1-...", "runner": "api",        "status": "QUEUED" },
    { "id": "0193a7d2-...", "runner": "playwright", "status": "QUEUED" },
    { "id": "0193a7d3-...", "runner": "audit",      "status": "QUEUED" },
    { "id": "0193a7d4-...", "runner": "k6",         "status": "WAITING_APPROVAL", "approvalId": "0193a7d5-..." }
  ],
  "eventsUrl": "/api/v1/test-runs/0193a7d0-.../events"
}
```

### 4.2. CI trigger, chờ kết quả gate

```http
POST /api/v1/ci/runs?wait=true
Authorization: Bearer qah_7Kq2mX9p_<secret>
Idempotency-Key: gh-run-8812345-attempt-1

{
  "projectKey": "QSNET",
  "environment": "Staging",
  "testPlan": "Smoke trước deploy",
  "branch": "main",
  "commitSha": "9f8e7d6",
  "buildNumber": "8812345",
  "ciUrl": "https://github.com/acme/qsnet/actions/runs/8812345"
}
```

```http
HTTP/1.1 200 OK

{
  "runId": "0193a8e0-...",
  "status": "COMPLETED",
  "resultSummary": { "PASSED": 41, "FAILED": 2, "ERROR": 0, "SKIPPED": 1 },
  "gate": {
    "result": "FAILED",
    "ruleResults": [
      { "metric": "functional.passRate", "operator": ">=", "value": 98, "actual": 95.35, "passed": false, "mandatory": true },
      { "metric": "findings.open.critical", "operator": "==", "value": 0, "actual": 0, "passed": true, "mandatory": true }
    ]
  },
  "reportUrl": "https://qa-hub.company.vn/runs/0193a8e0-..."
}
```

Nếu run chưa xong trong 10 phút: `202` + `{ runId, status: "RUNNING", statusUrl }`; CI poll `GET /ci/runs/:id/status` mỗi 15 s.

### 4.3. Lỗi: host chưa được xác minh

```http
HTTP/1.1 403 Forbidden

{
  "error": {
    "code": "TARGET_NOT_ALLOWED",
    "message": "Host shop-staging.example.com chưa được xác minh cho dự án này",
    "details": [{ "host": "shop-staging.example.com", "howToFix": "/settings/targets" }],
    "requestId": "01JC9A0B5S7K2D4F6H8J0L2N4P"
  }
}
```
