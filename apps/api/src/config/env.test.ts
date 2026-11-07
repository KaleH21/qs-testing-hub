import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/qahub',
  REDIS_URL: 'redis://localhost:6379/0',
  S3_ENDPOINT: 'http://localhost:9000',
};

describe('loadEnv', () => {
  it('áp giá trị mặc định kiểu Cá nhân', () => {
    const env = loadEnv(base);
    expect(env.DEPLOYMENT_MODE).toBe('personal');
    expect(env.HUB_BIND_ADDRESS).toBe('127.0.0.1');
    expect(env.PORT).toBe(3000);
  });

  it('từ chối personal khi bind ra ngoài loopback', () => {
    expect(() => loadEnv({ ...base, HUB_BIND_ADDRESS: '0.0.0.0' })).toThrow(/HUB_BIND_ADDRESS/);
  });

  it('cho phép server bind 0.0.0.0', () => {
    expect(
      loadEnv({ ...base, DEPLOYMENT_MODE: 'server', HUB_BIND_ADDRESS: '0.0.0.0' }).DEPLOYMENT_MODE,
    ).toBe('server');
  });

  it('báo thiếu biến bắt buộc', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });
});
