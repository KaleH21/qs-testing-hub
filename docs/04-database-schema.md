# 04. Database schema (PostgreSQL 17, Drizzle)

- Người đọc: developer backend
- Bản này **thay thế** spec 1.0 mục 6. Thay đổi so với spec 1.0 ghi ở mục 12.

## 1. Quy ước

- Khóa chính `id uuid` (UUID v7 sinh ở ứng dụng để sắp xếp được theo thời gian).
- Thời gian `timestamptz`, lưu UTC. Cột chuẩn: `created_at`, `updated_at` (trigger hoặc ORM cập nhật).
- Mọi bảng nghiệp vụ có `organization_id` hoặc truy được về organization qua `project_id`. Repository **bắt buộc** nhận `orgId`/`projectId` trong mọi query (xem [09-security-model.md](09-security-model.md) mục 2).
- Xóa mềm (`archived_at`) cho project, test case, suite, plan. Kết quả chạy **không bao giờ** xóa hay sửa (chỉ thêm).
- `jsonb` chỉ dùng cho dữ liệu luôn đọc/ghi cùng bản ghi cha và được kiểm bằng Zod ở `packages/validation`. Dữ liệu cần lọc, join hoặc thống kê thì tách cột/bảng.
- Enum khai báo bằng `pgEnum` của Drizzle, đồng bộ với `packages/shared-types`.
- Ký hiệu dưới đây: `→ bảng` là foreign key; `?` là nullable; `U(...)` là unique; `I(...)` là index.
- Kiểu cài Cá nhân đi trước (D-32), nhưng schema **giữ nguyên đa người dùng, đa tổ chức** (users, members, role, `organization_id`) để chuyển sang kiểu Máy chủ ở Phase 8 không phải đổi schema.

## 2. Enum

```text
org_role           OWNER | ADMIN | QA_LEAD | TESTER | DEVELOPER | VIEWER
project_role       QA_LEAD | TESTER | DEVELOPER | VIEWER
test_type          FUNCTIONAL | API | PERFORMANCE | SECURITY | ACCESSIBILITY | COMPATIBILITY
                   | VISUAL | SEO | BEST_PRACTICES | LINK_INTEGRITY | USABILITY | RELIABILITY
                   | EXPLORATORY | UNIT | INTEGRATION
test_purpose       SMOKE | SANITY | REGRESSION | RETEST | ACCEPTANCE | NEW_FEATURE
test_level         UNIT | INTEGRATION | SYSTEM | E2E | UAT
test_method        MANUAL | AUTOMATED
priority           CRITICAL | HIGH | MEDIUM | LOW
case_status        DRAFT | ACTIVE | REJECTED | DEPRECATED
automation_status  NOT_AUTOMATED | AUTOMATED | NEEDS_UPDATE
case_source        MANUAL | RULE | AI | RECORDER | AI_EXPLORER | IMPORT
test_status        PENDING | QUEUED | RUNNING | PASSED | FAILED | BLOCKED | SKIPPED
                   | CANCELLED | ERROR | NOT_APPLICABLE              -- theo spec 1.0 mục 6.8
run_status         PENDING | WAITING_APPROVAL | QUEUED | RUNNING | COMPLETED | CANCELLED | ERROR
execution_source   MANUAL | WEB | API | CI | SCHEDULED | IMPORTED
failure_category   PRODUCT_DEFECT | TEST_DEFECT | ENVIRONMENT | TEST_DATA | NETWORK_DEPENDENCY | UNKNOWN
severity           CRITICAL | HIGH | MEDIUM | LOW | INFO
finding_status     OPEN | CONFIRMED | IN_PROGRESS | RESOLVED | REOPENED | ACCEPTED_RISK | CLOSED
approval_status    PENDING | APPROVED | REJECTED | EXPIRED
gate_result        PASSED | FAILED | INCONCLUSIVE
quality_dimension  FUNCTIONAL | PERFORMANCE | SECURITY | ACCESSIBILITY | COMPATIBILITY_UI
                   | WEB_STANDARDS | RELIABILITY
```

Ánh xạ `test_type` → `quality_dimension` (dùng cho chỉ số sức khỏe, cố định trong `packages/scoring`):

