# 12. Kế hoạch triển khai

- Người đọc: Tech Lead, team dev, người quản lý dự án
- Giả định team: **1 backend, 1 frontend, 1 fullstack** (lo worker/runner), **1 QA bán thời gian** (từ Phase 2). Sprint 2 tuần, 10 ngày làm việc/người/sprint, đã trừ ~20% cho họp, review, sửa lỗi.
- Ước lượng tính bằng **ngày-người (d)**. Năng lực mỗi sprint ≈ 3 người × 8 d = **24 d**.

---

## 1. Lộ trình tổng

| Phase | Sprint | Tuần | Nội dung | Mốc |
|---|---|---|---|---|
| 0 | – | 1 | Khởi tạo repo, CI, Docker Compose, khung app | |
| 1 | S1–S2 | 2–5 | Nền tảng: auth, org, RBAC, project, môi trường (`LOCAL`...), **công tắc bật/tắt test**, secret, allowlist, audit | |
| 2 | S3–S4 | 6–9 | Quản lý test + manual execution + finding + artifact | |
| 3 | S5–S6 | 10–13 | Execution engine (queue, orchestrator, SSE) + API testing | |
| 4 | S7–S8 | 14–17 | Performance (chuyển `k6-perf`) + **AI lõi: Gemini, tự phân tích nguyên nhân lỗi** | **M1 – Alpha nội bộ**: manual + API + hiệu năng + AI phân tích lỗi |
| 5 | S9–S11 | 18–23 | Browser (Playwright + DSL), **Recorder**, **trình sửa bước trực quan**, Discovery + **sơ đồ luồng**, sinh test theo luật, audit, Quick Scan | |
| 6 | S12–S13 | 24–27 | Dashboard, chỉ số sức khỏe, **báo cáo 1 trang có nguyên nhân AI**, xuất file, quality gate | **M2 – MVP nội bộ** |
| 7 | S14–S15 | 28–31 | AI sinh test, **AI Explorer**, AI tóm tắt báo cáo, JUnit import, CI API | |
| 8 | S16–S18 | 32–37 | **Kiểu Máy chủ nội bộ** (mời thành viên, SSO, dashboard thành viên, link chia sẻ, xuất/nhập dự án), ZAP, visual regression, lịch chạy, thông báo, hardening, backup | **M3 – v1.0** |
| 9 | sau v1.0 | – | Local runner agent, Observability agent, production baseline, sửa locator bằng AI... | |

**Kiểu cài Cá nhân làm trước** (D-32): M1 và M2 phát hành dạng Hub chạy trên máy dev; phần chỉ cần khi nhiều người dùng chung dồn về Phase 8.

Tổng đến v1.0: khoảng **37 tuần (~8,5 tháng)** với team 3 người (tăng 6 tuần so với bản đầu vì thêm Recorder dạng trình duyệt từ xa, sơ đồ luồng, AI Explorer, đưa AI lên sớm, và tách kiểu Máy chủ thành một khối ở Phase 8). Muốn nhanh hơn: thêm 1 dev từ Phase 3 rút còn ~27 tuần (Phase 5 và 6 chạy song song được vì ít phụ thuộc nhau).

```text
Tuần  1    5    9    13   17     23   27   31     37
P0   ▇
P1    ▇▇▇▇
P2         ▇▇▇▇
P3              ▇▇▇▇
P4                   ▇▇▇▇ M1
P5                       ▇▇▇▇▇▇
P6                             ▇▇▇▇ M2
P7                                 ▇▇▇▇
P8                                     ▇▇▇▇▇▇ M3
```

## 2. Chi tiết từng phase

Ký hiệu lớp: **BE** backend, **FE** frontend, **W** worker, **DB** migration, **Ops** hạ tầng, **QA** kiểm thử.

### Phase 0. Khởi tạo (tuần 1, ~8 d)

