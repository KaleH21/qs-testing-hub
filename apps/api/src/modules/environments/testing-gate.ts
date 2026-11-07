import type { EnvironmentKind } from '@qah/validation';
import { AppError } from '../../common/app-error';

export interface OrgSwitches {
  productionTestingEnabled: boolean;
  localTestingEnabled: boolean;
}

export interface EnvSwitch {
  kind: EnvironmentKind;
  testingEnabled: boolean;
  testingDisabledReason?: string | null;
  testingToggledBy?: number | null;
  testingToggledAt?: Date | null;
}

export interface TestingBlock {
  code: 'PRODUCTION_TESTING_DISABLED' | 'TESTING_DISABLED';
  blockedBy: 'ORGANIZATION' | 'ENVIRONMENT';
  message: string;
  reason?: string | null;
  toggledBy?: number | null;
  toggledAt?: Date | null;
}

/**
 * Công tắc test (D-24, docs/06 §3.0). Được chạy ⇔ công tắc tổ chức cho kind này VÀ công tắc
 * môi trường đều bật. API (tạo run), scheduler và worker (trước khi dispatch) dùng chung hàm này.
 */
export function testingBlock(org: OrgSwitches, env: EnvSwitch): TestingBlock | null {
  if (env.kind === 'PRODUCTION' && !org.productionTestingEnabled) {
    return {
      code: 'PRODUCTION_TESTING_DISABLED',
      blockedBy: 'ORGANIZATION',
      message: 'Test trên Production đang tắt ở cấp tổ chức',
    };
  }
  if (env.kind === 'LOCAL' && !org.localTestingEnabled) {
    return {
      code: 'TESTING_DISABLED',
      blockedBy: 'ORGANIZATION',
      message: 'Test môi trường Local đang tắt ở cấp tổ chức',
    };
  }
  if (!env.testingEnabled) {
    return {
      code: 'TESTING_DISABLED',
      blockedBy: 'ENVIRONMENT',
      message: 'Môi trường đang tắt test',
      reason: env.testingDisabledReason,
      toggledBy: env.testingToggledBy,
      toggledAt: env.testingToggledAt,
    };
  }
  return null;
}

export function assertTestingAllowed(org: OrgSwitches, env: EnvSwitch): void {
  const block = testingBlock(org, env);
  if (block) {
    throw new AppError(block.code, 403, block.message, [
      {
        reason: block.reason ?? null,
        toggledBy: block.toggledBy ?? null,
        toggledAt: block.toggledAt ?? null,
      },
    ]);
  }
}