| Dimension | test_type |
|---|---|
| FUNCTIONAL | FUNCTIONAL, API, LINK_INTEGRITY, UNIT, INTEGRATION, EXPLORATORY |
| PERFORMANCE | PERFORMANCE (k6) + chỉ số hiệu năng trang của Lighthouse |
| SECURITY | SECURITY |
| ACCESSIBILITY | ACCESSIBILITY |
| COMPATIBILITY_UI | COMPATIBILITY, VISUAL, USABILITY |
| WEB_STANDARDS | SEO, BEST_PRACTICES |
| RELIABILITY | RELIABILITY + tỉ lệ flaky + kết quả smoke theo lịch |

## 3. Tài khoản và tổ chức

```text
users
  id, email U, password_hash?, display_name, avatar_url?, locale (vi|en), timezone,
  settings jsonb               -- chế độ hiển thị (kỹ thuật/tổng quan), theme, bộ lọc đã lưu
  status (ACTIVE|LOCKED|DISABLED), failed_login_count, locked_until?, totp_secret_enc?,
  last_login_at?, created_at, updated_at

user_identities              -- SSO (Phase 8)
  id, user_id → users, provider (google|microsoft|oidc), subject, created_at
  U(provider, subject)

refresh_tokens
  id, user_id → users, token_hash U, family_id (= claim `sid` trong JWT), expires_at, revoked_at?, user_agent?, ip?, created_at
  I(user_id)                 -- xoay vòng: dùng lại token đã revoke → thu hồi cả family

organizations
  id, name, slug U, default_timezone, settings jsonb, created_by → users, created_at, updated_at
  production_testing_enabled bool default false   -- công tắc tổng (D-24); tắt → mọi môi trường PRODUCTION bị chặn
  local_testing_enabled bool default true         -- công tắc tổng cho môi trường LOCAL
  testing_switches_changed_by?, testing_switches_changed_at?
  -- để cột riêng (không nằm trong settings) vì API, worker, scheduler đều phải kiểm tra trước mỗi lần chạy

organization_members
  id, organization_id → organizations, user_id → users, role org_role, joined_at
  U(organization_id, user_id)

invitations
  id, organization_id, email, role org_role, token_hash U, invited_by, expires_at, accepted_at?, created_at

service_accounts
  id, organization_id, name, token_prefix (8 ký tự đầu, để nhận diện), token_hash U,
  scopes text[]  -- vd. runs:create, results:import, project:<id>
  project_ids uuid[]?        -- null = mọi project trong org
  last_used_at?, expires_at?, revoked_at?, created_by, created_at

```

## 4. Dự án, môi trường, mục tiêu, secret

