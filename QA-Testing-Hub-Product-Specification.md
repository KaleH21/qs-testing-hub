# QA Testing Hub --- Product Requirements & Technical Specification

> **Mục tiêu:** Xây dựng một nền tảng kiểm thử phần mềm dùng chung cho
> cá nhân và công ty, có thể kiểm thử nhiều dự án khác nhau, tổng hợp
> kết quả theo loại kiểm thử, dự án và từng thành viên trên một
> Dashboard tập trung.
>
> **Định hướng sản phẩm:** QA Testing Hub là công cụ kiểm thử, thực thi,
> báo cáo và phân tích chất lượng phần mềm. Đây **không phải** Jira,
> không phải hệ thống quản lý công việc hay quản lý vòng đời dự án tổng
> quát.

-   Phiên bản tài liệu: 1.0
-   Trạng thái: Product specification / MVP baseline
-   Ngôn ngữ giao diện mặc định: Tiếng Việt; hỗ trợ mở rộng tiếng Anh
-   Đối tượng sử dụng: Developer, QA Engineer, Tester, Tech Lead,
    Engineering Manager và quản trị viên công ty

------------------------------------------------------------------------

## 1. Tầm nhìn và mục tiêu sản phẩm

QA Testing Hub cung cấp một nơi duy nhất để:

1.  Kết nối hoặc khai báo nhiều dự án phần mềm của cá nhân/công ty.
2.  Chạy, nhập hoặc ghi nhận kết quả kiểm thử từ nhiều công cụ.
3.  Quản lý test case, test suite, test plan và các lần thực thi ở mức
    cần thiết cho testing.
4.  Hỗ trợ manual testing và automated testing.
5.  Tổng hợp báo cáo theo:
    -   Toàn công ty.
    -   Từng dự án.
    -   Từng thành viên thực hiện test.
    -   Từng loại kiểm thử.
    -   Phiên bản/build/branch/môi trường.
    -   Khoảng thời gian.
6.  Hỗ trợ AI tạo test case, phân tích kết quả thất bại, phát hiện vùng
    thiếu kiểm thử và tạo bản tóm tắt báo cáo.
7.  Theo dõi xu hướng chất lượng phần mềm qua nhiều lần chạy, không chỉ
    xem kết quả của một lần test.

### 1.1. Những gì sản phẩm KHÔNG làm

Không xây dựng các tính năng quản lý dự án kiểu Jira:

-   Không quản lý sprint, backlog, story point hoặc task board.
-   Không quản lý tiến độ công việc tổng quát.
-   Không thay thế GitHub/GitLab, Jira, Linear hoặc hệ thống quản lý
    nhân sự.
-   Không xây dựng hệ thống quản lý source code.
-   Không tự động khẳng định một dự án "đạt chất lượng" chỉ dựa trên một
    con số pass rate.

Chỉ xây dựng các thành phần liên quan trực tiếp đến kiểm thử, thực thi,
kết quả, lỗi phát hiện trong kiểm thử, báo cáo và thống kê.

### 1.2. Nguyên tắc sản phẩm

-   **Multi-project:** Một tài khoản/công ty có thể kiểm thử nhiều dự
    án.
-   **Multi-user:** Kết quả gắn với người thực hiện, người khởi chạy
    hoặc tài khoản CI/service account.
-   **Tool-agnostic:** Không phụ thuộc vào một framework testing duy
    nhất.
-   **Unified reporting:** Chuẩn hóa kết quả từ nhiều công cụ về cùng
    một mô hình.
-   **Traceability:** Có thể truy ngược báo cáo đến lần chạy, test case,
    log và artifact.
-   **Safe by default:** Không chạy tải lớn, security scan xâm nhập hoặc
    test phá hoại khi chưa được cấp quyền.
-   **AI as assistant:** AI chỉ đề xuất; người dùng duyệt các nội dung
    quan trọng.

------------------------------------------------------------------------

## 2. Phạm vi kiểm thử cần hỗ trợ

Nền tảng phải có khả năng ghi nhận hoặc thực thi các nhóm dưới đây.
Không phải tất cả loại test đều do Hub tự viết engine; với nhiều loại,
Hub tích hợp runner hoặc nhập kết quả từ công cụ bên ngoài.

  ------------------------------------------------------------------------------
  Nhóm                    Loại kiểm thử                  Cách hỗ trợ
  ----------------------- ------------------------------ -----------------------
  Functional              Positive, Negative, Boundary,  Manual và test runner
                          Validation, Business Logic     

  Testing levels          Unit, Integration, System,     Import report, runner
                          End-to-End, Acceptance/UAT     hoặc manual

  Regression              Regression, Re-testing, Smoke, Test suite và lịch sử
                          Sanity                         chạy

  API                     REST API, HTTP assertions,     Runner tích hợp
                          schema, auth, chaining         

  UI/Browser              Browser workflow, UI           Playwright runner
                          assertions, cross-browser      

  Performance             Load, Stress, Spike,           k6 runner
                          Endurance, Volume              

  Security                DAST,                          OWASP ZAP và kiểm tra
                          authentication/authorization   chuyên biệt
                          checks, OWASP checks           

  Compatibility           Browser, OS, viewport, device  Browser/device matrix
                          profile                        hoặc report import

  Usability               Checklist đánh giá và kết quả  Manual
                          review                         

  Accessibility           WCAG-oriented checks, axe scan Tool integration và
                                                         manual

  Reliability             Stability, soak, fault         Runner/script và report
                          tolerance                      import

  Recovery                Backup/restore, restart,       Kịch bản có phê duyệt
                          failover, recovery checks      và manual

  Installation            Install, upgrade, rollback,    Manual/agent hoặc
                          uninstall                      report import

  Exploratory             Session-based exploratory      Session notes, findings
                          testing                        và evidence
  ------------------------------------------------------------------------------

