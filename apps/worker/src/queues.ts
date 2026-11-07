// Queue theo docs/06 §2. Mỗi queue thuộc đúng một loại worker (docs/03 §2).
export const WORKER_QUEUES = {
  core: [
    'run.orchestrate',
    'results.ingest',
    'runner.api',
    'import',
    'report.export',
    'ai',
    'scheduler',
    'maintenance',
  ],
  browser: ['runner.browser'],
  k6: ['runner.perf'],
  security: ['runner.security'],
} as const;

export type WorkerRole = keyof typeof WORKER_QUEUES;
