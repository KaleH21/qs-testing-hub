# QA Testing Hub

Nền tảng kiểm thử website nội bộ. Tài liệu thiết kế: [docs/00-README.md](docs/00-README.md).

## Cấu trúc

```text
apps/api              NestJS: REST /api/v1, auth, RBAC, dự án, môi trường, vault, allowlist, audit
apps/web              React + Vite + Tailwind + shadcn/ui
apps/worker           BullMQ worker, entrypoint: main-core | main-browser | main-k6 | main-security
packages/validation   Enum, schema Zod và ma trận quyền dùng chung cho api và web
legacy/k6-perf        tool cũ, giữ đến khi Performance module đạt parity (docs/11)
```

## Chạy khi phát triển

Cần Node 24, pnpm 11, PostgreSQL 17+ (cài trên máy hoặc qua `docker-compose.dev.yml`).

```bash
pnpm install
pnpm hub:init        # tạo .env, sinh JWT_SECRET + master key vault vào ./secrets (lưu bản sao ./secrets!)
# sửa DATABASE_URL (và TEST_DATABASE_URL nếu chạy test tích hợp) trong .env
pnpm build           # build package dùng chung trước lần chạy đầu
pnpm dev             # api :3000, web http://127.0.0.1:5173
```

Mở http://127.0.0.1:5173 → màn **Cài đặt lần đầu** tạo tài khoản Owner và tổ chức. Migration tự chạy khi api khởi động.

Redis và MinIO chưa bắt buộc ở Phase 1 (`/health/ready` sẽ báo chưa sẵn sàng cho 2 mục này). Có Docker thì chạy `docker compose -f docker-compose.dev.yml up -d`.

- API docs: http://127.0.0.1:3000/api/docs
- Health: `/health/live`, `/health/ready`

## Lệnh quản trị (kiểu Cá nhân)

| Lệnh | Việc |
|---|---|
| `pnpm hub:init` | Tạo `.env`, sinh khóa (chỉ thêm giá trị còn thiếu, không ghi đè) |
| `pnpm hub:create-owner --email you@company.vn` | Tạo Owner bằng dòng lệnh thay cho màn `/setup` |
| `pnpm hub:reset-password --email you@company.vn` | Quên mật khẩu: đặt mật khẩu tạm, mở khóa, thu hồi mọi phiên |
| `pnpm hub:backup` | `pg_dump` ra `./backups` (Windows: đặt `PG_DUMP` trỏ tới `pg_dump.exe` nếu chưa có trong PATH) |

Các lệnh `hub:create-owner`, `hub:reset-password`, `hub:backup` cần `pnpm build` trước.

## Kiểm tra

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

Test tích hợp (`*.int.test.ts`: ma trận quyền, auth, vault, môi trường...) chạy trên database `TEST_DATABASE_URL`. **Database này bị xóa sạch mỗi lần chạy test**, không trỏ vào DB đang dùng. Không có biến này thì test tích hợp bị bỏ qua.

Migration: sửa schema ở `apps/api/src/db/schema`, rồi `pnpm db:generate`.

## Chạy cả stack bằng Docker (kiểu Cá nhân)

```bash
pnpm hub:init
docker compose up -d --build  # http://127.0.0.1:8080
```
