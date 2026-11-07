# 08. AI Assistant

- Người đọc: developer (module `ai`, queue `ai` ở worker-core), QA Lead, Admin
- Phase: **P4** provider adapter (Gemini mặc định), pipeline lọc dữ liệu, **phân tích lỗi tự động**; **P6** nguyên nhân AI trong báo cáo ngắn; **P7** sinh test case, đề xuất DSL/plan, **AI Explorer**, tóm tắt báo cáo
- Liên quan: [01-product-requirements.md](01-product-requirements.md) E5, E11, [06-execution-engine.md](06-execution-engine.md) mục 3.7 và 10.2, [04-database-schema.md](04-database-schema.md) mục 10, [07-reporting-and-scoring.md](07-reporting-and-scoring.md), [09-security-model.md](09-security-model.md)

---

## 1. Nguyên tắc

| # | Nguyên tắc | Cách bảo đảm trong code |
|---|---|---|
| P1 | AI chỉ **đề xuất**; người duyệt | Output AI chỉ ghi vào `ai_generations` hoặc tạo test case `DRAFT`. Không có code path nào cho AI ghi trực tiếp vào bản ghi chính thức |
| P2 | AI **không** đổi trạng thái test, không đóng/đổi trạng thái finding, không duyệt chạy, không sign-off gate | Service AI không được inject repository của `test_results.normalized_status`, `findings.status`, `execution_approvals`, `gate_evaluations` (kiểm bằng lint rule kiến trúc) |
| P3 | Mọi kết luận **dẫn nguồn** | Output có trường `refs`/`evidence` trỏ tới id dữ liệu đầu vào; validator loại phần không dẫn nguồn hợp lệ |
| P4 | Nêu rõ **giới hạn** | Mọi output có `limitations[]`; UI luôn hiện nhãn "Do AI đề xuất – cần kiểm tra lại" |
| P5 | Không gửi secret, credential production, dữ liệu nhạy cảm | Pipeline lọc dữ liệu (mục 8) chạy **trước** mọi lần gọi provider; không có đường gọi provider bỏ qua pipeline |
| P6 | Có phương án không cần AI | Sinh test theo luật (E5.1), câu kết luận theo luật (07 mục 2.6), phân loại lỗi theo luật (mục 5.2) vẫn chạy khi AI tắt hoặc hết ngân sách |

## 2. Kiến trúc

```text
UI ──POST /ai/...──► api: module ai ──kiểm quyền, ngân sách──► tạo ai_generations(PENDING)
                                                                 │ enqueue queue "ai"
worker-core ◄────────────────────────────────────────────────────┘
  1. Context builder (theo tính năng)      → lấy dữ liệu từ DB theo input_reference
  2. Scrubber (mục 8)                      → lọc secret/PII
  3. Prompt template (prompt_version)      → system + user
  4. LlmClient.generateStructured()        → provider adapter
  5. Zod validate → validator riêng tính năng (dẫn nguồn, số liệu, DSL) → tối đa 1 lần "sửa lỗi" gửi lại
  6. Post-process (dedup, tạo DRAFT...)    → ghi ai_generations(COMPLETED|FAILED), token, chi phí
  7. publish SSE ai:<generationId>
```

Mọi lệnh AI chạy **bất đồng bộ** (job), trả `generationId` ngay; UI theo dõi qua SSE. Không gọi provider trong request HTTP.

### 2.1. Hai tầng abstraction

Provider chỉ khác nhau ở cách gọi mạng, nên **adapter chỉ cài một hàm**; logic từng tính năng viết một lần ở tầng trên.

