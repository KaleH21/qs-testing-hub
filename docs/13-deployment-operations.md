# 13. Triển khai và vận hành

- Người đọc: DevOps / Tech Lead / developer trực vận hành
- Liên quan: [03-architecture.md](03-architecture.md), [09-security-model.md](09-security-model.md)

---

## 1. Môi trường của chính Hub

| Môi trường | Mục đích | Dữ liệu | Hạ tầng |
|---|---|---|---|
| `dev` | Máy developer | Seed giả (`pnpm db:seed`) | `docker-compose.dev.yml`: chỉ Postgres, Redis, MinIO, Mailpit, egress-proxy; app chạy `pnpm dev` (hot reload). Dùng `DEPLOYMENT_MODE=personal` để test app đang chạy trên chính máy dev |
| `staging` | Kiểm thử trước release, demo, chạy ZAP vào chính Hub | Seed + bản sao ẩn danh (tùy chọn) | Docker Compose trên VM riêng, cấu hình giống prod nhưng nhỏ hơn |
| `prod` | Dùng thật | Thật | **Kiểu Cá nhân (mặc định, từ M1):** Docker Compose trên máy dev (mục 4.1). **Kiểu Máy chủ (Phase 8):** server nội bộ (mục 3) |

Image build **một lần** trong CI, cùng tag chạy ở staging rồi prod (không build lại).

## 2. Các service trong `docker-compose.yml`

| Service | Image | Vai trò | Tài nguyên đề xuất (prod) | Network |
|---|---|---|---|---|
| `web` | `qa-hub/web` (nginx + build React) | Phục vụ SPA, reverse proxy `/api` → `api` | 0.5 CPU, 256 MB | `edge`, `app` |
| `artifacts` | `qa-hub/web` (cấu hình nginx khác) | Origin riêng cho HTML bên thứ ba ([09](09-security-model.md) mục 9) | 0.25 CPU, 128 MB | `edge`, `app` |
| `api` | `qa-hub/api` | NestJS; chạy migration khi khởi động (mục 6) | 2 CPU, 2 GB (×1, có thể ×2) | `app` |
| `worker-core` | `qa-hub/worker` (`main-core.js`) | Orchestrator, API runner, import, export, AI, scheduler, ingest kết quả | 1 CPU, 1 GB | `app`, `egress-int` |
| `worker-browser` | `qa-hub/worker-browser` (base Playwright) | Playwright, discovery, Lighthouse, axe, visual, PDF | 2 CPU, 4 GB, `shm_size: 1gb`, concurrency 2 (×N) | `egress-int`, `app-results` |
| `worker-k6` | `qa-hub/worker-k6` (Node + k6 binary) | Hiệu năng | 2 CPU, 2 GB, concurrency 1 | `egress-int`, `app-results` |
| `worker-security` | `qa-hub/worker-security` | Điều khiển ZAP | 0.5 CPU, 512 MB | `egress-int`, `app-results` |
| `zap` | `zaproxy/zap-stable` (daemon, ghim tag) | ZAP API, upstream qua `egress-proxy` | 2 CPU, 3 GB | `egress-int` |
| `egress-proxy` | `qa-hub/egress-proxy` | Đường ra duy nhất, allowlist + chặn SSRF | 0.5 CPU, 256 MB | `egress-int`, `egress-ext` |
| `postgres` | `postgres:17` | DB | 2 CPU, 4 GB, volume SSD | `app` |
| `redis` | `redis:7` (AOF `everysec`) | Queue, pub/sub, cache | 0.5 CPU, 1 GB | `app`, `app-results` |
| `minio` | `minio/minio` (ghim tag) | Artifact | 1 CPU, 1 GB, volume lớn | `app`, `app-results` |
| `mailpit` | `axllent/mailpit` | **Chỉ dev/staging**: bắt email | — | `app` |
| `backup` | `qa-hub/backup` (cron) | pg_dump + mirror MinIO (mục 8) | 0.5 CPU, 512 MB | `app` |

Network:
- `edge`: duy nhất mở cổng 443 ra ngoài (qua reverse proxy công ty hoặc nginx của `web` có TLS).
- `app`: `internal: true`, nội bộ giữa api, worker-core, postgres, redis, minio.
- `egress-int`: `internal: true`, worker ↔ `egress-proxy`, `zap`.
- `egress-ext`: chỉ `egress-proxy` có, ra Internet/LAN.
- `app-results`: worker-browser/k6/security chỉ chạm Redis và MinIO (không có Postgres), theo [09](09-security-model.md) mục 8.