### 2.1. Phân biệt khả năng thực thi và khả năng ghi nhận

Mỗi loại kiểm thử phải khai báo một trong các execution modes:

-   `MANUAL`: Người dùng thực hiện và nhập kết quả.
-   `NATIVE_RUNNER`: Hub thực thi bằng runner được tích hợp.
-   `EXTERNAL_IMPORT`: Nhập kết quả từ công cụ/CI bên ngoài.
-   `HYBRID`: Kết hợp nhiều phương thức.

Ví dụ:

-   Unit Testing thường được chạy trong pipeline bằng Jest, Vitest,
    JUnit, Pytest; Hub nhận JUnit XML hoặc định dạng report tương ứng.
-   Performance Testing dùng k6; Hub điều phối job và đọc metrics.
-   Security Testing dùng OWASP ZAP; Hub quản lý scope, approval, scan
    job và findings.
-   UAT thường là manual sign-off; không nên giả định có thể tự động hóa
    hoàn toàn.

------------------------------------------------------------------------

## 3. Người dùng, tổ chức và phân quyền

### 3.1. Mô hình sử dụng

Hỗ trợ hai phạm vi:

1.  **Personal Workspace:** Người dùng kiểm thử các dự án cá nhân.
2.  **Organization Workspace:** Công ty có nhiều thành viên, nhiều dự án
    và báo cáo tập trung.

Một người có thể tham gia nhiều organization. Mỗi organization có các
project và thành viên riêng.

### 3.2. Vai trò

  -----------------------------------------------------------------------
  Role                                Quyền chính
  ----------------------------------- -----------------------------------
  Organization Owner                  Toàn quyền organization, thành
                                      viên, cấu hình và dữ liệu

  Organization Admin                  Quản trị thành viên, project, môi
                                      trường và tích hợp

  QA Lead                             Quản lý test plan/suite, phân công
                                      và xem báo cáo phạm vi được cấp

  Tester                              Chạy manual test, xem và cập nhật
                                      kết quả được phép

  Developer                           Chạy test, xem kết quả, tạo/cập
                                      nhật bug finding

  Viewer/Manager                      Chỉ xem dashboard và báo cáo

  Service Account                     Gửi kết quả tự động từ CI/CD hoặc
                                      công cụ bên ngoài
  -----------------------------------------------------------------------

Quyền phải được kiểm tra ở backend theo organization và project; không
chỉ ẩn nút ở frontend.

### 3.3. Phân biệt người thực hiện và nguồn thực thi

Mỗi lần chạy cần lưu riêng:

-   `triggered_by_user_id`: Người bấm chạy hoặc tạo job.
-   `executed_by_user_id`: Người thực hiện manual test, nếu có.
-   `service_account_id`: Tài khoản CI/automation, nếu chạy tự động.
-   `execution_source`: `MANUAL`, `WEB`, `API`, `CI`, `SCHEDULED`,
    `IMPORTED`.
-   `runner_name` và `runner_version`.

Không gán kết quả CI cho một cá nhân nếu không có dữ liệu đáng tin cậy.
Dashboard phải phân biệt kết quả do cá nhân thực hiện với kết quả do
service account/CI thực hiện.

------------------------------------------------------------------------

## 4. Khái niệm dữ liệu cốt lõi

### 4.1. Project

Project ở đây chỉ là **đối tượng phân nhóm kết quả kiểm thử**, không
phải công cụ quản lý dự án.

Thông tin tối thiểu:

-   Tên, mã project, mô tả.
-   Organization sở hữu.
-   Repository URL tùy chọn.
-   Công nghệ chính tùy chọn.
-   Thành viên được quyền truy cập.
-   Môi trường kiểm thử.
-   Trạng thái hoạt động/lưu trữ.

### 4.2. Environment

Ví dụ: Local, Development, QA, Staging, Production.

Lưu tên, base URL, metadata và tham chiếu đến secret. Không lưu
credential dạng plain text hoặc trả secret về frontend.

### 4.3. Test Plan

Một kế hoạch kiểm thử cho một mục tiêu cụ thể, ví dụ:

-   Regression trước release 1.4.0.
-   Kiểm thử module nhập kho.
-   Security assessment cho bản staging.
-   UAT cho quy trình sản xuất.

Test Plan không phải sprint hay backlog.

### 4.4. Test Suite và Test Case

-   Test Suite: nhóm test case theo module, tính năng hoặc mục đích.
-   Test Case: một trường hợp kiểm thử có mục tiêu và điều kiện rõ ràng.
-   Test Step: từng bước thao tác và expected result.
-   Test Case có thể được gắn nhiều tag và loại kiểm thử.

Một test case có thể thuộc nhiều suite nếu mô hình quan hệ được thiết kế
hỗ trợ; nếu MVP dùng một suite chính, cần tránh khóa thiết kế khiến
không thể mở rộng.

### 4.5. Test Run và Test Result

-   Test Run: một lần thực thi một tập test.
-   Test Run Item: một test case hoặc một đơn vị test được đưa vào lần
    chạy.
-   Test Attempt: một lần thử thực tế của một item, hỗ trợ retry.
-   Test Result: kết quả chuẩn hóa của attempt.
-   Artifact: screenshot, video, trace, log, report, file đính kèm.

