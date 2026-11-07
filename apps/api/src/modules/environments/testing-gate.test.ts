import { ENVIRONMENT_KINDS } from '@qah/validation';
import { describe, expect, it } from 'vitest';
import { assertTestingAllowed, testingBlock } from './testing-gate';

const on = { productionTestingEnabled: true, localTestingEnabled: true };

describe('testingBlock (D-24)', () => {
  it('production mặc định tắt ở cấp tổ chức → PRODUCTION_TESTING_DISABLED', () => {
    const org = { productionTestingEnabled: false, localTestingEnabled: true };
    expect(testingBlock(org, { kind: 'PRODUCTION', testingEnabled: true })?.code).toBe(
      'PRODUCTION_TESTING_DISABLED',
    );
  });

  it('tắt production ở tổ chức không ảnh hưởng môi trường khác', () => {
    const org = { productionTestingEnabled: false, localTestingEnabled: true };
    for (const kind of ['LOCAL', 'DEV', 'STAGING'] as const) {
      expect(testingBlock(org, { kind, testingEnabled: true })).toBeNull();
    }
  });

  it('tắt local ở tổ chức chỉ chặn LOCAL', () => {
    const org = { productionTestingEnabled: true, localTestingEnabled: false };
    expect(testingBlock(org, { kind: 'LOCAL', testingEnabled: true })?.code).toBe(
      'TESTING_DISABLED',
    );
    expect(testingBlock(org, { kind: 'DEV', testingEnabled: true })).toBeNull();
  });

  it('công tắc môi trường tắt → chặn mọi kind, kèm lý do', () => {
    for (const kind of ENVIRONMENT_KINDS) {
      const b = testingBlock(on, {
        kind,
        testingEnabled: false,
        testingDisabledReason: 'bảo trì hệ thống',
      });
      expect(b).toMatchObject({
        code: 'TESTING_DISABLED',
        blockedBy: 'ENVIRONMENT',
        reason: 'bảo trì hệ thống',
      });
    }
  });

  it('bật production cấp tổ chức vẫn phải bật cả cấp môi trường', () => {
    expect(testingBlock(on, { kind: 'PRODUCTION', testingEnabled: false })?.blockedBy).toBe(
      'ENVIRONMENT',
    );
    expect(testingBlock(on, { kind: 'PRODUCTION', testingEnabled: true })).toBeNull();
  });

  it('assertTestingAllowed ném lỗi 403 đúng mã', () => {
    expect(() =>
      assertTestingAllowed(
        { ...on, productionTestingEnabled: false },
        { kind: 'PRODUCTION', testingEnabled: true },
      ),
    ).toThrow(expect.objectContaining({ code: 'PRODUCTION_TESTING_DISABLED' }));
  });
});
