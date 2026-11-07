import { Inject, Injectable } from '@nestjs/common';
import type { OrgRole } from '@qah/validation';
import { and, count, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Actor, UserActor } from '../../common/actor';
import { AppError } from '../../common/app-error';
import { forbidden, notFound, unauthenticated, validationFailed } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import {
  organizationMembers,
  organizations,
  projectMembers,
  projects,
  refreshTokens,
  users,
} from '../../db/schema';
import { randomUUID } from 'node:crypto';
import { DB, type Db } from '../../infra.module';
import { AuditService } from '../audit/audit.service';
import { JWT_KEYS } from './auth.constants';
import {
  ACCESS_TOKEN_TTL_S,
  hashPassword,
  isCommonPassword,
  JwtKeys,
  randomToken,
  sha256,
  verifyPassword,
} from './crypto';
import { lockMinutes } from './lockout';

type ReqInfo = { ip: string | null; userAgent: string | null };

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const BAD_LOGIN = 'Email hoặc mật khẩu không đúng';

export function assertPasswordAllowed(pw: string) {
  if (isCommonPassword(pw)) {
    throw validationFailed('Mật khẩu quá phổ biến', [
      {
        path: 'password',
        message: 'Mật khẩu nằm trong danh sách hay bị đoán, hãy chọn mật khẩu khác',
      },
    ]);
  }
}

