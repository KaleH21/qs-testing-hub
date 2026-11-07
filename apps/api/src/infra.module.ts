import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import postgres, { type Sql } from 'postgres';
import { ENV, loadEnv, type Env } from './config/env';
import * as schema from './db/schema';

export const SQL = Symbol('SQL');
export const DB = Symbol('DB');
export const REDIS = Symbol('REDIS');
export type Db = PostgresJsDatabase<typeof schema>;

/** Trạng thái migration lúc khởi động; /health/ready = false cho tới khi xong */
export class MigrationState {
  done = false;
}

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    {
      provide: SQL,
      inject: [ENV],
      useFactory: (env: Env) => postgres(env.DATABASE_URL, { onnotice: () => {} }),
    },
    { provide: DB, inject: [SQL], useFactory: (sql: Sql) => drizzle(sql, { schema }) },
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 }),
    },
    MigrationState,
  ],
  exports: [ENV, SQL, DB, REDIS, MigrationState],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    this.redis.disconnect();
    await this.sql.end({ timeout: 5 });
  }
}
