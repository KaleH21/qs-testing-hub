import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';

interface RequestInfo {
  ip: string | null;
  userAgent: string | null;
}

export interface UserActor extends RequestInfo {
  kind: 'user';
  userId: string;
  sid: string;
}

export interface ServiceAccountActor extends RequestInfo {
  kind: 'sa';
  serviceAccountId: string;
  organizationId: string;
  scopes: string[];
  projectIds: string[] | null;
}

export type Actor = UserActor | ServiceAccountActor;

export const IS_PUBLIC = 'isPublic';
/** Bỏ qua AuthGuard (login, setup, refresh dùng cookie) */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentActor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Actor => ctx.switchToHttp().getRequest().actor,
);

/** Org đang chọn: header X-Organization-Id (docs/05 §2) */
export const OrgHeader = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const v = ctx.switchToHttp().getRequest().headers['x-organization-id'];
  return typeof v === 'string' && v ? v : undefined;
});