Không ghi đè kết quả cũ khi chạy lại. Lịch sử phải bất biến hoặc có
audit trail.

### 4.6. Finding / Bug

Finding là lỗi hoặc vấn đề được phát hiện trong quá trình test. Hub có
thể quản lý finding ở mức tối thiểu:

-   Tiêu đề, mô tả, severity, trạng thái.
-   Project, test run, test result liên quan.
-   Evidence và bước tái hiện.
-   Người tạo, người phụ trách.
-   External issue URL/ID tùy chọn để liên kết Jira/GitHub Issues/GitLab
    Issues.

Không xây dựng workflow quản lý công việc thay thế Jira.

------------------------------------------------------------------------

## 5. Kiến trúc hệ thống

### 5.1. Kiến trúc đề xuất

Sử dụng **Modular Monolith + Isolated Execution Workers** cho MVP.

Lý do:

-   Dễ phát triển và triển khai với team nhỏ.
-   Không tạo độ phức tạp microservices quá sớm.
-   Worker có thể scale độc lập với API.
-   Dễ bổ sung runner mới qua adapter interface.

``` text
                    ┌─────────────────────────┐
                    │       React Web         │
                    │ Dashboard / Test /      │
                    │ Reports / AI Assistant  │
                    └────────────┬────────────┘
                                 │ REST / SSE
                    ┌────────────▼────────────┐
                    │       NestJS API        │
                    │ Auth / RBAC / Projects  │
                    │ Test Mgmt / Results     │
                    │ Reports / AI / Imports  │
                    └──────┬───────────┬──────┘
                           │           │
                     PostgreSQL     Redis/BullMQ
                           │           │
                           │     ┌─────▼─────────────┐
                           │     │ Execution Workers │
                           │     │ API / Playwright  │
                           │     │ k6 / ZAP / Import │
                           │     └─────┬─────────────┘
                           │           │
                    ┌──────▼───────────▼──────┐
                    │   Artifact Storage      │
                    │ Logs / Screenshots /    │
                    │ Videos / Reports        │
                    └─────────────────────────┘
```

### 5.2. Công nghệ

  -----------------------------------------------------------------------
  Thành phần                          Công nghệ
  ----------------------------------- -----------------------------------
  Monorepo                            pnpm workspace

  Frontend                            React + Vite + TypeScript

  UI                                  Tailwind CSS + shadcn/ui

  Routing                             React Router

  Client state                        Redux Toolkit

  Server state                        RTK Query

  Forms                               React Hook Form + Zod

  Backend                             NestJS

  ORM                                 Drizzle ORM

  Database                            PostgreSQL

  Queue                               Redis + BullMQ

  Realtime progress                   Server-Sent Events (SSE)

  Browser runner                      Playwright

  API runner                          Node.js HTTP client + assertion
                                      engine

  Performance                         k6

  Security                            OWASP ZAP

  Unit report import                  JUnit XML và các adapter

  AI                                  Provider adapter cho
                                      Gemini/OpenAI/local model

  File storage                        Local storage ở development;
                                      S3-compatible ở production

  Deployment                          Docker Compose
  -----------------------------------------------------------------------

### 5.3. Cấu trúc repository

``` text
qa-testing-hub/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
├── packages/
│   ├── shared-types/
│   ├── validation/
│   ├── runner-contracts/
│   └── report-normalizers/
├── infrastructure/
│   ├── docker/
│   └── scripts/
├── docs/
│   ├── product-requirements.md
│   ├── architecture.md
│   ├── database-schema.md
│   ├── api-specification.md
│   └── security-model.md
├── docker-compose.yml
├── pnpm-workspace.yaml
└── README.md
```

### 5.4. Backend modules

``` text
src/modules/
├── auth/
├── users/
├── organizations/
├── memberships/
├── projects/
├── environments/
├── test-plans/
├── test-suites/
├── test-cases/
├── test-runs/
├── test-execution/
├── runners/
├── imports/
├── findings/
├── artifacts/
├── dashboards/
├── reports/
├── ai/
├── integrations/
└── audit/
```

------------------------------------------------------------------------

## 6. Database schema

Dùng UUID primary key, timestamp có timezone (`timestamptz`), foreign
key, index và transaction phù hợp. Tất cả dữ liệu nghiệp vụ phải có
organization/project scope rõ ràng.

### 6.1. Organization và User

**users** - id - email (unique) - password_hash hoặc external identity
reference - display_name - avatar_url - status - created_at - updated_at

**organizations** - id - name - slug (unique) - created_by -
created_at - updated_at

**organization_members** - id - organization_id - user_id - role -
joined_at

Unique: `(organization_id, user_id)`.

**service_accounts** - id - organization_id - name - token_hash -
scopes - last_used_at - expires_at - created_at

Chỉ lưu token hash; token bí mật chỉ hiển thị một lần khi tạo.

### 6.2. Project và Environment

**projects** - id - organization_id - key - name - description -
repository_url (nullable) - technology_metadata (jsonb) - status -
created_by - created_at - updated_at

Unique: `(organization_id, key)`.

**project_members** - id - project_id - user_id - role - created_at

Unique: `(project_id, user_id)`.

**environments** - id - project_id - name - base_url (nullable) -
config_metadata (jsonb) - secret_reference (nullable) - is_active -
created_at - updated_at

Không lưu password/API secret trực tiếp trong `config_metadata`.

### 6.3. Test definition

