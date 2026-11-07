# 11. Chuyển `k6-perf` thành Performance module của QA Testing Hub

- Người đọc: developer làm Phase 4
- Hiện trạng: `k6-perf/` (khoảng 1.900 dòng, không dependency, đã chạy thật trên `qs-net-management-be`, có 5 lần chạy trong `results/`)
- Nguyên tắc: **dùng lại phần đã chạy đúng, bỏ phần gắn chặt với một dự án**. Không viết lại thứ đã có unit test nếu chỉ cần đổi chỗ.

---

## 1. Đánh giá tool hiện tại

| Phần | Đánh giá | Quyết định |
|---|---|---|
| `k6/main.js`: `ramping-arrival-rate`, threshold riêng cho từng endpoint để summary có số liệu theo API, 12 cửa sổ thời gian (tag `win`), phân loại lỗi (`timeout`, `rate_limited`, `server_error`, `client_error`, `body_error`), `handleSummary` xóa `setup_data` | Thiết kế tốt, đúng bản chất k6 | **Giữ**, tổng quát hóa |
| `k6/main.js`: `setup()` login vào `/api/v1/access/login`, đọc device/member của QS; header `authorization` không có `Bearer`; luật `body.success === false` cho mobile | Chỉ đúng với một backend | **Thay** bằng setup chain + `success_rule` cấu hình được |
| `k6/main.js`: chặn mọi URL không phải localhost | Đúng cho tool local, sai cho Hub | **Thay** bằng target allowlist + execution policy (worker kiểm tra lại trước khi spawn) |
| `lib/report.js`: `summaryToReport`, `windowsOf`, `targetAt`, `ERROR_KINDS` | Pure function, có test | **Chuyển nguyên** sang `packages/report-normalizers/src/k6/` (đổi sang TypeScript, giữ test) |
| `lib/report.js`: `parseLogLine`, `createBaseline`, `normalizePath` (đọc access log morgan → p50/p95/p99 thật) | Hữu ích, nhưng regex gắn với định dạng morgan | **Giữ** thành tính năng "Production baseline" (Phase 9), định dạng log cấu hình được |
| `lib/diagnose.js`: 20 luật suy luận nguyên nhân có độ tin cậy | Giá trị cao nhất của tool, có test | **Chuyển** sang `packages/report-normalizers/src/k6/diagnose.ts`; tổng quát hóa câu chữ gắn với QS (xem mục 4) |
| `lib/probes.js`: chụp `performance_schema` MySQL, đo CPU/RAM bằng PowerShell counter | Chỉ chạy được khi tool nằm cùng máy với BE và DB | **Không chuyển vào worker**. Thành "Observability integration" tùy chọn (Phase 9, mục 6) |
| `server.js`: 1 run một lúc, spawn k6, SSE log, stop qua k6 REST API | Hub đã có queue, SSE, cancel chung | **Bỏ**, ý tưởng stop qua REST API giữ lại trong `k6-runner.cancel()` |
| `ui/app.js` + `index.html`: lịch sử, chạy mới, chi tiết (KPI, chẩn đoán, bảng theo API, SQL, CPU/RAM), so sánh, baseline, GLOSSARY tooltip | UX đã được kiểm chứng | **Viết lại bằng React** theo đúng bố cục cũ (xem [10-ui-ux.md](10-ui-ux.md)); GLOSSARY chuyển vào i18n |
| `config/endpoints.json` | Danh sách 15 API | **Import** thành API collection + performance scenario |
| `config/profiles.json` | 5 profile | **Seed** thành `performance_profiles` hệ thống |
| `config/slo.json` | p95 1000 ms, success 99%, availability 99,9% | Thành SLO mặc định của `performance_scenarios.slo` |
| `scripts/seed.js` | Tạo tài khoản test trong DB của QS | **Không chuyển**. Hub không ghi vào DB của hệ thống được test; tài khoản test khai báo ở `environment_credentials` |
| `results/*` | 5 lần chạy lịch sử | **Import** thành `test_runs` (`kind=PERF`, `execution_source=IMPORTED`) để giữ lịch sử |