```ts
// packages/runner-contracts (hoặc apps/worker/src/ai) – tầng provider
interface LlmClient {
  readonly provider: 'gemini' | 'openai' | 'anthropic' | 'openai_compatible';
  generateStructured<T>(req: {
    system: string;
    user: string;
    schema: z.ZodType<T>;      // chuyển sang JSON Schema cho provider
    model: string;
    maxOutputTokens: number;
    temperature?: number;      // mặc định 0.2; tóm tắt 0.3
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<{ data: T; tokensIn: number; tokensOut: number; latencyMs: number }>;
}

// Tầng tính năng – giữ interface AIProvider của spec 1.0 mục 9.4, mở rộng thêm 2 hàm
interface AIAssistant {
  generateTestCases(input: TestCaseGenerationInput): Promise<TestCaseDraft[]>;
  analyzeFailure(input: FailureAnalysisInput): Promise<FailureAnalysis>;
  summarizeReport(input: ReportSummaryInput): Promise<ReportSummary>;
  suggestDslSteps(input: DslSuggestionInput): Promise<DslStepDraft[]>;
  suggestTestPlan(input: PlanSuggestionInput): Promise<TestPlanDraft>;
  exploreStep(input: ExploreStepInput): Promise<ExploreAction>;   // AI Explorer, mục 4.3
}
```

Structured output theo provider:

| Provider | Cơ chế |
|---|---|
| Gemini | `responseMimeType: application/json` + `responseSchema` |
| OpenAI | `response_format: { type: "json_schema", strict: true }` |
| Anthropic Claude | Structured output / tool use với `input_schema` |
| OpenAI-compatible local (Ollama, vLLM) | JSON mode nếu có; luôn Zod validate + 1 lần sửa lỗi |

Kết quả luôn qua Zod ở phía Hub, kể cả khi provider khẳng định đã theo schema.

### 2.2. Retry, timeout, hủy

- Timeout: sinh test case / plan 90 s; phân tích lỗi, DSL 45 s; tóm tắt 30 s.
- Retry: tối đa 2 lần với backoff lũy thừa (2 s, 8 s) cho 429, 5xx, timeout mạng. Không retry lỗi 4xx khác (sai key, nội dung bị chặn).
- Output sai schema hoặc trượt validator: gửi lại 1 lần kèm danh sách lỗi; vẫn sai → `status = FAILED`, lưu lỗi, UI đề xuất dùng phương án theo luật.
- Người dùng hủy → `AbortSignal`, `status = DISCARDED`.

### 2.3. Provider và model

Cấu hình ở `ai_provider_configs` theo organization, theo `purpose` (`DEFAULT|GENERATION|ANALYSIS|SUMMARY`), có thể khác provider cho từng mục đích. API key nằm trong `secrets`.

| Provider | Gợi ý dùng |
|---|---|
| **Gemini (mặc định, D-25)** | Model Gemini **Flash** cho tác vụ nhanh, số lượng lớn (phân tích lỗi tự động, tóm tắt, từng bước AI Explorer); model Gemini **Pro** cho tác vụ khó (sinh test case, đề xuất plan/DSL). Tên model cụ thể là cấu hình, Admin chọn trong danh sách model Gemini trả về |
| Anthropic | Ví dụ: `claude-sonnet-5-5` cho sinh test case, DSL, phân tích lỗi; `claude-haiku-5-5` cho tóm tắt, phân loại |
| OpenAI | Admin chọn model trong danh sách provider trả về; không hardcode tên model trong code |
| OpenAI-compatible local (Ollama/vLLM trong mạng công ty) | Dự án nhạy cảm, bắt buộc khi project bật "Không gửi dữ liệu cho AI bên ngoài" |

Model là cấu hình, không phải hằng số trong code. Đổi model → chạy bộ đánh giá (mục 9) trước khi bật cho cả organization.

**Đổi provider/model (Settings → AI), không sửa code:**
1. Admin thêm provider (Gemini / OpenAI / Claude / OpenAI-compatible local), nhập API key (lưu `secrets`), bấm "Kiểm tra kết nối" (gọi thử 1 lệnh nhỏ).
2. Chọn model cho từng `purpose`: `ANALYSIS` (phân tích lỗi, explorer), `GENERATION` (sinh test, DSL, plan), `SUMMARY` (tóm tắt), `DEFAULT` (còn lại). Mặc định khi cài: cả 4 dùng Gemini (Flash cho ANALYSIS/SUMMARY, Pro cho GENERATION).
3. Tùy chọn "Chạy bộ đánh giá trước khi áp dụng" (mục 9): hiện điểm của model mới so với model hiện tại.
4. Lưu → áp dụng cho job AI **mới**; job đang chạy giữ model cũ. Mỗi `ai_generations` ghi provider + model nên báo cáo cũ vẫn truy được.