**test_plans** - id - project_id - name - description - target_version
(nullable) - status - created_by - created_at - updated_at

**test_suites** - id - project_id - parent_id (nullable) - name -
description - created_at - updated_at

**test_cases** - id - project_id - suite_id (nullable) - case_key -
title - description - test_type - test_level (nullable) - test_method -
priority - preconditions (text) - expected_result (text) -
automation_status - status - created_by - created_at - updated_at

**test_steps** - id - test_case_id - step_order - action - test_data
(jsonb, nullable) - expected_result - created_at

**test_case_tags** - test_case_id - tag_id

**tags** - id - project_id - name

### 6.4. Execution

**test_runs** - id - project_id - test_plan_id (nullable) -
environment_id (nullable) - name - execution_type - execution_source -
status - branch (nullable) - commit_sha (nullable) - build_number
(nullable) - triggered_by_user_id (nullable) - service_account_id
(nullable) - started_at - completed_at - created_at

**test_run_items** - id - test_run_id - test_case_id (nullable) -
external_test_id (nullable) - test_name_snapshot - test_type - status -
assigned_to_user_id (nullable) - created_at

**test_attempts** - id - run_item_id - attempt_number - status -
duration_ms - started_at - completed_at - runner_name - runner_version -
error_message (nullable) - result_metadata (jsonb)

Unique: `(run_item_id, attempt_number)`.

**test_results** - id - attempt_id - normalized_status - summary -
actual_result (text) - expected_result_snapshot (text) -
executed_by_user_id (nullable) - failure_category (nullable) -
created_at

**execution_logs** - id - attempt_id - level - message - timestamp -
metadata (jsonb)

Với log lớn, cần retention policy và storage phù hợp; không giữ vô hạn
trong PostgreSQL.

### 6.5. Findings và Artifacts

**findings** - id - project_id - title - description - severity -
priority - status - reproduction_steps (jsonb) - external_issue_url
(nullable) - created_by_user_id - assignee_user_id (nullable) -
created_at - updated_at

**finding_test_results** - finding_id - test_result_id

**artifacts** - id - organization_id - project_id - attempt_id
(nullable) - finding_id (nullable) - file_name - storage_key -
mime_type - file_size - checksum - created_by - created_at

### 6.6. API Testing

**api_collections** - id - project_id - name - description -
created_at - updated_at

**api_requests** - id - collection_id - name - method - url_template -
headers (jsonb) - query_params (jsonb) - body_type - body (jsonb/text) -
auth_config (jsonb, secret references only) - timeout_ms - created_at -
updated_at

**api_assertions** - id - api_request_id - source - operator -
expected_value (jsonb) - created_at

**api_run_results** - id - attempt_id - request_snapshot (jsonb, redact
secrets) - response_status - response_headers (jsonb, redact secrets) -
response_body_reference (nullable) - response_time_ms -
assertion_summary (jsonb)

### 6.7. AI, Reports và Audit

**ai_generations** - id - organization_id - project_id (nullable) -
requested_by - generation_type - input_reference (jsonb) - provider -
model - output (jsonb) - status - created_at

**ai_feedback** - id - generation_id - user_id - rating - feedback -
created_at

**report_snapshots** - id - organization_id - project_id (nullable) -
report_type - filter_snapshot (jsonb) - storage_key (nullable) -
generated_by - created_at

**audit_logs** - id - organization_id - actor_user_id (nullable) -
actor_service_account_id (nullable) - action - entity_type - entity_id -
metadata (jsonb) - created_at

### 6.8. Quy tắc trạng thái chuẩn hóa

Test status:

-   `PENDING`
-   `QUEUED`
-   `RUNNING`
-   `PASSED`
-   `FAILED`
-   `BLOCKED`
-   `SKIPPED`
-   `CANCELLED`
-   `ERROR`
-   `NOT_APPLICABLE`

Không đồng nhất `ERROR` với `FAILED`: ERROR có thể là
runner/infrastructure failure, còn FAILED là test assertion hoặc
expected behavior không đạt.

Finding severity:

-   `CRITICAL`
-   `HIGH`
-   `MEDIUM`
-   `LOW`
-   `INFO`

Finding status:

-   `OPEN`
-   `CONFIRMED`
-   `IN_PROGRESS`
-   `RESOLVED`
-   `REOPENED`
-   `ACCEPTED_RISK`
-   `CLOSED`

------------------------------------------------------------------------

## 7. Execution Engine và Runner Adapter

### 7.1. Nguyên tắc

Mỗi loại kiểm thử được xử lý bởi runner riêng, nhưng tất cả kết quả phải
được chuẩn hóa về cùng mô hình.

``` ts
interface TestRunner<TConfig = unknown> {
  readonly type: string;

  validate(config: TConfig): Promise<void>;

  execute(
    context: ExecutionContext,
    config: TConfig
  ): Promise<RunnerResult>;

  cancel?(executionId: string): Promise<void>;
}
```

`RunnerResult` cần có:

-   status
-   summary
-   duration
-   test item results
-   logs
-   metrics
-   findings
-   artifacts
-   runner metadata

### 7.2. Runner cần triển khai theo giai đoạn

  -----------------------------------------------------------------------
  Runner/Adapter          Vai trò                 Giai đoạn
  ----------------------- ----------------------- -----------------------
  Manual Runner           Ghi nhận thao tác và    MVP
                          kết quả người dùng      

  API Runner              Gửi HTTP request và     MVP
                          chạy assertions         

  JUnit XML Importer      Nhập Unit/Integration   MVP hoặc MVP+
                          test report             

  Playwright Runner       UI/E2E browser          Phase 2
                          automation              

  k6 Runner               Performance testing     Phase 3

  OWASP ZAP Adapter       DAST security testing   Phase 3

  Generic Report Importer Chuẩn hóa report ngoài  Phase 2
  -----------------------------------------------------------------------