## 2. Ánh xạ khái niệm

| `k6-perf` | Hub |
|---|---|
| `BASE_URL` trong `.env` | `environments.api_base_url` (+ kiểm tra `target_hosts`) |
| `K6_WEB_USER`, `K6_WEB_PASS` | `environment_credentials` (mật khẩu trong `secrets`) |
| Một mục trong `endpoints.json` | Một `api_requests` + một phần tử `performance_scenarios.items[] {apiRequestId, weight}` |
| `group: web/mobile` + header riêng | `api_requests.headers` / `auth` của từng request |
| Placeholder `{{deviceId}}`, `{{memberId}}`... lấy trong `setup()` | Biến từ `setup` chain (`extract`) hoặc `test_data_sets` (mỗi VU lấy một dòng) |
| Luật "mobile trả HTTP 200 + `success:false`" | `api_requests.success_rule` (vd. `{"jsonpath":"$.success","operator":"notEquals","expected":false}`) |
| Luật "429 hoặc `error === RATE_LIMITED`" | `api_requests.error_rules[]`: ánh xạ điều kiện → `rate_limited` (mặc định chỉ `status == 429`) |
| `profiles.json` | `performance_profiles` |
| `RATE_SCALE` (0, 20] | `performance_scenarios.rate_scale`, giới hạn thêm bởi `execution_policies.max_perf_rps` |
| `slo.json` | `performance_scenarios.slo` (+ `per_item_slo`) |
| `results/<id>/meta.json` | `test_runs` + `run_jobs` |
| `results/<id>/summary.json` | Artifact `REPORT_JSON` + chuẩn hóa thành `test_run_items` (1 item / endpoint) và `run_metrics` |
| `results/<id>/dashboard.html` | Artifact `REPORT_HTML`, mở trong iframe sandbox |
| `results/<id>/k6.log` | Artifact `LOG`; 3 lỗi đầu mỗi VU vẫn được `diagnose` đọc |
| `baseline.json` | Tính năng Production baseline (Phase 9) |
| PASS/FAIL theo threshold | Item `PASSED`/`FAILED` theo SLO của endpoint; run có chỉ số PERFORMANCE |

Một endpoint không có request nào trong lần chạy → item `NOT_APPLICABLE` (thay cho badge "không có request" cũ), không tính vào pass rate.

## 3. Script k6 tổng quát (`apps/worker/src/runners/k6/script/main.js`)

Worker ghi một file `job.json` vào thư mục làm việc tạm (tmpfs) rồi chạy:

```text
k6 run --address 127.0.0.1:6565 --summary-export=… -e JOB=/work/job.json main.js
```

`job.json` nằm trong thư mục làm việc tmpfs, **không chứa secret**: các placeholder `{{cred.*}}`, `{{secret.*}}` được worker truyền vào k6 qua biến môi trường của process (chỉ tồn tại trong bộ nhớ). Thiếu biến thì job dừng với `ERROR` mã `VAR_UNDEFINED`, không thay bằng chuỗi rỗng như `k6-perf`. Cấu hình vượt giới hạn cứng của execution policy thì worker từ chối trước khi spawn, mã `POLICY_LIMIT`.

```json
{
  "baseUrl": "https://staging.example.vn",
  "profile": { "startRate": 1, "stages": [{ "target": 12, "duration": "1m" }, { "target": 12, "duration": "5m" }] },
  "rateScale": 1,
  "maxVUs": 200,
  "slo": { "p95Ms": 1000, "successRate": 0.99, "availability": 0.999 },
  "setup": [ { "name": "login", "method": "POST", "url": "{{baseUrl}}/api/login", "body": {"username":"{{cred.user}}","password":"{{cred.pass}}"}, "extract": [{ "var": "token", "jsonpath": "$.data.accessToken" }] } ],
  "items": [
    { "name": "web.dashboard", "weight": 7, "method": "GET", "url": "{{baseUrl}}/api/v1/dashboard?storeId={{data.storeId}}",
      "headers": { "authorization": "{{vars.token}}" }, "successRule": null, "errorRules": [] }
  ],
  "dataSet": { "columns": ["storeId"], "rows": [[12], [15]] },
  "windows": 12
}
```

