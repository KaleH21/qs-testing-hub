import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { validationFailed } from './errors';

interface RequestInfo {
  ip: string | null;
  userAgent: string | null;
}

export interface UserActor extends RequestInfo {
  kind: 'user';
  userId: number;
  sid: string;
}

export interface ServiceAccountActor extends RequestInfo {
  kind: 'sa';
  serviceAccountId: number;
  organizationId: number;
  scopes: string[];
  projectIds: number[] | null;
}

export type Actor = UserActor | ServiceAccountActor;

export const IS_PUBLIC = 'isPublic';
/** Bỏ qua AuthGuard (login, setup, refresh dùng cookie) */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentActor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Actor => ctx.switchToHttp().getRequest().actor,
);

/** Org đang chọn: header X-Organization-Id (docs/05 §2) */
export const OrgHeader = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): number | undefined => {
    const v = ctx.switchToHttp().getRequest().headers['x-organization-id'];
    if (typeof v !== 'string' || !v) return undefined;
    // id tự tăng (D-38): phải là số nguyên dương, so sánh bằng === với id trong DB
    if (!/^[1-9]\d{0,15}$/.test(v)) {
      throw validationFailed('X-Organization-Id không hợp lệ', [{ path: 'X-Organization-Id' }]);
    }
    return Number(v);
  },
);