```text
projects
  id, organization_id, key (vd. QSNET), name, description?, repository_url?,
  technology_metadata jsonb, settings jsonb  -- trọng số điểm, SLO mặc định, luật sinh test bật/tắt
  archived_at?, created_by, created_at, updated_at
  U(organization_id, key)

project_members
  id, project_id, user_id, role project_role, created_at
  U(project_id, user_id)

environments
  id, project_id, name, kind (LOCAL|DEV|STAGING|PRODUCTION),   -- thay is_production (D-23)
  web_base_url?, api_base_url?,
  testing_enabled bool default true,                       -- công tắc theo môi trường (D-24)
  testing_disabled_reason?, testing_toggled_by?, testing_toggled_at?,
  default_headers jsonb, config_metadata jsonb, is_active, created_at, updated_at
  U(project_id, name)
  -- được chạy test ⇔ testing_enabled AND công tắc tổng của org cho kind này
  --   (PRODUCTION → production_testing_enabled, LOCAL → local_testing_enabled, DEV/STAGING → luôn bật ở cấp org)
  -- "production" trong mọi tài liệu = kind = PRODUCTION

environment_variables
  id, environment_id, key, value?, secret_id? → secrets   -- đúng một trong hai
  U(environment_id, key)

environment_credentials       -- tài khoản test theo vai trò
  id, environment_id, role_name (vd. admin, staff, guest), username,
  password_secret_id → secrets, login_flow_id? → shared_flows, created_at
  U(environment_id, role_name)

secrets
  id, organization_id, project_id?, name, ciphertext bytea, iv bytea, auth_tag bytea,
  key_version int, last_rotated_at?, created_by, created_at
  U(organization_id, project_id, name)
  -- API chỉ trả {id, name, masked: "••••1234"?}; chỉ worker có quyền giải mã

target_hosts
  id, organization_id, project_id?, host_pattern (vd. staging.example.com, *.example.vn),
  allow_private_network bool,      -- cho host phân giải ra IP nội bộ (staging trong LAN)
  allowed_cidrs cidr[]?,           -- bắt buộc khi allow_private_network
  verification_method (DNS_TXT|WELL_KNOWN_FILE|ADMIN_APPROVAL|LOCAL_NETWORK),
  verification_token, verified_at?, verified_by?, expires_at?, created_by, created_at
  U(organization_id, host_pattern)
  -- LOCAL (D-23): localhost, 127.0.0.1, IP/hostname LAN. Không xác minh DNS; dùng LOCAL_NETWORK:
  --   host phải nằm trong allowed_cidrs mà Admin đã bật một lần cho org.
  --   Kiểu cài Cá nhân: worker đổi localhost/127.0.0.1 → host.docker.internal (cổng giữ nguyên).
  --   IP metadata cloud (169.254.169.254, fd00:ec2::254...) luôn bị chặn, kể cả khi bật private network.

execution_policies
  id, organization_id, environment_id?    -- null = mặc định của org
  allowed_test_types test_type[],
  max_perf_rps int, max_perf_duration_s int, max_vus int,
  require_approval_perf bool, require_approval_active_security bool,
  allow_write_requests bool,          -- PRODUCTION mặc định false; LOCAL/DEV mặc định true
  max_concurrent_jobs_per_host int, created_at, updated_at
```

## 5. Định nghĩa kiểm thử

```text
test_plans
  id, project_id, name, description?, objective?, target_version?,
  environment_id?, scope jsonb   -- {suiteIds[], caseIds[], testTypes[], purposes[], tags[]}
  matrix jsonb?                  -- {browsers[], viewports[]} cho test UI
  options jsonb                  -- {retry:{maxErrorRetries:1, retryFailed:false}, failOnConsoleError, includeQuarantined}
  exit_criteria text?, quality_gate_id? → quality_gates,
  template_key?, status (DRAFT|ACTIVE|ARCHIVED), created_by, created_at, updated_at

test_suites
  id, project_id, parent_id? → test_suites, name, description?, sort_order, archived_at?, created_at, updated_at
  I(project_id, parent_id)

test_cases
  id, project_id, case_key (vd. QSNET-TC-0123, sinh tuần tự theo project) ,
  title, description?, test_type, test_purpose[]?, test_level?, test_method,
  priority, preconditions?, expected_result?,
  status case_status, automation_status,
  source case_source, source_ref?   -- vd. rule:form.required:<sitePageId>:<field>, ai:<generationId>
  dedup_key?                        -- chống sinh trùng
  target_page_id? → site_pages, target_endpoint_id? → discovered_endpoints,
  api_request_id? → api_requests,   -- test API một request
  writes_data bool                  -- tự tính khi lưu: có bước DSL/API ghi dữ liệu (POST/PUT/PATCH/DELETE, submit form)
  read_only_confirmed bool          -- người tạo xác nhận case chỉ đọc → được chạy tự động trên production
  current_version int, archived_at?, created_by, updated_by, created_at, updated_at
  U(project_id, case_key), U(project_id, dedup_key) WHERE dedup_key IS NOT NULL
  I(project_id, status, test_type), GIN(title gin_trgm_ops) cho tìm kiếm

test_suite_cases              -- một case thuộc nhiều suite
  suite_id, test_case_id, sort_order;  PK(suite_id, test_case_id)

test_steps
  id, test_case_id, step_order, action (lời mô tả), test_data jsonb?, expected_result?,
  automation jsonb?             -- 1 bước DSL, schema ở packages/test-dsl
  U(test_case_id, step_order)

test_case_versions            -- lịch sử; ghi mỗi lần sửa
  id, test_case_id, version, snapshot jsonb (case + steps), changed_by, change_note?, created_at
  U(test_case_id, version)

tags              id, project_id, name, color?;  U(project_id, name)
test_case_tags    test_case_id, tag_id;  PK(test_case_id, tag_id)

shared_flows                  -- chuỗi bước DSL tái sử dụng, vd. "Đăng nhập admin"
  id, project_id, name, description?, steps jsonb, params jsonb, created_by, created_at, updated_at

test_data_sets
  id, project_id, name, columns text[], rows jsonb, created_by, created_at, updated_at
  -- shortcut: lưu rows trong jsonb, giới hạn 5.000 dòng; lớn hơn thì chuyển sang artifact CSV
```

