import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// `pnpm dev` đọc .env ở gốc repo; container (production) nhận biến từ compose
const DOTENV = path.resolve(__dirname, '../../../../.env');
if (process.env.NODE_ENV !== 'production' && existsSync(DOTENV)) process.loadEnvFile(DOTENV);

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.url(),
    DATABASE_MIGRATOR_URL: z.url().optional(),
    REDIS_URL: z.url(),
    S3_ENDPOINT: z.url(),
    // D-32: kiểu Cá nhân là mặc định
    DEPLOYMENT_MODE: z.enum(['personal', 'server']).default('personal'),
    HUB_BIND_ADDRESS: z.string().default('127.0.0.1'),
    // "secret" hoặc "kid1:secret1,kid2:secret2" (khóa đầu dùng để ký, mọi khóa dùng để kiểm)
    JWT_SECRET: z.string().min(32, 'JWT_SECRET tối thiểu 32 ký tự'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    // Vault (docs/09 §4): SECRETS_KEYS="v1:base64,v2:base64" hoặc 1 khóa master (= v1)
    SECRETS_KEYS: z.string().optional(),
    SECRETS_MASTER_KEY: z.string().optional(),
    SECRETS_MASTER_KEY_FILE: z.string().optional(),
    // Cookie Secure: mặc định bật ở kiểu Máy chủ (HTTPS); kiểu Cá nhân chạy http://127.0.0.1
    COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  })
  .refine((e) => e.SECRETS_KEYS || e.SECRETS_MASTER_KEY || e.SECRETS_MASTER_KEY_FILE, {
    path: ['SECRETS_MASTER_KEY'],
    message:
      'Cần SECRETS_KEYS, SECRETS_MASTER_KEY hoặc SECRETS_MASTER_KEY_FILE (chạy pnpm hub:init)',
  })
  .refine((e) => e.DEPLOYMENT_MODE !== 'personal' || LOOPBACK.has(e.HUB_BIND_ADDRESS), {
    // docs/09 §5: personal mà Hub mở ra ngoài loopback → từ chối khởi động
    path: ['HUB_BIND_ADDRESS'],
    message: 'DEPLOYMENT_MODE=personal yêu cầu HUB_BIND_ADDRESS là loopback (127.0.0.1)',
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Cấu hình môi trường không hợp lệ:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
