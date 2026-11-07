# 07. Thống kê, chỉ số sức khỏe, quality gate và báo cáo

- Người đọc: developer (module `dashboards`, `reports`, `scoring`, `quality-gates`), QA Lead, người thiết kế UI
- Liên quan: [04-database-schema.md](04-database-schema.md) mục 9, [01-product-requirements.md](01-product-requirements.md) E9, E10
- Công thức nằm ở `packages/scoring` (hàm thuần, không I/O, có unit test cho mọi ví dụ trong tài liệu này). Phiên bản công thức hiện tại: **`v1`**.

---

## 1. Công thức thống kê cơ bản (giữ nguyên spec 1.0 mục 8.5)

Chỉ tính trên test item đã có **kết quả cuối cùng hợp lệ**. Item `PENDING`, `QUEUED`, `RUNNING` không vào bất kỳ mẫu số nào trừ `Total Scheduled Items`. `CANCELLED` và `NOT_APPLICABLE` không tính vào `Completed`.

```text
Completed            = PASSED + FAILED + BLOCKED + SKIPPED + ERROR
Pass Rate            = PASSED / (PASSED + FAILED) × 100
Failure Rate         = FAILED / (PASSED + FAILED) × 100
Execution Error Rate = ERROR / Completed × 100
Completion Rate      = Completed / Total Scheduled Items × 100
```

Quy tắc hiển thị:

| Quy tắc | Ví dụ |
|---|---|
| Luôn hiện tử số/mẫu số cạnh phần trăm | `91,0% (81/89)` |
| Mẫu số = 0 → `N/A` (giao diện kỹ thuật) hoặc `Không có dữ liệu` (giao diện cho người không chuyên). Không bao giờ hiện `0%` | |
| `ERROR` không gộp vào `FAILED` | ERROR là lỗi runner/hạ tầng, FAILED là sản phẩm không đạt kỳ vọng |
| Pass Rate không tính BLOCKED/SKIPPED | Chúng thể hiện ở Completion Rate |

### 1.1. Ba chế độ tính khi có retry

| Chế độ | Ý nghĩa | Cột `daily_result_stats` | Cột `test_run_items` |
|---|---|---|---|
| **Kết quả cuối** (mặc định) | Mỗi item tính 1 lần, theo attempt cuối | `final_*` | `status` |
| **Lần chạy đầu** | Mỗi item tính 1 lần, theo attempt đầu. Dùng để thấy test "phải retry mới qua" | `first_passed`, `first_failed`, `first_error` | `first_attempt_status` |
| **Tất cả attempt** | Mỗi attempt là một lần thử; chỉ dùng để đo độ ổn định runner, **không** dùng cho Pass Rate của sản phẩm | `attempts_*` | `test_attempts` |

Không cộng tất cả attempt như các test case độc lập. Bộ chọn chế độ có ở mọi dashboard; chế độ đang dùng được ghi vào `report_snapshots.filter_snapshot`.

### 1.2. Ghi nhận người thực hiện

| Nguồn | Gán cho cá nhân? |
|---|---|
| Manual run | Có: `test_results.executed_by_user_id` |
| Chạy từ Web bởi người dùng | Tính vào "số run đã trigger" của `triggered_by_user_id`; **kết quả pass/fail không gán** cho người đó |
| CI / Scheduled / Service account | Không gán cá nhân. Hiển thị dưới nhãn "Tự động (CI/lịch)" |
| Import | Chỉ gán nếu file import có trường người thực hiện được map tới user có thật |

## 2. Chỉ số sức khỏe (health score)

### 2.1. Nguyên tắc

- Mỗi `quality_dimension` có một điểm 0–100, kèm **độ phủ** (`coverage` 0–1) và **độ tin cậy** (`HIGH|MEDIUM|LOW`).
- Không có dữ liệu → `score = null` → hiển thị **"Chưa kiểm tra"**. Không bao giờ thay bằng 0.
- Điểm chỉ phản ánh **các bài kiểm tra đã chạy**. Mọi màn hình có điểm đều kèm câu: *"Đây là kết quả của các bài kiểm tra đã chạy, không phải cam kết chất lượng."*
- Mỗi lần tính lưu một dòng `quality_scores` với `inputs` (số liệu đầu vào) và `formula_version`. Đổi công thức → tăng version; điểm cũ **không** tính lại, trừ khi chạy lệnh tính lại có chủ đích (ghi audit).

### 2.2. Phạm vi tính

| Phạm vi | Dữ liệu | Khi nào tính |
|---|---|---|
| **Theo run** (`test_run_id` có giá trị) | Chỉ kết quả của run đó + finding đang mở tại thời điểm run xong | Khi run `COMPLETED` |
| **Trạng thái hiện tại** theo môi trường (`period_start/end`) | Với mỗi test case: kết quả cuối **mới nhất** trong 30 ngày; k6/Lighthouse/ZAP: lần chạy mới nhất; finding: đang mở | Khi run xong, khi finding đổi trạng thái, và job hằng đêm |

