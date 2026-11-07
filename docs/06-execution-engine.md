# 06. Execution engine, runner và Test DSL

- Người đọc: developer backend/worker
- Liên quan: [03-architecture.md](03-architecture.md) mục 6 (luồng chạy), [04-database-schema.md](04-database-schema.md) mục 7, [02-test-catalog.md](02-test-catalog.md), [09-security-model.md](09-security-model.md), [11-k6-migration.md](11-k6-migration.md)

---

## 1. Runner contract (`packages/runner-contracts`)

Mở rộng interface của spec 1.0 mục 7.1. Runner **không** truy cập DB, không đọc biến môi trường của worker, không gọi mạng trực tiếp: mọi thứ đi qua `ExecutionContext`.

```ts
export interface TestRunner<TConfig = unknown> {
  readonly type: RunnerType;                 // 'api' | 'playwright' | 'k6' | 'audit' | 'zap' | 'visual' | 'discovery' | 'explorer' | 'import'
  readonly version: string;                  // ghi vào test_attempts.runner_version
  validate(config: TConfig): Promise<void>;  // Zod schema; ném ValidationError, không chạy gì
  execute(ctx: ExecutionContext, config: TConfig): Promise<RunnerResult>;
  cancel?(ctx: ExecutionContext): Promise<void>; // ngoài AbortSignal, cho công cụ cần dừng riêng (k6, ZAP)
}

export interface ExecutionContext {
  runId: string; runJobId: string; projectId: string; organizationId: string;
  environment: { id: string; name: string; kind: 'LOCAL' | 'DEV' | 'STAGING' | 'PRODUCTION';
                 webBaseUrl?: string; apiBaseUrl?: string };   // URL đã resolve cho LOCAL (mục 3.0)
  policy: EffectivePolicy;                   // execution_policies đã gộp (org + environment)
  signal: AbortSignal;                       // abort khi cancel hoặc hết timeout
  deadline: Date;
  secrets: { get(name: string): Promise<string> };   // giải mã lazily, tự đăng ký vào redactor
  vars: Record<string, string>;              // environment_variables không bí mật
  redact(text: string): string;              // thay mọi secret đã lấy bằng '••••'
  log: { debug/info/warn/error(msg: string, meta?: object): void };   // đã qua redact
  progress(p: { done: number; total: number; message?: string }): void; // publish run:<runId>
  artifacts: { upload(file: { name: string; kind: ArtifactKind; data: Buffer | Readable; mime: string }): Promise<ArtifactRef> };
  egress: { proxyUrl: string; assertAllowed(url: string): Promise<void> }; // kiểm allowlist + DNS trước khi gọi
  workDir: string;                           // thư mục tạm riêng cho job, xóa khi xong
}

export interface RunnerResult {
  status: 'COMPLETED' | 'ERROR' | 'CANCELLED';   // trạng thái của JOB, không phải của test
  summary: string;
  durationMs: number;
  items: ItemResult[];
  metrics: Metric[];              // → run_metrics
  findings: FindingCandidate[];   // → findings (chống trùng ở collector)
  artifacts: ArtifactRef[];       // artifact cấp job (báo cáo gốc, dashboard k6)
  runner: { name: string; version: string; toolVersion?: string };
  error?: { code: string; message: string };
}

export interface ItemResult {
  runItemId?: string;             // item đã tạo trước (từ test case)
  externalTestId?: string;        // item phát sinh khi chạy (import, endpoint k6, trang Lighthouse)
  name: string; testType: TestType; browser?: string; viewport?: string;
  status: TestStatus;             // PASSED | FAILED | BLOCKED | SKIPPED | ERROR | NOT_APPLICABLE
  durationMs?: number; summary?: string; actual?: string;
  errorCode?: string; errorMessage?: string;
  steps?: StepResult[]; api?: ApiCallResult[]; artifacts?: ArtifactRef[];
  failureCategory?: FailureCategory;   // chỉ khi runner chắc chắn (vd. DNS lỗi → NETWORK_DEPENDENCY)
}

export interface Metric { scope: 'RUN' | 'ITEM' | 'ENDPOINT' | 'PAGE' | 'WINDOW'; scopeRef?: string; key: string; value: number; unit: string; labels?: Record<string, string> }

export interface FindingCandidate {
  ruleId: string;                 // 'zap:10038', 'axe:color-contrast', 'test:<caseId>', 'link:broken'
  target: string;                 // phần đã chuẩn hóa dùng cho fingerprint (mục 11)
  title: string; severity: Severity; category: FindingCategory;
  description?: string; recommendation?: string;
  location: Record<string, unknown>; evidence: Record<string, unknown>;
  runItemId?: string;
}
```

Quy tắc:
- `FAILED` = test chạy xong và kết quả không đạt. `ERROR` = không chạy được đến kết luận (công cụ lỗi, hết giờ, mạng, mục tiêu không phản hồi). Không lẫn hai trạng thái (spec 1.0 mục 6.8).
- Runner phải tôn trọng `ctx.signal`: dừng trong ≤ 30 s, trả `CANCELLED`, item chưa chạy để collector đặt `CANCELLED`.
- Mọi chuỗi ra khỏi runner (log, summary, evidence, request snapshot) đi qua `ctx.redact`. Collector redact thêm một lần trước khi ghi DB.

## 2. Runner registry

| Runner | Queue | Worker image | test_type | Duyệt | CPU / RAM | Timeout mặc định (trần) |
|---|---|---|---|---|---|---|
| `manual` | không (chạy trên web) | – | FUNCTIONAL, USABILITY, EXPLORATORY, ACCESSIBILITY, COMPATIBILITY | Không | – | – |
| `api` | `runner.api` | worker-core | API | Không (ghi trên prod bị chặn) | 0,5 / 512 MB | 10 phút (60) |
| `playwright` | `runner.browser` | worker-browser | FUNCTIONAL, COMPATIBILITY, VISUAL | Không | 2 / 2 GB | 30 phút (120) |
| `visual` | `runner.browser` | worker-browser | VISUAL | Không | 2 / 2 GB | 30 phút (120) |
| `audit` | `runner.browser` | worker-browser | PERFORMANCE (Lighthouse), ACCESSIBILITY, SEO, BEST_PRACTICES, LINK_INTEGRITY, SECURITY (headers/TLS) | Không | 2 / 2 GB | 20 phút (60) |
| `discovery` | `runner.browser` | worker-browser | – (sinh site map + `site_transitions`) | Không | 2 / 2 GB | 15 phút (60) |
| `recorder` | `runner.browser` (tương tác) | worker-browser | – (Recorder: trình duyệt từ xa, sinh case `DRAFT`) | Không | 1 / 1,5 GB | rảnh 10 phút, tối đa 30 phút/phiên |
| `explorer` | `runner.browser` | worker-browser | – (AI Explorer, sinh luồng → case `DRAFT`) | Không (ghi dữ liệu chỉ LOCAL/DEV khi bật cờ) | 2 / 2 GB | 10 phút/luồng (60/job) |
| `k6` | `runner.perf` | worker-k6 | PERFORMANCE, RELIABILITY | Có, trừ `smoke` | 2 / 2 GB | theo profile + 5 phút (trần `max_perf_duration_s`) |
| `zap` | `runner.security` | worker-security + ZAP daemon | SECURITY | `ZAP_API`, `ZAP_FULL` | 2 / 4 GB | 30 phút (240) |
| `import` | `import` | worker-core | UNIT, INTEGRATION, mọi loại khi import | Không | 0,5 / 512 MB | 5 phút |

