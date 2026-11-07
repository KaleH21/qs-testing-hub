import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Sql } from 'postgres';
import { ENV, type Env } from '../../config/env';
import { MigrationState, REDIS, SQL } from '../../infra.module';

export type CheckResult = { ok: boolean; error?: string };

const TIMEOUT_MS = 2000;

async function check(fn: () => Promise<unknown>): Promise<CheckResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
      }),
    ]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    private readonly migration: MigrationState,
  ) {}

  async readiness(): Promise<{ ready: boolean; checks: Record<string, CheckResult> }> {
    const [db, redis, storage] = await Promise.all([
      check(() => this.sql`select 1`),
      check(async () => {
        if (this.redis.status === 'wait') await this.redis.connect();
        return this.redis.ping();
      }),
      check(async () => {
        const res = await fetch(new URL('/minio/health/live', this.env.S3_ENDPOINT));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }),
    ]);
    const checks = { db, redis, storage, migrations: { ok: this.migration.done } };
    return { ready: Object.values(checks).every((c) => c.ok), checks };
  }
}
