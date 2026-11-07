import { describe, expect, it } from 'vitest';
import { WORKER_QUEUES } from './queues';

describe('WORKER_QUEUES', () => {
  const all = Object.values(WORKER_QUEUES).flat();

  it('mỗi queue thuộc đúng một loại worker', () => {
    expect(new Set(all).size).toBe(all.length);
  });

  it('tên queue hợp lệ với BullMQ (không có dấu :)', () => {
    for (const q of all) expect(q).not.toContain(':');
  });
});