### 2.3. Thang điểm

| Điểm | Nhãn | Màu | Icon |
|---|---|---|---|
| ≥ 90 | **Tốt** | xanh lá | ✓ |
| 75–89 | **Cần chú ý** | vàng | ● |
| 50–74 | **Có vấn đề** | cam | ▲ |
| < 50 | **Nghiêm trọng** | đỏ | ✕ |
| `null` | **Chưa kiểm tra** | xám | – |

Màu luôn đi kèm icon và chữ (spec 1.0 mục 10.3). Điểm làm tròn số nguyên khi hiển thị, lưu 1 chữ số thập phân.

### 2.4. Độ tin cậy

```text
HIGH   : coverage ≥ 0,8 và đủ mẫu tối thiểu của dimension
MEDIUM : coverage ≥ 0,5
LOW    : còn lại (vẫn hiện điểm, kèm nhãn "Ít dữ liệu")
```

Mẫu tối thiểu: FUNCTIONAL ≥ 20 kết quả; PERFORMANCE ≥ 1 run k6 không phải `smoke` hoặc ≥ 3 trang Lighthouse; ACCESSIBILITY ≥ 3 trang; COMPATIBILITY_UI ≥ 2 trình duyệt; RELIABILITY ≥ 20 lần smoke theo lịch.

### 2.5. Công thức từng khía cạnh (`v1`)

#### FUNCTIONAL

```text
w(priority)    = CRITICAL 4 · HIGH 3 · MEDIUM 2 · LOW 1        (priority_snapshot của item)
score          = Σ w(PASSED) / Σ w(PASSED + FAILED) × 100
cap            = có ≥ 1 item priority CRITICAL đang FAILED → score = min(score, 49)
coverage       = số test case ACTIVE trong phạm vi đã có kết quả Completed / số test case ACTIVE trong phạm vi
```

- Đầu vào: kết quả cuối của các item có `test_type` thuộc FUNCTIONAL (bảng ánh xạ ở 04 mục 2). JUnit import: mọi test có priority `MEDIUM` nếu không có thông tin.
- Test case bị quarantine (flaky) không tính vào score, hiện riêng số lượng.

#### PERFORMANCE

Trung bình của hai nhóm, mỗi nhóm có trọng số bằng nhau (để 30 endpoint không lấn át 3 trang):

```text
Nhóm A – API (k6, run gần nhất không phải smoke; nếu chỉ có smoke thì dùng smoke, confidence LOW)
  latency(endpoint) = p95 ≤ SLO → 100 ; p95 ≤ 1,5 × SLO → 60 ; còn lại → 20
  success           = rate ≥ SLO → 100 ; rate ≥ SLO − 0,01 → 60 ; còn lại → 20
  availability      = như success, với SLO availability
  A = mean( mean(latency mọi endpoint), success, availability )

Nhóm B – Trang (Lighthouse, mỗi trang đã audit)
  LCP : ≤ 2,5 s → 100 ; ≤ 4 s → 60 ; còn lại → 20
  TBT : ≤ 200 ms → 100 ; ≤ 600 ms → 60 ; còn lại → 20   (thay INP vì Lighthouse lab không đo được INP)
  CLS : ≤ 0,1 → 100 ; ≤ 0,25 → 60 ; còn lại → 20
  page = mean(LCP, TBT, CLS) ;  B = mean(page)

score    = mean của các nhóm có dữ liệu
coverage = (A có ? 0,5 : 0) + (B có ? 0,5 × số trang đã audit / số trang quan trọng : 0)
```

SLO lấy từ `performance_scenarios.slo` (mặc định p95 1000 ms, success 0,99, availability 0,999 như `k6-perf`). Nếu có dữ liệu INP thực tế (RUM, giai đoạn sau) thì dùng INP ≤ 200 ms / ≤ 500 ms thay TBT. "Trang quan trọng" = trang được đánh dấu trong project, mặc định 5 trang đầu theo độ sâu của discovery.

#### SECURITY

```text
penalty  = Σ finding SECURITY đang mở (OPEN|CONFIRMED|IN_PROGRESS|REOPENED):
           CRITICAL 40 · HIGH 20 · MEDIUM 8 · LOW 2 · INFO 0
score    = max(0, 100 − penalty)
cap      = có finding CRITICAL đang mở → score = min(score, 30)
coverage = Σ trọng số các loại kiểm tra đã chạy trong 30 ngày:
           HEADERS_TLS 0,3 · ZAP_BASELINE 0,4 · ZAP_API hoặc ZAP_FULL 0,3
```

`ACCEPTED_RISK` không bị trừ điểm nhưng được liệt kê riêng trong báo cáo. Chưa chạy loại kiểm tra nào → `null`.