| ID | Việc | Lớp | d |
|---|---|---|---|
| 0.1 | Monorepo pnpm + Turborepo, TS strict, ESLint, Prettier, commitlint | Ops | 1 |
| 0.2 | `apps/api` NestJS khung: config (Zod validate env), pino, health, error filter thống nhất, OpenAPI | BE | 1,5 |
| 0.3 | `apps/web` Vite + React + Tailwind + shadcn, layout sidebar, i18n, theme sáng/tối, router | FE | 1,5 |
| 0.4 | `apps/worker` khung nhiều entrypoint, kết nối BullMQ | W | 1 |
| 0.5 | Docker Compose: profile `personal` (mặc định, chạy trên máy dev, bind `127.0.0.1`) + dev (postgres, redis, minio, mailpit) | Ops | 1 |
| 0.6 | CI: lint, typecheck, unit test, build | Ops | 1 |
| 0.7 | Drizzle setup, migration đầu, seed script | DB | 1 |

**Xong khi:** `docker compose up` + `pnpm dev` chạy được cả 3 app; CI xanh.

### Phase 1. Nền tảng (S1–S2, ~44 d)

| ID | Việc | Lớp | d |
|---|---|---|---|
| 1.1 | Bảng users, organizations, members, invitations, refresh_tokens, service_accounts, audit_logs | DB | 2 |
| 1.2 | Auth: màn cài lần đầu tạo Owner, đăng nhập, refresh xoay vòng, logout, khóa sau 5 lần sai, lệnh CLI `pnpm hub:init`, `hub:create-owner`, `hub:reset-password`, `hub:backup` | BE | 4 |
| 1.3 | RBAC: guard org/project, policy service, decorator `@Can(action, resource)`; **test ma trận quyền tự động** | BE | 4 |
| 1.4 | Organization, thành viên, đổi role (thêm thành viên trực tiếp; lời mời qua email để Phase 8) | BE+FE | 2 |
| 1.5 | Service account: tạo (hiện token 1 lần), scope, thu hồi | BE+FE | 2 |
| 1.6 | Projects + project members (CRUD, archive) | BE+FE | 4 |
| 1.7 | Environments, biến, tài khoản test theo vai trò | BE+FE | 4 |
| 1.8 | Secret vault AES-256-GCM, key version, API write-only, masking | BE | 3 |
| 1.9 | Target allowlist + xác minh DNS TXT / well-known file / Admin duyệt; `allow_private_network` + CIDR | BE+FE | 4 |
| 1.10 | Audit interceptor + màn Audit log | BE+FE | 2 |
| 1.11 | Màn đăng nhập, chọn organization, cài đặt cá nhân (ngôn ngữ, timezone) | FE | 3 |
| 1.12 | Integration test (Testcontainers) cho auth, RBAC, secret | BE | 3 |
| 1.13 | Loại môi trường `LOCAL/DEV/STAGING/PRODUCTION`; công tắc bật/tắt test cấp tổ chức + môi trường (audit, lý do, chặn ở API); hỗ trợ target `localhost` ở kiểu cài Cá nhân (`host.docker.internal`) | BE+FE | 4 |

**Xong khi:** đạt nghiệm thu "Organization & Users" của spec 1.0 mục 13; user ngoài project bị 403/404 ở mọi endpoint (test tự động); tắt production thì mọi đường tạo run bị chặn (test tự động).

### Phase 2. Quản lý test và manual testing (S3–S4, ~46 d)