AI chỉ bật khi đã có provider hoạt động (D-25); chưa có → mọi tính năng AI ẩn nút, các phương án theo luật (P6) vẫn chạy.

### 2.4. Ngân sách và giới hạn

- `ai_provider_configs.monthly_token_budget`: vượt ngân sách → từ chối với thông báo rõ, Admin nhận thông báo khi đạt 80%.
- Mỗi người dùng tối đa 30 lệnh AI/giờ (Redis rate limit); mỗi project tối đa 3 job AI chạy đồng thời (phân tích lỗi tự động có hàng đợi riêng, không tính vào giới hạn người dùng).
- Phân tích lỗi tự động: tối đa **20 phân tích mới / run** (mặc định của org: `ai_provider_configs.max_analyses_per_run`; dự án ghi đè bằng `projects.settings.ai.maxAnalysesPerRun`), dùng lại theo `error_signature` nên 100 test lỗi cùng một nguyên nhân chỉ tốn 1 lần gọi. AI Explorer: hiện ước tính token trước khi chạy, dừng khi chạm ngân sách.
- Mỗi `ai_generations` lưu `tokens_in`, `tokens_out`, `cost_usd` (bảng giá cấu hình theo model), `latency_ms`. Trang Admin: chi phí theo tháng, theo project, theo tính năng.

## 3. Sinh test case (E5.2)

### 3.1. Đầu vào

```ts
type TestCaseGenerationInput = {
  projectId: string;
  sources: Array<
    | { kind: 'DESCRIPTION'; text: string }                    // mô tả nghiệp vụ người dùng nhập
    | { kind: 'ACCEPTANCE_CRITERIA'; text: string }
    | { kind: 'REQUIREMENT_DOC'; artifactId: string; sections?: string[] }  // PDF/DOCX/MD đã upload
    | { kind: 'SITE_PAGE'; sitePageId: string }                // form, field, nút từ discovery
    | { kind: 'API_ENDPOINTS'; apiRequestIds: string[] }       // từ OpenAPI/Postman
  >;
  testTypes?: TestType[];                 // mặc định FUNCTIONAL (+ API nếu nguồn là API)
  techniques?: Technique[];               // mặc định tất cả phù hợp
  maxCases?: number;                      // mặc định 20, tối đa 50
  targetSuiteId?: string;
};
type Technique = 'POSITIVE' | 'NEGATIVE' | 'BOUNDARY' | 'EDGE' | 'PERMISSION' | 'SECURITY';
```

**Context builder** ghép:
- Tài liệu yêu cầu: trích text (PDF/DOCX/MD), chia đoạn ~2.000 token, chỉ gửi các đoạn người dùng chọn (hoặc 5 đoạn liên quan nhất theo tìm kiếm từ khóa với mô tả). Mỗi đoạn có id `doc:<artifactId>#<n>`.
- `site_pages.forms`: field, type, required, pattern, min/max, maxlength, options; id `page:<id>/field:<name>`.
- API: method, path, tham số, request schema, response schema, security; id `api:<apiRequestId>`.
- Vai trò tài khoản test có sẵn (`environment_credentials.role_name`, **không** gửi username/mật khẩu) để sinh case phân quyền.
- Tối đa 100 tiêu đề test case đã có cùng đối tượng (cùng page/endpoint/suite) để tránh trùng.
- Test case bị từ chối gần đây của project (5 mục, kèm lý do) làm ví dụ "không nên sinh".

### 3.2. Đầu ra

```ts
type TestCaseDraft = {
  title: string;                       // tiếng Việt, ≤ 150 ký tự, bắt đầu bằng động từ/kịch bản
  testType: TestType;
  technique: Technique;
  purposes?: TestPurpose[];
  priority: Priority;
  preconditions?: string;
  steps: Array<{ action: string; testData?: Record<string, unknown>; expected?: string }>;
  expectedResult: string;
  tags: string[];
  rationale: string;                   // vì sao cần case này
  coverageRefs: string[];              // id nguồn: doc:..#3, page:../field:email, api:...
  automationHint?: 'UI' | 'API' | 'MANUAL_ONLY';
};
```

