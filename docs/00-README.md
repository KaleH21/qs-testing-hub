# QA Testing Hub: bộ tài liệu

Bộ tài liệu thiết kế cho **QA Testing Hub (bản Web)**: nền tảng kiểm thử website dùng nội bộ, phát triển từ tool `k6-perf` và spec `QA-Testing-Hub-Product-Specification.md` v1.0.

Bản tóm tắt cho người ra quyết định: [plan_07112026_qa-testing-hub-platform.md](plan_07112026_qa-testing-hub-platform.md).

| # | Tài liệu | Nội dung | Ai cần đọc |
|---|---|---|---|
| 01 | [Product requirements](01-product-requirements.md) | Mục tiêu, phạm vi, persona, danh sách tính năng (E1–E14), user story, phân quyền, nghiệm thu | Tất cả |
| 02 | [Test catalog](02-test-catalog.md) | Từng loại test cho website: kiểm tra gì, giải thích lời thường, công cụ, giới hạn an toàn, Quick Scan | QA, PO |
| 03 | [Architecture](03-architecture.md) | Quyết định kiến trúc, sơ đồ, công nghệ, cấu trúc repo, module, luồng chạy | Dev |
| 04 | [Database schema](04-database-schema.md) | Toàn bộ bảng, enum, index, thay đổi so với spec 1.0 | Dev backend |
| 05 | [API specification](05-api-specification.md) | REST API `/api/v1`, quy ước, lỗi, phân trang, CI API | Dev |
| 06 | [Execution engine](06-execution-engine.md) | Runner contract, orchestrator, Test DSL, từng runner, Discovery, luật sinh test | Dev worker |
| 07 | [Reporting & scoring](07-reporting-and-scoring.md) | Công thức thống kê, chỉ số sức khỏe, quality gate, báo cáo cho người không chuyên | PO, Dev, QA Lead |
| 08 | [AI assistant](08-ai-assistant.md) | Provider, sinh test, phân tích lỗi, tóm tắt, bảo vệ dữ liệu, đánh giá | Dev, PO |
| 09 | [Security model](09-security-model.md) | Phân quyền, secret, xác minh domain, SSRF, sandbox, audit | Dev, Admin |
| 10 | [UI/UX](10-ui-ux.md) | Sitemap, danh sách màn hình, luồng chính, wireframe, hệ màu trạng thái | Dev frontend, Designer |
| 11 | [k6 migration](11-k6-migration.md) | Chuyển `k6-perf` thành Performance module, tiêu chí parity | Dev |
| 12 | [Implementation plan](12-implementation-plan.md) | 9 phase, việc chi tiết + ước lượng, mốc, rủi ro | Tech Lead, quản lý |
| 13 | [Deployment & operations](13-deployment-operations.md) | Docker Compose, cấu hình server, CI/CD, backup, giám sát, runbook | Ops, Dev |
| 14 | [Decisions & open questions](14-decisions-and-open-questions.md) | Quyết định đã chốt, câu hỏi cần trả lời | PO, Tech Lead |

## Thứ tự đọc

- **Người quản lý / PO:** file plan tổng → 01 → 07 (phần báo cáo) → 12 → 14.
- **Dev mới vào dự án:** 01 → 03 → 04 → 06 → 05 → 09 → tài liệu của phase đang làm.
- **QA:** 01 → 02 → 07 → 10.

## Quy tắc cập nhật

- Tài liệu là nguồn sự thật; code khác tài liệu thì sửa một trong hai trong cùng PR.
- Đổi quyết định trong [14](14-decisions-and-open-questions.md) trước, rồi mới sửa các tài liệu liên quan.
- Tên bảng, enum, route dùng đúng như [04](04-database-schema.md) và [05](05-api-specification.md).