Ngoài ra queue không phải runner: `run.orchestrate`, `report.export`, `ai`, `scheduler`, `maintenance` (lease recovery, retention).

Concurrency: theo queue (cấu hình worker) **và** theo host đích (BullMQ group key = host, mặc định `max_concurrent_jobs_per_host`: k6 = 1, browser = 2, zap = 1). Riêng `recorder`: tối đa **1 phiên mỗi user**, giữ chỗ riêng trong worker-browser (`WORKER_CONCURRENCY_RECORDER`, mặc định 1 ở kiểu Cá nhân) để phiên tương tác không phải xếp hàng sau job tự động.

## 3. Orchestrator

### 3.0. Công tắc test và môi trường LOCAL

**Công tắc (D-24).** Trước khi tạo run, service `execution` kiểm theo thứ tự; worker-core kiểm **lại** lúc dispatch và worker runner kiểm lần cuối ngay trước khi chạy (công tắc có thể bị tắt trong lúc job chờ queue):

| Điều kiện | Kết quả |
|---|---|
| `environments.kind = PRODUCTION` và `organizations.production_testing_enabled = false` | Từ chối `PRODUCTION_TESTING_DISABLED` (API 403; job đã trong queue → `CANCELLED` với mã này) |
| `environments.kind = LOCAL` và `organizations.local_testing_enabled = false` | Từ chối `TESTING_DISABLED` |
| `environments.testing_enabled = false` | Từ chối `TESTING_DISABLED` |

Lịch chạy trỏ tới môi trường bị tắt được bỏ qua (ghi sự kiện `SCHEDULE_SKIPPED` kèm lý do), không tính là lỗi. Tắt công tắc khi run đang chạy không tự dừng run; người tắt chọn "Dừng ngay" thì API gọi cancel như mục 3.4.

**Môi trường theo `kind`:**

| kind | Chính sách mặc định (`execution_policies` seed) |
|---|---|
| `LOCAL` | Cho phép request ghi, submit form; k6 mọi profile **không cần duyệt**; ZAP active cần duyệt. Giới hạn cứng toàn hệ thống vẫn áp dụng (`rate_scale ≤ 20`, k6 ≤ 2.000 req/s, ≤ 2 giờ) |
| `DEV` | Như LOCAL nhưng k6 khác `smoke` cần duyệt |
| `STAGING` | Ghi được; k6 khác `smoke` và ZAP active cần duyệt |
| `PRODUCTION` | Không ghi, k6 chỉ `smoke` (khác cần duyệt + Admin nới policy), **không bao giờ** ZAP active (D-11) |

**Resolve địa chỉ LOCAL (D-23).** Worker-core resolve `webBaseUrl`/`apiBaseUrl` trước khi dispatch:
- Kiểu cài **Cá nhân** (`DEPLOYMENT_MODE=personal`): host `localhost`, `127.0.0.1`, `[::1]` được đổi thành `host.docker.internal` (giữ cổng, path); header `Host` giữ giá trị gốc để app phân biệt virtual host. Allowlist cho loopback chỉ có hiệu lực ở chế độ này.
- Kiểu cài **Máy chủ nội bộ** (`DEPLOYMENT_MODE=server`): `localhost` của dev **không** tới được → API từ chối khi lưu môi trường `LOCAL` có host loopback, gợi ý dùng IP LAN (vd. `http://192.168.1.50:3000`) và nhắc app phải listen `0.0.0.0`. IP LAN phải nằm trong CIDR của `target_hosts` có `allow_private_network = true`.
- IP metadata cloud (`169.254.169.254`, `fd00:ec2::254`...) luôn bị chặn ở mọi chế độ.
- Test `localhost` của một dev từ Hub trung tâm (local runner agent chạy trên máy dev): Phase 9.

### 3.1. Mở rộng một plan run

`POST /test-runs {planId, environmentId}` → service `execution`:

1. Lấy test case theo `test_plans.scope` (suite, case, type, purpose, tag), chỉ `status = ACTIVE`, bỏ case `quarantined` (ghi `SKIPPED` với lý do) nếu plan không chọn "chạy cả test quarantine".
2. Chia case theo cách chạy:

| Điều kiện | Job | Item |
|---|---|---|
| `test_method = MANUAL` hoặc `automation_status ≠ AUTOMATED` | 1 job `manual` | 1 item/case, `assigned_to_user_id` theo phân công |
| `test_type = API` (có `api_request_id` hoặc bước `apiCall`) | 1 job `api` | 1 item/case |
| Case tự động UI (`FUNCTIONAL`, `COMPATIBILITY`, `VISUAL`) | 1 job `playwright` **mỗi ô ma trận** (browser × viewport) | 1 item/case/ô |
| `PERFORMANCE` qua `performance_scenarios` trong scope | 1 job `k6`/scenario | Item phát sinh khi chạy (1/endpoint) |
| `SECURITY` qua `security_scan_configs` | 1 job `zap` hoặc `audit` | Item phát sinh (1/nhóm kiểm tra) |
| Audit trang (`ACCESSIBILITY`, `SEO`, `BEST_PRACTICES`, `LINK_INTEGRITY`) | 1 job `audit` | Item phát sinh (1/trang × category) |

Ma trận mặc định khi plan không khai báo: `chromium × desktop`.
3. Kiểm execution policy cho từng job (loại test, môi trường, ghi dữ liệu, giới hạn tải). Job vi phạm policy **không tạo**; trả lỗi 422 liệt kê lý do, trừ khi người dùng chọn "bỏ qua phần bị chặn" (khi đó tạo item `NOT_APPLICABLE` có lý do).
4. Transaction: `test_runs` + `run_jobs` + `test_run_items` (snapshot `test_name_snapshot`, `case_version`, `priority_snapshot`).
5. Job cần duyệt → `WAITING_APPROVAL` + `execution_approvals`; job khác → `QUEUED` và enqueue với `jobId = run_jobs.id`.

Job manual không vào queue: item `PENDING` cho đến khi tester ghi kết quả. Run có job manual chỉ `COMPLETED` khi mọi item manual có kết quả cuối hoặc người có quyền bấm "Kết thúc run" (item còn lại → `SKIPPED`, lý do "kết thúc thủ công").

### 3.2. Trạng thái run

`run_status` của `test_runs` tính từ các `run_jobs`:

| Điều kiện (xét theo thứ tự) | Run |
|---|---|
| Có job `RUNNING` | `RUNNING` |
| Có job `QUEUED` | `QUEUED` (hoặc `RUNNING` nếu đã có job xong) |
| Còn job `WAITING_APPROVAL`, không job nào đang chạy/chờ queue | `WAITING_APPROVAL` |
| Mọi job kết thúc, có ít nhất một job `COMPLETED` | `COMPLETED` |
| Mọi job `CANCELLED` | `CANCELLED` |
| Mọi job kết thúc, không job nào `COMPLETED`, có `ERROR` | `ERROR` |