| ID | Việc | Lớp | d |
|---|---|---|---|
| 2.1 | Bảng plan, suite, case, step, version, tag, suite_cases; sinh `case_key` tuần tự an toàn khi đồng thời | DB | 2 |
| 2.2 | Suite dạng cây (kéo thả sắp xếp), case thuộc nhiều suite | BE+FE | 4 |
| 2.3 | Test case editor: thông tin, bước thủ công, tag, phân loại; lịch sử phiên bản + so sánh | BE+FE | 6 |
| 2.4 | Danh sách case: tìm kiếm (trigram), lọc, phân trang cursor, thao tác hàng loạt | BE+FE | 4 |
| 2.5 | Import/Export CSV, XLSX (mẫu file có sẵn, báo lỗi theo dòng) | BE+FE | 4 |
| 2.6 | Test plan: phạm vi, môi trường, tiêu chí kết thúc | BE+FE | 3 |
| 2.7 | Bảng runs, run_jobs, items, attempts, results, step_results, artifacts | DB | 2 |
| 2.8 | Tạo run thủ công từ plan/suite/chọn case; giao người thực hiện | BE+FE | 3 |
| 2.9 | Manual execution workspace: từng bước, phím tắt P/F/B/S, dán ảnh, ghi chú, retry = attempt mới | BE+FE | 6 |
| 2.10 | Artifact: presigned upload/download MinIO, giới hạn dung lượng, kiểm MIME | BE | 2 |
| 2.11 | Findings: CRUD, severity/status, comment, link issue ngoài, tạo từ kết quả fail | BE+FE | 5 |
| 2.12 | Trang tổng quan dự án bản đơn giản (đếm kết quả run gần nhất, finding mở) | FE | 2 |
| 2.13 | E2E Playwright cho luồng: tạo case → chạy manual → tạo finding | QA | 3 |

**Xong khi:** tester chuyển được một bộ test case Excel thật của một dự án vào Hub, chạy manual hết, có finding và bằng chứng.

### Phase 3. Execution engine và API testing (S5–S6, ~48 d)

| ID | Việc | Lớp | d |
|---|---|---|---|
| 3.1 | `packages/runner-contracts`, runner registry | W | 2 |
| 3.2 | Orchestrator: chia run thành job, lease + heartbeat, quét job mất worker, cancel, timeout, idempotency | W+BE | 6 |
| 3.3 | Execution policy + approval (bảng, API, màn Phê duyệt, digest cấu hình) | BE+FE | 4 |
| 3.4 | SSE tiến độ + log (Redis pub/sub), hook `useRunEvents` | BE+FE | 3 |
| 3.5 | **SSRF guard** trong code (resolve DNS, chặn dải IP, pin IP, kiểm lại redirect) + **egress proxy** container; test tự động với các URL tấn công | W+Ops | 5 |
| 3.6 | API collection, request builder (method, URL, header, query, body, auth), biến môi trường | BE+FE | 7 |
| 3.7 | Assertion (status, header, JSONPath, thời gian, JSON schema bằng ajv), extract + chaining | W+FE | 5 |
| 3.8 | API runner: chạy 1 request (thử nhanh) và chạy cả collection trong run; redact secret | W | 4 |
| 3.9 | Import OpenAPI 3 / Swagger 2 / Postman v2.1 | BE | 4 |
| 3.10 | Run detail: job lanes, log, kết quả theo item, attempt, response viewer | FE | 5 |
| 3.11 | Retry các item fail/error thành attempt mới | BE | 1 |
| 3.12 | Integration test: worker chết giữa chừng, cancel, nhận trùng message | QA+W | 2 |

**Xong khi:** đạt nghiệm thu "Execution" của spec 1.0 mục 13 cho manual và API; SSRF test suite xanh.

### Phase 4. Performance (chuyển `k6-perf`) + AI lõi (S7–S8, ~38 d)

Chi tiết ở [11-k6-migration.md](11-k6-migration.md).

