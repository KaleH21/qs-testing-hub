import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { Actor } from '../../common/actor';
import { notFound, validationFailed } from '../../common/errors';
import { projects, serviceAccounts } from '../../db/schema';
import { DB, type Db } from '../../infra.module';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { newServiceAccountToken } from '../auth/crypto';

type SaRow = typeof serviceAccounts.$inferSelect;

const view = (s: SaRow) => ({
  id: s.id,
  name: s.name,
  tokenPrefix: s.tokenPrefix,
  scopes: s.scopes,
  projectIds: s.projectIds,
  lastUsedAt: s.lastUsedAt,
  expiresAt: s.expiresAt,
  revokedAt: s.revokedAt,
  createdAt: s.createdAt,
});

/** Token CI (docs/05 §2): chỉ lưu hash, token bí mật trả đúng 1 lần khi tạo/xoay vòng */
@Injectable()
export class ServiceAccountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  private async assertProjectsInOrg(orgId: number, ids: number[] | null | undefined) {
    if (!ids?.length) return;
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.organizationId, orgId), inArray(projects.id, ids)));
    if (rows.length !== new Set(ids).size) {
      throw validationFailed('Dự án không thuộc tổ chức', [{ path: 'projectIds' }]);
    }
  }

  private async load(orgId: number, id: number) {
    const [s] = await this.db
      .select()
      .from(serviceAccounts)
      .where(and(eq(serviceAccounts.id, id), eq(serviceAccounts.organizationId, orgId)));
    if (!s) throw notFound('Service account');
    return s;
  }

  async list(actor: Actor, org?: number) {
    const { orgId } = await this.access.org(actor, 'org.serviceAccounts', org);
    const rows = await this.db
      .select()
      .from(serviceAccounts)
      .where(eq(serviceAccounts.organizationId, orgId));
    return { data: rows.map(view) };
  }

  async create(
    actor: Actor,
    org: number | undefined,
    dto: { name: string; scopes: string[]; projectIds: number[] | null; expiresInDays: number },
  ) {
    const { orgId } = await this.access.org(actor, 'org.serviceAccounts', org);
    await this.assertProjectsInOrg(orgId, dto.projectIds);
    const t = newServiceAccountToken();
    const [s] = await this.db
      .insert(serviceAccounts)
      .values({
        organizationId: orgId,
        name: dto.name,
        tokenPrefix: t.prefix,
        tokenHash: t.hash,
        scopes: dto.scopes,
        projectIds: dto.projectIds,
        expiresAt: new Date(Date.now() + dto.expiresInDays * 86_400_000),
        createdBy: actor.kind === 'user' ? actor.userId : null,
      })
      .returning();
    await this.audit.log({
      actor,
      organizationId: orgId,
      action: 'service_account.create',
      entityType: 'service_account',
      entityId: s!.id,
      metadata: { name: dto.name, scopes: dto.scopes, projectIds: dto.projectIds },
    });
    return { ...view(s!), token: t.token };
  }

  async update(
    actor: Actor,
    org: number | undefined,
    id: number,
    dto: { name?: string; scopes?: string[]; projectIds?: number[] | null },
  ) {
    const { orgId } = await this.access.org(actor, 'org.serviceAccounts', org);
    const before = await this.load(orgId, id);
    await this.assertProjectsInOrg(orgId, dto.projectIds);
    const [s] = await this.db
      .update(serviceAccounts)
      .set(dto)
      .where(eq(serviceAccounts.id, id))
      .returning();
    await this.audit.log({
      actor,
      organizationId: orgId,
      action: 'service_account.update',
      entityType: 'service_account',
      entityId: id,
      metadata: {
        before: { name: before.name, scopes: before.scopes, projectIds: before.projectIds },
        after: dto,
      },
    });
    return view(s!);
  }

  /** Token cũ hết hiệu lực ngay (graceMinutes mặc định 0) */
  async rotate(actor: Actor, org: number | undefined, id: number) {
    const { orgId } = await this.access.org(actor, 'org.serviceAccounts', org);
    await this.load(orgId, id);
    const t = newServiceAccountToken();
    const [s] = await this.db
      .update(serviceAccounts)
      .set({ tokenPrefix: t.prefix, tokenHash: t.hash })
      .where(eq(serviceAccounts.id, id))
      .returning();
    await this.audit.log({
      actor,
      organizationId: orgId,
      action: 'service_account.rotate',
      entityType: 'service_account',
      entityId: id,
    });
    return { ...view(s!), token: t.token };
  }

  async revoke(actor: Actor, org: number | undefined, id: number) {
    const { orgId } = await this.access.org(actor, 'org.serviceAccounts', org);
    await this.load(orgId, id);
    await this.db
      .update(serviceAccounts)
      .set({ revokedAt: new Date() })
      .where(eq(serviceAccounts.id, id));
    await this.audit.log({
      actor,
      organizationId: orgId,
      action: 'service_account.revoke',
      entityType: 'service_account',
      entityId: id,
    });
  }
}