### 5.1. API testing

```text
api_collections
  id, project_id, name, description?, source (MANUAL|OPENAPI|POSTMAN|DISCOVERY|K6_IMPORT),
  source_ref?, created_at, updated_at

api_requests
  id, collection_id, name, folder?, method, url_template (vd. {{apiBaseUrl}}/users/{{userId}}),
  headers jsonb, query_params jsonb, body_type (NONE|JSON|FORM|MULTIPART|RAW),
  body jsonb?, auth jsonb          -- {type: none|bearer|basic|apiKey|flow, secretId?, flowRequestId?}
  assertions jsonb                 -- [{source: status|header|jsonpath|body|duration|schema, path?, operator, expected}]
  extract jsonb                    -- [{var, source, path}] cho chaining
  response_schema jsonb?           -- từ OpenAPI
  is_write bool                    -- tự suy từ method; production + policy chặn
  success_rule jsonb?              -- vd. body.success != false (thay cho logic riêng trong k6-perf)
  error_rules jsonb                -- [{when, kind}] phân loại lỗi, vd. body.error == RATE_LIMITED → rate_limited
  timeout_ms, sort_order, created_at, updated_at
```

Ghi chú: spec 1.0 tách `api_assertions` thành bảng. Ở đây gộp vào `jsonb` vì assertion luôn được đọc/ghi cùng request và không cần thống kê theo từng assertion; kết quả từng assertion vẫn lưu ở `api_run_results.assertion_results`.

### 5.2. Hiệu năng (thay cho `endpoints.json`, `profiles.json`, `slo.json` của `k6-perf`)

```text
performance_profiles          -- seed sẵn smoke/load/stress/spike/soak; org có thể thêm
  id, organization_id?, key, label, executor (ramping-arrival-rate),
  start_rate, stages jsonb [{target, duration}], is_system bool
  U(organization_id, key)

performance_scenarios
  id, project_id, name, kind (API|PAGE),
  items jsonb          -- API: [{apiRequestId, weight}] ; PAGE: [{url, weight}]
  setup jsonb?         -- {requestIds[]}: chạy 1 lần trong setup(), vd. login lấy token
  profile_id → performance_profiles, rate_scale numeric (0, 20],
  slo jsonb            -- {p95Ms: 1000, successRate: 0.99, availability: 0.999}
  per_item_slo jsonb?, created_by, created_at, updated_at
```

### 5.3. Bảo mật, visual, gate, lịch

```text
security_scan_configs
  id, project_id, name, mode (HEADERS_TLS|ZAP_BASELINE|ZAP_API|ZAP_FULL),
  scope jsonb (include/exclude URL regex), openapi_collection_id?,
  auth jsonb?, max_duration_min, created_at, updated_at

visual_baselines
  id, test_case_id, step_order, browser, viewport, artifact_id → artifacts,
  threshold numeric, approved_by, approved_at, superseded_at?
  I(test_case_id, step_order, browser, viewport) WHERE superseded_at IS NULL

quality_gates
  id, project_id, name, rules jsonb   -- [{metric, operator, value, mandatory}] (xem 07-reporting-and-scoring.md)
  created_by, created_at, updated_at

schedules
  id, project_id, name, cron, timezone, target (PLAN|QUICK_SCAN|PERF_SCENARIO|SECURITY_CONFIG),
  target_id, environment_id, enabled, next_run_at, last_run_id?, created_by, created_at, updated_at
  I(enabled, next_run_at)
```

