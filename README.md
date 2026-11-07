# QA Testing Hub

Nền tảng kiểm thử website nội bộ. Tài liệu thiết kế: [docs/00-README.md](docs/00-README.md).

## Cấu trúc

```text
apps/api      NestJS: REST /api/v1, health, migration Drizzle
apps/web      React + Vite + Tailwind
apps/worker   BullMQ worker, entrypoint: main-core | main-browser | main-k6 | main-security
legacy/k6-perf  tool cũ, giữ đến khi Performance module đạt parity (docs/11)
```

## Chạy khi phát triển

Cần Node 24, pnpm 11, Docker.

```bash
cp .env.example .env          # đổi các giá trị CHANGE_ME
pnpm install
docker compose -f docker-compose.dev.yml up -d   # Postgres, Redis, MinIO, Mailpit
pnpm dev                      # api :3000, web http://127.0.0.1:5173, worker-core
```

- API docs: http://127.0.0.1:3000/api/docs
- Health: `/health/live`, `/health/ready` (DB, Redis, MinIO, migration)

## Chạy cả stack (kiểu Cá nhân)

```bash
docker compose up -d --build  # http://127.0.0.1:8080
```

## Kiểm tra

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

Migration: sửa schema ở `apps/api/src/db/schema`, rồi `pnpm db:generate`. Migration tự chạy khi api khởi động.
