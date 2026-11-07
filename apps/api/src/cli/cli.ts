import '../config/env'; // nạp .env khi chạy trên máy dev
import { parseArgs } from 'node:util';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../db/schema';

/** Tiện ích chung cho lệnh CLI: chỉ cần DATABASE_URL */
export async function withDb<T>(
  fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>,
): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Thiếu DATABASE_URL (chạy pnpm hub:init hoặc kiểm tra .env)');
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await fn(drizzle(sql, { schema }));
  } finally {
    await sql.end();
  }
}

export function args<T extends Record<string, { type: 'string' | 'boolean' }>>(options: T) {
  return parseArgs({ options, allowPositionals: false, strict: true }).values;
}

export function run(main: () => Promise<void>) {
  main().catch((err: unknown) => {
    console.error(`Lỗi: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
