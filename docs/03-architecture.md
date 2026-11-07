# 03. Kiến trúc hệ thống

- Người đọc: Tech Lead, developer
- Liên quan: [04-database-schema.md](04-database-schema.md), [06-execution-engine.md](06-execution-engine.md), [09-security-model.md](09-security-model.md), [13-deployment-operations.md](13-deployment-operations.md)

---

## 1. Quyết định kiến trúc chính

| # | Quyết định | Lý do | Phương án đã loại |
|---|---|---|---|
| A1 | **Modular monolith** (1 API NestJS) + **worker tách riêng** theo loại runner | Team nhỏ; tách worker để chạy công cụ nặng (trình duyệt, k6, ZAP) cô lập và scale riêng | Microservices: quá sớm |
| A2 | Một hàng đợi BullMQ **cho mỗi loại runner**, worker image riêng cho từng nhóm công cụ | Image Playwright ~2 GB, k6 ~60 MB, ZAP ~1.5 GB; không gộp vào một image | Một worker chung: image khổng lồ, khó giới hạn tài nguyên |
| A3 | **PostgreSQL** là nguồn sự thật duy nhất; Redis chỉ cho queue, pub/sub, rate limit, cache | Không mất dữ liệu nếu Redis mất | Lưu trạng thái job chỉ trong Redis |
| A4 | Artifact lưu **S3-compatible (MinIO)** ở mọi môi trường, kể cả dev | Một đường code duy nhất; không có nhánh "local storage" | Local disk ở dev: khác prod, dễ lỗi khi deploy |
| A5 | Tiến độ realtime bằng **SSE** qua Redis pub/sub | Một chiều server → client là đủ; đơn giản hơn WebSocket | WebSocket |
| A6 | Dashboard đọc **bảng tổng hợp** (`daily_result_stats`, `quality_scores`) cập nhật khi run kết thúc | Đạt p95 < 2 s mà không cần OLAP | Query trực tiếp bảng kết quả thô; ClickHouse (để sau nếu cần) |
| A7 | Test UI tự động dùng **DSL JSON** do runner diễn dịch, không chạy script người dùng viết | An toàn (không chạy code tùy ý), AI sinh được, người không code sửa được | Lưu và chạy file Playwright `.ts`: cần sandbox chặt hơn nhiều (để Phase 9, tùy chọn) |
| A8 | Hiệu năng **dùng lại API request** của module API Testing | Không khai báo endpoint hai lần (thay cho `endpoints.json` của `k6-perf`) | Cấu hình hiệu năng riêng |
| A9 | Triển khai **single-tenant cho công ty** nhưng giữ `organization_id` ở mọi bảng | Dùng nội bộ, nhưng không khóa đường mở rộng | Bỏ organization: khó thêm lại |
| A10 | Shared types + Zod schema ở `packages/`, frontend **không** import schema DB | Theo spec 1.0 mục 16 | Dùng type Drizzle ở frontend |
| A11 | **Local-first, 2 kiểu cài từ cùng một Docker Compose**: *Cá nhân* (trên máy dev, `localhost` của target được đổi thành `host.docker.internal`) là **kiểu mặc định, làm trước** (D-32); *Máy chủ nội bộ* (target là IP LAN) bổ sung ở Phase 8 | Website được test chạy ở local trước (D-23); người dùng chọn kiểu Cá nhân | Bắt buộc deploy server trung tâm: không test được localhost |
| A12 | **Recorder là trình duyệt từ xa trong Hub**: worker-browser chạy Chromium, truyền hình ảnh bằng CDP screencast, nhận chuột/bàn phím qua **WebSocket** (ngoại lệ duy nhất của A5, vì cần hai chiều); script ghi gắn vào trang sinh bước DSL | Team không cài được extension (D-27 sửa lại); không phải cài gì; cùng engine với runner nên chạy lại ổn định | Extension Chrome/Edge: không cài được trong công ty |
| A13 | **AI mặc định Gemini** qua adapter; provider/model đọc từ `ai_provider_configs` lúc chạy | Đổi model không cần deploy (D-25) | Gắn cứng một SDK |
| A14 | **Phân tích lỗi bằng AI chạy tự động** sau collector, dạng job queue `ai` riêng, gom theo chữ ký lỗi | Có nguyên nhân ngay trong lúc test mà không làm chậm runner (D-26) | Phân tích trong runner: chậm job, tốn token khi lỗi lặp |

## 2. Sơ đồ