### 3.3. Prompt (tóm tắt)

- **System**: "Bạn là QA engineer cấp cao kiểm thử website. Chỉ dựa trên dữ liệu được cung cấp. Không bịa field, URL, quy tắc nghiệp vụ không có trong nguồn; nếu cần giả định thì ghi trong `rationale`. Mỗi case phải có `coverageRefs` hợp lệ. Viết tiếng Việt. Áp dụng các kỹ thuật: phân vùng tương đương, giá trị biên, bảng quyết định, phân quyền theo vai trò. Không sinh case trùng với danh sách đã có."
- **User**: các khối nguồn có id + danh sách case đã có + giới hạn số lượng + kỹ thuật yêu cầu.
- Template có `prompt_version` (vd. `tc-gen@3`) lưu trong repo, ghi vào `ai_generations.prompt_version`.

### 3.4. Hậu xử lý

1. Zod validate từng case; case lỗi bị bỏ và đếm vào `output.dropped`.
2. Loại case có `coverageRefs` không thuộc input.
3. Chống trùng:
   - `dedup_key = ai:<coverageRef đầu tiên>:<hash(tiêu đề đã chuẩn hóa)>` → trùng unique `(project_id, dedup_key)` thì bỏ.
   - Tiêu đề giống ≥ 0,8 (pg_trgm `similarity`) với case đã có → **không bỏ**, gắn cờ "Có thể trùng với TC-xxx" để người duyệt quyết định.
4. Cắt theo `maxCases`, ưu tiên priority cao và đủ đa dạng kỹ thuật.
5. Ghi `test_cases` với `status = DRAFT`, `source = AI`, `source_ref = ai:<generationId>#<index>`, `test_method = MANUAL`, `automation_status = NOT_AUTOMATED`.

### 3.5. Duyệt (UX)

```text
Chọn nguồn (mô tả / tài liệu / trang / API) → chọn loại test, số lượng → "Sinh test case"
  → tiến độ (SSE) → danh sách nháp: tiêu đề, kỹ thuật, priority, nguồn (hover xem đoạn gốc), cờ trùng
  → sửa trực tiếp · Duyệt (→ ACTIVE) · Từ chối (bắt buộc chọn lý do) · Duyệt hàng loạt
```

Lý do từ chối: `DUPLICATE | WRONG_BEHAVIOR | TOO_VAGUE | NOT_RELEVANT | OTHER` + ghi chú. Lưu vào `ai_feedback` (`rating = -1`, lý do), test case chuyển `REJECTED` (giữ để chống sinh lại). Duyệt = `ai_feedback.rating = 1`.

## 4. Đề xuất bước tự động (DSL), test plan và khám phá luồng

### 4.1. `suggestDslSteps` (E5.4)

- **Đầu vào**: test case (bước thủ công), trang đích (`site_pages`) kèm accessibility tree rút gọn (Playwright `ariaSnapshot()`, ≤ 8.000 token), `shared_flows` có sẵn (vd. đăng nhập), biến môi trường dạng tên (không giá trị), schema DSL từ `packages/test-dsl`.
- **Đầu ra**: `DslStepDraft[]` = bước DSL + `fromManualStep` (bước thủ công tương ứng) + `confidence`.
- **Kiểm tra**: validator DSL; locator phải ưu tiên role/label/text, cấm XPath; tham chiếu secret chỉ dưới dạng `{{secret.<name>}}`.
- **Dry run tùy chọn**: worker-browser mở trang, chỉ kiểm locator có resolve được (không click, không submit) → đánh dấu từng bước `resolved/unresolved`.
- Người dùng chấp nhận → ghi `test_steps.automation`, `automation_status = AUTOMATED`.

### 4.2. `suggestTestPlan` (E5.5)