### 7.3. Queue workflow

1.  User tạo test run.
2.  API kiểm tra quyền, project, environment và execution policy.
3.  API tạo run/items trong transaction.
4.  API enqueue job vào BullMQ.
5.  Worker nhận job và kiểm tra lại quyền/scope.
6.  Runner thực thi trong sandbox.
7.  Worker stream progress/log.
8.  Result collector chuẩn hóa kết quả.
9.  Lưu attempt, result, logs và artifacts.
10. Cập nhật trạng thái run.
11. Dashboard/report được cập nhật.

Phải hỗ trợ timeout, cancellation, retry có kiểm soát, idempotency và xử
lý worker crash.

### 7.4. An toàn khi kiểm thử

Đây là yêu cầu bắt buộc:

-   Chỉ chạy trên hệ thống mà organization/user có quyền kiểm thử.
-   Project phải xác minh domain/target hoặc khai báo allowlist.
-   Chặn SSRF: loopback, private network, link-local, metadata
    endpoints, DNS rebinding và redirect sang target không được phép.
-   Worker chạy container tách biệt, không mount Docker socket.
-   Không chạy script tùy ý trên host.
-   Giới hạn CPU, RAM, process, network, file size và thời gian.
-   Mask credentials trong request/response/log.
-   Không chạy destructive test trên production theo mặc định.
-   Performance test và security scan cần approval, target allowlist,
    giới hạn tải và thời gian.
-   Có audit log cho người tạo, người duyệt, target, thời gian và cấu
    hình chạy.

------------------------------------------------------------------------

## 8. Dashboard và báo cáo

Dashboard là trung tâm sản phẩm. Không biến nó thành bảng quản lý task.

### 8.1. Bộ lọc toàn cục

Dashboard hỗ trợ lọc theo:

-   Organization.
-   Project hoặc tất cả project.
-   Khoảng thời gian.
-   Environment.
-   Test type.
-   Test level.
-   Branch/commit/build.
-   Execution source.
-   Người thực hiện.
-   Người trigger.
-   Runner.

Các filter phải áp dụng nhất quán cho KPI, chart và bảng dữ liệu.

### 8.2. Dashboard cấp công ty

Các KPI:

-   Tổng số test executions.
-   Tổng test cases đã thực thi.
-   Pass rate.
-   Fail rate.
-   Error rate.
-   Blocked/Skipped count.
-   Số findings theo severity.
-   Số project có test activity.
-   Số thành viên có test activity.
-   Thời gian chạy test.
-   Xu hướng chất lượng theo thời gian.

Biểu đồ:

1.  Test result trend theo ngày/tuần/tháng.
2.  Pass/fail/error theo project.
3.  Phân bố kết quả theo test type.
4.  Findings theo severity.
5.  Top project có tỷ lệ failure cao.
6.  Test activity theo thành viên.
7.  Performance trend: p50/p95/p99 latency, throughput, error rate nếu
    có dữ liệu.
8.  Security findings theo severity nếu có scan data.

### 8.3. Dashboard cấp Project

-   Tổng test case.
-   Số test đã chạy.
-   Pass/fail/error/blocked/skipped.
-   Pass rate theo loại test.
-   Test run gần nhất.
-   Test run theo build/branch.
-   Finding đang mở.
-   Xu hướng qua các phiên bản.
-   Các module có nhiều lỗi.
-   Test coverage nếu có dữ liệu coverage đáng tin cậy.

### 8.4. Dashboard cấp thành viên

Cần hiển thị:

-   Số manual test được thực hiện.
-   Số test run được trigger.
-   Số kết quả pass/fail/blocked.
-   Số project đã tham gia kiểm thử.
-   Số findings tạo ra.
-   Số lần re-test.
-   Thời gian thực thi (nếu đo được).
-   Hoạt động theo thời gian.

**Nguyên tắc công bằng:** Không dùng số bug tạo ra hoặc số test pass làm
chỉ số đánh giá năng suất cá nhân một cách độc lập. Kết quả tự động từ
CI/service account không được tự động gán cho người trigger nếu không có
căn cứ. Dashboard cá nhân là thống kê hoạt động kiểm thử, không phải
bảng xếp hạng nhân viên.

### 8.5. Công thức thống kê

Chỉ tính trên các test item đã có kết quả cuối cùng hợp lệ:

``` text
Completed = PASSED + FAILED + BLOCKED + SKIPPED + ERROR

Pass Rate = PASSED / (PASSED + FAILED) * 100

Failure Rate = FAILED / (PASSED + FAILED) * 100

Execution Error Rate =
  ERROR / Completed * 100

Completion Rate =
  Completed / Total Scheduled Items * 100
```

Phải hiển thị mẫu số và số lượng tuyệt đối cùng phần trăm. Nếu mẫu số
bằng 0, hiển thị `N/A`, không hiển thị 0% gây hiểu nhầm.

Với retry, báo cáo cần cho phép chọn: - Kết quả cuối cùng của mỗi test
item. - Tất cả attempts. - Kết quả lần chạy đầu tiên.

Không cộng tất cả attempts như thể đó là các test case độc lập.

### 8.6. Báo cáo

Hỗ trợ:

-   Company Quality Report.
-   Project Test Report.
-   Test Run Report.
-   Test Type Report.
-   Member Activity Report.
-   Findings/Bug Report.
-   Performance Report.
-   Security Report.
-   Release/Build Quality Summary.

Định dạng xuất: CSV, XLSX, PDF và HTML. Báo cáo phải lưu bộ lọc, thời
điểm tạo và timezone.

------------------------------------------------------------------------

## 9. AI Assistant

AI là trợ lý hỗ trợ kiểm thử, không thay thế runner hoặc người chịu
trách nhiệm phê duyệt.

### 9.1. AI Test Case Generator

Input: - Mô tả nghiệp vụ. - API specification/OpenAPI. - Form field và
validation. - Acceptance criteria. - Tài liệu hoặc đoạn code được người
dùng cung cấp.

Output: - Test title. - Test type. - Preconditions. - Steps. - Test
data. - Expected result. - Priority. - Rationale. - Tags.

AI phải đề xuất Positive, Negative, Boundary, Edge Case và Permission
cases khi phù hợp.

Kết quả sinh ra ở trạng thái `DRAFT`; người dùng phải review trước khi
lưu thành test case chính thức.

### 9.2. AI Failure Analyzer

Input: - Test result. - Error message. - Stack trace. - Request/response
đã redact. - Execution logs. - Environment metadata.

Output: - Tóm tắt lỗi. - Failure category dự đoán. - Nguyên nhân có khả
năng. - Bằng chứng hỗ trợ. - Đề xuất bước debug. - Test case bổ sung nên
tạo.

Phải phân biệt: - Product defect. - Test script defect. -
Environment/infrastructure failure. - Test data issue. -
Network/dependency failure. - Unknown.

AI không được tự động đổi status thành PASS hoặc tự đóng finding.

### 9.3. AI Report Summary

Tạo bản tóm tắt: - Chất lượng hiện tại. - Xu hướng tăng/giảm lỗi. -
Project có rủi ro. - Loại test còn thiếu. - Findings nghiêm trọng. -
Khuyến nghị tiếp theo.

Mọi kết luận phải truy xuất được dữ liệu nguồn; nếu dữ liệu thiếu, AI
phải nêu rõ giới hạn.

### 9.4. AI Provider abstraction

``` ts
interface AIProvider {
  generateTestCases(input: TestCaseGenerationInput):
    Promise<TestCaseDraft[]>;

  analyzeFailure(input: FailureAnalysisInput):
    Promise<FailureAnalysis>;

  summarizeReport(input: ReportSummaryInput):
    Promise<ReportSummary>;
}
```

Lưu provider/model/token usage/cost metadata khi có thể. Có thể cấu hình
provider theo organization. Không gửi secret, production credentials
hoặc dữ liệu nhạy cảm cho AI.

------------------------------------------------------------------------

## 10. Frontend navigation và UX

### 10.1. Sidebar

``` text
QA Testing Hub
│
├── Dashboard
│
├── Testing
│   ├── Projects
│   ├── Test Plans
│   ├── Test Suites
│   ├── Test Cases
│   ├── Test Runs
│   └── Test Results
│
├── Test Tools
│   ├── API Testing
│   ├── Browser Testing
│   ├── Unit Test Reports
│   ├── Performance Testing
│   └── Security Testing
│
├── Quality
│   ├── Findings
│   └── Reports
│
├── AI Assistant
│
└── Settings
    ├── Organization
    ├── Members & Roles
    ├── Environments
    ├── Integrations
    └── Execution Policies
```

Không có menu Sprint, Backlog, Task Board, Timesheet hoặc Project
Roadmap.

### 10.2. Các màn hình chính

1.  Login/Register.
2.  Organization selector.
3.  Company Dashboard.
4.  Project list.
5.  Project quality dashboard.
6.  Test plan list/detail.
7.  Test suite tree.
8.  Test case list/detail/editor.
9.  Manual execution workspace.
10. Test run detail với progress/logs.
11. API request builder.
12. Test result detail.
13. Finding list/detail.
14. Reports.
15. AI Assistant.
16. Organization/member/permission settings.

### 10.3. UX principles

-   Giao diện desktop-first, responsive.
-   Sidebar rõ ràng, bảng dữ liệu dễ lọc.
-   Trạng thái test nhất quán.
-   Có empty state, loading state, error state.
-   Có thể drill down từ KPI → project → run → test result →
    log/artifact.
-   Không dùng màu sắc đơn thuần để truyền tải trạng thái; kết hợp
    text/icon.
-   Dữ liệu chart phải có tooltip, đơn vị và khoảng thời gian.
-   Dashboard hỗ trợ lưu filter preset.

------------------------------------------------------------------------

## 11. API design sơ bộ

Base path: `/api/v1`

### Authentication

``` text
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me
```

### Organization và Project

``` text
GET    /organizations
POST   /organizations
GET    /organizations/:id/members
POST   /organizations/:id/members

GET    /projects
POST   /projects
GET    /projects/:id
PATCH  /projects/:id
GET    /projects/:id/environments
POST   /projects/:id/environments
```

### Test Management

``` text
GET    /projects/:id/test-plans
POST   /projects/:id/test-plans
GET    /test-plans/:id
PATCH  /test-plans/:id

GET    /test-suites
POST   /test-suites
PATCH  /test-suites/:id

GET    /test-cases
POST   /test-cases
GET    /test-cases/:id
PATCH  /test-cases/:id
```

### Execution