## 6. Khám phá (Discovery)

```text
discovery_runs                -- dùng chung cho crawler và AI Explorer (D-29)
  id, project_id, environment_id, mode (CRAWLER|AI_EXPLORER),
  config jsonb (startUrls, maxDepth, maxPages, credentialRole?, include/exclude;
                AI_EXPLORER: goal?, maxSteps, maxMinutes, allowWrites),
  status run_status, pages_found, endpoints_found, transitions_found, flows_proposed,
  ai_generation_id? → ai_generations, triggered_by, started_at?, completed_at?, error?, created_at

site_pages
  id, project_id, discovery_run_id, url, normalized_path (vd. /products/:id), title?, http_status,
  depth, load_ms?, screenshot_artifact_id?,
  forms jsonb      -- [{selector, action, method, fields:[{name,label,type,required,pattern,min,max,maxlength,options[]}]}]
  links_out int, console_errors jsonb, failed_requests jsonb, requires_auth bool, created_at
  I(project_id, normalized_path)

discovered_endpoints
  id, project_id, method, path_template, source (NETWORK|OPENAPI|POSTMAN),
  sample_status?, seen_on_page_ids uuid[], first_seen_at, last_seen_at,
  api_request_id? → api_requests
  U(project_id, method, path_template)

recorder_sessions             -- phiên ghi bằng trình duyệt từ xa trong Hub (D-27 sửa lại)
  id, user_id → users, project_id, environment_id, start_url, viewport (vd. 1280x800),
  status (ACTIVE|FINISHED|EXPIRED|CANCELLED), steps jsonb   -- bản nháp bước DSL + id ảnh, lưu dần để mất kết nối không mất bước
  test_case_id? → test_cases, started_at, last_input_at, ended_at?
  U(user_id) WHERE status = 'ACTIVE'   -- mỗi người 1 phiên; hết hạn khi không thao tác 10 phút hoặc quá 30 phút

site_transitions              -- cạnh của Sơ đồ luồng (D-28)
  id, project_id, discovery_run_id?, from_page_id → site_pages,
  to_page_id? → site_pages  -- null = bước chuyển dự kiến (form/nút chưa bấm, chờ AI Explorer/Recorder điền đích)
  trigger jsonb     -- {kind: LINK|BUTTON|FORM_SUBMIT|REDIRECT, locator, label}
  trigger_hash      -- hash(kind, locator chuẩn hóa) để chống trùng
  source (DISCOVERY|AI_EXPLORER|RECORDER), requires_auth bool, first_seen_at, last_seen_at
  U(project_id, from_page_id, to_page_id, trigger_hash) NULLS NOT DISTINCT   -- PG15+, để cạnh dự kiến không bị trùng

test_case_transitions         -- test case nào đi qua bước chuyển nào (tính độ phủ luồng)
  test_case_id, transition_id;  PK(test_case_id, transition_id)
  -- ghi khi lưu bước DSL (goto/click/submit khớp trigger) và khi Recorder tạo case
  -- Độ phủ luồng = |transition có ≥ 1 test case ACTIVE| / |transition của project|
```

## 7. Thực thi