- **Đầu vào**: tóm tắt site map (số trang, nhóm path, số form), danh sách API, suite có sẵn, test type mà runner hỗ trợ, `environments.kind` (LOCAL/DEV/STAGING/PRODUCTION), execution policy.
- **Đầu ra**: `TestPlanDraft { name, objective, scope { suiteNames[], testTypes[], purposes[] }, matrix?, exitCriteria, gateRules: GateRule[], rationale }`.
- Production → không đề xuất PERFORMANCE ngoài smoke và không đề xuất ZAP active. Người dùng sửa rồi bấm "Tạo kế hoạch".

### 4.3. AI Explorer: khám phá luồng (D-29, Phase 7)

Thuật toán vòng lặp, giới hạn và replay xác nhận ở [06](06-execution-engine.md) mục 10.2. Phần AI:

- **Đầu vào mỗi bước** (`ExploreStepInput`): mục tiêu (`goal`), cây accessibility đã cắt (≤ 8k token, đã qua pipeline lọc), ảnh chụp viewport (đã che field nhạy cảm; chỉ gửi khi provider hỗ trợ ảnh), URL hiện tại (path template), 5 bước gần nhất + kết quả, danh sách thao tác bị cấm ở môi trường này, dữ liệu được phép dùng để điền (tên cột data set, `{{cred.<role>.*}}` dạng placeholder, không bao giờ giá trị thật).
- **Đầu ra** (Zod):

```ts
type ExploreAction = {
  action: 'goto' | 'click' | 'fill' | 'select' | 'check' | 'press' | 'waitFor'
        | 'expectVisible' | 'expectText' | 'back' | 'stop';
  target?: { role: string; name: string } | { label: string } | { placeholder: string } | { text: string };
  value?: string;        // placeholder {{data.col}} / {{cred.role.user}} hoặc dữ liệu giả đúng type field
  reason: string;        // 1 câu tiếng Việt, hiện trong nhật ký khám phá
  goalDone: boolean;
  stepTitle: string;     // câu mô tả bước cho test case (vd. "Bấm nút 'Thêm vào giỏ'")
};
```

- **System prompt (tóm tắt)**: "Bạn là tester khám phá website để hoàn thành mục tiêu. Mỗi lượt chọn đúng 1 thao tác trong danh sách cho phép, chỉ nhắm phần tử có trong cây accessibility. Không đăng xuất, không xóa, không thanh toán thật. Khi thấy dấu hiệu hoàn thành mục tiêu, thêm 1 bước kiểm tra (`expectText`/`expectVisible`) rồi đặt `goalDone = true`. Không bịa phần tử."
- **Guard ở Hub** (không tin AI): validate schema; `target` phải khớp đúng 1 phần tử; thao tác nằm trong danh sách cấm hoặc ghi dữ liệu khi `allowWrites = false` → từ chối, gửi lại lý do cho AI ở lượt sau; 3 lần bị từ chối liên tiếp → dừng luồng.
- **Gợi ý mục tiêu**: nếu người dùng không nhập, AI đề xuất ≤ 10 mục tiêu từ tài liệu yêu cầu + form/trang đã khám phá + bước chuyển dự kiến chưa có đích (`site_transitions.to_page_id = null`), ưu tiên phần có độ phủ luồng thấp.
- **Kết quả**: chỉ luồng replay `PASSED` mới thành test case `DRAFT` (`source = AI`); `ai_generations.generation_type = EXPLORATION` lưu nhật ký từng bước (thao tác, lý do, ảnh thu nhỏ) để người duyệt xem AI đã làm gì.

## 5. Phân tích lỗi (E11.3)

**Chạy tự động trong lúc test (D-26).** Không cần bấm nút: mỗi item `FAILED`/`ERROR` được phân tích ngay khi job ghi kết quả, gom theo `error_signature` (luồng kích hoạt, chống trùng, trần số lần ở [06](06-execution-engine.md) mục 3.7). Màn chạy nhận SSE `analysis.ready` và hiện "Nguyên nhân có khả năng" bên cạnh item. Item vượt trần hoặc khi AI tắt vẫn có phân loại theo luật (5.2) và nút "Phân tích thêm". Item `ERROR` (lỗi hạ tầng) vẫn được phân tích để giải thích cho người chạy, nhưng không tạo finding.