Mọi worker: `read_only: true`, `tmpfs: /work`, `user: 10001`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `pids_limit: 512`, `restart: unless-stopped`, `stop_grace_period: 60s` (để job đang chạy kịp dừng êm và trả lease).

## 3. Cấu hình server đề xuất (nội bộ, 100 user, 20 job đồng thời)

| Mức | Cấu hình | Ghi chú |
|---|---|---|
| Tối thiểu (thử nghiệm, ≤ 5 job đồng thời) | 8 vCPU, 32 GB RAM, 500 GB SSD | 1 worker-browser, 1 worker-k6 |
| Đề xuất | 16 vCPU, 64 GB RAM, 1 TB SSD (DB + artifact tách disk) | 3–4 worker-browser |
| Mở rộng | Server 1: web, api, postgres, redis, minio. Server 2+: worker-browser, worker-k6, zap (nối Redis/MinIO qua mạng riêng) | Worker browser là phần tốn tài nguyên nhất; scale bằng `docker compose up --scale worker-browser=N` |

Lưu ý k6: máy chạy k6 cũng là nút thắt; giới hạn cứng 2.000 req/s ([09](09-security-model.md) mục 7) vừa với 2 CPU. Không chạy k6 cùng lúc với nhiều job browser trên máy tối thiểu.

## 4. Biến môi trường (`.env.example`)

```dotenv
# ---- Chung ----
NODE_ENV=production
APP_PUBLIC_URL=https://qa-hub.company.vn
ARTIFACT_PUBLIC_ORIGIN=https://artifacts.qa-hub.company.vn
DEFAULT_TIMEZONE=Asia/Ho_Chi_Minh
DEFAULT_LOCALE=vi
LOG_LEVEL=info

# ---- Database / Redis / MinIO ----
DATABASE_URL=postgres://qahub_app:CHANGE_ME@postgres:5432/qahub
DATABASE_MIGRATOR_URL=postgres://qahub_owner:CHANGE_ME@postgres:5432/qahub   # chỉ dùng khi chạy migration
REDIS_URL=redis://:CHANGE_ME@redis:6379/0
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=qahub-artifacts
S3_ACCESS_KEY=CHANGE_ME
S3_SECRET_KEY=CHANGE_ME

# ---- Auth ----
JWT_SECRET=CHANGE_ME_64_RANDOM_BYTES_BASE64          # có thể nhiều khóa: kid1:...,kid2:...
REFRESH_TOKEN_TTL_DAYS=14
ALLOW_SELF_REGISTER=false
ALLOW_ORG_CREATE=false                               # bản nội bộ: chỉ 1 organization
OIDC_GOOGLE_CLIENT_ID=
OIDC_GOOGLE_CLIENT_SECRET=
OIDC_MICROSOFT_TENANT_ID=
OIDC_MICROSOFT_CLIENT_ID=
OIDC_MICROSOFT_CLIENT_SECRET=
OIDC_ALLOWED_EMAIL_DOMAINS=company.vn

# ---- Secret vault ----
SECRETS_MASTER_KEY_FILE=/run/secrets/qahub_master_key    # ưu tiên Docker secret
# SECRETS_KEYS=v1:BASE64_32_BYTES,v2:BASE64_32_BYTES    # khi đang xoay vòng khóa
JOB_PAYLOAD_KEY_FILE=/run/secrets/qahub_job_payload_key  # niêm phong secret trong payload queue; chỉ worker-core và worker runner có

# ---- Email ----
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=
MAIL_FROM="QA Testing Hub <qa-hub@company.vn>"

# ---- Worker ----
WORKER_CONCURRENCY_BROWSER=2
WORKER_CONCURRENCY_K6=1
WORKER_CONCURRENCY_RECORDER=1                        # số phiên Recorder đồng thời trên máy (~500 MB RAM mỗi phiên)
WORKER_CONCURRENCY_CORE=8
JOB_LEASE_SECONDS=60
EGRESS_PROXY_URL=http://egress-proxy:3128
ZAP_API_URL=http://zap:8080
ZAP_API_KEY=CHANGE_ME
DEPLOYMENT_MODE=server                               # server | personal (D-23); personal cho phép test localhost của chính máy này
HUB_BIND_ADDRESS=0.0.0.0                             # personal: bắt buộc 127.0.0.1 (Hub không có người ngoài truy cập)

# ---- AI (khóa provider nhập qua UI, lưu trong vault) ----
AI_ENABLED=true
AI_DEFAULT_PROVIDER=gemini                          # chỉ là giá trị seed lần đầu; đổi provider/model trong Settings → AI
AI_REQUEST_TIMEOUT_MS=60000

# ---- Retention ----
RETENTION_LOG_DAYS=30
RETENTION_ARTIFACT_DAYS=90
RETENTION_AUDIT_DAYS=400
```