| ID | Việc | Lớp | d |
|---|---|---|---|
| 4.1 | Worker image `worker-k6`, script k6 tổng quát đọc `job.json`, giới hạn cứng theo policy | W | 4 |
| 4.2 | Chuyển `report.js`, `diagnose.js` + test sang `packages/report-normalizers` (TS, Vitest) | W | 2 |
| 4.3 | Chuẩn hóa summary → items, metrics, artifact; stop qua k6 REST API | W | 3 |
| 4.4 | Bảng + API performance profiles, scenarios, SLO | BE | 2 |
| 4.5 | UI: tạo scenario (chọn API request + weight), chạy, chi tiết (KPI, chẩn đoán, bảng theo API, biểu đồ cửa sổ, Timeline), so sánh | FE | 7 |
| 4.6 | Script import `k6-perf` (config + 5 lần chạy cũ) | BE | 2 |
| 4.7 | Kiểm tra parity P1–P6 | QA | 2 |
| 4.8 | AI provider adapter: **Gemini mặc định**, OpenAI, Claude, OpenAI-compatible local; `ai_provider_configs`; màn Settings → AI (chọn model theo mục đích, nút "Kiểm tra kết nối", ngân sách token) | BE+FE | 5 |
| 4.9 | Pipeline lọc dữ liệu nhạy cảm trước khi gửi AI + test; chặn dữ liệu môi trường `PRODUCTION` trừ khi Admin bật | BE | 3 |
| 4.10 | **Tự phân tích nguyên nhân lỗi**: luật phân loại trước + Gemini giải thích; chữ ký lỗi để gom; giới hạn số phân tích/run; SSE `analysis.ready`; panel "Nguyên nhân có khả năng" ở run detail (manual, API, hiệu năng) | BE+W+FE | 6 |
| 4.11 | Feedback 👍/👎 + lý do, theo dõi token/chi phí | BE+FE | 2 |

**Mốc M1:** team dùng thử nội bộ cho 1–2 dự án thật đang chạy ở local. Thu feedback (đặc biệt về độ đúng của nguyên nhân AI) trước khi làm Phase 5.

### Phase 5. Browser, Recorder, sơ đồ luồng, sinh test, Quick Scan (S9–S11, ~71 d)

| ID | Việc | Lớp | d |
|---|---|---|---|
| 5.1 | `packages/test-dsl`: schema Zod, validator, chuyển DSL ↔ câu mô tả bước | W | 3 |
| 5.2 | Worker image `worker-browser`, Playwright runner diễn dịch DSL; screenshot/video/trace khi fail | W | 6 |
| 5.3 | Shared flow (đăng nhập) + dùng tài khoản test theo vai trò; data set | W+BE | 3 |
| 5.4 | Ma trận trình duyệt × viewport | W+BE | 2 |
| 5.5 | **Trình sửa bước trực quan**: mỗi bước một thẻ có ảnh chụp, kéo thả, form từng action, chọn locator, "chạy thử bước" | FE | 8 |
| 5.6 | Discovery crawler + bảng site_pages, discovered_endpoints, **site_transitions** | W+BE | 6 |
| 5.6b | **Sơ đồ luồng** (React Flow): trang + bước chuyển, tô màu đã/chưa có test, độ phủ luồng, bấm bước chuyển → sinh test / ghi / AI khám phá | BE+FE | 6 |
| 5.6c | **Recorder (trình duyệt từ xa trong Hub)**: phiên ghi trên worker-browser, CDP screencast → WebSocket, chuyển chuột/bàn phím ngược lại, script ghi sinh DSL + ảnh từng bước, che ô mật khẩu, "Thêm kiểm tra" chọn phần tử, upload file, kết thúc → test case `DRAFT`, chạy lại xác nhận | W+BE+FE | 14 |
| 5.7 | Sinh test theo luật (`generators`) + hàng đợi duyệt (duyệt/sửa/bỏ hàng loạt, chống trùng) | BE+FE | 6 |
| 5.8 | Audit runner: Lighthouse, axe, link checker, headers/TLS/cookie | W | 6 |
| 5.9 | Finding tự động + fingerprint + mở lại khi tái xuất hiện | BE | 3 |
| 5.10 | Quick Scan: preset, timebox ≤ 15 phút, màn kết quả tạm (bản đầy đủ ở Phase 6) | BE+FE | 4 |
| 5.11 | Wizard "Thêm dự án" (thông tin → môi trường → xác minh → tài khoản test → nguồn dữ liệu → chạy Quick Scan + Discovery) | FE | 4 |

