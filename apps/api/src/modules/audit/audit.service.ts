import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, type SQL } from 'drizzle-orm';
import type { Actor } from '../../common/actor';
import { auditLogs } from '../../db/schema';
import { DB, type Db } from '../../infra.module';

export interface AuditEntry {
  actor: Actor | null;
  organizationId: number | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  metadata?: Record<string, unknown>;
}

export interface AuditFilter {
  actor?: number;
  action?: string;
  entityType?: string;
  entityId?: number;
  from?: Date;
  to?: Date;
  cursor?: number;
  limit: number;
}

/** Audit log chỉ thêm (docs/09 §11). Ghi trong cùng transaction với thao tác khi có thể */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async log(entry: AuditEntry, tx: Pick<Db, 'insert'> = this.db): Promise<void> {
    const a = entry.actor;
    await tx.insert(auditLogs).values({
      organizationId: entry.organizationId,
      actorUserId: a?.kind === 'user' ? a.userId : null,
      actorServiceAccountId: a?.kind === 'sa' ? a.serviceAccountId : null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
      ip: a?.ip ?? null,
      userAgent: a?.userAgent ?? null,
    });
  }

  async list(orgId: number, f: AuditFilter) {
    const where: SQL[] = [eq(auditLogs.organizationId, orgId)];
    if (f.actor) where.push(eq(auditLogs.actorUserId, f.actor));
    if (f.action) where.push(eq(auditLogs.action, f.action));
    if (f.entityType) where.push(eq(auditLogs.entityType, f.entityType));
    if (f.entityId) where.push(eq(auditLogs.entityId, f.entityId));
    if (f.from) where.push(gte(auditLogs.createdAt, f.from));
    if (f.to) where.push(lt(auditLogs.createdAt, f.to));
    if (f.cursor) where.push(lt(auditLogs.id, f.cursor)); // id tự tăng: id nhỏ hơn = cũ hơn
    const rows = await this.db
      .select()
      .from(auditLogs)
      .where(and(...where))
      .orderBy(desc(auditLogs.id))
      .limit(f.limit + 1);
    const data = rows.slice(0, f.limit);
    return { data, nextCursor: rows.length > f.limit ? data[data.length - 1]!.id : null };
  }
}
