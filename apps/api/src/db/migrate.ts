import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const MIGRATION_LOCK_KEY = 727001; // advisory lock: 2 instance api không migrate cùng lúc (docs/13 §6)
export const MIGRATIONS_FOLDER = path.join(__dirname, '../../drizzle');

export async function runMigrations(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    try {
      await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    }
  } finally {
    await sql.end();
  }
}
