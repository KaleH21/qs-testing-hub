import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// swc để giữ decorator metadata cho DI của Nest trong test.
// Test tích hợp (*.int.test.ts) dùng chung DB TEST_DATABASE_URL → chạy tuần tự.
export default defineConfig({
  plugins: [swc.vite()],
  test: { include: ['src/**/*.test.ts'], fileParallelism: false, testTimeout: 30_000 },
});