#### ACCESSIBILITY

```text
page_score = max(0, 100 − Σ rule axe vi phạm (đếm mỗi rule 1 lần/trang):
             critical 10 · serious 5 · moderate 2 · minor 1)
score      = mean(page_score)
coverage   = số trang đã quét / số trang trong site map (tối đa 1)
```

Luôn hiện ghi chú: *"Công cụ tự động chỉ phát hiện khoảng 30–40% vấn đề WCAG. Cần kiểm tra thủ công (bàn phím, trình đọc màn hình) để kết luận."*

#### COMPATIBILITY_UI

```text
matrix   = Pass Rate của các item có browser/viewport (test COMPATIBILITY và test UI chạy theo ma trận)
visual   = số visual diff chưa được duyệt trong run gần nhất
score    = max(0, matrix − 5 × visual)          (mỗi diff chưa duyệt trừ 5, tối đa trừ 50)
coverage = số tổ hợp browser×viewport đã chạy / số tổ hợp khai báo trong test plan
```

#### WEB_STANDARDS

```text
lh       = mean(Lighthouse SEO, Lighthouse Best Practices) trên các trang đã audit
broken   = số link hỏng (4xx/5xx/không phân giải) duy nhất trong lần kiểm tra link gần nhất
score    = max(0, lh − min(30, 2 × broken))
coverage = như ACCESSIBILITY
```

#### RELIABILITY

```text
smoke    = tỉ lệ thành công của các run smoke theo lịch (schedule) trong 7 ngày gần nhất
flaky    = số test case is_flaky / số test case đã chạy ≥ 5 lần
score    = max(0, smoke × 100 − 100 × flaky)
coverage = 1 nếu có lịch smoke chạy ≥ 1 lần/ngày trong 7 ngày; tỉ lệ ngày có chạy nếu ít hơn
```

### 2.6. Câu kết luận và điểm tổng

Tiêu đề báo cáo **không** phải một con số mà là **câu kết luận** sinh bằng luật cố định, xét theo thứ tự, dừng ở luật đầu tiên khớp:

| # | Điều kiện | Câu kết luận |
|---|---|---|
| 1 | Mọi dimension đều `null` | "Chưa có đủ dữ liệu để đánh giá. Hãy chạy Kiểm tra nhanh hoặc một kế hoạch kiểm thử." |
| 2 | Có N finding CRITICAL đang mở | "Có N vấn đề nghiêm trọng cần xử lý trước khi phát hành." |
| 3 | Quality gate gần nhất `FAILED` | "Chưa đạt tiêu chí phát hành đã thống nhất: {tiêu chí bắt buộc đầu tiên bị trượt}." |
| 4 | Có dimension < 50 | "Khía cạnh {tên} đang ở mức nghiêm trọng." |
| 5 | Có finding HIGH đang mở hoặc dimension 50–74 | "Dùng được nhưng còn N vấn đề quan trọng nên xử lý." |
| 6 | FUNCTIONAL coverage < 0,5 | "Kết quả tốt, nhưng mới kiểm thử {x}% chức năng trong phạm vi." |
| 7 | Còn lại | "Không phát hiện vấn đề lớn trong các bài kiểm tra đã chạy." |

Câu phụ (nếu có run trước để so): "So với lần trước: tốt hơn ở {…}, kém hơn ở {…}."

**Điểm tổng** (tùy chọn, hiển thị nhỏ dưới câu kết luận):

```text
overall  = Σ (score_d × weight_d) / Σ weight_d     chỉ trên dimension có score
nhãn     = "Điểm trung bình 84 – dựa trên 5/7 khía cạnh"
```

Trọng số mặc định (sửa được ở `projects.settings.scoring.weights`, tổng không bắt buộc bằng 100):

| FUNCTIONAL | SECURITY | PERFORMANCE | ACCESSIBILITY | COMPATIBILITY_UI | RELIABILITY | WEB_STANDARDS |
|---:|---:|---:|---:|---:|---:|---:|
| 30 | 20 | 15 | 10 | 10 | 10 | 5 |

### 2.7. Ví dụ tính

**FUNCTIONAL** – phạm vi 50 case ACTIVE, đã chạy 40:

| Priority | PASSED | FAILED | BLOCKED |
|---|---:|---:|---:|
| CRITICAL (×4) | 5 | 0 | 0 |
| HIGH (×3) | 9 | 1 | 0 |
| MEDIUM (×2) | 13 | 2 | 0 |
| LOW (×1) | 8 | 1 | 1 |

```text
Σw(PASSED)        = 5·4 + 9·3 + 13·2 + 8·1 = 81
Σw(PASSED+FAILED) = 5·4 + 10·3 + 15·2 + 9·1 = 89
score = 81/89 = 91,0 → Tốt ;  coverage = 40/50 = 0,8 ;  confidence = HIGH (≥ 20 kết quả)
Pass Rate thường (không trọng số) = 35/39 = 89,7% ; BLOCKED chỉ ảnh hưởng Completion Rate
```

