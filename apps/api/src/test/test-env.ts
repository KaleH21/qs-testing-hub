import { resolve } from 'node:path';

// Phải được import TRƯỚC app.module (module đó đọc biến môi trường lúc nạp).
// Lấy TEST_DATABASE_URL từ biến môi trường hoặc .env ở gốc repo; không có thì test tích hợp bị bỏ qua.
if (!process.env.TEST_DATABASE_URL) {
  try {
    process.loadEnvFile(resolve(__dirname, '../../../../.env'));
  } catch {
    // không có .env
  }
}

export const TEST_DB = process.env.TEST_DATABASE_URL;

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: TEST_DB ?? 'postgres://unused@127.0.0.1:1/unused',
  DATABASE_MIGRATOR_URL: TEST_DB ?? 'postgres://unused@127.0.0.1:1/unused',
  REDIS_URL: 'redis://127.0.0.1:6399',
  S3_ENDPOINT: 'http://127.0.0.1:9999',
  DEPLOYMENT_MODE: 'personal',
  HUB_BIND_ADDRESS: '127.0.0.1',
  JWT_SECRET: 'test-jwt-secret-'.padEnd(48, 'x'),
  SECRETS_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
});
delete process.env.SECRETS_MASTER_KEY_FILE;
delete process.env.SECRETS_KEYS;