Không commit `.env`. Secret thật (`JWT_SECRET`, master key, mật khẩu DB) nên để ở Docker secrets hoặc file quyền `600` trên server.

### 4.1. Hai kiểu cài (D-23, D-32): **Cá nhân trước**

M1 và M2 phát hành dạng **Cá nhân**; kiểu **Máy chủ nội bộ** làm ở Phase 8 (M3).

| | **Cá nhân** (`DEPLOYMENT_MODE=personal`): mặc định | **Máy chủ nội bộ** (`DEPLOYMENT_MODE=server`): Phase 8 |
|---|---|---|
| Dùng khi | Một dev test website đang chạy `localhost` trên máy mình | Cả team dùng chung, báo cáo tập trung |
| Máy | Laptop/PC dev, Docker Desktop: tối thiểu **4 vCPU, 16 GB RAM, 30 GB trống**; khuyến nghị 8 vCPU / 32 GB nếu chạy trình duyệt và k6 cùng lúc | Server mục 3 |
| Lệnh | `docker compose --profile personal up -d` | `docker compose up -d` |
| Profile `personal` | Không chạy `zap` (bật bằng `--profile security` khi cần), `worker-browser` concurrency 1 + **1 phiên Recorder**, `worker-k6` concurrency 1, không `backup`, không `mailpit` | Đủ service mục 2 |
| Truy cập Hub | `http://127.0.0.1:8080` (`HUB_BIND_ADDRESS=127.0.0.1`), chỉ máy này | `https://qa-hub.<công ty>` trong LAN |
| Website được test | `http://localhost:<port>`: worker tự đổi thành `host.docker.internal:<port>` (Linux cần `extra_hosts: host.docker.internal:host-gateway`, đã có trong compose) | IP/hostname LAN của máy dev hoặc server staging, vd. `http://192.168.1.50:3000`; app phải listen `0.0.0.0`, mở firewall cổng đó cho IP server Hub |
| Tài khoản | Owner tạo ở màn **lần chạy đầu** (`/setup`) hoặc `pnpm hub:create-owner`; quên mật khẩu: `pnpm hub:reset-password --email …` (không cần email/SMTP) | Đầy đủ: mời qua email, SSO, 2FA |
| Chia sẻ báo cáo | Xuất file PDF/HTML | Thêm link chia sẻ có hạn |
| Dữ liệu | Volume Docker cục bộ; sao lưu bằng `pnpm hub:backup` (pg_dump + thư mục MinIO ra 1 file) | Backup theo mục 8 |

**Chuyển từ Cá nhân lên Máy chủ (Phase 8):** `pnpm hub:export-project --key QSNET` xuất 1 file (môi trường không kèm secret, test case, plan, flow map, tùy chọn lịch sử run + artifact) → `pnpm hub:import-project` trên server; secret nhập lại bằng tay. Schema giống nhau ở hai kiểu nên không cần chuyển đổi.

Khi website lên internet: thêm môi trường `STAGING`/`PRODUCTION` với domain thật và xác minh domain; bộ test case giữ nguyên.

### 4.2. Recorder (trình duyệt từ xa trong Hub, D-27)

- Chạy trong `worker-browser`, không có thành phần nào phải cài trên máy người dùng.
- Mỗi phiên ghi là 1 Chromium, khoảng **500 MB RAM**, tính vào concurrency của `worker-browser` (kiểu Cá nhân: 1 phiên ghi + 1 job trình duyệt cùng lúc).
- Hình ảnh và thao tác đi qua WebSocket `GET /api/v1/recorder/sessions/:id/ws`, nên nginx của `web` cần chuyển tiếp WebSocket:
  ```nginx
  location /api/v1/recorder/ {
    proxy_pass http://api:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 1900s;   # phiên tối đa 30 phút
  }
  ```