**PERFORMANCE** – SLO p95 1000 ms; 3 endpoint p95 = 400 / 1200 / 2000 ms; success 99,5%; availability 99,95%; 2 trang Lighthouse:

```text
A = mean( mean(100, 60, 20)=60 , 100 , 100 ) = 86,7
Trang 1: LCP 2,1 s→100, TBT 150 ms→100, CLS 0,05→100  → 100
Trang 2: LCP 3,2 s→60,  TBT 180 ms→100, CLS 0,02→100  → 86,7
B = 93,3 ;  score = mean(86,7 ; 93,3) = 90,0 → Tốt
```

**SECURITY** – đã chạy HEADERS_TLS và ZAP_BASELINE; mở 1 HIGH, 2 MEDIUM, 3 LOW:

```text
score = 100 − (20 + 16 + 6) = 58 → Có vấn đề ;  coverage = 0,3 + 0,4 = 0,7 ;  confidence = MEDIUM
```

**Kết luận** (giả sử không có CRITICAL, gate chưa đặt): luật 5 → "Dùng được nhưng còn 1 vấn đề quan trọng nên xử lý." Điểm tổng trên 3 dimension có dữ liệu = (91·30 + 90·15 + 58·20) / 65 = 80,6 → "Điểm trung bình 81 – dựa trên 3/7 khía cạnh".

### 2.8. Độ phủ luồng (D-28)

Cho biết bao nhiêu luồng đi lại giữa các trang đã có test. **Không** tính vào điểm khía cạnh nào; hiển thị như thông tin độ phủ và dùng được trong quality gate (`flow.coverage`).

```text
Độ phủ luồng = số bước chuyển (site_transitions) có ≥ 1 test case ACTIVE gắn qua test_case_transitions
               ───────────────────────────────────────────────────────────────────────────────────────
               số bước chuyển đã khám phá (lần discovery gần nhất + bước chuyển ghi bằng Recorder/AI Explorer)
```

- Mẫu số = 0 (chưa khám phá) → `Không có dữ liệu`, không hiện 0%.
- Hiển thị kèm tử/mẫu: "Độ phủ luồng 62% (31/50 luồng đã có test)".
- Tính trên test case **ACTIVE**, không cần đã chạy trong kỳ; phần "đã chạy" thể hiện qua FUNCTIONAL coverage.
- Câu giải thích cố định: *"Luồng là các đường đi giữa các trang mà hệ thống đã khám phá hoặc được ghi lại. Luồng cần dữ liệu đặc biệt có thể chưa có trong danh sách."*

## 3. Quality gate

### 3.1. Cấu trúc rule (`quality_gates.rules`)

```ts
type GateRule = {
  metric: GateMetric;            // xem bảng 3.2
  operator: '>=' | '>' | '<=' | '<' | '==' | '!=';
  value: number;
  mandatory: boolean;            // false = chỉ cảnh báo
  scope?: { testTypes?: TestType[]; endpoint?: string };
};
```

### 3.2. Danh mục metric

| Metric | Nguồn | Đơn vị |
|---|---|---|
| `functional.pass_rate` | Pass Rate kết quả cuối, test type FUNCTIONAL/API | % |
| `functional.critical_failed` | Số item priority CRITICAL đang FAILED | số |
| `completion_rate` | Completion Rate của run | % |
| `execution_error_rate` | Execution Error Rate | % |
| `findings.open.critical` / `findings.open.high` | Finding đang mở của project tại thời điểm đánh giá | số |
| `perf.p95_ms` | p95 toàn run k6 (hoặc theo `scope.endpoint`) | ms |
| `perf.success_rate` / `perf.availability` | k6 | % |
| `page.lcp_ms_max` | LCP lớn nhất trong các trang đã audit | ms |
| `security.score`, `a11y.score`, `functional.score`, `performance.score`, … | `quality_scores` của run | điểm |
| `a11y.critical_violations` | Số rule axe mức critical | số |
| `links.broken` | Số link hỏng | số |
| `flaky.count` | Số test case flaky trong phạm vi | số |
| `flow.coverage` | Độ phủ luồng (mục 2.8) | % |

### 3.3. Đánh giá

- Thời điểm: khi run `COMPLETED` (mọi `run_jobs` ở trạng thái kết thúc). Job chờ duyệt bị hết hạn → các metric phụ thuộc thiếu dữ liệu.
- Kết quả:
  - `FAILED`: có ít nhất một rule **bắt buộc** trượt.
  - `INCONCLUSIVE`: không rule bắt buộc nào trượt, nhưng có rule bắt buộc **thiếu dữ liệu** (vd. run không có k6 mà gate có `perf.p95_ms`).
  - `PASSED`: mọi rule bắt buộc đạt. Rule không bắt buộc trượt hiện là cảnh báo.