```text
                         ┌──────────────────────────────┐
  Người dùng (browser) ─►│  web: React + Vite (nginx)   │
                         └──────────────┬───────────────┘
                                        │ REST /api/v1 + SSE
  CI / service account ────────────────►│
  Recorder (trong web app) ◄══ WebSocket ══► /recorder/sessions/:id/ws ◄─ Redis ─► worker-browser (Chromium)
                         ┌──────────────▼───────────────┐
                         │  api: NestJS (modular)        │
                         │  auth · rbac · projects ·     │
                         │  test-mgmt · runs · reports · │
                         │  ai · imports · audit         │
                         └───┬──────────┬───────────┬────┘
                             │          │           │
                     PostgreSQL     Redis (BullMQ,   MinIO (S3)
                             ▲      pub/sub, limiter) ▲
                             │          │             │
        ┌────────────────────┴──────────┴─────────────┴──────────────┐
        │                         Workers                            │
        │ worker-core     : orchestrator, api-runner, import, report │
        │                   export (CSV/XLSX), ai, scheduler         │
        │ worker-browser  : playwright-runner, recorder, discovery,   │
        │                   ai-explorer,                              │
        │                   audit (Lighthouse, axe, links), visual,   │
        │                   PDF                                       │
        │ worker-k6       : perf-runner (k6 binary)                   │
        │ worker-security : zap-runner (điều khiển ZAP daemon)        │
        └───────────────────────────┬────────────────────────────────┘
                                    │ chỉ ra ngoài qua egress proxy
                         ┌──────────▼───────────┐
                         │ egress-proxy (allow-  │──► Website / API được test
                         │ list + chặn SSRF)     │
                         └──────────────────────┘
```

Worker **không** gọi trực tiếp ra ngoài: mọi traffic tới hệ thống được test đi qua `egress-proxy`, nơi kiểm tra allowlist và chặn IP nội bộ chưa được phép (chi tiết ở [09-security-model.md](09-security-model.md) mục 4). Đây là lớp chặn thứ hai, sau bước kiểm tra trong code.

## 3. Công nghệ

| Thành phần | Chọn | Ghi chú |
|---|---|---|
| Runtime | Node.js 24 LTS | Máy dev đã có Node 24 |
| Monorepo | pnpm workspace + Turborepo (chỉ để cache build/test) | |
| Frontend | React 19, Vite, TypeScript strict | |
| UI | Tailwind CSS 4 + shadcn/ui, icon lucide | |
| Biểu đồ | Recharts (qua shadcn charts) | Thay Chart.js của `k6-perf` để đồng bộ với shadcn |
| Routing / state | React Router, Redux Toolkit + RTK Query | Theo spec 1.0 |
| Form | React Hook Form + Zod | Zod schema dùng chung với API ở `packages/validation` |
| i18n | i18next (`vi` mặc định, `en`) | |
| Backend | NestJS 11 | |
| ORM | Drizzle ORM + drizzle-kit migration | |
| DB | PostgreSQL 17 | |
| Queue | Redis 7 + BullMQ 5 | |
| Auth | Argon2id, JWT access 15 phút + refresh token httpOnly cookie (xoay vòng) | OIDC ở Phase 8 |
| API docs | `@nestjs/swagger` sinh OpenAPI từ DTO | |
| Browser | Playwright (Chromium, Firefox, WebKit) | |
| Audit trang | Lighthouse (Node API), axe-core (`@axe-core/playwright`) | |
| Hiệu năng | k6 v2.x | Đang dùng v2.3.0 trong `k6-perf/bin` |
| Bảo mật | OWASP ZAP (daemon, điều khiển qua API) | |
| Report import | `fast-xml-parser` cho JUnit XML | |
| Xuất file | CSV tự viết, XLSX bằng `exceljs`, PDF bằng Playwright `page.pdf()` từ trang báo cáo HTML | Không thêm thư viện PDF riêng |
| AI | Provider adapter, **mặc định Gemini** (`@google/genai`); thêm OpenAI, Anthropic Claude, OpenAI-compatible local (Ollama/vLLM) | Model chọn theo mục đích trong Settings → AI |
| Recorder | Playwright + CDP `Page.startScreencast` (ảnh) và `Input.*` (chuột/bàn phím); WebSocket qua `@nestjs/websockets` (`ws`); script ghi ở `packages/test-dsl/recorder` | Không cần cài gì phía người dùng |
| Sơ đồ luồng | React Flow (`@xyflow/react`) + bố cục tự động `elkjs` | |
| Log | pino (JSON), OpenTelemetry trace (tùy chọn) | |
| Test | Vitest (unit), Supertest + Testcontainers (integration), Playwright (E2E của chính Hub) | |
| Deploy | Docker Compose (một server); có thể chuyển Kubernetes sau | |

Phiên bản chính xác ghim trong lockfile; nâng cấp có chủ đích, không dùng `latest` trong Dockerfile.

## 4. Cấu trúc repository