- Phiên không thao tác 10 phút hoặc quá 30 phút bị đóng; tác vụ `maintenance` dọn Chromium mồ côi khi worker khởi động lại.

## 5. Cài đặt lần đầu

### 5.1. Kiểu Cá nhân (mặc định)

```bash
git clone <repo> qa-testing-hub && cd qa-testing-hub
pnpm hub:init                                     # tạo .env (DEPLOYMENT_MODE=personal, HUB_BIND_ADDRESS=127.0.0.1) và sinh khóa vào ./secrets
docker compose --profile personal up -d           # migration + seed hệ thống chạy tự động khi api khởi động
```

Mở `http://127.0.0.1:8080` → màn **lần chạy đầu** tạo tài khoản Owner (hoặc `pnpm hub:create-owner --email you@company.vn`) → Settings → AI nhập Gemini API key → tạo dự án với môi trường `LOCAL` (vd. `http://localhost:3000`).

**Lưu bản sao thư mục `./secrets`** ra nơi an toàn. Mất master key = mất mọi secret trong vault.

### 5.2. Kiểu Máy chủ nội bộ (Phase 8)

```bash
git clone <repo> qa-testing-hub && cd qa-testing-hub
cp .env.example .env                              # DEPLOYMENT_MODE=server, điền giá trị, sinh khóa:
openssl rand -base64 64                           # JWT_SECRET
openssl rand -base64 32 > secrets/qahub_master_key && chmod 600 secrets/qahub_master_key
docker compose pull                               # image đã build trong CI (tag cố định)
docker compose up -d postgres redis minio
docker compose run --rm api node dist/db/migrate.js     # tạo schema
docker compose run --rm api node dist/db/seed-system.js # profile k6 hệ thống, policy mặc định, bucket MinIO
docker compose up -d
docker compose run --rm api node dist/cli/create-owner.js --email admin@company.vn
```

Sau đó: đăng nhập → tạo organization → thêm target host đầu tiên → bật lịch backup (mục 8) → kiểm `/admin/system-health` xanh.

**Lưu master key ra nơi an toàn ngoài server** (password manager của công ty). Mất key = mất mọi secret trong vault.

## 6. Migration

- Drizzle: `drizzle-kit generate` sinh file SQL, commit cùng PR, review như code. Không dùng `push` ngoài dev.
- Chạy tự động khi `api` khởi động bằng `DATABASE_MIGRATOR_URL` (khóa advisory lock để 2 instance không chạy cùng lúc); `api` không nhận request cho tới khi migration xong (`/health/ready` = false).
- Nguyên tắc **expand → migrate → contract**: thêm cột/bảng mới (nullable hoặc có default) ở release N, ghi cả hai nơi và backfill ở N, xóa cột cũ ở N+1. Không đổi tên cột trong một bước. Như vậy rollback image về N-1 vẫn chạy với schema N.
- Migration dài (backfill, tạo index lớn) chạy riêng bằng script, dùng `CREATE INDEX CONCURRENTLY`.
- Mỗi migration có test: chạy trên DB rỗng và trên bản dump staging trong CI.

## 7. CI/CD cho Hub

```text
PR:     install (pnpm, cache) → lint (eslint, prettier) → typecheck
        → unit (vitest, gồm packages/scoring, report-normalizers, test-dsl, net-guard)
        → integration (Testcontainers: Postgres, Redis, MinIO; permission matrix test)
        → e2e (Playwright vào stack docker compose dựng trong CI, luồng chính)
        → pnpm audit --prod, gitleaks, semgrep
main:   tất cả bước trên → build image (web, api, worker, worker-browser, worker-k6,
        worker-security, egress-proxy, backup), tag = git sha
        → Trivy scan (HIGH/CRITICAL fail) → push registry nội bộ
        → deploy staging (tự động) → smoke test + Quick Scan của Hub vào chính nó
tag v*: deploy prod (bấm duyệt thủ công) → smoke test → thông báo
```

Deploy = `docker compose pull && docker compose up -d` với tag mới; worker dừng êm (`stop_grace_period`), job đang chạy trả lease và được worker mới nhận lại.