- `rule_results` lưu với mỗi rule: giá trị thực tế, ngưỡng, đạt/trượt/thiếu dữ liệu, link drill-down.
- Đánh giá lại (vd. sau khi đóng finding): tạo dòng `gate_evaluations` **mới**, không sửa dòng cũ.
- Sign-off: QA Lead/Admin/Owner ghi `signed_off_by`, `sign_off_note` (bắt buộc khi sign-off trên gate `FAILED`/`INCONCLUSIVE`); ghi audit `gate.sign_off`. Sign-off không đổi `result`.

### 3.4. Trả về cho CI

| Exit code | Ý nghĩa |
|---:|---|
| 0 | `PASSED` |
| 1 | `FAILED` |
| 2 | `INCONCLUSIVE` (CI có thể cấu hình coi là fail bằng `--strict`) |
| 3 | Run lỗi (`ERROR`/`CANCELLED`) hoặc hết thời gian chờ |

API trả `{ gate: { result, ruleResults[] }, reportUrl }`.

## 4. Dashboard

### 4.1. Bộ lọc toàn cục

Organization · Project (một/nhiều/tất cả) · khoảng thời gian · environment · test type · test level · branch/commit/build · execution source · người thực hiện · người trigger · runner · chế độ retry (mục 1.1).

- Một object filter duy nhất (Zod schema ở `packages/validation`) truyền cho **mọi** KPI, chart, bảng trên trang. Không widget nào có filter ngầm riêng.
- Filter nằm trên URL (chia sẻ được) và lưu được thành **preset** (cá nhân hoặc dùng chung cho project).
- Filter branch/commit/build không đi qua `daily_result_stats` mà query bảng thô (xem 04 mục 9); UI hiện nhãn "Đang tính trên dữ liệu chi tiết" nếu chậm hơn.

### 4.2. Dashboard công ty

- Thẻ sức khỏe trung bình theo dimension trên các project active (mỗi thẻ ghi "n/N dự án có dữ liệu").
- KPI và biểu đồ theo spec 1.0 mục 8.2: số test execution, test case đã thực thi, Pass/Fail/Error rate, Blocked/Skipped, finding theo severity, project và thành viên có hoạt động, thời gian chạy, xu hướng.
- Bảng project: tên, câu kết luận, 7 icon dimension, finding CRITICAL/HIGH mở, lần chạy gần nhất, gate gần nhất.

### 4.3. Dashboard project

- Câu kết luận + 7 thẻ dimension (điểm, nhãn, coverage, confidence, mũi tên so với kỳ trước).
- Theo spec 1.0 mục 8.3: tổng test case, đã chạy, pass/fail/error/blocked/skipped, pass rate theo test type, run gần nhất, theo build/branch, finding đang mở, xu hướng theo version, module (suite) nhiều lỗi, coverage nếu có.
- Thêm: gate gần nhất, test flaky, test case lâu chưa chạy (> 30 ngày), lịch chạy sắp tới.

### 4.4. Dashboard thành viên

Nội dung theo spec 1.0 mục 8.4 (manual test đã thực hiện, run đã trigger, pass/fail/blocked của manual test, project tham gia, finding tạo, số lần re-test, thời gian thực thi, hoạt động theo thời gian).

**Nguyên tắc công bằng (bắt buộc):**
- Không có bảng xếp hạng, không sắp thành viên theo số bug hay số test pass.
- Kết quả CI/lịch không gán cho người trigger.
- Không hiển thị "pass rate cá nhân" (pass/fail phản ánh sản phẩm, không phản ánh tester).
- Mặc định mỗi người chỉ xem dashboard của chính mình; QA Lead/Admin xem được của thành viên trong project mình quản lý.
- Trang có dòng: *"Đây là thống kê hoạt động kiểm thử, không phải chỉ số đánh giá hiệu suất."*

### 4.5. Drill-down

`KPI / thẻ dimension → danh sách project → project dashboard → run → item → attempt (bước, log, artifact) → finding`. Mỗi bước giữ nguyên filter. Mỗi số trên biểu đồ có tooltip ghi đơn vị, khoảng thời gian, tử số/mẫu số.

## 5. Báo cáo cho người không chuyên

### 5.1. Trang tóm tắt: 1 màn hình, 1 trang PDF (D-30)

Nguyên tắc: người đọc hiểu trong ≤ 2 phút (mục tiêu G3). Phần chữ của trang tóm tắt **≤ ~150 chữ** (không tính tên khía cạnh và nhãn). Mọi thứ khác nằm ở phần mở rộng.