### 5.1. Đầu vào

| Khối | Giới hạn | Id dẫn nguồn |
|---|---|---|
| Test result, error_message, stack trace | stack ≤ 4.000 ký tự | `result`, `stack` |
| `step_results` (bước nào fail, lỗi) | | `step:<n>` |
| API request/response snapshot (đã redact), body | body ≤ 4 KB | `api:request`, `api:response` |
| Log | 200 dòng cuối quanh thời điểm lỗi | `log:<lineNo>` |
| Môi trường: browser, viewport, URL, runner_version | | `env` |
| Lịch sử: 10 trạng thái gần nhất của test case, `is_flaky` | | `history` |
| Cùng lỗi ở item khác của run (đếm theo error signature) | | `run:similar` |
| Ảnh chụp lúc lỗi | chỉ gửi nếu provider hỗ trợ ảnh và project cho phép | `screenshot` |

### 5.2. Phân loại theo luật trước

Luật chạy trong worker ngay khi kết quả được ghi (không cần AI). Luật khớp được ghi `test_results.failure_category` với `failure_category_source = RULE`.

| Dấu hiệu | Ứng viên |
|---|---|
| `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT` khi kết nối, DNS lỗi, chứng chỉ TLS hết hạn trên môi trường test | ENVIRONMENT |
| Lỗi từ dịch vụ ngoài (domain khác base URL) hoặc 502/503/504 từ gateway | NETWORK_DEPENDENCY |
| HTTP 5xx từ API của chính dự án | PRODUCT_DEFECT |
| Assertion về nội dung/giá trị sai, response trái schema | PRODUCT_DEFECT |
| Locator không tìm thấy / timeout chờ element, trong khi trang tải bình thường | TEST_DEFECT |
| 401/403 với tài khoản test, hoặc dữ liệu tiền điều kiện không tồn tại (404 với id cố định) | TEST_DATA |
| Lỗi runner, hết bộ nhớ, worker mất | (đây là `ERROR`, không phải FAILED; không phân loại) |
| Không khớp luật nào | UNKNOWN |

AI nhận ứng viên từ luật và **bổ sung giải thích**, có thể đề xuất category khác kèm bằng chứng.

### 5.3. Đầu ra

```ts
type FailureAnalysis = {
  summary: string;                                  // 1–3 câu tiếng Việt
  category: FailureCategory;                        // enum failure_category
  ruleCategory?: FailureCategory;                   // ứng viên từ luật (để so)
  confidence: number;                               // 0–1
  likelyCauses: Array<{ cause: string; evidence: Array<{ ref: string; quote?: string }> }>;
  debugSteps: string[];
  isLikelyFlaky: boolean;
  suggestedTestCases?: Array<{ title: string; rationale: string }>;
  limitations: string[];
  // Bản lời thường cho báo cáo ngắn (07): không thuật ngữ, ≤ 25 chữ mỗi trường
  plain: { cause: string; fix: string };   // vd. cause: "Nút 'Đặt hàng' không còn trên trang sau khi giao diện đổi", fix: "Cập nhật bước bấm nút trong test case"
};
```

- Validator bỏ `evidence` có `ref` không có trong input; nguyên nhân không còn bằng chứng nào bị bỏ; không còn nguyên nhân hợp lệ → `confidence = min(confidence, 0.3)`.
- Kết quả hiện ở trang item/attempt: "Phân tích của AI" + độ tin cậy (Cao ≥ 0,7 / Trung bình ≥ 0,4 / Thấp).
- Nút "Áp dụng phân loại" → ghi `failure_category`, `failure_category_source = AI` và audit (người bấm). AI **không** tự ghi.
- `suggestedTestCases` → nút tạo test case `DRAFT` (`source = AI`).

### 5.4. Đưa vào báo cáo

