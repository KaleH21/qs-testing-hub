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