```text
qa-testing-hub/
├── apps/
│   ├── web/                     React app
│   │   └── src/{app,features/<module>,components,lib,i18n}
│   ├── api/                     NestJS
│   │   └── src/{modules/<module>,common,db,config}
│   └── worker/                  Một codebase, nhiều entrypoint
│       └── src/
│           ├── main-core.ts     orchestrator, api, import, report, ai, scheduler
│           ├── main-browser.ts  playwright, discovery, audit, visual, pdf
│           ├── main-k6.ts       perf
│           ├── main-security.ts zap
│           └── runners/<runner>/
├── packages/
│   ├── shared-types/            enum trạng thái, DTO dùng chung
│   ├── validation/              Zod schema (DSL, assertion, filter...)
│   ├── runner-contracts/        TestRunner, RunnerResult, ExecutionContext
│   ├── report-normalizers/      JUnit, k6 summary, Lighthouse, axe, ZAP → mô hình chuẩn
│   ├── scoring/                 công thức chỉ số sức khỏe (pure, có unit test)
│   └── test-dsl/                định nghĩa + validator + chuyển DSL ↔ lời mô tả bước
├── infrastructure/
│   ├── docker/                  Dockerfile cho web, api, worker-*, egress-proxy
│   └── scripts/                 backup, restore, seed, import-k6-perf
├── legacy/k6-perf/              tool cũ, giữ đến khi đạt parity (xem 11-k6-migration.md)
├── docs/
├── docker-compose.yml
├── docker-compose.dev.yml
└── pnpm-workspace.yaml
```

## 5. Module backend

Mỗi module: `controller` (HTTP, DTO) → `service` (nghiệp vụ, kiểm quyền) → `repository` (Drizzle). Controller không chứa logic; service không biết HTTP.

| Module | Trách nhiệm | Phase |
|---|---|---|
| `auth` | Đăng nhập, refresh, logout, đổi mật khẩu, OIDC | 1 |
| `users`, `organizations`, `memberships` | Người dùng, tổ chức, role | 1 |
| `service-accounts` | Token CI, scope | 1 |
| `projects`, `environments` | Dự án, môi trường (`kind`), biến, công tắc bật/tắt test (cấp môi trường + cấp tổ chức) | 1 |
| `targets` | Allowlist host, xác minh domain | 1 |
| `secrets` | Vault mã hóa; chỉ worker giải mã được | 1 |
| `audit` | Ghi audit log (interceptor + gọi tường minh) | 1 |
| `test-plans`, `test-suites`, `test-cases` | Định nghĩa test, phiên bản | 2 |
| `test-runs` | Tạo run, item, attempt, kết quả, cancel, retry | 2–3 |
| `manual-execution` | Phiên chạy thủ công | 2 |
| `findings` | Finding, fingerprint, link ngoài | 2 |
| `artifacts` | Upload/download qua presigned URL | 2 |
| `api-testing` | Collection, request, assertion, import OpenAPI/Postman | 3 |
| `execution` | Enqueue job, approval, execution policy, SSE progress | 3 |
| `performance` | Scenario, profile, SLO | 4 |
| `discovery` | Discovery run, site map, endpoint quan sát, **sơ đồ luồng** (`site_transitions`) + độ phủ luồng | 5 |
| `recorder` | Phiên ghi luồng (trình duyệt từ xa): tạo phiên, chuyển tiếp WebSocket ↔ Redis ↔ worker, kết thúc → test case `DRAFT` | 5 |
| `generators` | Sinh test case theo luật | 5 |
| `quick-scan` | Preset chạy nhanh | 5 |
| `security-testing` | Cấu hình ZAP, scope | 8 |
| `visual` | Baseline ảnh | 8 |
| `dashboards`, `reports`, `scoring` | Thống kê, chỉ số sức khỏe, xuất file, link chia sẻ | 6 |
| `quality-gates` | Gate, đánh giá, sign-off | 6 |
| `ai` | Provider (Gemini mặc định), lọc dữ liệu nhạy cảm, **phân tích lỗi tự động** (Phase 4); sinh test, AI Explorer, tóm tắt báo cáo (Phase 7); feedback | 4 / 7 |
| `imports` | JUnit, generic JSON | 7 |
| `ci` | Endpoint cho CI | 7 |
| `schedules`, `notifications` | Cron, kênh thông báo | 8 |

## 6. Luồng dữ liệu một lần chạy