Báo cáo ngắn (D-30, [07](07-reporting-and-scoring.md)) lấy tối đa 3 vấn đề quan trọng nhất; mỗi vấn đề hiển thị `plain.cause` ("Nguyên nhân có khả năng"), `plain.fix` ("Cách khắc phục") và độ tin cậy dạng chữ (Cao / Trung bình / Thấp), kèm nhãn "AI đề xuất". Với finding gom nhiều item, dùng phân tích có độ tin cậy cao nhất trong các occurrence của run. Không có phân tích (AI tắt, vượt trần) → dùng template `impact` theo `rule_id` và category từ luật. Phân tích được chụp vào `report_snapshots.data` lúc tạo báo cáo nên bản PDF không đổi về sau; validator số liệu ở mục 6 áp dụng cho cả hai trường `plain`.

## 6. Tóm tắt báo cáo cho người không chuyên (E11.4)

- **Đầu vào duy nhất**: `report_snapshots.data`. Mỗi chỉ số có id ổn định, vd. `dim.SECURITY.score`, `dim.SECURITY.coverage`, `findings.open.CRITICAL`, `trend.pass_rate.delta`, `finding:<id>.title`. Không đọc thêm dữ liệu ngoài snapshot.
- **Đầu ra**:

```ts
type ReportSummary = {
  sentences: Array<{ text: string; refs: string[] }>;           // 3–7 câu, lời thường
  recommendations: Array<{ text: string; refs: string[] }>;     // ≤ 5
  limitations: string[];                                        // vd. "Chưa kiểm thử khả năng truy cập"
};
```

- **Validator**:
  1. Mỗi câu có ≥ 1 `ref` tồn tại trong snapshot.
  2. Mọi số trong `text` (bắt bằng regex, gồm phần trăm, giây, số đếm) phải bằng giá trị của một `ref` của câu đó sau khi định dạng theo 07 mục 5.4 (cho phép sai lệch làm tròn).
  3. Không dùng từ khẳng định tuyệt đối ("an toàn tuyệt đối", "không có lỗi", "đạt chất lượng").
  4. Dimension `null` phải được nhắc trong `limitations`.
- Trượt validator → sửa lỗi 1 lần → vẫn trượt thì dùng tóm tắt theo template cố định (câu kết luận 07 mục 2.6 + top vấn đề).
- UI: khối "Tóm tắt do AI viết – đã đối chiếu số liệu", hover mỗi câu hiện số liệu gốc. Bản PDF ghi rõ phần nào do AI viết. Tóm tắt lưu kèm snapshot nên không đổi sau khi tạo.

## 7. Phân quyền

| Hành động | Role |
|---|---|
| Sinh test case, DSL, plan | Owner, Admin, QA Lead, Tester, Developer (project member) |
| Phân tích lỗi (tự động; "Phân tích thêm" thủ công) | Tự động: hệ thống; thủ công: ai xem được kết quả đó |
| Chạy AI Explorer | Owner, Admin, QA Lead, Tester, Developer (project member); bật `allowWrites` ở LOCAL/DEV cần QA Lead trở lên |
| Tóm tắt báo cáo | Ai tạo được báo cáo đó |
| Cấu hình provider, ngân sách, xem chi phí | Owner, Admin |
| Bật/tắt "Không gửi dữ liệu cho AI bên ngoài" của project | Owner, Admin, QA Lead của project |

Mọi lệnh AI ghi audit `ai.generate` với `generation_type`, provider, model.

## 8. Bảo vệ dữ liệu

### 8.1. Pipeline lọc (chạy ở worker-core trước mỗi lần gọi provider)