## 8. Backup và restore

| Dữ liệu | Cách | Tần suất | Giữ |
|---|---|---|---|
| PostgreSQL | `pg_dump -Fc` (nén) → MinIO bucket backup **và** một nơi ngoài server (NAS/S3 công ty) | Hằng đêm 01:00 | 7 bản ngày, 4 bản tuần, 6 bản tháng |
| PostgreSQL (tùy chọn) | WAL archiving (`pgBackRest`/`wal-g`) cho point-in-time recovery | Liên tục | 7 ngày |
| MinIO artifact | `mc mirror` sang nơi lưu ngoài server | Hằng đêm | Theo retention artifact |
| Cấu hình | `.env`, master key, `docker-compose.yml` → kho bí mật của công ty | Khi đổi | Mọi phiên bản |
| Redis | Không backup (chỉ queue/cache; job dở dang được tái tạo từ `run_jobs` trong DB) | — | — |

Backup được mã hóa (`age`/`gpg`) trước khi đưa ra ngoài server. Job backup ghi kết quả vào metrics; thất bại → cảnh báo.

**Diễn tập restore hằng quý** (checklist, ghi biên bản):
- [ ] Dựng stack sạch trên VM khác với cùng tag image.
- [ ] Restore bản dump mới nhất (`pg_restore`), mirror artifact về MinIO.
- [ ] Đặt đúng master key; mở một secret bằng job thử → giải mã được.
- [ ] Đăng nhập, mở dashboard công ty, mở một run cũ có artifact (screenshot, k6 dashboard).
- [ ] Chạy một Quick Scan vào target thử nghiệm.
- [ ] Ghi thời gian thực tế (so với RTO) và lượng dữ liệu mất (so với RPO).

## 9. Giám sát và cảnh báo

| Nguồn | Nội dung |
|---|---|
| `GET /health/live`, `/health/ready` | api; `ready` kiểm DB, Redis, MinIO, migration xong |
| Heartbeat worker | Mỗi worker ghi `worker:<id>` vào Redis (TTL 45 s), kèm loại, phiên bản, số job đang chạy |
| Prometheus `/metrics` | `qah_jobs_total{runner,status}`, `qah_job_duration_seconds{runner}`, `qah_queue_depth{queue}`, `qah_queue_wait_seconds{queue}`, `qah_egress_blocked_total`, `qah_http_request_duration_seconds{route}`, `qah_backup_last_success_timestamp` |
| Log | JSON pino ra stdout → Docker log driver (`local`, xoay vòng 100 MB × 5) hoặc Loki nếu công ty có |

| Cảnh báo | Điều kiện | Mức |
|---|---|---|
| API down | `/health/ready` lỗi > 2 phút | Nghiêm trọng |
| Không còn worker của một loại | Không có heartbeat loại X > 2 phút | Nghiêm trọng |
| Queue tồn đọng | `qah_queue_depth` > 50 hoặc `qah_queue_wait_seconds` p95 > 10 phút trong 15 phút | Cảnh báo |
| Job lỗi nhiều | Tỉ lệ `ERROR` (không phải `FAILED`) > 20% trong 1 giờ cho một runner | Cảnh báo |
| Disk | > 80% (cảnh báo), > 90% (nghiêm trọng) cho volume Postgres/MinIO | Cảnh báo / Nghiêm trọng |
| Backup | `qah_backup_last_success_timestamp` cũ hơn 26 giờ | Nghiêm trọng |
| Target hết xác minh | Có `target_hosts` sắp hết hạn trong 7 ngày | Thông tin (email Admin) |

Kênh cảnh báo dùng chính `notification_channels` (Slack/Teams/Telegram/email) và một kênh dự phòng ngoài Hub (email SMTP trực tiếp từ Alertmanager), vì Hub sập thì không tự báo được.

## 10. Retention log và dữ liệu

Theo [09](09-security-model.md) mục 12. Job `maintenance.cleanup` (worker-core, 02:00 hằng đêm): xóa object hết `retain_until`, drop partition `execution_logs` > 30 ngày, `audit_logs` > `RETENTION_AUDIT_DAYS`, xóa `refresh_tokens` hết hạn, `VACUUM (ANALYZE)` các bảng lớn hằng tuần.

## 11. Nâng cấp