Giữ nguyên từ bản cũ:
- Executor `ramping-arrival-rate`; `preAllocatedVUs`, `maxVUs = max(20, peak × 10)` nhưng **không vượt** `execution_policies.max_vus`.
- Sinh threshold cho từng item (`http_req_duration{name:…}`, `api_success{name:…}`, `api_available{name:…}`, `http_reqs{name:…}`, `api_resp_bytes{name:…}`, `api_errors{name:…,kind:…}`) và cho từng cửa sổ `win`.
- `handleSummary`: xóa `data.setup_data`, gắn `data.k6perf = {windows, windowMs, startRate, scale, stages, maxVUs}`.
- In 3 lỗi đầu tiên mỗi VU bằng `console.warn` theo đúng định dạng mà `failureSamples()` đang đọc.

Thay đổi:
- Bỏ regex localhost. Worker đã kiểm tra target; ngoài ra mọi traffic đi qua egress proxy.
- `setup()` chạy chuỗi request trong `job.setup`, gom biến bằng `extract`. Không còn code riêng cho QS.
- Placeholder: `{{baseUrl}}`, `{{vars.x}}` (từ setup), `{{data.col}}` (dòng data set theo `exec.vu.idInTest % rows`), `{{env.x}}`, `{{uuid}}`, `{{now.iso}}`, `{{now.date}}`.
- Chế độ `PAGE` (scenario kind=PAGE): chỉ `GET` trang HTML, không chạy JavaScript; dùng để đo server trả trang. Hiệu năng hiển thị trên trình duyệt do Lighthouse đo, không phải k6.

## 4. Chẩn đoán (`diagnose`) sau khi tổng quát hóa

| Luật cũ | Thay đổi |
|---|---|
| "Bị rate limit chặn (429)" gắn với limiter mobile theo IP của QS | Câu chữ chung: "Server giới hạn số request (429)". Gợi ý: k6 chạy từ một IP, cần nâng giới hạn ở môi trường test |
| "Request nhẹ phải xếp hàng chờ (nghẽn event loop)" | Đổi thành "Request nhẹ phải xếp hàng chờ (server nghẽn chung)"; chỉ nhắc event loop khi `projects.technology_metadata.runtime = node` |
| "Lỗi server", "Timeout", "success:false", "4xx", "Vượt SLO", "Response lớn", "Điểm bão hòa", "Dao động", "Vượt SLO từ đầu", "k6 không đạt tốc độ mục tiêu", "Chậm dần theo thời gian" | Giữ nguyên logic; `success:false` đổi thành "Response báo lỗi theo luật thành công đã cấu hình" |
| CPU BE, DB bận, RAM, truy vấn không index, một truy vấn chiếm phần lớn, "CPU và DB không quá tải nhưng vẫn chậm" | Chỉ chạy khi có dữ liệu Observability (mục 6); không có thì bỏ qua, như hiện tại |
| "Local nhanh/chậm hơn production nhiều" | Đổi thành "So với baseline production"; chỉ chạy khi project có baseline (Phase 9) |

Kết quả `diagnose` lưu thành artifact `REPORT_JSON` tên `diagnosis.json` và hiển thị ở panel "Nguyên nhân có khả năng". Finding chỉ tự tạo cho mục mức `critical` (vd. 5xx, timeout, vượt SLO), fingerprint = `k6:<ruleKey>:<itemName>`.

Unit test cũ (`test/report.test.js`, `test/diagnose.test.js`) chuyển sang Vitest, giữ nguyên dữ liệu mẫu; test nào kiểm tra câu chữ QS thì sửa theo câu chữ mới.

## 5. Chuẩn hóa kết quả