Approval bị từ chối/hết hạn → job `CANCELLED`, item `NOT_APPLICABLE` lý do "không được duyệt".

`run_status = COMPLETED` **không** có nghĩa test đạt. Kết quả đạt/không đạt nằm ở `result_summary` (đếm item theo `test_status` cuối và theo `test_type`) và ở quality gate.

### 3.3. Retry

| Trường hợp | Tự retry? | Ghi chú |
|---|---|---|
| Item `ERROR` do hạ tầng (`error_code` ∈ `TIMEOUT_NAVIGATION`, `BROWSER_CRASH`, `NETWORK_TRANSIENT`, `TARGET_5XX_TRANSIENT`) | Có, tối đa `plan.retry.maxErrorRetries` (mặc định 1) | |
| Item `FAILED` | Không, trừ khi plan bật `retry.retryFailed` (tối đa 2) | Item pass ở lần retry được đánh dấu nghi flaky |
| Job `ERROR` (worker chết, công cụ không khởi động) | Lease recovery, tối đa `run_jobs.max_attempts` (mặc định 2) | Mục 3.5 |
| Người dùng bấm "Chạy lại item fail" | Tạo **run mới** `kind = RETEST`/`AD_HOC` | Không sửa run cũ |

Mỗi lần retry trong cùng run = một `test_attempts` mới (`attempt_number` tăng). `test_run_items.status` = attempt cuối; `first_attempt_status` giữ lần đầu. Không bao giờ sửa attempt cũ.

### 3.4. Cancel và timeout

- Cancel run: `run_jobs.cancel_requested = true` cho mọi job chưa kết thúc; job `QUEUED`/`WAITING_APPROVAL` → `CANCELLED` ngay (xóa khỏi queue); job `RUNNING` nhận `cancel:<runJobId>` → `ctx.signal.abort()` + `runner.cancel()`.
- Sau 30 s job chưa dừng → worker kill process con (k6, ZAP scan, browser), ghi `CANCELLED`.
- Timeout: `deadline = started_at + timeout` (không vượt trần registry và policy). Hết hạn → abort như cancel, job `ERROR` `error_code = JOB_TIMEOUT`; item đang chạy `ERROR`, item chưa chạy `CANCELLED`.

### 3.5. Lease recovery

Theo [03-architecture.md](03-architecture.md) mục 6: worker runner không chạm DB; nó phát heartbeat qua Redis mỗi 20 s và worker-core đặt `lease_until = now() + 60s` khi nhận heartbeat (BullMQ lock + stalled check xử lý phía queue). Tác vụ `maintenance` (worker-core) mỗi phút:
```sql
UPDATE run_jobs SET status = 'QUEUED', worker_id = NULL, attempts_made = attempts_made + 1
WHERE status = 'RUNNING' AND lease_until < now() AND attempts_made + 1 < max_attempts
RETURNING id;   -- enqueue lại
UPDATE run_jobs SET status = 'ERROR', error_code = 'WORKER_LOST' WHERE status = 'RUNNING' AND lease_until < now();
```
Item của job bị nhận lại chạy lại với attempt mới; attempt dở dang của worker chết đánh `ERROR` `WORKER_LOST`.

### 3.6. Collector

Một hàm trong worker-core (`collectResult`) nhận `RunnerResult` và ghi trong **một transaction**: attempts, results, step_results, api_run_results, run_metrics, artifacts (metadata), findings (upsert theo fingerprint) + finding_occurrences, cập nhật item và job. Sau commit: publish trạng thái; kích hoạt phân tích lỗi tự động (mục 3.7); nếu là job cuối → enqueue `run.finalize` (thống kê, điểm, gate, thông báo). `run.finalize` chờ các phân tích AI của run xong (trần 2 phút) để báo cáo có nguyên nhân; quá trần thì báo cáo ghi "đang phân tích" và tự cập nhật khi xong.

### 3.7. Phân tích nguyên nhân lỗi tự động (D-26)

Chạy trong lúc test, không cần ai bấm:

1. Collector commit một item `FAILED`/`ERROR` → **luật phân loại trước** (`failure_category` từ luật, vd. `ECONNREFUSED` → ENVIRONMENT, locator timeout → TEST_DEFECT, 5xx → PRODUCT_DEFECT; bảng luật ở [08-ai-assistant.md](08-ai-assistant.md)).
2. Tính `error_signature = sha256(runner + normalize(error_message) + step_order/action + url_template)`; `normalize` bỏ số, UUID, timestamp, id phiên, giá trị đã redact.
3. Trong cùng run đã có phân tích cùng chữ ký → gắn `test_results.ai_analysis_id` vào phân tích đó, không gọi AI. Khác run: dùng lại phân tích cùng chữ ký trong 24 giờ nếu test case và phiên bản không đổi.
4. Chưa có → enqueue job `ai` (`generation_type = FAILURE_ANALYSIS`, lưu `ai_generations.error_signature`), ưu tiên theo priority case. Trần mặc định **20 phân tích mới / run** (mặc định của org: `ai_provider_configs.max_analyses_per_run`; dự án ghi đè bằng `projects.settings.ai.maxAnalysesPerRun`), vượt trần thì item còn lại chỉ có kết quả luật và nút "Phân tích thêm".
5. Xong → ghi `test_results.ai_analysis_id`, publish SSE `analysis.ready {runItemId, analysisId}` trên kênh `run:<runId>`; màn chạy hiện "Nguyên nhân có khả năng" ngay.

AI không bật (chưa có API key, `projects.settings.ai.enabled = false`, hoặc hết ngân sách) → chỉ có kết quả luật, không lỗi run. AI **không** đổi `normalized_status` và không đóng finding.

---

## 4. Test DSL (`packages/test-dsl`)

Mỗi `test_steps.automation` là **một bước DSL**. Một test case tự động = chuỗi bước theo `step_order`. `shared_flows.steps` là mảng bước cùng định dạng.

### 4.1. Định nghĩa