``` text
POST   /test-runs
GET    /test-runs
GET    /test-runs/:id
POST   /test-runs/:id/cancel
GET    /test-runs/:id/progress
GET    /test-runs/:id/results
POST   /test-results/:id/attachments
```

### API Testing

``` text
GET    /api-collections
POST   /api-collections
POST   /api-collections/:id/requests
POST   /api-requests/:id/execute
GET    /api-requests/:id/history
```

### Findings và Reports

``` text
GET    /findings
POST   /findings
GET    /findings/:id
PATCH  /findings/:id

GET    /reports/company
GET    /reports/projects/:id
GET    /reports/members/:id
GET    /reports/test-types
POST   /reports/export
```

### AI

``` text
POST   /ai/generate-test-cases
POST   /ai/analyze-failure
POST   /ai/summarize-report
POST   /ai/feedback
```

Mọi endpoint phải có DTO validation, pagination, permission checks,
error format thống nhất và OpenAPI documentation.

------------------------------------------------------------------------

## 12. Kế hoạch triển khai

Ưu tiên xây dựng một nền tảng có giá trị sử dụng thật sớm, sau đó bổ
sung runner theo nhu cầu.

### Phase 1 --- Foundation & Multi-user (Sprint 1)

-   Monorepo, frontend, backend.
-   Docker Compose.
-   PostgreSQL, Redis.
-   Authentication.
-   Organization, members, RBAC.
-   Project và environment.
-   Audit log cơ bản.

**Kết quả:** Công ty có thể đăng nhập, tạo organization, thêm thành viên
và tạo các project dùng để phân nhóm test.

### Phase 2 --- Test Management & Manual Testing (Sprint 2)

-   Test Plans.
-   Test Suites.
-   Test Cases.
-   Test Steps.
-   Tags và test type.
-   Manual execution.
-   Test Runs và Attempts.
-   Test Results.
-   Findings và attachments.

**Kết quả:** Tester có thể tạo, chạy và ghi nhận test thủ công, kết quả
gắn với người thực hiện.

### Phase 3 --- API Testing (Sprint 3)

-   API Collection.
-   HTTP request builder.
-   Headers, params, body, authentication.
-   Environment variables.
-   Assertions.
-   Request chaining.
-   Execution queue.
-   Logs và response history.
-   Timeout, cancellation và secret redaction.

**Kết quả:** Developer có thể kiểm thử API của nhiều dự án trên cùng một
nền tảng.

### Phase 4 --- Dashboard & Reports (Sprint 4)

-   Company dashboard.
-   Project dashboard.
-   Member activity dashboard.
-   Test type breakdown.
-   Findings statistics.
-   Filter theo thời gian, project, member, environment.
-   CSV/XLSX/PDF export.

**Kết quả:** Có thể xem chất lượng toàn công ty, từng dự án và hoạt động
kiểm thử của từng người.

### Phase 5 --- AI Assistant & External Imports (Sprint 5)

-   AI provider abstraction.
-   AI Test Case Generator.
-   AI Failure Analyzer.
-   AI Report Summary.
-   JUnit XML import.
-   Generic report import.
-   AI usage tracking và feedback.

**Kết quả:** AI hỗ trợ quy trình testing; có thể tổng hợp kết quả
unit/integration test từ CI.

### Phase 6 --- Browser Automation & Hardening (Sprint 6--7)

-   Playwright runner.
-   Browser artifacts, screenshot, trace.
-   CI webhook.
-   Worker sandbox hardening.
-   Permission audit.
-   Integration tests.
-   Backup/restore.
-   Deployment và documentation.

**Kết quả:** MVP mở rộng có thể chạy UI/E2E và tiếp nhận kết quả từ
pipeline.

### Phase 7 --- Advanced Testing

Triển khai theo nhu cầu thực tế:

-   k6 Performance Testing.
-   OWASP ZAP Security Testing.
-   Accessibility.
-   Compatibility matrix.
-   Reliability/soak testing.
-   Recovery test workflow.
-   Advanced analytics.

Không bắt buộc hoàn thành Phase 7 trước khi đưa MVP vào sử dụng nội bộ.

------------------------------------------------------------------------

## 13. MVP acceptance criteria

MVP được nghiệm thu khi đáp ứng các luồng sau:

### Organization & Users

-   [ ] Tạo organization.
-   [ ] Mời/thêm thành viên.
-   [ ] Gán role.
-   [ ] Người không có quyền không thể đọc dữ liệu organization/project
    khác.
-   [ ] Có service account để nhận kết quả từ CI.

### Project & Test Management

-   [ ] Tạo nhiều project.
-   [ ] Khai báo nhiều environment.
-   [ ] Tạo test plan, suite, case, step.
-   [ ] Phân loại test case theo type.
-   [ ] Tìm kiếm, filter và pagination.

### Execution

-   [ ] Manual test có người thực hiện.
-   [ ] Tạo test run và lưu lịch sử.
-   [ ] Hỗ trợ retry mà không ghi đè attempt cũ.
-   [ ] Lưu log và artifact.
-   [ ] API test hỗ trợ request/assertions.
-   [ ] Có timeout, cancel và trạng thái ERROR riêng.

### Dashboard & Reports

-   [ ] Company dashboard.
-   [ ] Project dashboard.
-   [ ] Member activity report.
-   [ ] Test type report.
-   [ ] Lọc theo thời gian và environment.
-   [ ] Export báo cáo.
-   [ ] Metrics không tính sai retry hoặc kết quả pending.

### AI