**Xong khi:** với một website thật của công ty đang chạy ở local, từ lúc tạo dự án đến lúc có kết quả Quick Scan ≤ 15 phút; sinh được bộ test case nháp đạt tiêu chí US-02; ghi được một luồng nhiều bước bằng Recorder và chạy lại thành công (US-06); sơ đồ luồng hiện độ phủ (US-09).

### Phase 6. Dashboard, báo cáo, quality gate (S12–S13, ~43 d)

| ID | Việc | Lớp | d |
|---|---|---|---|
| 6.1 | `daily_result_stats`, `test_case_stats` cập nhật khi run xong; job tính lại toàn bộ (backfill) | W+DB | 4 |
| 6.2 | `packages/scoring` công thức v1 + unit test với số liệu mẫu; `quality_scores` | W | 4 |
| 6.3 | API dashboard với bộ lọc toàn cục (spec 1.0 mục 8.1), áp nhất quán cho KPI/biểu đồ/bảng | BE | 5 |
| 6.4 | Dashboard công ty (tất cả dự án) và dự án; drill-down; lưu bộ lọc (dashboard thành viên để Phase 8) | FE | 6 |
| 6.5 | **Báo cáo 1 trang**: câu kết luận, 7 thẻ, xu hướng nhỏ, tối đa 3 vấn đề (ảnh hưởng + **nguyên nhân AI** + cách sửa + ảnh), độ phủ luồng, "chưa kiểm tra"; phụ lục kỹ thuật tách riêng; thư viện câu "ảnh hưởng tới người dùng" | BE+FE | 7 |
| 6.6 | Report snapshot, xuất PDF (Playwright), XLSX, CSV (chống formula injection), HTML | W+BE | 5 |
| 6.8 | Quality gate: rule, đánh giá khi run xong, `INCONCLUSIVE`, sign-off | BE+FE | 5 |
| 6.9 | So sánh 2 run, phát hiện flaky | BE+FE | 3 |
| 6.10 | Mẫu test plan có sẵn | BE | 1 |
| 6.11 | Usability test báo cáo với 5 người không chuyên (mục tiêu G3) + sửa theo kết quả | QA+FE | 3 |

**Mốc M2 – MVP nội bộ:** đạt toàn bộ checklist "MVP nội bộ" ở [01-product-requirements.md](01-product-requirements.md) mục 11. Mỗi dev cài bản Cá nhân trên máy mình và dùng cho các dự án web đang làm.

### Phase 7. AI sinh test, AI Explorer, JUnit, CI (S14–S15, ~38 d)

(Provider Gemini, lọc dữ liệu và phân tích lỗi tự động đã làm ở Phase 4.)

| ID | Việc | Lớp | d |
|---|---|---|---|
| 7.3 | Sinh test case bằng AI (từ mô tả, tài liệu, OpenAPI, form, sơ đồ luồng) → DRAFT; chống trùng | BE+FE | 7 |
| 7.4 | AI đề xuất bước DSL cho case thủ công | BE+FE | 3 |
| 7.5 | **AI Explorer**: Gemini điều khiển Playwright (cây accessibility + ảnh → chọn thao tác), giới hạn bước/thời gian, chỉ ghi dữ liệu ở `LOCAL`/`DEV` khi bật, chạy lại xác nhận từng luồng → test case DRAFT + bước chuyển mới trên sơ đồ luồng; màn khởi chạy và duyệt kết quả | W+BE+FE | 10 |
| 7.6 | Tóm tắt báo cáo bằng lời thường, kiểm tra mọi con số có trong dữ liệu nguồn | BE+FE | 4 |
| 7.7 | Bộ golden set đánh giá AI (`pnpm ai:eval`) | BE | 2 |
| 7.8 | Import JUnit XML (Jest, Vitest, Pytest, JUnit, Playwright reporter) | BE | 4 |
| 7.9 | CI API: tạo run, chờ/poll, trả kết quả gate, badge SVG; ví dụ GitHub Actions + GitLab CI | BE | 4 |
| 7.10 | Màn AI Assistant | FE | 4 |