```ts
type Locator =
  | { role: AriaRole; name?: string; exact?: boolean }     // ưu tiên 1
  | { label: string }                                      // 2
  | { placeholder: string }                                // 3
  | { text: string; exact?: boolean }                      // 4
  | { testId: string }                                     // 5 (data-testid)
  | { css: string };                                       // 6, chỉ khi không có cách khác
// Tùy chọn chung cho mọi locator: { nth?: number; within?: Locator }
// Không hỗ trợ XPath.

type Step = { id?: string; note?: string; timeoutMs?: number /* ≤ 60000 */; continueOnFail?: boolean } & (
  | { action: 'goto'; url: string }                                    // URL tuyệt đối hoặc path ghép với webBaseUrl
  | { action: 'click'; target: Locator; button?: 'left' | 'right'; double?: boolean }
  | { action: 'fill'; target: Locator; value: string }
  | { action: 'select'; target: Locator; option: string | { label: string } | { index: number } }
  | { action: 'check' | 'uncheck'; target: Locator }
  | { action: 'press'; key: string; target?: Locator }                 // 'Enter', 'Control+A'
  | { action: 'hover'; target: Locator }
  | { action: 'upload'; target: Locator; artifactId: string }          // file mẫu đã upload vào project
  | { action: 'waitFor'; target?: Locator; state?: 'visible' | 'hidden'; urlPattern?: string; networkIdle?: boolean }
  | { action: 'expectVisible' | 'expectHidden'; target: Locator }
  | { action: 'expectText'; target: Locator; text: string; match?: 'contains' | 'equals' | 'regex' }
  | { action: 'expectUrl'; pattern: string; match?: 'contains' | 'regex' }
  | { action: 'expectTitle'; text: string; match?: 'contains' | 'equals' | 'regex' }
  | { action: 'expectCount'; target: Locator; op: '==' | '>=' | '<='; count: number }
  | { action: 'expectAttribute'; target: Locator; name: string; value: string; match?: 'equals' | 'contains' | 'regex' }
  | { action: 'screenshot'; name: string; fullPage?: boolean; mask?: Locator[] }
  | { action: 'visualCompare'; name: string; fullPage?: boolean; mask?: Locator[]; threshold?: number }
  | { action: 'apiCall'; requestId: string; saveAs?: string }          // chạy api_request, kết quả vào vars[saveAs]
  | { action: 'setVar'; var: string; from: { target: Locator; attr?: string } | { value: string } | { regex: string; source: 'url' | 'text'; target?: Locator } }
  | { action: 'useFlow'; flowId: string; params?: Record<string, string> }
  | { action: 'a11yScan'; include?: Locator; tags?: string[] }         // mặc định WCAG 2.1 A/AA
);
```

`expect*` dùng auto-wait của Playwright (`expect(locator).toBeVisible({timeout})`), timeout mặc định 5 s; `goto`/`waitFor` mặc định 30 s.

### 4.2. Biến

| Cú pháp | Nguồn | Ghi chú |
|---|---|---|
| `{{env.webBaseUrl}}`, `{{env.apiBaseUrl}}`, `{{env.<key>}}` | Environment + `environment_variables` không bí mật | |
| `{{secret.<name>}}` | `secrets` qua `ctx.secrets.get` | Chỉ được dùng trong `fill.value`, header/body/auth của API. Dùng ở chỗ khác (`expectText`, `goto`) → lỗi validate |
| `{{cred.<role>.username}}`, `{{cred.<role>.password}}` | `environment_credentials` | `password` xử lý như secret |
| `{{data.<column>}}` | Dòng hiện tại của `test_data_sets` | Case gắn data set → mỗi dòng là một item riêng |
| `{{vars.<name>}}` | `setVar`, `apiCall.saveAs`, `extract` của API | Phạm vi một item |
| `{{fn.uuid}}`, `{{fn.now}}`, `{{fn.today}}`, `{{fn.randomEmail}}` | Hàm dựng sẵn | Không có hàm tùy biến |

Biến không tồn tại → bước `ERROR` `error_code = VAR_UNDEFINED` (không thay bằng chuỗi rỗng như `k6-perf`).

### 4.3. Che secret

- Giá trị secret đăng ký vào redactor khi lấy ra; log, `step_results.actual`, request snapshot đều đi qua redact.
- `fill` với giá trị chứa secret: trước khi chụp screenshot/video, runner thêm `mask` cho chính locator đó; trace Playwright ghi `fill` với giá trị `'••••'` (runner gọi `locator.fill` qua wrapper không ghi giá trị vào trace step title; bật `trace: { snapshots: true, sources: false }`).
- Trường `type="password"` luôn bị mask trong screenshot dù không dùng secret.

### 4.4. Ví dụ: đăng nhập thành công

```json
[
  { "action": "goto", "url": "/login" },
  { "action": "fill", "target": { "label": "Email" }, "value": "{{cred.admin.username}}" },
  { "action": "fill", "target": { "label": "Mật khẩu" }, "value": "{{cred.admin.password}}" },
  { "action": "click", "target": { "role": "button", "name": "Đăng nhập" } },
  { "action": "expectUrl", "pattern": "/dashboard", "match": "contains" },
  { "action": "expectVisible", "target": { "role": "heading", "name": "Tổng quan" } },
  { "action": "screenshot", "name": "sau-dang-nhap" }
]
```

### 4.5. DSL ↔ câu mô tả bước thủ công

Mỗi bước có cả `action` (lời, cho manual) và `automation` (DSL). `packages/test-dsl` có:
- `describe(step, locale)`: DSL → câu. Dùng khi tạo bước từ DSL (luật sinh, Recorder, AI) để điền `test_steps.action` / `expected_result`.
- `parse(sentence)`: câu theo mẫu → DSL (best effort, chỉ các mẫu dưới). Không khớp mẫu → để `automation = null`, AI đề xuất (E5.4).

| DSL | Câu (vi) | Cột |
|---|---|---|
| `goto /login` | Mở trang `/login` | action |
| `fill {label: Email} = x` | Nhập "x" vào ô "Email" | action |
| `fill ... {{secret.*}}` | Nhập mật khẩu (đã ẩn) vào ô "Mật khẩu" | action |
| `click {role: button, name: Đăng nhập}` | Bấm nút "Đăng nhập" | action |
| `select {label: Tỉnh} = Hà Nội` | Chọn "Hà Nội" ở ô "Tỉnh" | action |
| `check {label: Đồng ý}` | Tích chọn "Đồng ý" | action |
| `press Enter` | Nhấn phím Enter | action |
| `expectVisible {role: heading, name: Tổng quan}` | Thấy tiêu đề "Tổng quan" | expected_result |
| `expectText {...} contains "Sai mật khẩu"` | Thấy thông báo chứa "Sai mật khẩu" | expected_result |
| `expectUrl contains /dashboard` | Được chuyển sang trang `/dashboard` | expected_result |
| `expectCount {role: row} >= 1` | Có ít nhất 1 dòng trong bảng | expected_result |
| `apiCall <tên request>` | Gọi API "<tên request>" | action |
| `useFlow <tên flow>` | Thực hiện "<tên flow>" | action |
| `a11yScan` | Trang không có lỗi accessibility mức nghiêm trọng | expected_result |

Bước `expect*` ghép vào `expected_result` của bước hành động ngay trước nó khi hiển thị cho manual tester.

### 4.6. Validate (lúc lưu và trước khi chạy)

- Zod schema theo 4.1; `step_order` liên tục; tối đa 200 bước/case, `useFlow` lồng tối đa 3 cấp, không vòng.
- `goto` URL tuyệt đối phải thuộc host của environment hoặc `target_hosts`; kiểm lại lúc chạy (môi trường có thể khác).
- `css` không chứa `:has-text`/engine riêng của Playwright (chỉ CSS chuẩn); cảnh báo (không chặn) khi dùng `css`/`nth`: locator dễ vỡ.
- Biến tham chiếu phải khai báo được (env/secret/cred/data tồn tại trong project), `secret` chỉ ở vị trí cho phép (4.2).
- Case có bước ghi dữ liệu (submit, `apiCall` tới request `is_write`) được đánh `writes_data` (tính khi lưu) để policy chặn trên production. Bước `click` vào nút submit form không suy ra chắc chắn được → mọi case FUNCTIONAL tự động trên production phải có cờ `read_only_confirmed` do người tạo tích.

---

## 5. API runner