```text
┌──────────────────────────────────────────────────────────────────┐
│ Báo cáo chất lượng · Shop ABC · [LOCAL] máy dev 192.168.1.50      │
│ 01/11–07/11/2026 (Asia/Ho_Chi_Minh) · tạo 07/11 15:20             │
├──────────────────────────────────────────────────────────────────┤
│ ▲ Dùng được nhưng còn 1 vấn đề quan trọng nên xử lý.              │
│   Tốt hơn lần trước ở Hiệu năng, kém hơn ở Bảo mật.  ▁▃▅▆▅▇ 30 ngày│
├──────────────────────────────────────────────────────────────────┤
│ [✓ Chức năng 91] [✓ Hiệu năng 90] [▲ Bảo mật 58] [– Truy cập]     │
│ [● Giao diện 82] [✓ Chuẩn web 95] [– Ổn định]                     │
├──────────────────────────────────────────────────────────────────┤
│ 3 VẤN ĐỀ CẦN XỬ LÝ                                                │
│ ┌────┐ 1. [Cao] Không đặt hàng được khi giỏ có mã giảm giá        │
│ │ảnh │ Ảnh hưởng: khách không thanh toán được, mất đơn hàng.      │
│ └────┘ Nguyên nhân (AI đề xuất · tin cậy cao): API /orders trả    │
│        lỗi 500 khi mã giảm giá hết hạn.                           │
│        Cách sửa: kiểm tra mã hết hạn trước khi tính tiền.         │
│ ┌────┐ 2. …                                                       │
│ └────┘ 3. …                                                       │
├──────────────────────────────────────────────────────────────────┤
│ Độ phủ luồng  ████████████░░░░░░░  62% (31/50 luồng đã có test)   │
│ Chưa kiểm tra: Truy cập, Ổn định, Firefox/Safari                  │
├──────────────────────────────────────────────────────────────────┤
│ Kết quả của các bài kiểm tra đã chạy, không phải cam kết chất     │
│ lượng. ▸ Xem chi tiết kỹ thuật                                    │
└──────────────────────────────────────────────────────────────────┘
```

| Khối | Quy tắc |
|---|---|
| Header | Tên dự án, **nhãn loại môi trường** nổi bật (`LOCAL`, `DEV`, `STAGING`, `PRODUCTION`, mỗi loại một màu + chữ) kèm URL/host. Báo cáo `LOCAL` có dòng nhỏ: "Kiểm thử trên máy phát triển; kết quả có thể khác khi lên internet." Một báo cáo chỉ thuộc **một** môi trường; không trộn LOCAL với PRODUCTION |
| Kết luận | Câu kết luận mục 2.6 + câu so sánh 1 dòng + sparkline điểm trung bình 30 ngày (không trục, chỉ có tooltip trên web) |
| 7 thẻ | Icon + tên ngắn + điểm (hoặc "–" cho Chưa kiểm tra). Coverage, confidence, mũi tên ↑↓ chỉ hiện khi rê chuột/bấm (web) hoặc ở phụ lục (PDF) |
| 3 vấn đề | **Tối đa 3**, chọn theo: severity → ảnh hưởng tới luồng chính (test case CRITICAL hoặc tag `flow:main`) → số lần xuất hiện → mới nhất. Mỗi vấn đề đúng 4 dòng: *chuyện gì xảy ra* (1 câu, từ template 5.2), *ảnh hưởng tới người dùng*, *nguyên nhân có khả năng* (mục 5.1.1), *cách khắc phục*; kèm 1 ảnh minh họa thu nhỏ (screenshot của bước lỗi hoặc trang có vấn đề) nếu có và người tạo báo cáo cho phép hiện ảnh. Không có vấn đề nào → "Không có vấn đề cần xử lý gấp" |
| Độ phủ luồng | Thanh ngang + tử/mẫu (mục 2.8) |
| Chưa kiểm tra | **Một dòng**: dimension `null`, trình duyệt chưa chạy, "N test case chưa chạy trong kỳ" (chỉ ghi khi N > 0) |
| Chi tiết kỹ thuật | Web: khối thu gọn "Xem chi tiết kỹ thuật". Xuất file: **PDF tóm tắt 1 trang**, phụ lục là **file riêng tùy chọn** (`…-phu-luc.pdf`) gồm bảng số liệu đầy đủ, coverage/confidence từng khía cạnh, công thức, danh sách finding, run đã dùng, bộ lọc, glossary |

Kiểm tra tự động khi xuất PDF: trang tóm tắt vượt 1 trang A4 → cắt bớt (vấn đề 3 trước, rồi ảnh minh họa) và ghi log cảnh báo, không bao giờ tràn sang trang 2.

#### 5.1.1. Chọn "Nguyên nhân có khả năng" cho báo cáo (D-26)

Theo thứ tự, lấy nguồn đầu tiên có:

1. **AI tự phân tích trong lúc chạy**: `test_results.ai_analysis_id` của lần xuất hiện gần nhất (finding → `finding_occurrences` → `test_result`). Hiện nhãn **"AI đề xuất"** + độ tin cậy (cao/trung bình/thấp). Phân tích có độ tin cậy thấp vẫn hiện nhưng kèm "cần kiểm tra lại".
2. Con người đã xác nhận nguyên nhân (`failure_category_source = HUMAN`, có ghi chú) → hiện nhãn "Đã xác nhận", **ưu tiên hơn AI** nếu có.
3. Không có phân tích AI (AI tắt, hết ngân sách, chưa phân tích xong) → câu theo luật: `failure_category` do luật gán + template trong i18n namespace `impact` (vd. ENVIRONMENT: "Môi trường test không phản hồi, có thể máy chủ chưa chạy"). Nhãn "Phân loại tự động".
4. Không có gì → "Chưa xác định nguyên nhân".

Câu AI đưa vào báo cáo phải qua cùng bộ kiểm tra của [08](08-ai-assistant.md) (không chứa số liệu không có trong dữ liệu nguồn, đã lọc secret) và được cắt tối đa 30 chữ; bản đầy đủ nằm ở phụ lục và trang finding.

### 5.2. Thư viện câu mô tả bằng lời thường

Template đặt ở i18n namespace `impact`, key theo `findings.rule_id` hoặc loại lỗi; biến trong `{}` lấy từ dữ liệu. Không có template → dùng mô tả chung theo category.

| Rule / loại | Tiêu đề | Ảnh hưởng tới người dùng | Nên làm gì |
|---|---|---|---|
| `lighthouse:largest-contentful-paint` | Trang {page} tải chậm ({lcp} giây) | Người dùng phải chờ {lcp} giây mới thấy nội dung chính; trên 2,5 giây nhiều người sẽ rời trang | Tối ưu ảnh lớn, giảm JavaScript tải lúc đầu; mục tiêu dưới 2,5 giây |
| `headers:strict-transport-security` | Website chưa bắt buộc kết nối bảo mật (HSTS) | Người dùng ở Wi-Fi công cộng có thể bị chuyển sang kết nối không mã hóa và bị đánh cắp thông tin | Bật header HSTS trên máy chủ web |
| `axe:color-contrast` | Chữ khó đọc trên {n} trang | Người mắt kém hoặc dùng điện thoại ngoài nắng khó đọc nội dung | Tăng độ tương phản giữa chữ và nền (tối thiểu 4,5:1) |
| `links:broken` | {n} đường link bị hỏng | Người dùng bấm vào sẽ gặp trang lỗi, mất niềm tin và không tìm được thông tin | Sửa hoặc gỡ các link trong danh sách |
| `api:server_error` | Chức năng "{endpoint}" bị lỗi máy chủ ({rate}% lần gọi) | Người dùng có thể thấy thông báo lỗi hoặc thao tác không lưu được | Đội phát triển kiểm tra log máy chủ ở thời điểm lỗi |
| `functional:failed` (test case có tag/flow login) | Đăng nhập không thành công trong kiểm thử | Người dùng có thể không vào được hệ thống | Kiểm tra lại chức năng đăng nhập trước khi phát hành |
| `perf:p95_over_slo` | "{endpoint}" phản hồi chậm khi đông người dùng | Khi nhiều người dùng cùng lúc, thao tác này mất tới {p95} giây | Tối ưu truy vấn/bộ nhớ đệm; xem phần chẩn đoán kỹ thuật |
| `zap:cookie-no-httponly` | Cookie đăng nhập chưa được bảo vệ đủ | Nếu website có lỗ hổng khác, kẻ xấu dễ lấy được phiên đăng nhập | Đặt cờ HttpOnly và Secure cho cookie phiên |

### 5.3. Glossary

- Kế thừa ý tưởng `GLOSSARY` trong `k6-perf/ui/app.js`: mọi thuật ngữ (p95, pass rate, SLO, LCP, CLS, HSTS, flaky, coverage…) được bọc bằng component `<Term k="p95">` hiện tooltip, truy cập được bằng bàn phím (`tabindex`, `aria-describedby`).
- Nội dung ở i18n namespace `glossary` (`vi`, `en`); chuyển các mục có sẵn của `k6-perf` sang đây. Bản PDF in glossary ở cuối phụ lục.

### 5.4. Định dạng số

| Loại | Giao diện kỹ thuật | Báo cáo cho người không chuyên |
|---|---|---|
| Số | `Intl.NumberFormat('vi-VN')`: `1.234` | như bên trái |
| Phần trăm | `91,0%` + tử/mẫu | `91%` + "(81/89 bài kiểm tra)" |
| Thời gian phản hồi | `812 ms`, `1,25 s` | `0,8 giây`, `1,3 giây` (luôn giây, 1 chữ số thập phân) |
| Không có dữ liệu | `N/A` | `Không có dữ liệu` / `Chưa kiểm tra` |
| Ngày giờ | `07/11/2026 15:20` + timezone ở header | như bên trái |