### Phase 8. Kiểu Máy chủ nội bộ, bảo mật, visual, lịch, vận hành → v1.0 (S16–S18, ~62 d)

| ID | Việc | Lớp | d |
|---|---|---|---|
| 8.1 | Worker `worker-security` + ZAP daemon: baseline, API scan; active scan chỉ khi duyệt + không production | W | 7 |
| 8.2 | ZAP alert → finding (severity, fingerprint), màn cấu hình scan | BE+FE | 3 |
| 8.3 | Visual regression: baseline, diff, duyệt thay đổi | W+FE | 5 |
| 8.4 | Lịch chạy (cron + timezone) | BE+FE | 3 |
| 8.5 | Thông báo: email, Slack, Teams, Telegram, webhook; luật sự kiện | BE+FE | 4 |
| 8.6 | SSO OIDC, 2FA cho Owner/Admin | BE+FE | 4 |
| 8.7 | Hardening worker: non-root, read-only rootfs, seccomp, cgroup, mạng riêng | Ops | 3 |
| 8.8 | Retention (log, artifact), phân vùng bảng | BE+Ops | 2 |
| 8.9 | Backup/restore + diễn tập restore | Ops | 3 |
| 8.10 | Prometheus metrics, cảnh báo, trang Tình trạng hệ thống | Ops+FE | 3 |
| 8.11 | Chạy ZAP + kiểm tra phân quyền lên chính Hub; sửa lỗi | QA | 4 |
| 8.12 | Tài liệu người dùng (vi), README, runbook | All | 3 |
| 8.13 | **Kiểu Máy chủ**: compose profile server, nginx + TLS nội bộ, test website qua IP LAN, kiểm tra `DEPLOYMENT_MODE=server` | Ops+W | 3 |
| 8.14 | Mời thành viên + quên mật khẩu qua email | BE+FE | 3 |
| 8.15 | Dashboard thành viên (nguyên tắc công bằng spec 1.0 mục 8.4) | BE+FE | 3 |
| 8.16 | Link chia sẻ báo cáo chỉ-đọc có hạn | BE+FE | 2 |
| 8.17 | Xuất/nhập dự án (bản Cá nhân → Máy chủ): test case, plan, môi trường không kèm secret, lịch sử tùy chọn | BE+FE | 5 |

**Mốc M3 – v1.0:** đạt checklist "v1.0" ở [01](01-product-requirements.md) mục 11.

### Phase 9. Sau v1.0 (theo nhu cầu thực tế)

- **Local runner agent**: dev chạy một worker nhỏ trên máy mình, kết nối Hub trung tâm, để Hub test được `localhost` của từng máy.
- AI đề xuất sửa locator khi test UI hỏng.
- Observability agent / Prometheus cho chẩn đoán hiệu năng ([11](11-k6-migration.md) mục 6).
- Production baseline từ access log (kế thừa `createBaseline` của `k6-perf`).
- So sánh hai lần discovery (trang mới/mất).
- Tạo issue Jira/GitHub từ finding.
- Chạy file Playwright `.ts` của dự án trong sandbox chặt.
- Truy vết yêu cầu ↔ test case (độ phủ yêu cầu), giữ đúng giới hạn "không thành Jira".

## 3. Phụ thuộc giữa các phase

```text
P0 ─► P1 ─► P2 ─► P3 ─┬─► P4 (cần API request + engine)
                      ├─► P5 (cần engine) ─► P6 (cần dữ liệu từ nhiều runner)
                      └─► P7 (AI cần test case; JUnit cần run model)
P6 ─► P8 (gate/thông báo dùng điểm và sự kiện)
```

P5 và P6 làm song song được nếu có người thứ 4: P6 bắt đầu với dữ liệu manual/API/perf, thêm audit khi P5 xong.

## 4. Cách làm việc