- **Biến**: thứ tự ưu tiên `vars` (extract trước đó) > `data` > `env` > `secret`. Template trong URL, header, query, body (đệ quy trong JSON), auth.
- **Auth**: `bearer`/`basic`/`apiKey` lấy secret; `flow` = chạy request login (`flowRequestId`) một lần mỗi item (hoặc một lần mỗi job nếu đánh dấu `shared`), extract token vào `vars`.
- **Chaining**: case có nhiều `apiCall` chạy tuần tự; `extract: [{var, source: jsonpath|header|status, path}]`. Request lỗi `ERROR`/`FAILED` → các bước sau `BLOCKED` (trừ `continueOnFail`).
- **Assertion**:

| source | operator |
|---|---|
| `status` | `==`, `!=`, `in`, `between` |
| `header` | `exists`, `notExists`, `==`, `contains`, `regex` |
| `jsonpath` (JSONPath, `jsonpath-plus`) | `exists`, `notExists`, `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `regex`, `type`, `lengthEq`, `lengthGte` |
| `body` | `contains`, `notContains`, `regex` |
| `duration` | `<`, `<=` (ms) |
| `schema` | `matches` (ajv draft 2020-12 với `response_schema`; OpenAPI 3.0 `nullable` được chuyển đổi trước) |

`success_rule` của request (vd. `body.success != false`) là assertion ngầm áp dụng cho mọi case dùng request đó.
- **Redact**: header `Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`, `Proxy-Authorization`, mọi header/field JSON có tên khớp `/pass|secret|token|key|otp|pin/i`, cộng mọi giá trị secret đã dùng. Áp cho `request_snapshot`, `response_headers`, body lưu artifact.
- **Giới hạn**: timeout mặc định 30 s (trần 120 s); body response tối đa 10 MB (vượt → cắt, assertion body `ERROR` `RESPONSE_TOO_LARGE`); body > 64 KB lưu artifact thay vì DB.
- **Redirect**: tự theo tối đa 5 lần, **mỗi bước** gọi `ctx.egress.assertAllowed`; host ngoài allowlist → `ERROR` `REDIRECT_BLOCKED`.
- **Ghi dữ liệu**: method khác GET/HEAD/OPTIONS trên môi trường có `allow_write_requests = false` → item `NOT_APPLICABLE` `WRITE_BLOCKED_BY_POLICY` (đã chặn ở orchestrator, runner kiểm lại).

## 6. Playwright runner

- Một browser mỗi job (browser × viewport của job), **một `BrowserContext` mới cho mỗi item** (cookie/storage sạch). Đăng nhập lặp lại có thể cache `storageState` theo `cred.role` trong phạm vi job.
- Proxy: `launch({ proxy: { server: ctx.egress.proxyUrl } })`; ngoài ra `context.route('**')` gọi `assertAllowed` cho request điều hướng chính (chặn sớm, thông báo rõ).
- Artifact: screenshot khi bước fail (luôn), `video: 'retain-on-failure'`, `trace: 'retain-on-failure'`; screenshot theo bước DSL `screenshot`. Plan có thể bật "luôn giữ trace".
- Ghi lại: console error, page error, request ≥ 400 hoặc thất bại → `result_metadata`; console error **không** làm fail test trừ khi bước `expect` hoặc plan bật `failOnConsoleError`.
- Ma trận: mỗi job một ô; viewport preset `desktop` 1366×768, `tablet` 768×1024 (`hasTouch`), `mobile` 390×844 (`isMobile`, `hasTouch`, user agent di động).
- Item song song trong job: mặc định 2 context đồng thời, trần theo RAM.
- Bước `a11yScan` dùng `@axe-core/playwright`; bước `visualCompare` dùng so pixel (`pixelmatch`) với baseline active, chưa có baseline → lưu ảnh làm "baseline chờ duyệt", bước `PASSED` kèm ghi chú.

## 7. Audit runner

Chạy trên worker-browser; một job có thể gồm nhiều check (`config.checks[]`). Mỗi check × trang = một item phát sinh.

| Check | Công cụ | Cấu hình | Kết quả |
|---|---|---|---|
| `lighthouse` | Lighthouse Node API, Chrome của image Playwright | Preset `mobile` (mặc định, throttling mô phỏng) và/hoặc `desktop`; category `performance`, `accessibility`, `seo`, `best-practices`; 1 lần/trang (Quick Scan), 3 lần lấy median (plan) | Điểm 0–100/category, LCP, TBT, CLS, FCP, TTFB, Speed Index → `run_metrics`; báo cáo HTML/JSON → artifact |
| `axe` | `@axe-core/playwright` | Tag `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`; bỏ `best-practice` trừ khi bật | Vi phạm theo rule, impact, số node, selector |
| `links` | Crawler nhẹ (fetch qua proxy, không render) | Link nội bộ: GET; ngoài: HEAD rồi GET khi 405; 2 request đồng thời/domain ngoài, 4 nội bộ; timeout 10 s; không theo tiếp link ngoài | Link hỏng: URL, trang chứa, status/lỗi |
| `smoke` | Playwright | Mở trang, chờ `load` | Status, lỗi console, request lỗi, thời gian tải |
| `headers_tls` | Node `https`/`tls` | Trang chủ + trang khai báo | Danh sách dưới |

Kiểm tra `headers_tls`:

| Kiểm tra | Đạt khi | Severity khi không đạt |
|---|---|---|
| HTTPS + redirect HTTP→HTTPS | HTTP trả 301/308 sang HTTPS | HIGH |
| TLS version | Chỉ TLS 1.2+ (thử bắt tay TLS 1.0/1.1 phải thất bại) | HIGH |
| Chứng chỉ | Hợp lệ, đúng host, còn hạn > 14 ngày (≤ 14 ngày: MEDIUM, hết hạn: CRITICAL) | xem cột trái |
| `Strict-Transport-Security` | Có, `max-age ≥ 15552000` | MEDIUM |
| `Content-Security-Policy` | Có, không `unsafe-inline` trong `script-src` (thiếu hẳn: MEDIUM; yếu: LOW) | MEDIUM / LOW |
| `X-Content-Type-Options` | `nosniff` | LOW |
| Chống clickjacking | CSP `frame-ancestors` hoặc `X-Frame-Options: DENY/SAMEORIGIN` | MEDIUM |
| `Referrer-Policy` | Có, không phải `unsafe-url` | LOW |
| `Permissions-Policy` | Có | INFO |
| Cookie | Cookie phiên có `Secure`, `HttpOnly`, `SameSite` (Lax/Strict) | MEDIUM |
| Mixed content | Trang HTTPS không tải tài nguyên HTTP | MEDIUM |
| Lộ phiên bản | `Server`/`X-Powered-By` không chứa số phiên bản | LOW |

## 8. k6 runner (tóm tắt)

Chi tiết chuyển đổi ở [11-k6-migration.md](11-k6-migration.md).

- Một script k6 chung (`apps/worker/src/runners/k6/script/main.js`) đọc **file JSON cấu hình** do worker ghi vào `workDir` (`open('./job.json')`): danh sách request đã resolve (trừ secret), weight, profile, SLO, `rate_scale`. Secret truyền qua biến môi trường của process k6, không ghi file.
- Executor `ramping-arrival-rate` (giữ req/s cố định khi API chậm).
- Giữ thủ thuật của `k6-perf`: threshold cho từng item (`http_req_duration{name:...}`, `api_success{name:...}`...) để summary có số liệu từng API; chia 12 cửa sổ thời gian (tag `win`) để tìm điểm bão hòa; phân loại lỗi `timeout | rate_limited | server_error | client_error | body_error`.
- `handleSummary` xóa `setup_data` (token, dữ liệu setup) trước khi ghi `summary.json`.
- Dừng êm: `PATCH http://127.0.0.1:6565/v1/status {stopped: true}` (REST API của k6, giữ được summary); quá 30 s thì kill.
- Trước khi spawn, worker **kiểm lại giới hạn cứng** từ `execution_policies` (`max_perf_rps` so với đỉnh profile × `rate_scale`, `max_perf_duration_s`, `max_vus`) và môi trường production; vượt → `ERROR` `POLICY_LIMIT`, không chạy. Script tự kiểm lại một lần nữa (phòng chạy tay).
- Normalizer `packages/report-normalizers/k6` (từ `lib/report.js`) → item theo endpoint + `run_metrics`; `diagnose` (từ `lib/diagnose.js`) → finding PERFORMANCE.

