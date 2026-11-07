import { describe, expect, it } from 'vitest';
import { can, effectiveProjectRole } from './permissions.js';

describe('effectiveProjectRole', () => {
  it('Owner/Admin thấy mọi project', () => {
    expect(effectiveProjectRole('OWNER', null)).toBe('OWNER');
    expect(effectiveProjectRole('ADMIN', undefined)).toBe('ADMIN');
  });
  it('không phải thành viên project → null (404)', () => {
    expect(effectiveProjectRole('QA_LEAD', null)).toBeNull();
    expect(effectiveProjectRole('VIEWER', null)).toBeNull();
  });
  it('lấy role cao hơn giữa org và project', () => {
    expect(effectiveProjectRole('VIEWER', 'QA_LEAD')).toBe('QA_LEAD');
    expect(effectiveProjectRole('QA_LEAD', 'VIEWER')).toBe('QA_LEAD');
  });
  it('cùng hạng (Tester/Developer) → theo role project', () => {
    expect(effectiveProjectRole('DEVELOPER', 'TESTER')).toBe('TESTER');
  });
});

describe('can', () => {
  it('kiểm theo ma trận', () => {
    expect(can('QA_LEAD', 'project.environments.manage')).toBe(true);
    expect(can('TESTER', 'project.environments.manage')).toBe(false);
    expect(can('ADMIN', 'org.audit.export')).toBe(false);
    expect(can(null, 'project.read')).toBe(false);
  });
});

describe('URL không bắt buộc (form gửi chuỗi rỗng)', () => {
  it('chuỗi rỗng = không nhập; URL sai báo lỗi tiếng Việt', async () => {
    const { createEnvironmentSchema } = await import('./schemas.js');
    const ok = createEnvironmentSchema.parse({
      name: 'Local',
      kind: 'LOCAL',
      webBaseUrl: 'http://localhost:3000',
      apiBaseUrl: '',
    });
    expect(ok.apiBaseUrl).toBeUndefined();
    const bad = createEnvironmentSchema.safeParse({
      name: 'X',
      kind: 'DEV',
      webBaseUrl: 'ftp://x',
    });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toContain('URL không hợp lệ');
  });
});