```text
test_runs
  id, project_id, organization_id, test_plan_id?, environment_id?, name,
  kind (PLAN|AD_HOC|QUICK_SCAN|PERF|SECURITY|DISCOVERY|AI_EXPLORER|IMPORT|RETEST),
  execution_source, status run_status,
  branch?, commit_sha?, build_number?, app_version?,
  triggered_by_user_id?, service_account_id?, schedule_id?, retest_of_finding_id?,
  result_summary jsonb   -- đếm theo test_status, cập nhật khi xong (cache cho danh sách)
  started_at?, completed_at?, created_at
  I(project_id, created_at DESC), I(organization_id, created_at DESC), I(project_id, branch, build_number)

run_jobs                      -- một run chia thành nhiều job theo runner
  id (= BullMQ jobId), test_run_id, runner (manual|api|playwright|k6|audit|zap|visual|discovery|ai-explorer|import),
  queue, config_snapshot jsonb (đã bỏ secret), status run_status,
  requires_approval bool, approval_id?, cancel_requested bool,
  attempts_made int, max_attempts int, lease_until?, worker_id?,
  error_code?, error_message?, progress jsonb, started_at?, completed_at?, created_at
  I(status, lease_until)

execution_approvals
  id, run_job_id, requested_by, reason?, config_digest (hash cấu hình được duyệt),
  status approval_status, decided_by?, decided_at?, decision_note?, expires_at, created_at
  -- cấu hình đổi sau khi duyệt → digest khác → phải duyệt lại

test_run_items
  id, test_run_id, run_job_id, test_case_id?, case_version?, external_test_id?,
  test_name_snapshot, test_type, browser?, viewport?, priority_snapshot,
  status test_status            -- trạng thái CUỐI (attempt cuối)
  first_attempt_status test_status?
  attempt_count int, assigned_to_user_id?, duration_ms?, created_at
  I(test_run_id), I(test_case_id, created_at DESC)

test_attempts
  id, run_item_id, attempt_number, status test_status, duration_ms?, started_at?, completed_at?,
  runner_name, runner_version, error_code?, error_message?, result_metadata jsonb
  U(run_item_id, attempt_number)

test_results
  id, attempt_id U, normalized_status test_status, summary?, actual_result?,
  expected_result_snapshot?, executed_by_user_id?, failure_category?,
  failure_category_source (RULE|AI|HUMAN)?,
  ai_analysis_id? → ai_generations   -- phân tích nguyên nhân tự động (D-26); kết quả cùng chữ ký lỗi dùng chung 1 bản
  created_at

step_results                  -- kết quả từng bước (manual và DSL)
  id, attempt_id, step_order, status test_status, actual?, duration_ms?, screenshot_artifact_id?, error?
  U(attempt_id, step_order)

api_run_results
  id, attempt_id, request_snapshot jsonb (đã redact), response_status?, response_headers jsonb (đã redact),
  response_body_artifact_id?, response_size_bytes?, response_time_ms?, assertion_results jsonb

run_metrics                   -- số liệu dạng chỉ số: k6, Lighthouse, Web Vitals
  id, run_job_id, scope (RUN|ITEM|ENDPOINT|PAGE|WINDOW), scope_ref?, key, value numeric, unit, labels jsonb
  I(run_job_id, scope, key)
  -- vd. key=http_req_duration.p95 scope=ENDPOINT scope_ref=web.dashboard value=812 unit=ms

execution_logs                -- phân vùng theo tháng, giữ 30 ngày
  id, run_job_id, attempt_id?, level, message, ts, metadata jsonb
  PARTITION BY RANGE (ts)
  -- log dài (k6.log, console trình duyệt) lưu thành artifact, bảng này chỉ giữ dòng quan trọng
```

## 8. Finding và artifact

```text
findings
  id, project_id, organization_id, title, description?, severity, priority?, status finding_status,
  category (FUNCTIONAL|PERFORMANCE|SECURITY|ACCESSIBILITY|COMPATIBILITY|WEB_STANDARDS|OTHER),
  source (MANUAL|RUNNER|AI), rule_id?   -- vd. zap:10038, axe:color-contrast, lighthouse:largest-contentful-paint
  fingerprint?                          -- hash(project, rule_id, normalized target); null cho finding thủ công
  user_impact?                          -- câu giải thích bằng lời thường (sinh từ template)
  recommendation?, reproduction_steps jsonb, environment_id?,
  first_seen_run_id?, last_seen_run_id?, occurrence_count int,
  external_issue_url?, external_issue_key?,
  created_by_user_id?, assignee_user_id?, resolved_at?, created_at, updated_at
  U(project_id, fingerprint) WHERE fingerprint IS NOT NULL
  I(project_id, status, severity)

finding_occurrences           -- thay finding_test_results của spec 1.0
  id, finding_id, test_run_id, test_result_id?, location jsonb (url, selector, endpoint...), evidence jsonb, created_at
  -- finding đã RESOLVED/CLOSED mà xuất hiện lại → REOPENED (audit log ghi lý do)

finding_comments              -- trao đổi tối thiểu về finding, không phải workflow task
  id, finding_id, user_id, body, created_at

artifacts
  id, organization_id, project_id, run_job_id?, attempt_id?, finding_id?, site_page_id?,
  kind (SCREENSHOT|VIDEO|TRACE|HAR|LOG|REPORT_HTML|REPORT_JSON|ATTACHMENT|BASELINE),
  file_name, storage_key U, mime_type, file_size, checksum_sha256,
  retain_until?, created_by?, created_at
```