## 9. ZAP runner

- ZAP chạy daemon trong container riêng (`worker-security` điều khiển qua ZAP API, API key nội bộ); ZAP đi ra ngoài qua egress proxy (upstream proxy).
- Mỗi job tạo context ZAP mới (scope include/exclude regex từ `security_scan_configs.scope`), xóa khi xong.

| Mode | Làm gì | Điều kiện |
|---|---|---|
| `ZAP_BASELINE` | Spider (giới hạn URL, thời gian) + passive scan, chờ passive queue rỗng | Mọi môi trường đã xác minh |
| `ZAP_API` | Import OpenAPI (`openapi_collection_id`), active scan trên endpoint đã import | Duyệt; cấm production |
| `ZAP_FULL` | Spider + AJAX spider + active scan (policy mặc định, bỏ rule DoS) | Duyệt; cấm production |

- Alert → finding: `riskcode` 3 → HIGH, 2 → MEDIUM, 1 → LOW, 0 → INFO (ZAP không có Critical; nâng lên CRITICAL chỉ do người). `confidence = 0 (false positive)` bỏ qua. `ruleId = zap:<pluginId>`, `target = method + path_template(url) + param`.
- Báo cáo gốc HTML/JSON → artifact.

## 10. Discovery crawler

Input `discovery_runs.config`: `startUrls`, `maxDepth` (mặc định 3), `maxPages` (mặc định 200, Quick Scan 50), `credentialRole?`, `include[]`/`exclude[]` (regex).

Thuật toán:
1. Đăng nhập trước bằng `login_flow_id` của `credentialRole` (nếu có); đây là form duy nhất được submit.
2. BFS từ `startUrls`, hàng đợi theo độ sâu; 2 trang song song; chỉ cùng origin với `webBaseUrl` (và host trong `target_hosts` của project).
3. Chuẩn hóa URL: bỏ fragment, sắp query, bỏ tham số tracking (`utm_*`, `fbclid`, `gclid`); `normalized_path` thay đoạn số, UUID, hash dài, slug có số bằng `:id`. Mỗi `normalized_path` chỉ crawl tối đa 3 URL mẫu (tránh 10.000 trang sản phẩm).
4. Bỏ qua link/nút có text hoặc href khớp `/logout|log-out|sign-?out|đăng xuất|delete|xóa|xoá|remove|huỷ|hủy|unsubscribe/i`, link `mailto:`, `tel:`, file tải về (`.pdf`, `.zip`...) chỉ HEAD.
5. Mỗi trang: chờ `networkidle` (trần 10 s); ghi title, status, thời gian tải, screenshot (viewport), form (field, type, required, pattern, min, max, maxlength, options, label), nút, link, lỗi console, request lỗi. **Không submit form, không click nút ngoài link điều hướng.** SPA: thu link từ `a[href]` và route quan sát được khi `history.pushState`.
6. Bắt XHR/fetch (`resourceType` ∈ `xhr`, `fetch`) cùng host API/web → `discovered_endpoints` (method, `path_template` chuẩn hóa như bước 3, `sample_status`, trang thấy). Chỉ ghi metadata, không lưu body.
7. **Ghi bước chuyển (D-28):** mỗi link điều hướng tới trang đã/đang crawl → `site_transitions` (`from_page_id`, `to_page_id`, `trigger {kind: LINK, locator, label}`, `source = DISCOVERY`); redirect HTTP/JS quan sát được → `kind: REDIRECT`. Form và nút không bấm nên được ghi là bước chuyển **dự kiến** (`to_page_id = null`, `kind: FORM_SUBMIT|BUTTON`); AI Explorer (mục 10.2) hoặc Recorder (mục 10.1) điền nốt đích. Khóa chống trùng: `(from normalized_path, trigger.kind, trigger.locator)`.
8. Dừng khi hết hàng đợi, đủ `maxPages` hoặc hết timebox.

Output: `site_pages`, `site_transitions`, `discovered_endpoints`, `pages_found`, `endpoints_found`; nếu project có OpenAPI, endpoint quan sát được khớp với `api_requests` theo method + path template.

**Độ phủ luồng.** Một `site_transitions` được coi là "có test" khi có `test_case_transitions` trỏ tới nó từ test case `ACTIVE`. Liên kết được tạo tự động khi: Recorder/AI Explorer sinh case (biết chính xác bước chuyển), hoặc case DSL chạy `PASSED`/`FAILED` mà Playwright runner quan sát được bước chuyển khớp khóa trên (runner ghi danh sách điều hướng vào `result_metadata.transitions`, collector map). `Độ phủ luồng = bước chuyển có test / bước chuyển đã biết` (bước chuyển dự kiến chưa có đích vẫn tính ở mẫu số). Công thức hiển thị ở [07](07-reporting-and-scoring.md).

### 10.1. Recorder: trình duyệt từ xa trong Hub (D-27)

Không cần cài extension. Người dùng thao tác trên một trình duyệt Chromium chạy trong worker-browser, hiện ngay trong trang Hub. **Cùng engine với Playwright runner** nên bước ghi được chạy lại ổn định hơn.

**Luồng một phiên:**

```text
Web (canvas) ◄─JPEG frames── API ◄─Redis pub/sub── worker-browser (Chromium + Playwright)
     │  chuột/bàn phím/cuộn/dán         ▲                       │ script ghi (addInitScript)
     └──────────── WebSocket ───────────┘ ──Redis pub/sub──►     └─► bước DSL + ảnh
```