export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return base || 'org';
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(JWT_KEYS) private readonly jwt: JwtKeys,
    private readonly audit: AuditService,
  ) {}

  // ---- Phiên đăng nhập ----

  async issueSession(
    tx: Pick<Db, 'insert'>,
    userId: number,
    info: ReqInfo,
    familyId: string = randomUUID(), // mã phiên ngẫu nhiên, không phải ID bản ghi
  ): Promise<IssuedSession> {
    const refreshToken = randomToken(32); // 256-bit
    const refreshExpiresAt = new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    await tx.insert(refreshTokens).values({
      userId,
      familyId,
      tokenHash: sha256(refreshToken),
      expiresAt: refreshExpiresAt,
      ip: info.ip,
      userAgent: info.userAgent,
    });
    return {
      accessToken: await this.jwt.sign(userId, familyId),
      expiresIn: ACCESS_TOKEN_TTL_S,
      refreshToken,
      refreshExpiresAt,
    };
  }

  async needsSetup(): Promise<boolean> {
    const [row] = await this.db.select({ n: count() }).from(users);
    return row!.n === 0;
  }

  /** Lần chạy đầu (D-32): tạo Owner + tổ chức. Chỉ chạy được khi DB chưa có user */
  async setup(
    dto: { email: string; password: string; displayName: string; organizationName: string },
    info: ReqInfo,
  ) {
    assertPasswordAllowed(dto.password);
    const passwordHash = await hashPassword(dto.password);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(727002)`); // 2 request setup cùng lúc
      const [row] = await tx.select({ n: count() }).from(users);
      if (row!.n > 0) throw new AppError('INVALID_STATE', 409, 'Hub đã được cài đặt');
      const [user] = await tx
        .insert(users)
        .values({ email: dto.email, displayName: dto.displayName, passwordHash })
        .returning();
      const [org] = await tx
        .insert(organizations)
        .values({
          name: dto.organizationName,
          slug: slugify(dto.organizationName),
          createdBy: user!.id,
          // Kiểu Cá nhân: Hub chỉ mở ở 127.0.0.1, test localhost của chính máy này là việc chính
          settings: {
            localNetwork: {
              allowedCidrs: [],
              allowLoopback: this.env.DEPLOYMENT_MODE === 'personal',
            },
          },
        })
        .returning();
      await tx
        .insert(organizationMembers)
        .values({ organizationId: org!.id, userId: user!.id, role: 'OWNER' });
      const actor: UserActor = { kind: 'user', userId: user!.id, sid: '', ...info };
      await this.audit.log(
        {
          actor,
          organizationId: org!.id,
          action: 'org.setup',
          entityType: 'organization',
          entityId: org!.id,
        },
        tx,
      );
      return this.issueSession(tx, user!.id, info);
    });
  }

  async login(email: string, password: string, info: ReqInfo): Promise<IssuedSession> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email));
    const ok = await verifyPassword(user?.passwordHash ?? null, password);
    const now = new Date();
    if (!user) throw unauthenticated(BAD_LOGIN);
    const locked = user.lockedUntil && user.lockedUntil > now;
    if (locked || user.status === 'DISABLED') {
      await this.audit.log({
        actor: { kind: 'user', userId: user.id, sid: '', ...info },
        organizationId: null,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        metadata: { reason: locked ? 'locked' : 'disabled' },
      });
      throw unauthenticated(BAD_LOGIN);
    }
    const actor: UserActor = { kind: 'user', userId: user.id, sid: '', ...info };
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      const minutes = lockMinutes(failed);
      await this.db
        .update(users)
        .set({
          failedLoginCount: failed,
          lockedUntil: minutes ? new Date(now.getTime() + minutes * 60_000) : user.lockedUntil,
        })
        .where(eq(users.id, user.id));
      await this.audit.log({
        actor,
        organizationId: null,
        action: minutes ? 'auth.locked' : 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        metadata: minutes ? { minutes } : {},
      });
      throw unauthenticated(BAD_LOGIN);
    }
    return this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now })
        .where(eq(users.id, user.id));
      const session = await this.issueSession(tx, user.id, info);
      await this.audit.log(
        {
          actor,
          organizationId: null,
          action: 'auth.login',
          entityType: 'user',
          entityId: user.id,
        },
        tx,
      );
      return session;
    });
  }

  /** Xoay vòng refresh token; dùng lại token đã thay → thu hồi cả family (docs/09 §3) */
  async refresh(raw: string | undefined, info: ReqInfo): Promise<IssuedSession> {
    if (!raw) throw unauthenticated();
    const [token] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, sha256(raw)));
    if (!token) throw unauthenticated();
    if (token.revokedAt) {
      await this.revokeFamily(token.familyId);
      await this.audit.log({
        actor: { kind: 'user', userId: token.userId, sid: token.familyId, ...info },
        organizationId: null,
        action: 'auth.refresh_reuse',
        entityType: 'user',
        entityId: token.userId,
      });
      throw new AppError(
        'TOKEN_REUSED',
        401,
        'Phiên đăng nhập đã bị thu hồi, vui lòng đăng nhập lại',
      );
    }
    if (token.expiresAt <= new Date()) throw unauthenticated();
    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, token.userId));
    if (!user || user.status === 'DISABLED') throw unauthenticated();
    return this.db.transaction(async (tx) => {
      const revoked = await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.id, token.id), isNull(refreshTokens.revokedAt)))
        .returning({ id: refreshTokens.id });
      if (!revoked.length) throw unauthenticated(); // request refresh song song đã xoay trước
      return this.issueSession(tx, token.userId, info, token.familyId);
    });
  }

  revokeFamily(familyId: string, tx: Pick<Db, 'update'> = this.db) {
    return tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  revokeAllForUser(userId: number, tx: Pick<Db, 'update'> = this.db, exceptFamily?: string) {
    const where = [eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)];
    if (exceptFamily) where.push(ne(refreshTokens.familyId, exceptFamily));
    return tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(...where));
  }

  private asUser(actor: Actor): UserActor {
    if (actor.kind !== 'user') throw forbidden();
    return actor;
  }

  async logout(actor: Actor) {
    const a = this.asUser(actor);
    await this.revokeFamily(a.sid);
  }

  async logoutAll(actor: Actor) {
    const a = this.asUser(actor);
    await this.revokeAllForUser(a.userId);
    await this.audit.log({
      actor,
      organizationId: null,
      action: 'auth.logout_all',
      entityType: 'user',
      entityId: a.userId,
    });
  }

  async changePassword(actor: Actor, currentPassword: string, newPassword: string) {
    const a = this.asUser(actor);
    const [user] = await this.db.select().from(users).where(eq(users.id, a.userId));
    if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
      throw validationFailed('Mật khẩu hiện tại không đúng', [
        { path: 'currentPassword', message: 'Mật khẩu hiện tại không đúng' },
      ]);
    }
    assertPasswordAllowed(newPassword);
    const passwordHash = await hashPassword(newPassword);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, a.userId));
      await this.revokeAllForUser(a.userId, tx, a.sid); // thu hồi các phiên khác
      await this.audit.log(
        {
          actor,
          organizationId: null,
          action: 'auth.password_changed',
          entityType: 'user',
          entityId: a.userId,
        },
        tx,
      );
    });
  }

  async sessions(actor: Actor) {
    const a = this.asUser(actor);
    const rows = await this.db
      .select({
        id: refreshTokens.familyId,
        userAgent: refreshTokens.userAgent,
        ip: refreshTokens.ip,
        lastUsedAt: refreshTokens.createdAt,
      })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.userId, a.userId),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      );
    return { data: rows.map((r) => ({ ...r, current: r.id === a.sid })) };
  }

  async revokeSession(actor: Actor, familyId: string) {
    const a = this.asUser(actor);
    const res = await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.familyId, familyId),
          eq(refreshTokens.userId, a.userId),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .returning({ id: refreshTokens.id });
    if (!res.length) throw notFound('Phiên');
  }

  async me(actor: Actor) {
    const a = this.asUser(actor);
    const [user] = await this.db.select().from(users).where(eq(users.id, a.userId));
    if (!user) throw unauthenticated();
    const orgs = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(eq(organizationMembers.userId, a.userId));
    const memberships = orgs.length
      ? await this.db
          .select({
            projectId: projectMembers.projectId,
            role: projectMembers.role,
            organizationId: projects.organizationId,
          })
          .from(projectMembers)
          .innerJoin(projects, eq(projects.id, projectMembers.projectId))
          .where(
            and(
              eq(projectMembers.userId, a.userId),
              inArray(
                projects.organizationId,
                orgs.map((o) => o.id),
              ),
            ),
          )
      : [];
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        locale: user.locale,
        timezone: user.timezone,
        settings: user.settings,
      },
      organizations: orgs.map((o) => ({
        ...o,
        role: o.role as OrgRole,
        projects: memberships
          .filter((m) => m.organizationId === o.id)
          .map(({ projectId, role }) => ({ projectId, role })),
      })),
    };
  }

  async updateMe(
    actor: Actor,
    dto: { displayName?: string; locale?: 'vi' | 'en'; timezone?: string },
  ) {
    const a = this.asUser(actor);
    if (Object.keys(dto).length) await this.db.update(users).set(dto).where(eq(users.id, a.userId));
    return this.me(actor);
  }
}