```text
POST /test-runs {planId, environmentId}
  │ api: kiểm quyền → kiểm công tắc test (tổ chức + môi trường) → kiểm target allowlist → kiểm execution policy
  │      → transaction: test_run + test_run_items + run_jobs (mỗi runner 1 job)
  │      → job cần duyệt: run_jobs.status = WAITING_APPROVAL
  │      → enqueue các job còn lại (jobId = run_job.id, idempotent)
  ▼
worker-core (dispatcher, job run.orchestrate)
  │ 1. Đọc lại run_job từ DB, kiểm lại scope + target + policy (không tin payload queue)
  │ 2. Giải mã secret cần thiết, niêm phong bằng JOB_PAYLOAD_KEY vào payload
  │ 3. Enqueue vào queue của runner (jobId = run_job.id)
  ▼
worker runner (browser / k6 / security / api) — KHÔNG có quyền DB
  │ 4. BullMQ lock là lease; phát heartbeat + progress/log qua Redis pub/sub
  │    → worker-core đặt status=RUNNING, lease_until=now()+60s khi nhận heartbeat
  │ 5. runner.execute(context, config); upload artifact thẳng vào MinIO
  │ 6. normalizer → RunnerResult chuẩn → đẩy vào queue results.ingest
  ▼
worker-core (collector, job results.ingest)
  │ 7. Transaction: test_attempts + test_results + logs + artifacts metadata + findings
  │ 8. run_jobs.status = COMPLETED/ERROR ; nếu là job cuối → hoàn tất run
  │ 9. Item FAILED/ERROR → tính chữ ký lỗi; đã có phân tích cùng chữ ký trong run thì dùng lại,
  │    chưa có thì enqueue job `ai` (giới hạn số phân tích/run) → publish `analysis.ready` qua SSE
  ▼
run hoàn tất
  │ cập nhật daily_result_stats, test_case_stats (flaky), quality_scores
  │ đánh giá quality gate (nếu plan có gate)
  │ phát event run.completed → notifications, SSE
```

**Worker chết:** job `RUNNING` có `lease_until < now()` bị một tác vụ quét mỗi phút đưa về `QUEUED` (tối đa `max_attempts` lần, mặc định 2), quá số lần thì `ERROR` với `error_code = WORKER_LOST`.

**Idempotency:** `run_jobs.id` là `jobId` của BullMQ; ghi kết quả dùng unique `(run_item_id, attempt_number)` nên nhận trùng message không tạo bản ghi trùng.

**Cancel:** API đặt `run_jobs.cancel_requested = true` và publish `cancel:<runJobId>`; worker gọi `runner.cancel()` (k6: PATCH REST API như `k6-perf` đang làm; Playwright: đóng browser context; ZAP: stop scan).

## 7. Realtime

- Kênh Redis: `run:<runId>` (tiến độ, trạng thái), `runjob:<runJobId>:log` (log).
- `GET /test-runs/:id/events` (SSE): khi kết nối, gửi trạng thái hiện tại từ DB, rồi chuyển tiếp message pub/sub. Client mất kết nối thì tự nối lại với `Last-Event-ID`.
- Log được gom 500 ms/lần trước khi publish để không quá tải trình duyệt.
- **Ngoại lệ: Recorder** dùng WebSocket `GET /recorder/sessions/:id/ws` (cookie auth + kiểm `Origin`). API chuyển tiếp hai chiều qua Redis: kênh `rec:<id>:frames` (ảnh JPEG, bước vừa ghi) và `rec:<id>:input` (chuột, bàn phím, cuộn, dán). Mỗi người một phiên; ngắt khi không thao tác 10 phút hoặc quá 30 phút.

## 8. Lưu trữ artifact

- Key: `org/<orgId>/project/<projectId>/run/<runId>/<attemptId>/<file>`.
- Upload từ worker thẳng vào MinIO; API chỉ lưu metadata (`artifacts`).
- Download qua presigned URL hết hạn 10 phút; kiểm quyền trước khi cấp URL.
- HTML do công cụ ngoài sinh (k6 dashboard, Lighthouse, ZAP report) mở trong `<iframe sandbox>` từ domain/đường dẫn riêng với header `Content-Security-Policy: sandbox`, không chạy chung origin với app.

## 9. Mở rộng runner mới

1. Tạo `apps/worker/src/runners/<name>/` cài đặt interface `TestRunner` ở `packages/runner-contracts`.
2. Thêm normalizer ở `packages/report-normalizers` (có unit test với file mẫu).
3. Khai báo trong `runner-registry` (tên, queue, image, test type hỗ trợ, có cần duyệt không, giới hạn mặc định).
4. Thêm form cấu hình ở frontend (`features/<name>`), schema Zod ở `packages/validation`.

Không cần sửa orchestrator, dashboard hay báo cáo: chúng chỉ đọc mô hình chuẩn.

## 10. Quan sát hệ thống (observability)

- Mọi log là JSON pino, có `requestId`, `orgId`, `runId`, `runJobId`.
- Health check: `GET /health/live`, `GET /health/ready` (DB, Redis, MinIO), worker ghi heartbeat vào Redis mỗi 15 s.
- Metrics Prometheus (`/metrics`, chỉ mạng nội bộ): số job theo trạng thái, thời gian chờ queue, thời gian chạy theo runner, lỗi theo loại.
- Trang Admin "Tình trạng hệ thống": worker online, độ dài queue, job lỗi gần nhất.