1. `POST /recorder/sessions` → API kiểm quyền, công tắc test (mục 3.0), `target_hosts`; tạo phiên và enqueue job `recorder` vào `runner.browser`. Mỗi user tối đa 1 phiên (`RECORDER_BUSY`).
2. Worker mở Chromium bằng Playwright với **profile tạm trong tmpfs** (không dùng cookie/trình duyệt thật của người dùng), viewport theo preset: desktop 1280×800, tablet 820×1180, mobile 390×844. URL bắt đầu được resolve theo quy tắc LOCAL (kiểu Cá nhân: `localhost` → `host.docker.internal`) và đi qua SSRF guard + egress proxy như mọi runner.
3. **Hình ảnh:** CDP `Page.startScreencast` (JPEG, 5–10 khung/giây, chất lượng tự giảm khi mạng chậm hoặc trang đứng yên) → Redis pub/sub `recorder:<sessionId>:frames` → API → client qua WebSocket `GET /recorder/sessions/:id/ws`. Khung hình **không lưu**; chỉ ảnh chụp của từng bước được lưu.
4. **Điều khiển:** client gửi sự kiện chuột (tọa độ đã quy đổi theo viewport), bàn phím, cuộn, dán → API → worker phát lại bằng `page.mouse` / `page.keyboard` (CDP Input). Gộp `mousemove`, giới hạn 60 sự kiện/giây.
5. **Script ghi** (`packages/test-dsl/recorder`, gắn bằng `page.addInitScript` cho mọi frame cùng origin) bắt `click`, `input/change` (gộp thành một `fill` khi rời field), `select`, `check/uncheck`, phím `Enter/Escape/Tab`, `submit`, điều hướng (`framenavigated`, `history.pushState`). Mỗi thao tác → một bước DSL với locator theo **cùng thứ tự ưu tiên** như mục 4: role + name > label > placeholder > text > testId > css (không xpath); kèm 2 locator dự phòng; phải dùng `css` thì bước bị gắn cảnh báo "dễ vỡ". Điều hướng sang trang mới tự thêm `expectUrl`.
6. **Thêm kiểm tra:** người dùng bấm "Thêm kiểm tra" trên thanh công cụ của Hub rồi chọn phần tử trên khung hình → worker xác định phần tử tại tọa độ (`document.elementFromPoint`) → bước `expectVisible` hoặc `expectText`.
7. **Ảnh từng bước:** `page.screenshot` sau mỗi bước (JPEG, ≤ 1280 px), các ô nhạy cảm được che (`mask`) trước khi lưu artifact.
8. **Kết thúc:** `POST /recorder/sessions/:id/finish` → test case `DRAFT` (`source = RECORDER`), `automation_status = AUTOMATED`, mỗi bước có câu mô tả sinh từ DSL (mục 4.5); bước chuyển giữa trang ghi vào `site_transitions` (`source = RECORDER`) và `test_case_transitions`. Đóng trình duyệt, xóa profile tmpfs.
9. **Chạy lại để xác nhận** (mặc định bật): chạy case một lần bằng Playwright runner trên cùng môi trường; `PASSED` → nhãn "đã xác nhận"; `FAILED` → editor đánh dấu bước hỏng để sửa locator.

**Che dữ liệu nhạy cảm:** ô `type=password`, ô có `autocomplete` dạng `cc-*`/`one-time-code`, hoặc name/id khớp `/pass|otp|pin|token|secret|card|cvv/i` → giá trị gõ vào **không bao giờ lưu**, bước ghi thành `{{secret.<tên gợi ý>}}`, người dùng chọn secret thật khi lưu. `redact()` chạy lại ở server; server từ chối bước chứa chuỗi trùng secret đã lưu.

**Trường hợp đặc biệt:**

| Tình huống | Xử lý |
|---|---|
| Ô upload file | Hub hiện hộp chọn file → `POST /recorder/sessions/:id/upload` → `setInputFiles`; bước DSL `upload` tham chiếu artifact |
| `alert` / `confirm` / `prompt` | Hub hiện hộp thoại tương ứng, lựa chọn của người dùng được phát lại và ghi thành bước xử lý dialog |
| Tab mới / popup | Theo trang mới nhất; bước chuyển ghi kèm `newPage: true` |
| Kéo thả phức tạp, khóa bảo mật phần cứng (WebAuthn), popup đăng nhập bên thứ ba (Google/Microsoft SSO) | **Không hỗ trợ.** Người dùng ghi phần còn lại, bước này viết tay hoặc dùng shared flow đăng nhập bằng tài khoản test |
| Rảnh 10 phút / quá 30 phút | Phiên đóng (`RECORDER_SESSION_EXPIRED`); bước đã ghi giữ ở trạng thái nháp 24 giờ để lưu tiếp |

**Giới hạn:** tối đa 200 bước/phiên; không ghi iframe khác origin; chỉ mở URL thuộc môi trường của project (đổi sang host khác → chặn và báo).

### 10.2. AI Explorer (D-29)

Runner `explorer` trên `runner.browser`; Phase 7. Tìm luồng mà crawler không thấy (sau đăng nhập, nhiều bước, form).

**Input** (`config`): `goals[]` (người dùng nhập, vd. "Đặt một đơn hàng", hoặc AI đề xuất từ tài liệu yêu cầu và trang/form đã khám phá), `credentialRole?`, `allowWrites` (chỉ nhận `true` khi `environment.kind ∈ {LOCAL, DEV}`; PRODUCTION luôn `false`, STAGING `false` ở bản này), `maxStepsPerFlow` (mặc định 50), `maxMinutesPerFlow` (mặc định 10), `maxFlows` (mặc định 10).

**Vòng lặp mỗi mục tiêu:**

```text
observe  : cây accessibility (page.accessibility / ariaSnapshot, cắt ≤ 8k token) + ảnh chụp viewport + URL + 5 bước gần nhất
decide   : Gemini trả JSON theo schema {action, target:{role,name}|{label}|{text}, value?, reason, goalDone: bool}
           action ∈ goto | click | fill | select | check | press | waitFor | expectVisible | expectText | back | stop
guard    : validate Zod; target phải khớp đúng 1 phần tử; chặn click khớp danh sách nguy hiểm (mục 10 bước 4);
           allowWrites=false → chặn submit form / nút khớp /lưu|gửi|đặt|thanh toán|xóa|save|submit|pay|delete/i
           và mọi request không phải GET/HEAD tới host được test (route.abort, ghi lý do)
           giá trị fill: chỉ từ test_data_sets, {{cred.*}} hoặc dữ liệu giả do AI sinh theo type field (không bao giờ là secret thật trong prompt)
act      : thực thi như Playwright runner; ghi bước DSL + ảnh + bước chuyển
stop khi : goalDone | stop | hết maxSteps/maxMinutes | lỗi 3 lần liên tiếp
```

**Hậu xử lý:**
1. Chống trùng: luồng có cùng chuỗi khóa bước chuyển với luồng đã có (từ explorer, recorder hoặc case `ACTIVE`) → bỏ.
2. **Replay xác nhận:** chạy lại luồng bằng Playwright runner trong context sạch, không có AI. Chỉ luồng replay `PASSED` mới thành test case `DRAFT` (`source = AI`, `source_ref = ai:<generationId>`, DSL đầy đủ, tiêu đề + mô tả bước bằng tiếng Việt do AI viết). Luồng không replay được → lưu trong kết quả explorer để người xem lại, không tạo case.
3. Ghi `site_transitions` (`source = AI_EXPLORER`), `test_case_transitions`, `ai_generations` (`generation_type = EXPLORATION`, token, chi phí).

**An toàn và chi phí:** mỗi bước là một lần gọi AI → ước tính chi phí hiện trước khi chạy (số mục tiêu × maxSteps); dừng khi chạm ngân sách token của org. Prompt đi qua pipeline lọc dữ liệu ([08](08-ai-assistant.md) mục 8); ảnh chụp đã che field nhạy cảm như Recorder. Không chạy trên PRODUCTION khi `production_testing_enabled = false`; khi bật vẫn chỉ đọc.