-   [ ] Sinh test case từ mô tả nghiệp vụ.
-   [ ] Kết quả AI ở trạng thái draft.
-   [ ] Phân tích failure có bằng chứng và mức độ tin cậy.
-   [ ] Có thể thay provider.
-   [ ] Không gửi secret vào AI prompt.

### Security & Operations

-   [ ] Có audit log.
-   [ ] Secret được bảo vệ.
-   [ ] Worker tách biệt.
-   [ ] Có giới hạn tài nguyên.
-   [ ] Có target allowlist và SSRF protection.
-   [ ] Có backup/restore procedure.
-   [ ] Có health check và structured logging.

------------------------------------------------------------------------

## 14. Non-functional requirements

Các ngưỡng dưới đây là mục tiêu ban đầu để đo lường, cần hiệu chỉnh sau
khi có tải thực tế.

  Hạng mục            Mục tiêu ban đầu
  ------------------- ---------------------------------------------------------
  API response time   p95 dưới 500ms cho API CRUD thông thường
  Dashboard           p95 dưới 2 giây với dữ liệu đã tổng hợp
  Availability        Mục tiêu 99.5% trong giai đoạn nội bộ
  Data integrity      Không mất lịch sử test result khi retry
  Security            RBAC, tenant isolation, secret redaction
  Scalability         Scale worker độc lập với API
  Observability       Structured logs, metrics, health checks
  Backup              Có lịch backup và thử nghiệm restore
  Timezone            Lưu UTC, hiển thị theo timezone người dùng/organization

Không áp dụng ngưỡng response time cho các endpoint chạy test đồng bộ;
các tác vụ dài phải chạy background job và trả execution ID.

------------------------------------------------------------------------

## 15. Các quyết định cần giữ ổn định trong quá trình phát triển

1.  QA Testing Hub tập trung vào testing, không phát triển thành Jira.
2.  Project chỉ dùng để nhóm dữ liệu và báo cáo testing.
3.  Kết quả luôn gắn với project, test type, execution, thời gian và
    actor phù hợp.
4.  Phân biệt user thực hiện manual test, user trigger job và service
    account chạy CI.
5.  Mọi runner dùng chung result contract.
6.  Không ghi đè lịch sử execution.
7.  Dashboard công ty, project và member dùng cùng nguồn dữ liệu chuẩn
    hóa.
8.  AI không tự phê duyệt kết quả.
9.  Công cụ chạy test phải được cô lập và giới hạn quyền.
10. Ưu tiên Manual + API + Dashboard + AI + JUnit Import trước khi mở
    rộng tất cả runner.

------------------------------------------------------------------------

## 16. Hướng dẫn cho AI Coding Agent / Developer

Khi triển khai dự án, tuân thủ các quy tắc:

-   Đọc tài liệu này trước khi tạo hoặc sửa kiến trúc.
-   Triển khai theo phase, không tạo toàn bộ module rỗng chỉ để đủ cấu
    trúc.
-   Mỗi feature phải có database migration, API validation, permission
    check và UI state tương ứng.
-   Không hardcode dữ liệu demo vào logic production.
-   Tách business logic khỏi controller và React component.
-   Sử dụng shared types/validation khi phù hợp, nhưng không làm
    frontend phụ thuộc trực tiếp vào database schema.
-   Viết Unit Test cho business logic.
-   Viết Integration Test cho repository/service/API quan trọng.
-   Viết E2E cho các luồng chính.
-   Mỗi bug được sửa cần có regression test phù hợp.
-   Không đánh dấu task hoàn thành nếu chưa chạy kiểm tra và xác nhận
    kết quả.
-   Cập nhật README, API docs và migration notes khi có thay đổi.
-   Không tự ý thay đổi các quyết định sản phẩm cốt lõi mà không cập
    nhật tài liệu.

### Definition of Done cho từng feature

-   [ ] Có acceptance criteria.
-   [ ] Có schema/migration nếu cần.
-   [ ] Có permission validation.
-   [ ] Có loading/empty/error/success UI state nếu có giao diện.
-   [ ] Có Unit/Integration Test phù hợp.
-   [ ] Có log và audit nếu là thao tác quan trọng.
-   [ ] Đã chạy lint, typecheck và test liên quan.
-   [ ] Có tài liệu hoặc API spec được cập nhật.

------------------------------------------------------------------------

## 17. Kết luận

QA Testing Hub là nền tảng kiểm thử đa dự án, đa người dùng, phục vụ cá
nhân và doanh nghiệp.

Trọng tâm sản phẩm không phải quản lý công việc mà là:

-   **Execute:** Chạy hoặc tiếp nhận kết quả kiểm thử.
-   **Normalize:** Chuẩn hóa kết quả từ nhiều framework/công cụ.
-   **Trace:** Truy xuất kết quả đến project, người thực hiện, lần chạy
    và bằng chứng.
-   **Analyze:** Phân tích chất lượng theo loại test, project và thành
    viên.
-   **Report:** Tổng hợp báo cáo toàn công ty.
-   **Assist:** Dùng AI hỗ trợ tạo test case và phân tích lỗi.

**MVP ưu tiên:** Multi-user + Multi-project + Manual Testing + API
Testing + Test Results + Company/Project/Member Dashboard + AI Test Case
Generator + JUnit XML Import.

Đây là nền tảng đủ hữu ích để đưa vào sử dụng nội bộ, đồng thời tạo kiến
trúc mở để bổ sung Playwright, k6, OWASP ZAP và các loại testing nâng
cao sau này.
