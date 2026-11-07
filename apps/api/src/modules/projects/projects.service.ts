import { Inject, Injectable } from '@nestjs/common';
import type { ProjectRole } from '@qah/validation';
import { and, asc, eq, ilike, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import type { Actor } from '../../common/actor';
import { conflict, invalidState, isUniqueViolation, notFound } from '../../common/errors';
import { organizationMembers, projectMembers, projects, users } from '../../db/schema';
import { DB, type Db } from '../../infra.module';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';

type ProjectRow = typeof projects.$inferSelect;

const view = (p: ProjectRow) => ({
  id: p.id,
  key: p.key,
  name: p.name,
  description: p.description,
  repositoryUrl: p.repositoryUrl,
  archivedAt: p.archivedAt,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  /** Owner/Admin thấy mọi project của org; người khác chỉ project mình là thành viên (docs/09 §2) */
  async list(actor: Actor, org: number | undefined, q?: string, archived = false) {
    const { orgId, role } = await this.access.org(actor, 'org.read', org);
    const where: SQL[] = [
      eq(projects.organizationId, orgId),
      archived ? isNotNull(projects.archivedAt) : isNull(projects.archivedAt),
    ];
    if (q)
      where.push(or(ilike(projects.name, `%${q}%`), ilike(projects.key, `%${q.toUpperCase()}%`))!);
    const isAdmin = role === 'OWNER' || role === 'ADMIN';
    const base = this.db.select({ p: projects }).from(projects);
    const rows = isAdmin
      ? await base.where(and(...where)).orderBy(asc(projects.key))
      : await base
          .innerJoin(
            projectMembers,
            and(
              eq(projectMembers.projectId, projects.id),
              eq(projectMembers.userId, (actor as { userId: number }).userId),
            ),
          )
          .where(and(...where))
          .orderBy(asc(projects.key));
    return { data: rows.map((r) => view(r.p)), nextCursor: null };
  }

  async create(
    actor: Actor,
    org: number | undefined,
    dto: { key: string; name: string; description?: string; repositoryUrl?: string },
  ) {
    const { orgId } = await this.access.org(actor, 'org.projects.create', org);
    try {
      const [p] = await this.db
        .insert(projects)
        .values({
          ...dto,
          organizationId: orgId,
          createdBy: actor.kind === 'user' ? actor.userId : null,
        })
        .returning();
      await this.audit.log({
        actor,
        organizationId: orgId,
        action: 'project.create',
        entityType: 'project',
        entityId: p!.id,
        metadata: { key: dto.key, name: dto.name },
      });
      return view(p!);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(`Mã dự án ${dto.key} đã tồn tại`);
      throw err;
    }
  }

  async get(actor: Actor, id: number) {
    const { project, projectRole } = await this.access.project(actor, id, 'project.read');
    return { ...view(project), myRole: projectRole };
  }

  async update(
    actor: Actor,
    id: number,
    dto: { name?: string; description?: string; repositoryUrl?: string },
  ) {
    const { orgId, project } = await this.access.project(actor, id, 'project.update');
    const [p] = await this.db.update(projects).set(dto).where(eq(projects.id, id)).returning();
    await this.audit.log({
      actor,
      organizationId: orgId,
      action: 'project.update',
      entityType: 'project',
      entityId: id,
      metadata: { before: { name: project.name, description: project.description }, after: dto },
    });
    return view(p!);
  }

  async setArchived(actor: Actor, id: number, archived: boolean) {
    const { orgId } = await this.access.project(actor, id, 'project.archive');
    const [p] = await this.db
      .update(projects)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(projects.id, id))
      .returning();
    await this.audit.log({
      actor,
      organizationId: orgId,
      action: archived ? 'project.archive' : 'project.unarchive',
      entityType: 'project',
      entityId: id,
    });
    return view(p!);
  }

  // ---- Thành viên dự án ----

  async members(actor: Actor, id: number) {
    await this.access.project(actor, id, 'project.read');
    const data = await this.db
      .select({
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        role: projectMembers.role,
        createdAt: projectMembers.createdAt,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, id));
    return { data };
  }

  async addMember(actor: Actor, id: number, dto: { userId: number; role: ProjectRole }) {
    const { orgId } = await this.access.project(actor, id, 'project.members.manage');
    const [inOrg] = await this.db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.userId, dto.userId),
        ),
      );
    if (!inOrg) throw notFound('Thành viên tổ chức');
    const inserted = await this.db
      .insert(projectMembers)
      .values({ projectId: id, userId: dto.userId, role: dto.role })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) throw invalidState('Người dùng đã là thành viên dự án');
    await this.audit.log({
      actor,
      organizationId: orgId,
      action: 'project_member.add',
      entityType: 'project',
      entityId: id,
      metadata: { userId: dto.userId, role: dto.role },
    });
    return { userId: dto.userId, role: dto.role };
  }

  private async membership(projectId: number, userId: number) {
    const [m] = await this.db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    if (!m) throw notFound('Thành viên dự án');
    return m;
  }

  async updateMember(actor: Actor, id: number, userId: number, role: ProjectRole) {
    const { orgId } = await this.access.project(actor, id, 'project.members.manage');
    const m = await this.membership(id, userId);
    await this.db.update(projectMembers).set({ role }).where(eq(projectMembers.id, m.id));
    await this.audit.log({
      actor,
      organizationId: orgId,
      action: 'project_member.role_change',
      entityType: 'project',
      entityId: id,
      metadata: { userId, before: m.role, after: role },
    });
    return { userId, role };
  }

  async removeMember(actor: Actor, id: number, userId: number) {
    const { orgId } = await this.access.project(actor, id, 'project.members.manage');
    const m = await this.membership(id, userId);
    await this.db.delete(projectMembers).where(eq(projectMembers.id, m.id));
    await this.audit.log({
      actor,
      organizationId: orgId,
      action: 'project_member.remove',
      entityType: 'project',
      entityId: id,
      metadata: { userId, role: m.role },
    });
  }
}