- **Nhánh:** trunk-based, nhánh ngắn `feat/<id>-<tên>`, PR nhỏ (< 400 dòng), 1 người review.
- **Mỗi PR:** lint, typecheck, unit test, integration test liên quan; migration có cả bước rollback hoặc theo expand/contract.
- **Definition of Done** (giữ spec 1.0 mục 16, thêm):
  - [ ] Endpoint mới có trong test ma trận quyền.
  - [ ] Chuỗi giao diện qua i18n (vi + en).
  - [ ] Thao tác chạm tới hệ thống bên ngoài đi qua SSRF guard.
  - [ ] Không log secret (có test redaction cho runner mới).
- **Demo cuối sprint** với người dùng thật (QA của 1 dự án), không chỉ trong team.
- **Hub tự test chính nó:** từ M1, các test API và E2E của Hub được khai báo trong chính Hub (dogfooding).

## 5. Kiểm thử chính Hub

| Loại | Công cụ | Phạm vi tối thiểu |
|---|---|---|
| Unit | Vitest | `scoring`, `report-normalizers`, `test-dsl`, SSRF guard, redaction, công thức thống kê, chống trùng finding |
| Integration | Supertest + Testcontainers (Postgres, Redis, MinIO) | Mọi service quan trọng, ma trận quyền, orchestrator (worker chết, cancel, nhận trùng) |
| E2E | Playwright | Luồng chính: onboarding → Quick Scan → duyệt case → chạy → báo cáo → xuất PDF |
| Bảo mật | ZAP lên Hub staging, `pnpm audit`, quét secret trong CI | Mỗi release |
| Hiệu năng | k6 qua chính Hub | Dashboard p95 < 2 s với 1 triệu result giả lập |

## 6. Rủi ro triển khai

| Rủi ro | Khả năng | Ảnh hưởng | Giảm thiểu |
|---|---|---|---|
| Ước lượng Phase 5 (browser + discovery) thiếu vì website thật đa dạng | Cao | Trễ M2 | Chọn 3 website mẫu của công ty làm bộ kiểm chứng từ Phase 0; timebox crawler |
| Test UI sinh tự động dễ vỡ | Cao | Người dùng mất niềm tin | Luật sinh mặc định chỉ tạo case **ổn định** (smoke, a11y, link); case tương tác form để ở dạng manual cho tới khi có người duyệt bước tự động |
| SSRF/allowlist làm khó test staging trong LAN | Trung bình | Không dùng được cho dự án nội bộ | `allow_private_network` + CIDR do Admin duyệt (đã thiết kế) |
| Chi phí Gemini vượt dự kiến (phân tích tự động + AI Explorer) | Trung bình | Phải tắt AI | Gom lỗi theo chữ ký, giới hạn phân tích/run và bước/luồng, ngân sách token theo org, model Flash cho tác vụ đơn giản, hỗ trợ model local |
| Nguyên nhân AI sai làm người dùng mất niềm tin | Trung bình | Bỏ qua tính năng | Luật phân loại trước, hiện bằng chứng + độ tin cậy, đo độ đúng qua feedback từ M1 |
| Recorder ghi locator dễ vỡ (class CSS sinh tự động) | Cao | Test ghi lại hỏng khi giao diện đổi | Ưu tiên role/label/text/testId, cảnh báo khi phải dùng CSS, chạy lại xác nhận ngay sau khi ghi |
| AI Explorer đi lạc hoặc gây ghi dữ liệu không mong muốn | Trung bình | Bẩn dữ liệu local/dev | Mặc định chỉ đọc, giới hạn bước/thời gian, cấm hoàn toàn ở production, loại link có chữ "xóa/đăng xuất" |
| Image Playwright/ZAP nặng, server nội bộ yếu | Trung bình | Chạy chậm, hết RAM | Giới hạn job đồng thời theo worker; tách server worker khi cần ([13](13-deployment-operations.md)) |
| Phạm vi phình | Cao | Trễ toàn bộ | Mọi yêu cầu mới vào Phase 9 trừ khi thay thế một mục cùng kích thước |
| Thiếu người QA viết test cho chính Hub | Trung bình | Lỗi lọt | QA bán thời gian từ Phase 2; dogfooding từ M1 |