1. Đọc release notes + migration notes (bắt buộc có trong mỗi release).
2. Backup thủ công ngay trước (`docker compose run --rm backup now`).
3. Deploy lên staging, chạy smoke + Quick Scan.
4. Prod: chọn giờ ít job; tạm dừng scheduler (`/admin` → Pause schedules) nếu có migration lớn.
5. `docker compose pull && docker compose up -d`; theo dõi `/health/ready`, queue, log 15 phút.
6. Rollback: `up -d` với tag cũ (an toàn nhờ expand/contract). Chỉ restore DB khi migration hỏng dữ liệu.

Nâng phiên bản công cụ (Playwright, k6, ZAP, Lighthouse) là release riêng, vì có thể làm số liệu lệch: ghi `runner_version` vào mỗi attempt và ghi chú trên dashboard "đổi phiên bản công cụ" tại thời điểm đó.

## 12. Runbook sự cố

| Sự cố | Dấu hiệu | Xử lý |
|---|---|---|
| **Job kẹt `RUNNING`** | Run không tiến triển, `lease_until` quá hạn | Tác vụ quét lease tự đưa về `QUEUED` sau ≤ 1 phút. Nếu không: kiểm heartbeat worker; `POST /admin/run-jobs/:id/requeue`; xem log theo `runJobId` |
| **Queue tồn đọng** | Cảnh báo queue depth | Xem queue nào (`/admin/queues`). Browser/k6 → scale thêm worker; nếu một project spam run → giảm quota project; kiểm job lặp lỗi bị retry liên tục |
| **k6 không dừng** | Job k6 quá thời lượng profile | Worker gọi k6 REST API dừng êm (như `k6-perf`), sau 30 s gửi SIGTERM rồi SIGKILL cả process group; vẫn kẹt → `docker compose restart worker-k6` (job được lease lại hoặc `ERROR WORKER_LOST`). Kiểm có cần dừng khẩn cấp target (`/admin/targets/:id/stop-all`) |
| **Target bị quá tải bởi Hub** | Đội dự án báo website chậm khi test | `stop-all` host đó ngay; xem audit `run.create`/`approval.approve` để biết cấu hình; hạ `max_perf_rps` trong policy |
| **Disk đầy** | Cảnh báo disk | MinIO: chạy cleanup sớm, giảm `RETENTION_ARTIFACT_DAYS`, tắt video cho môi trường ít quan trọng. Postgres: kiểm partition log chưa drop, `pg_stat_user_tables` tìm bảng phình, `VACUUM`. Docker: `docker system prune` image cũ |
| **Worker browser crash liên tục** | `ERROR` tăng, OOM trong `docker events` | Tăng `mem_limit`/`shm_size`, giảm `WORKER_CONCURRENCY_BROWSER`; trang mục tiêu quá nặng → giảm `maxPages` |
| **Egress chặn nhầm** | Run lỗi `TARGET_NOT_ALLOWED`/connection refused dù host đã duyệt | Xem log `egress-proxy` (host, ip bị chặn); thường do host phân giải ra IP nội bộ mà target chưa bật `allow_private_network` + CIDR |
| **Xoay vòng master key** | Định kỳ 1 năm hoặc nghi lộ | (1) Sinh khóa mới, đặt `SECRETS_KEYS=v1:<cũ>,v2:<mới>`, restart api + worker. (2) `docker compose run --rm api node dist/cli/rotate-secrets.js --to v2` (mã hóa lại từng bản ghi, idempotent). (3) Kiểm không còn bản ghi `key_version=1`. (4) Bỏ v1 khỏi cấu hình, restart. Nghi lộ → đồng thời đổi mọi secret gốc (mật khẩu tài khoản test, API key AI) |
| **Lộ token service account** | Token xuất hiện trong log CI công khai | `POST /service-accounts/:id/rotate`, xem `audit_logs` theo `actor_service_account_id` từ thời điểm lộ |

## 13. Mục tiêu khôi phục

| Chỉ tiêu | Mục tiêu (giai đoạn nội bộ) |
|---|---|
| RPO (dữ liệu mất tối đa) | 24 giờ (backup hằng đêm); bật WAL archiving để xuống ~15 phút nếu cần |
| RTO (thời gian khôi phục) | 4 giờ, kiểm chứng ở diễn tập quý |
| Availability | 99,5% (theo spec 1.0 mục 14) |