| Bước | Việc |
|---|---|
| 1. Bỏ trường đã biết là nhạy cảm | Header `Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, `Proxy-Authorization`; field tên khớp `/pass(word)?|secret|token|api[_-]?key|otp|pin/i` → `[REDACTED]` |
| 2. Thay giá trị secret đã biết | Worker giải mã các secret của project (đã có quyền vì runner cần) và thay **chính xác** mọi lần xuất hiện bằng `{{secret.<name>}}` |
| 3. Nhận diện theo mẫu | JWT, `Bearer …`, khóa dạng `AKIA…`, `sk-…`, `AIza…`, `ghp_…`, private key PEM, `user:pass@` trong URL, query param `token/key/password/secret/sig` |
| 4. PII (bật mặc định, tắt được theo project) | Email → `[EMAIL]`, số điện thoại VN (`0\d{9}`, `+84…`) → `[PHONE]`, số CCCD 12 chữ số → `[ID]`, số thẻ (Luhn) → `[CARD]` |
| 5. Cắt độ dài | Theo giới hạn từng khối (mục 3–6) |

Pipeline có unit test với bộ mẫu chứa secret giả; CI fail nếu mẫu nào lọt qua.

### 8.2. Chính sách theo project

- `projects.settings.ai.externalAllowed` (mặc định `true` cho môi trường không phải production): `false` → chỉ cho dùng provider `openai_compatible` có `base_url` thuộc mạng nội bộ.
- Dữ liệu từ môi trường `kind = PRODUCTION` (D-33): **không gửi gì cho Gemini hay provider bên ngoài** (`ai_provider_configs.send_production_data = false`, mặc định). Item lỗi ở production vẫn có phân loại theo luật cố định (mục 5) và hiện "AI không phân tích dữ liệu production" thay cho nguyên nhân AI; API trả `analysis.status = SKIPPED`, `skippedReason = PRODUCTION_DATA_NOT_ALLOWED`. Admin có thể bật sau trong Settings → AI (ghi audit, bắt buộc lý do); khi bật vẫn chạy pipeline lọc dữ liệu như mọi môi trường khác.
- `projects.settings.ai.piiMasking` (mặc định `true`).

### 8.3. Lưu trữ

- `ai_generations` lưu `input_reference` (id đối tượng) và `output`, **không** lưu prompt thô.
- Chế độ debug (Admin bật tạm thời theo project): lưu prompt **đã lọc** thành artifact, giữ 30 ngày.
- `ai_generations` giữ 180 ngày; test case đã duyệt vẫn giữ nguồn gốc qua `source_ref`.
- Chỉ dùng gói API của provider có cam kết không dùng dữ liệu để huấn luyện; Admin xác nhận điều khoản khi thêm provider (ghi audit).

## 9. Đánh giá chất lượng AI

### 9.1. Bộ dữ liệu chuẩn (golden set)

Đặt tại `apps/worker/src/ai/eval/fixtures/`, không chứa dữ liệu thật:

| Tính năng | Bộ mẫu |
|---|---|
| Sinh test case | 10 form (đăng nhập, đăng ký, tìm kiếm, thanh toán…), 5 OpenAPI, 5 đoạn yêu cầu nghiệp vụ, kèm danh sách case "bắt buộc phải có" |
| DSL | 10 test case + aria snapshot + DSL kỳ vọng |
| Phân tích lỗi | 30 lỗi đã gán nhãn category bởi QA |
| Tóm tắt | 10 report snapshot, kiểm validator và độ dễ hiểu |

Chạy bằng `pnpm ai:eval --feature <name> --provider <cfg>`; bắt buộc chạy khi đổi `prompt_version`, model hoặc provider. Kết quả so với lần trước, lưu vào `docs/ai-eval/` (báo cáo ngắn).

### 9.2. Chỉ số

| Chỉ số | Mục tiêu ban đầu | Nguồn |
|---|---|---|
| Tỉ lệ output đúng schema (không cần sửa) | ≥ 98% | `ai_generations` |
| Tỉ lệ test case AI được duyệt | ≥ 60% (< 40% là cần sửa prompt) | `ai_feedback` |
| Tỉ lệ trùng (bị từ chối `DUPLICATE` hoặc gắn cờ trùng) | ≤ 10% | `ai_feedback`, cờ trùng |
| Độ phủ "case bắt buộc" trên golden set | ≥ 80% | eval |
| Độ chính xác category phân tích lỗi so với nhãn QA | ≥ 70% (và không thấp hơn luật) | eval + lần "Áp dụng" bị người sửa lại |
| Tóm tắt qua validator lần đầu | ≥ 95% | `ai_generations` |
| Chi phí trung bình mỗi lần sinh | theo dõi, cảnh báo khi tăng > 30% so với tháng trước | `cost_usd` |

Dashboard Admin "Chất lượng AI" hiển thị các chỉ số trên theo `prompt_version` và model.