## 11. Sinh test case theo luật (module `generators`)

Chạy sau discovery hoặc import OpenAPI, theo yêu cầu người dùng ("Tạo bộ test case"). Mọi case `status = DRAFT`, `source = RULE`, `source_ref = rule:<ruleId>:<đối tượng>`, `dedup_key = <ruleId>:<khóa đối tượng>` (unique theo project, case đã `REJECTED` cũng giữ để không sinh lại). Luật bật/tắt ở `projects.settings.generators`.

| ruleId | Từ | Case tạo ra (tiêu đề) | Bước | DSL | Priority | dedup_key |
|---|---|---|---|---|---|---|
| `page.smoke` | `site_pages` | Trang "{title}" ({path}) mở được, không lỗi | goto, expect status/console, expectTitle | Có | HIGH (trang chủ, login: CRITICAL) | `page.smoke:{normalized_path}` |
| `form.required` | form, field `required` | {form}: bỏ trống "{field}" thì báo lỗi bắt buộc | Điền các field khác hợp lệ, để trống field, submit, thấy thông báo lỗi | Có, nhưng `test_method = MANUAL` cho đến khi người duyệt xác nhận submit an toàn | MEDIUM | `form.required:{path}:{formKey}:{field}` |
| `form.format` | field có `type` email/url/number/tel/date hoặc `pattern` | {form}: nhập "{field}" sai định dạng thì báo lỗi | Như trên với giá trị sai mẫu (bộ giá trị cố định theo type) | Như trên | MEDIUM | `form.format:{path}:{formKey}:{field}` |
| `form.maxlength` | field có `maxlength`/`max`/`min` | {form}: "{field}" vượt giới hạn {n} | Giá trị biên n, n+1 (và min-1) | Như trên | LOW | `form.boundary:{path}:{formKey}:{field}` |
| `form.valid-submit` | mỗi form | {form}: gửi dữ liệu hợp lệ thành công | Điền dữ liệu hợp lệ, submit, thấy thông báo thành công | Không (chỉ manual: ghi dữ liệu) | HIGH | `form.valid:{path}:{formKey}` |
| `api.success` | `api_requests` (OpenAPI) | API {METHOD} {path} trả về thành công | apiCall + assertion status 2xx + schema | Có | HIGH (GET), MEDIUM (ghi) | `api.success:{METHOD}:{path}` |
| `api.no-auth-401` | request có security trong OpenAPI | API {METHOD} {path} từ chối khi không có token | apiCall với `auth = none`, expect 401/403 | Có | HIGH | `api.noauth:{METHOD}:{path}` |
| `api.schema-invalid-400` | request có requestBody schema | API {METHOD} {path} từ chối dữ liệu sai | Body thiếu field bắt buộc / sai type, expect 400/422 | Có | MEDIUM | `api.invalid:{METHOD}:{path}` |
| `link.integrity` | project (1 case) | Website không có link hỏng | audit `links` | Có (audit) | MEDIUM | `link.integrity:{environmentId}` |
| `page.a11y` | `site_pages` | Trang "{title}" đạt WCAG 2.1 AA (tự động) | goto, a11yScan | Có | MEDIUM | `page.a11y:{normalized_path}` |
| `page.lighthouse` | trang chủ + top 10 trang theo số link vào | Trang "{title}" tải nhanh và chuẩn SEO | audit `lighthouse` | Có (audit) | MEDIUM | `page.lh:{normalized_path}` |

Giới hạn: tối đa 500 case mỗi lần sinh, 50 case mỗi luật mỗi lần; vượt → sinh theo thứ tự ưu tiên (trang ít độ sâu, endpoint GET trước) và báo "còn N đối tượng chưa sinh". Case sinh ra tự gắn suite theo nhóm (`Tự động sinh / Trang`, `/ Form`, `/ API`) và tag `generated`.

## 12. Tự tạo finding và fingerprint

`fingerprint = sha256(projectId + ruleId + normalizedTarget)`. Collector upsert theo `(project_id, fingerprint)`: có rồi → thêm `finding_occurrences`, tăng `occurrence_count`, cập nhật `last_seen_run_id`; finding `RESOLVED`/`CLOSED` mà xuất hiện lại → `REOPENED`. `ACCEPTED_RISK` giữ nguyên trạng thái (chỉ thêm occurrence).

| Runner | ruleId | normalizedTarget | Severity mặc định | Gom |
|---|---|---|---|---|
| playwright / api (test `FAILED`) | `test:<testCaseId>` | `environmentId` | Theo priority case: CRITICAL→HIGH, HIGH→MEDIUM, còn lại LOW | 1 finding / case / môi trường (mọi ô ma trận chung finding, occurrence ghi browser) |
| `ERROR` | – | – | **Không** tạo finding (lỗi hạ tầng hiện ở trang Tình trạng hệ thống) | |
| axe | `axe:<ruleId>` | `normalized_path` | impact critical→HIGH, serious→MEDIUM, moderate→LOW, minor→INFO | 1 finding / rule / trang |
| lighthouse | `lighthouse:<auditId>` | `normalized_path` | Core Web Vitals "poor"→MEDIUM, "needs improvement"→LOW; audit SEO/best practice fail→LOW | Chỉ audit có `score < 0.5` |
| links | `link:broken` | URL đích | Nội bộ HIGH (404 trên link nội bộ), ngoài LOW | 1 finding / URL đích (occurrence ghi các trang chứa) |
| headers_tls | `hdr:<checkId>` | host | Theo bảng mục 7 | 1 / check / host |
| zap | `zap:<pluginId>` | method + path template + param | Theo mục 9 | 1 / alert / vị trí |
| k6 (`diagnose`) | `perf:<diagnosisRule>` | endpoint name hoặc `run` | critical→HIGH, warning→MEDIUM, info→không tạo finding | 1 / rule / endpoint |
| visual | `visual:<testCaseId>:<stepName>` | browser + viewport | LOW | |

`user_impact` và `recommendation` điền từ template theo `ruleId` (bảng template ở [07-reporting-and-scoring.md](07-reporting-and-scoring.md)).

## 13. Sandbox và giới hạn

Chi tiết ở [09-security-model.md](09-security-model.md). Tóm tắt điều runner dựa vào:

- Worker chạy container không root, filesystem chỉ đọc trừ `workDir` (tmpfs có giới hạn dung lượng), không mount Docker socket, `cap_drop: ALL`, giới hạn CPU/RAM/PIDs theo registry.
- Mạng: worker chỉ ra ngoài qua `egress-proxy`; proxy kiểm allowlist, phân giải DNS **một lần** và chặn IP loopback, link-local, metadata (`169.254.169.254`), private (trừ CIDR được phép trong `target_hosts`) → chống DNS rebinding.
- Secret chỉ giải mã trong bộ nhớ worker, mỗi lần giải mã ghi audit `secret.read_by_worker`.
- Không chạy code người dùng: DSL được diễn dịch; k6 chỉ chạy script cố định của Hub; ZAP chỉ dùng policy dựng sẵn.
- Artifact lớn nhất 200 MB/file, 1 GB/job.
