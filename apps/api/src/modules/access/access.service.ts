import { Inject, Injectable } from '@nestjs/common';
import { can, effectiveProjectRole, type Action, type OrgRole, type Role } from '@qah/validation';
import { and, eq } from 'drizzle-orm';
import type { Actor } from '../../common/actor';
import { forbidden, notFound, validationFailed } from '../../common/errors';
import { environments, organizationMembers, projectMembers, projects } from '../../db/schema';
import { DB, type Db } from '../../infra.module';

export interface OrgScope {
  orgId: number;
  role: OrgRole;
}

export interface ProjectScope extends OrgScope {
  projectId: number;
  projectRole: Role;
  project: typeof projects.$inferSelect;
}

/**
 * Kiểm quyền theo dữ liệu (docs/09 §2): AuthGuard chỉ xác thực, service gọi AccessService
 * trước khi đọc/ghi. Không có quyền đọc → 404 (không lộ sự tồn tại); thấy nhưng thiếu quyền → 403.
 * Phase 1 chưa có route nào cho service account → SA luôn bị 403.
 */
@Injectable()
export class AccessService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private userOf(actor: Actor): number {
    if (actor.kind !== 'user') throw forbidden('Service account không được dùng thao tác này');
    return actor.userId;
  }

  /** Org đang chọn: header X-Organization-Id; nếu không gửi và user chỉ thuộc 1 org thì dùng org đó */
  async org(actor: Actor, action: Action, orgId?: number): Promise<OrgScope> {
    const userId = this.userOf(actor);
    const rows = await this.db
      .select({ orgId: organizationMembers.organizationId, role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        orgId
          ? and(
              eq(organizationMembers.userId, userId),
              eq(organizationMembers.organizationId, orgId),
            )
          : eq(organizationMembers.userId, userId),
      );
    if (!orgId && rows.length > 1) throw validationFailed('Thiếu header X-Organization-Id');
    const m = rows[0];
    if (!m) throw notFound('Tổ chức');
    if (!can(m.role, action)) throw forbidden();
    return m;
  }

  async project(actor: Actor, projectId: number, action: Action): Promise<ProjectScope> {
    const userId = this.userOf(actor);
    const [row] = await this.db
      .select({
        project: projects,
        orgRole: organizationMembers.role,
        projectRole: projectMembers.role,
      })
      .from(projects)
      .innerJoin(
        organizationMembers,
        and(
          eq(organizationMembers.organizationId, projects.organizationId),
          eq(organizationMembers.userId, userId),
        ),
      )
      .leftJoin(
        projectMembers,
        and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)),
      )
      .where(eq(projects.id, projectId));
    const role = row ? effectiveProjectRole(row.orgRole, row.projectRole) : null;
    if (!row || !role) throw notFound('Dự án');
    if (!can(role, action)) throw forbidden();
    return {
      orgId: row.project.organizationId,
      role: row.orgRole,
      projectId,
      projectRole: role,
      project: row.project,
    };
  }

  async environment(actor: Actor, envId: number, action: Action) {
    const [env] = await this.db.select().from(environments).where(eq(environments.id, envId));
    if (!env) throw notFound('Môi trường');
    const scope = await this.project(actor, env.projectId, action);
    return { ...scope, env };
  }
}
