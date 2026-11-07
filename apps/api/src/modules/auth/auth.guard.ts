import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Request } from 'express';
import { IS_PUBLIC, type Actor } from '../../common/actor';
import { unauthenticated } from '../../common/errors';
import { refreshTokens, serviceAccounts, users } from '../../db/schema';
import { DB, type Db } from '../../infra.module';
import { JWT_KEYS } from './auth.constants';
import { JwtKeys, parseServiceAccountToken, safeEqualHex } from './crypto';

export function requestInfo(req: Request) {
  return { ip: req.ip ?? null, userAgent: req.headers['user-agent']?.slice(0, 500) ?? null };
}

/**
 * Xác thực mọi request (trừ @Public): JWT access token hoặc token service account.
 * Mỗi request kiểm phiên (sid) còn hiệu lực → logout/đổi mật khẩu có hiệu lực ngay (docs/09 §3).
 * shortcut: đọc DB mỗi request; thêm cache Redis 60 s khi có Redis (Phase 3).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Db,
    @Inject(JWT_KEYS) private readonly jwt: JwtKeys,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) {
      return true;
    }
    const req = ctx.switchToHttp().getRequest<Request & { actor?: Actor }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthenticated();
    const token = header.slice(7).trim();
    req.actor = token.startsWith('qah_')
      ? await this.serviceAccount(token, req)
      : await this.user(token, req);
    return true;
  }

  private async user(token: string, req: Request): Promise<Actor> {
    const claims = await this.jwt.verify(token).catch(() => {
      throw unauthenticated();
    });
    const [session] = await this.db
      .select({ status: users.status })
      .from(refreshTokens)
      .innerJoin(users, eq(users.id, refreshTokens.userId))
      .where(
        and(
          eq(refreshTokens.familyId, claims.sid),
          eq(refreshTokens.userId, claims.sub),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!session || session.status === 'DISABLED') throw unauthenticated();
    return { kind: 'user', userId: claims.sub, sid: claims.sid, ...requestInfo(req) };
  }

  private async serviceAccount(token: string, req: Request): Promise<Actor> {
    const parsed = parseServiceAccountToken(token);
    if (!parsed) throw unauthenticated();
    const [sa] = await this.db
      .select()
      .from(serviceAccounts)
      .where(eq(serviceAccounts.tokenPrefix, parsed.prefix));
    const now = new Date();
    if (
      !sa ||
      !safeEqualHex(sa.tokenHash, parsed.secretHash) ||
      sa.revokedAt ||
      (sa.expiresAt && sa.expiresAt <= now)
    ) {
      throw unauthenticated();
    }
    await this.db
      .update(serviceAccounts)
      .set({ lastUsedAt: now })
      .where(eq(serviceAccounts.id, sa.id));
    return {
      kind: 'sa',
      serviceAccountId: sa.id,
      organizationId: sa.organizationId,
      scopes: sa.scopes,
      projectIds: sa.projectIds,
      ...requestInfo(req),
    };
  }
}