## 9. Tổng hợp cho dashboard

```text
daily_result_stats            -- cập nhật khi run hoàn tất (upsert cộng dồn)
  organization_id, project_id, environment_id?, day date (theo timezone của org),
  test_type, runner, execution_source, executed_by_user_id?, triggered_by_user_id?, service_account_id?,
  final_passed, final_failed, final_blocked, final_skipped, final_error, final_cancelled, final_na,
  first_passed, first_failed, first_error,
  attempts_total, attempts_passed, attempts_failed, attempts_error,
  items_scheduled, duration_ms_total, runs_count
  PK(organization_id, project_id, environment_id, day, test_type, runner, execution_source,
     executed_by_user_id, triggered_by_user_id, service_account_id)  -- dùng sentinel uuid cho null
  -- lọc theo branch/build/commit không đi qua bảng này: query test_runs + test_run_items (có index)

test_case_stats               -- phục vụ flaky và "test lâu chưa chạy"
  test_case_id, environment_id, last_run_at, last_status, recent_statuses test_status[] (20 lần gần nhất),
  flip_rate numeric, is_flaky bool, quarantined bool, updated_at
  PK(test_case_id, environment_id)

quality_scores
  id, project_id, environment_id?, test_run_id?, period_start?, period_end?,
  dimension quality_dimension, score numeric?  -- null = chưa kiểm tra
  coverage numeric?, confidence (HIGH|MEDIUM|LOW), inputs jsonb (số liệu đầu vào để tái tính),
  formula_version text, computed_at
  I(project_id, dimension, computed_at DESC)
  -- inputs của FUNCTIONAL có thêm flow_coverage {coveredTransitions, totalTransitions} (D-28);
  --   độ phủ luồng hiển thị riêng trên báo cáo, không trộn vào điểm

gate_evaluations
  id, quality_gate_id, test_run_id, result gate_result, rule_results jsonb,
  signed_off_by?, signed_off_at?, sign_off_note?, created_at
```

## 10. AI, báo cáo, thông báo, audit

```text
ai_provider_configs           -- seed sẵn 1 dòng provider=gemini, purpose=DEFAULT, is_active=false
                              -- (bật khi Admin nhập API key); đổi provider/model không cần sửa code (D-25)
  id, organization_id, provider (gemini|openai|anthropic|openai_compatible), model,
  base_url?, api_key_secret_id → secrets, purpose (DEFAULT|GENERATION|ANALYSIS|SUMMARY|EXPLORATION),
  send_production_data bool default false,   -- dữ liệu môi trường PRODUCTION chỉ gửi khi Admin bật
  monthly_token_budget?, max_analyses_per_run int default 20, is_active, created_at
  U(organization_id, purpose) WHERE is_active   -- purpose không có cấu hình riêng → dùng DEFAULT

ai_generations
  id, organization_id, project_id?, requested_by?  -- null khi hệ thống tự gọi (phân tích lỗi tự động),
  generation_type (TEST_CASES|FAILURE_ANALYSIS|REPORT_SUMMARY|DSL_STEPS|PLAN|EXPLORATION),
  error_signature?   -- hash(runner, error_code, message chuẩn hóa, locator/endpoint); cùng run + cùng chữ ký → dùng lại 1 phân tích
  input_reference jsonb (id các đối tượng đầu vào, không lưu secret), prompt_version,
  provider, model, output jsonb, status (PENDING|COMPLETED|FAILED|DISCARDED),
  tokens_in?, tokens_out?, cost_usd?, latency_ms?, error?, created_at
  I(project_id, generation_type, error_signature)

ai_feedback
  id, generation_id, user_id, rating (-1|1),
  reason_code (DUPLICATE|WRONG_BEHAVIOR|TOO_VAGUE|NOT_RELEVANT|OTHER)?, feedback?, created_at

report_snapshots
  id, organization_id, project_id?, report_type, filter_snapshot jsonb, timezone,
  data jsonb (số liệu đã tính, để bản xuất khớp đúng lúc tạo), storage_key?, format?,
  generated_by, created_at

report_shares
  id, report_snapshot_id, token_hash U, expires_at, revoked_at?, view_count, created_by, created_at

notification_channels
  id, organization_id, type (EMAIL|SLACK|TEAMS|TELEGRAM|WEBHOOK), name, config jsonb, secret_id?, is_active, created_at

notification_rules
  id, organization_id, project_id?, event (RUN_COMPLETED|RUN_FAILED|GATE_FAILED|FINDING_CRITICAL|APPROVAL_REQUESTED|SCHEDULE_ERROR),
  channel_id, filter jsonb?, is_active, created_at

notification_deliveries
  id, rule_id, event_ref, status (SENT|FAILED), attempts, last_error?, created_at

audit_logs                    -- chỉ thêm; phân vùng theo tháng; không có quyền UPDATE/DELETE cho user ứng dụng
  id, organization_id, actor_user_id?, actor_service_account_id?, action (vd. run.approve, secret.read_by_worker),
  entity_type, entity_id?, metadata jsonb, ip?, user_agent?, created_at
  I(organization_id, created_at DESC), I(entity_type, entity_id)
```

