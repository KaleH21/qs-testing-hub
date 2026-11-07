import { Inject, Injectable } from '@nestjs/common';
import type { OrgRole } from '@qah/validation';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { Actor } from '../../common/actor';
import { forbidden, invalidState, notFound } from '../../common/errors';
import {
  organizationMembers,
  organizations,
  projectMembers,
  projects,
  users,
} from '../../db/schema';
import { DB, type Db } from '../../infra.module';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { hashPassword, temporaryPassword } from '../auth/crypto';
import { parseLocalNetwork, type LocalNetwork } from '../targets/net';

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  private view(o: typeof organizations.$inferSelect) {
    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      defaultTimezone: o.defaultTimezone,
      productionTestingEnabled: o.productionTestingEnabled,
      localTestingEnabled: o.localTestingEnabled,
      testingSwitchesChangedBy: o.testingSwitchesChangedBy,
      testingSwitchesChangedAt: o.testingSwitchesChangedAt,
      localNetwork: parseLocalNetwork(o.settings),
      createdAt: o.createdAt,
    };
  }

  async list(actor: Actor) {
    if (actor.kind !== 'user') throw forbidden();
    const rows = await this.db
      .select({ org: organizations, role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(eq(organizationMembers.userId, actor.userId));
    return { data: rows.map((r) => ({ ...this.view(r.org), role: r.role })) };
  }

  private async load(orgId: string) {
    const [org] = await this.db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org) throw notFound('Tổ chức');
    return org;
  }

  async get(actor: Actor, orgId: string) {
    await this.access.org(actor, 'org.read', orgId);
    return this.view(await this.load(orgId));
  }

  async update(actor: Actor, orgId: string, dto: { name?: string; defaultTimezone?: string }) {
    await this.access.org(actor, 'org.update', orgId);
    const before = await this.load(orgId);
    const [org] = await this.db
      .update(organizations)
      .set(dto)
      .where(eq(organizations.id, orgId))
      .returning();
    await this.audit.log({
      actor,
      organizationId: orgId,
      action: 'org.update',
      entityType: 'organization',
      entityId: orgId,
      metadata: {
        before: { name: before.name, defaultTimezone: before.defaultTimezone },
        after: dto,
      },
    });
    return this.view(org!);
  }

  /**
   * Công tắc test cấp tổ chức (D-24). Phase 1 chưa có run nên không có run nào để dừng;
   * khi có run (Phase 2–3), tắt lúc đang chạy sẽ trả 409 INVALID_STATE kèm danh sách run.
   */
  async setTestingSwitches(
    actor: Actor,
    orgId: string,
    dto: { productionTesting?: boolean; localTesting?: boolean; reason: string },
  ) {
    await this.access.org(actor, 'org.testingSwitches', orgId);
    const before = await this.load(orgId);
    const [org] = await this.db
      .update(organizations)
      .set({
        productionTestingEnabled: dto.productionTesting ?? before.productionTestingEnabled,
        localTestingEnabled: dto.localTesting ?? before.localTestingEnabled,
        testingSwitchesChangedBy: actor.kind === 'user' ? actor.userId : null,
        testingSwitchesChangedAt: new Date(),
      })
      .where(eq(organizations.id, orgId))
      .returning();
    await this.audit.log({
      actor,
      organizationId: orgId,
      action: 'testing.switch',
      entityType: 'organization',
      entityId: orgId,
      metadata: {
        before: {
          productionTesting: before.productionTestingEnabled,
          localTesting: before.localTestingEnabled,
        },
        after: {
          productionTesting: org!.productionTestingEnabled,
          localTesting: org!.localTestingEnabled,
        },
        reason: dto.reason,
      },
    });
    return this.view(org!);
  }

  async setLocalNetwork(actor: Actor, orgId: string, dto: LocalNetwork) {
    await this.access.org(actor, 'org.localNetwork', orgId);
    const before = await this.load(orgId);
    const localNetwork = parseLocalNetwork({ localNetwork: dto }); // chuẩn hóa + từ chối dải metadata
    const [org] = await this.db
      .update(organizations)
      .set({ settings: { ...(before.settings as object), localNetwork } })
      .where(eq(organizations.id, orgId))
      .returning();
    await this.audit.log({
      actor,
      organizationId: orgId,
      action: 'org.local_network_update',
      entityType: 'organization',
      entityId: orgId,
      metadata: { before: parseLocalNetwork(before.settings), after: localNetwork },
    });
    return this.view(org!);
  }

  // ---- Thành viên ----

  async members(actor: Actor, orgId: string) {
    await this.access.org(actor, 'org.read', orgId);
    const data = await this.db
      .select({
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        status: users.status,
        role: organizationMembers.role,
        joinedAt: organizationMembers.joinedAt,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, orgId));
    return { data };
  }

  /** Chỉ Owner gán/đụng tới role OWNER */
  private assertCanTouchRole(actorRole: OrgRole, ...roles: OrgRole[]) {
    if (actorRole !== 'OWNER' && roles.includes('OWNER')) {
      throw forbidden('Chỉ Owner được gán hoặc thay đổi role Owner');
    }
  }

  /** Thêm trực tiếp (lời mời qua email ở Phase 8). User mới nhận mật khẩu tạm, chỉ trả 1 lần */
  async addMember(
    actor: Actor,
    orgId: string,
    dto: { email: string; displayName: string; role: OrgRole },
  ) {
    const { role: actorRole } = await this.access.org(actor, 'org.members.manage', orgId);
    this.assertCanTouchRole(actorRole, dto.role);
    let temporary: string | undefined;
    const result = await this.db.transaction(async (tx) => {
      let [user] = await tx.select().from(users).where(eq(users.email, dto.email));
      if (!user) {
        temporary = temporaryPassword();
        [user] = await tx
          .insert(users)
          .values({
            email: dto.email,
            displayName: dto.displayName,
            passwordHash: await hashPassword(temporary),
          })
          .returning();
      }
      const inserted = await tx
        .insert(organizationMembers)
        .values({ organizationId: orgId, userId: user!.id, role: dto.role })
        .onConflictDoNothing()
        .returning();
      if (!inserted.length) throw invalidState('Người dùng đã là thành viên tổ chức');
      await this.audit.log(
        {
          actor,
          organizationId: orgId,
          action: 'member.add',
          entityType: 'user',
          entityId: user!.id,
          metadata: { email: dto.email, role: dto.role, newAccount: !!temporary },
        },
        tx,
      );
      return {
        userId: user!.id,
        email: user!.email,
        displayName: user!.displayName,
        role: dto.role,
      };
    });
    return { ...result, temporaryPassword: temporary ?? null };
  }

  private async membership(orgId: string, userId: string) {
    const [m] = await this.db
      .select()
      .from(organizationMembers)
      .where(
        and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId)),
      );
    if (!m) throw notFound('Thành viên');
    return m;
  }

  private async assertNotLastOwner(orgId: string, member: { role: OrgRole }) {
    if (member.role !== 'OWNER') return;
    const [row] = await this.db
      .select({ n: count() })
      .from(organizationMembers)
      .where(
        and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.role, 'OWNER')),
      );
    if (row!.n <= 1) throw invalidState('Không thể xóa hoặc hạ quyền Owner cuối cùng');
  }

  async updateMember(actor: Actor, orgId: string, userId: string, role: OrgRole) {
    const { role: actorRole } = await this.access.org(actor, 'org.members.manage', orgId);
    const m = await this.membership(orgId, userId);
    this.assertCanTouchRole(actorRole, m.role, role);
    if (m.role === 'OWNER' && role !== 'OWNER') await this.assertNotLastOwner(orgId, m);
    await this.db.update(organizationMembers).set({ role }).where(eq(organizationMembers.id, m.id));
    await this.audit.log({
      actor,
      organizationId: orgId,
      action: 'member.role_change',
      entityType: 'user',
      entityId: userId,
      metadata: { before: m.role, after: role },
    });
    return { userId, role };
  }

  /** Xóa khỏi tổ chức: bỏ khỏi mọi project của tổ chức + thu hồi phiên (docs/09 §3) */
  async removeMember(actor: Actor, orgId: string, userId: string) {
    const { role: actorRole } = await this.access.org(actor, 'org.members.manage', orgId);
    const m = await this.membership(orgId, userId);
    this.assertCanTouchRole(actorRole, m.role);
    await this.assertNotLastOwner(orgId, m);
    await this.db.transaction(async (tx) => {
      const orgProjects = tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.organizationId, orgId));
      await tx
        .delete(projectMembers)
        .where(
          and(eq(projectMembers.userId, userId), inArray(projectMembers.projectId, orgProjects)),
        );
      await tx.delete(organizationMembers).where(eq(organizationMembers.id, m.id));
      await this.auth.revokeAllForUser(userId, tx);
      await this.audit.log(
        {
          actor,
          organizationId: orgId,
          action: 'member.remove',
          entityType: 'user',
          entityId: userId,
          metadata: { role: m.role },
        },
        tx,
      );
    });
  }
}