### 5.5. Loại báo cáo (theo spec 1.0 mục 8.6, điều chỉnh cho web)

| Báo cáo | Nội dung chính |
|---|---|
| Company Quality Report | Mục 4.2 + tóm tắt từng project |
| Project Health Report (mặc định) | Bố cục 5.1 cho một project + **một** môi trường (nhãn loại môi trường ở header) |
| Test Run Report | Một run: kết quả, gate, finding mới, so sánh với run trước |
| Release/Build Quality Summary | Gom các run cùng `app_version`/`build_number`, gate, sign-off |
| Test Type Report | Pass rate, xu hướng theo test type |
| Member Activity Report | Mục 4.4, giữ nguyên nguyên tắc công bằng |
| Findings Report | Finding theo severity, trạng thái, tuổi |
| Performance Report | Bảng theo endpoint (như `k6-perf`), Lighthouse theo trang, chẩn đoán |
| Security Report | Finding bảo mật, kiểm tra đã chạy, coverage |
| Accessibility Report | Vi phạm theo rule và trang, ghi chú giới hạn công cụ tự động |

### 5.6. Snapshot, xuất file, chia sẻ

- **Snapshot**: tạo báo cáo = tính số liệu một lần và lưu vào `report_snapshots.data` cùng filter, timezone, `formula_version`. Mọi bản xuất và link chia sẻ đọc từ snapshot, nên luôn khớp nhau và không đổi theo dữ liệu mới.
- **PDF**: worker-browser mở chính trang HTML báo cáo (route in riêng, CSS `@media print`) và gọi `page.pdf()`. Không duy trì template PDF thứ hai. Mặc định xuất **1 file tóm tắt 1 trang**; tick "Kèm phụ lục kỹ thuật" thì xuất thêm file phụ lục (cùng snapshot).
- **XLSX**: `exceljs`, mỗi bảng một sheet, sheet đầu "Tóm tắt", sheet cuối "Bộ lọc & thời điểm tạo".
- **CSV**: UTF-8 có BOM (Excel đọc đúng tiếng Việt); ô bắt đầu bằng `=`, `+`, `-`, `@`, tab, CR được thêm tiền tố `'` để chặn formula injection.
- **HTML**: file đơn tự chứa (CSS inline).
- **Link chia sẻ** (`report_shares`): token ngẫu nhiên 32 byte, chỉ lưu hash; hạn mặc định 7 ngày, tối đa 90; thu hồi được; đếm lượt xem; chỉ xem snapshot. Tùy chọn khi tạo: **"Ẩn thông tin cá nhân"** (tên/email thành viên thay bằng vai trò) và **"Cho tải ảnh chụp/bằng chứng"** (mặc định tắt, vì ảnh có thể chứa dữ liệu thật). Tạo/thu hồi link ghi audit.

## 6. So sánh run, xu hướng, flaky

### 6.1. So sánh hai run

Ghép item theo `test_case_id + browser + viewport`, hoặc `external_test_id` với kết quả import.

| Nhóm | Định nghĩa |
|---|---|
| Mới lỗi | A: PASSED → B: FAILED/ERROR |
| Đã sửa | A: FAILED/ERROR → B: PASSED |
| Vẫn lỗi | FAILED/ERROR ở cả hai |
| Mới thêm / Bị bỏ | Chỉ có ở B / chỉ có ở A |
| Hiệu năng | Δp95 và Δsuccess theo endpoint; chậm hơn > 10% tô đỏ, nhanh hơn > 10% tô xanh (giữ quy ước `k6-perf`) |
| Finding | Mới xuất hiện / không còn xuất hiện giữa hai run |

### 6.2. Xu hướng

- Gom theo ngày/tuần/tháng từ `daily_result_stats` (ngày theo timezone org).
- Mỗi điểm hiện tỉ lệ kèm mẫu số trong tooltip; điểm có < 5 kết quả vẽ rỗng và ghi "ít dữ liệu".
- Đánh dấu mốc build/version trên trục thời gian.
- Xu hướng điểm sức khỏe đọc từ `quality_scores` (phạm vi "trạng thái hiện tại", một điểm/ngày).

### 6.3. Flaky

```text
recent    = 20 trạng thái cuối gần nhất của test case trên một môi trường (chỉ PASSED/FAILED)
flip_rate = số lần đổi trạng thái liên tiếp / (len(recent) − 1)
is_flaky  = len(recent) ≥ 5 và flip_rate ≥ 0,3
```

- Thêm cờ "Qua sau khi retry" cho item có attempt đầu FAILED và attempt cuối PASSED.
- Test flaky có thể được QA Lead đặt `quarantined`: vẫn chạy và hiện kết quả, nhưng không tính vào FUNCTIONAL score và `functional.pass_rate` của gate; báo cáo luôn hiện số test đang quarantine.