## 11. Index và hiệu năng

- Index đã nêu ở từng bảng; thêm index khi có query thực tế chậm (đo bằng `pg_stat_statements`), không thêm trước.
- `execution_logs`, `audit_logs` phân vùng theo tháng; xóa vùng cũ thay vì `DELETE`.
- `test_run_items`, `test_attempts`, `test_results` chưa phân vùng; xét lại khi vượt ~50 triệu dòng.
- Dashboard chỉ đọc `daily_result_stats`, `quality_scores`, `findings`; drill-down mới chạm bảng thô và luôn có `LIMIT` + phân trang theo cursor.

## 12. Thay đổi so với spec 1.0 mục 6

| Spec 1.0 | Bản này | Lý do |
|---|---|---|
| `test_cases.suite_id` | `test_suite_cases` (m:n) | Spec yêu cầu không khóa đường một case nhiều suite |
| `api_assertions` (bảng) | `api_requests.assertions` (jsonb) | Luôn đọc/ghi cùng request |
| `finding_test_results` | `finding_occurrences` | Cần lưu vị trí và bằng chứng mỗi lần xuất hiện, phục vụ chống trùng |
| `environments.secret_reference` | `secrets` + `environment_variables` + `environment_credentials` | Cần vault thật và nhiều tài khoản test theo vai trò |
| Không có | `run_jobs`, `execution_approvals`, `execution_policies`, `target_hosts` | Orchestrator nhiều runner, duyệt, allowlist |
| Không có | `discovery_runs`, `site_pages`, `discovered_endpoints` | Tính năng Discovery |
| Không có | `performance_*`, `security_scan_configs`, `visual_baselines` | Runner mới |
| Không có | `daily_result_stats`, `test_case_stats`, `quality_scores`, `gate_evaluations` | Dashboard nhanh, flaky, chỉ số sức khỏe, gate |
| Không có | `step_results`, `run_metrics` | Kết quả từng bước; chỉ số k6/Lighthouse |
| Không có | `test_case_versions`, `shared_flows`, `test_data_sets` | Lịch sử, tái sử dụng, data-driven |
| Không có | `environments.kind`, `testing_enabled`; `organizations.production_testing_enabled`, `local_testing_enabled` | Local-first, công tắc bật/tắt test (D-23, D-24) |
| Không có | `site_transitions`, `test_case_transitions`, `discovery_runs.mode` | Sơ đồ luồng, độ phủ luồng, AI Explorer (D-28, D-29) |
| Không có | `recorder_sessions` | Recorder là trình duyệt từ xa trong Hub (D-27 sửa lại) |
| Không có | `test_results.ai_analysis_id`, `ai_generations.error_signature` | AI tự phân tích lỗi, không phân tích trùng (D-26) |