| Nguồn trong summary | Đích |
|---|---|
| Mỗi endpoint đã chọn | 1 `test_run_items` (`test_type=PERFORMANCE`, `test_name_snapshot=<name>`), 1 attempt, 1 result: `PASSED` nếu đạt cả p95, success, availability của item; `FAILED` nếu không; `NOT_APPLICABLE` nếu 0 request |
| k6 thoát lỗi khác 0/99, không có summary | Mọi item `ERROR`, `run_jobs.error_code = K6_FAILED` |
| Người dùng dừng giữa chừng | Có summary → kết quả theo phần đã chạy, run ghi `stopped_early` trong `result_metadata` |
| avg/med/p90/p95/p99/max, rps, bytes, đếm lỗi theo loại | `run_metrics` (`scope=ENDPOINT`) |
| Theo cửa sổ: rps, p95, success, target | `run_metrics` (`scope=WINDOW`, `scope_ref=<i>`) |
| KPI tổng: rps, p95, p99, success, availability, dropped iterations | `run_metrics` (`scope=RUN`) |

## 6. Observability integration (Phase 9, tùy chọn)

`probes.js` cần truy cập trực tiếp DB và process của hệ thống được test, điều worker không được làm. Thay thế:

1. **Agent nhỏ cài cạnh hệ thống được test** (`qa-hub-agent`, Node, đóng gói từ `probes.js` + `sample-resources.ps1`), nhận lệnh `start/stop` kèm `runJobId` qua HTTPS từ Hub, gửi lại `resources.json` và `sql.json`. Chỉ đọc. Token riêng mỗi agent.
2. Hoặc đọc từ **Prometheus** có sẵn của dự án (CPU, RAM, DB) theo khoảng thời gian của run.

Cả hai đổ dữ liệu vào cùng đầu vào `diagnose({ resources, sql })` như hiện tại.

## 7. Script import một lần (`infrastructure/scripts/import-k6-perf.ts`)

```text
pnpm import:k6-perf --project QSNET --environment Local --path legacy/k6-perf
```

1. Đọc `config/endpoints.json` → tạo `api_collections` (`source=K6_IMPORT`) + 15 `api_requests`; header `authorization: {{vars.token}}` cho nhóm web; `success_rule` `$.success != false` cho nhóm mobile.
2. Tạo `performance_scenarios` "Read APIs (từ k6-perf)" với weight cũ, `setup` = request login, SLO từ `slo.json`.
3. Seed `performance_profiles` từ `profiles.json` (nếu chưa có).
4. Với mỗi `results/<id>/`: tạo `test_runs` `IMPORTED`, chuẩn hóa `summary.json` như mục 5, upload `dashboard.html`, `k6.log`, `sql.json`, `resources.json` thành artifact.
5. In báo cáo: số request, scenario, run đã import; chạy lại không tạo trùng (khóa theo `source_ref = k6-perf:<runId>`).

## 8. Kế hoạch chuyển và tiêu chí parity

Cách làm "strangler": `k6-perf` vẫn dùng được cho đến khi Hub đạt đủ các mục dưới, sau đó chuyển vào `legacy/k6-perf/` (chỉ đọc) và ngừng dùng.

| # | Tiêu chí parity | Kiểm chứng |
|---|---|---|
| P1 | Chạy được 5 profile cũ với 15 API cũ trên `localhost:3020` (môi trường `kind=LOCAL`; Hub cài kiểu Cá nhân `DEPLOYMENT_MODE=personal`, hoặc kiểu Máy chủ nội bộ trỏ tới IP LAN của máy chạy BE) | Chạy `smoke` + `load` |
| P2 | Số liệu từng API (p95, success, availability, số request) lệch ≤ 5% so với `k6-perf` cùng điều kiện | Chạy song song hai tool với cùng profile, so bảng |
| P3 | Panel chẩn đoán ra cùng danh sách finding với `k6-perf` trên 5 summary cũ (trừ luật cần Observability) | Unit test dùng 5 file `summary.json` thật |
| P4 | Dừng giữa chừng vẫn có báo cáo phần đã chạy | Test thủ công |
| P5 | So sánh hai lần chạy, biểu đồ cửa sổ, Timeline (k6 dashboard) | Test thủ công |
| P6 | 5 lần chạy lịch sử đã import, xem được trong Hub | Mở từng run |

Ước lượng: 6–8 ngày dev (nằm trong Phase 4 của [12-implementation-plan.md](12-implementation-plan.md)).
