import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { z } from 'zod';
import { WORKER_QUEUES, type WorkerRole } from './queues';

const envSchema = z.object({
  REDIS_URL: z.url(),
  LOG_LEVEL: z.string().default('info'),
  WORKER_CONCURRENCY_CORE: z.coerce.number().int().positive().default(8),
  WORKER_CONCURRENCY_BROWSER: z.coerce.number().int().positive().default(2),
  WORKER_CONCURRENCY_K6: z.coerce.number().int().positive().default(1),
  WORKER_CONCURRENCY_SECURITY: z.coerce.number().int().positive().default(1),
});

const HEARTBEAT_MS = 15_000; // docs/13 §9: heartbeat mỗi 15 s, TTL 45 s
const HEARTBEAT_TTL_S = 45;

export type Processor = (job: Job) => Promise<unknown>;

/** Processor theo tên queue; runner thật được đăng ký từ Phase 3 */
const processors: Partial<Record<string, Processor>> = {};

export async function startWorker(role: WorkerRole): Promise<void> {
  const dotenv = path.resolve(__dirname, '../../../.env'); // `pnpm dev`; container nhận biến từ compose
  if (process.env.NODE_ENV !== 'production' && existsSync(dotenv)) process.loadEnvFile(dotenv);
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Cấu hình worker không hợp lệ:', z.prettifyError(parsed.error));
    process.exit(1);
  }
  const env = parsed.data;
  const log = pino({ level: env.LOG_LEVEL, base: { role } });
  const workerId = `${role}-${hostname()}-${process.pid}`;
  const concurrency = {
    core: env.WORKER_CONCURRENCY_CORE,
    browser: env.WORKER_CONCURRENCY_BROWSER,
    k6: env.WORKER_CONCURRENCY_K6,
    security: env.WORKER_CONCURRENCY_SECURITY,
  }[role];

  // BullMQ yêu cầu maxRetriesPerRequest = null cho connection của Worker
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

  let activeJobs = 0;
  const workers = WORKER_QUEUES[role].map((queue) => {
    const w = new Worker(
      queue,
      async (job) => {
        const processor = processors[queue];
        if (!processor) throw new Error(`Chưa có processor cho queue ${queue} (job ${job.name})`);
        activeJobs++;
        try {
          return await processor(job);
        } finally {
          activeJobs--;
        }
      },
      { connection, concurrency },
    );
    w.on('failed', (job, err) => log.error({ queue, jobId: job?.id, err }, 'job failed'));
    w.on('error', (err) => log.error({ queue, err }, 'worker error'));
    return w;
  });

  const heartbeat = async () => {
    const payload = JSON.stringify({ role, activeJobs, at: Date.now() });
    await connection
      .set(`worker:${workerId}`, payload, 'EX', HEARTBEAT_TTL_S)
      .catch((err: unknown) => log.warn({ err }, 'heartbeat failed'));
  };
  await heartbeat();
  const timer = setInterval(heartbeat, HEARTBEAT_MS);

  log.info({ workerId, queues: WORKER_QUEUES[role], concurrency }, 'worker started');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    clearInterval(timer);
    await Promise.all(workers.map((w) => w.close())); // chờ job đang chạy kết thúc
    await connection.del(`worker:${workerId}`).catch(() => {});
    connection.disconnect();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}
