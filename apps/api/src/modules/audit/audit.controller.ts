import { idSchema } from '@qah/validation';
import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentActor, OrgHeader, type Actor } from '../../common/actor';
import { ZodPipe } from '../../common/zod.pipe';
import { AccessService } from '../access/access.service';
import { AuditService } from './audit.service';

const filterSchema = z.object({
  actor: idSchema.optional(),
  action: z.string().max(100).optional(),
  entityType: z.string().max(50).optional(),
  entityId: idSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Ô bắt đầu bằng = + - @ tab CR → thêm ' chống formula injection (docs/09 §10) */
export function csvCell(v: unknown): string {
  let s =
    v == null
      ? ''
      : typeof v === 'string'
        ? v
        : v instanceof Date
          ? v.toISOString()
          : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

@ApiTags('audit')
@Controller('audit-logs')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @OrgHeader() org: number | undefined,
    @Query(new ZodPipe(filterSchema)) f: z.infer<typeof filterSchema>,
  ) {
    const { orgId } = await this.access.org(actor, 'org.audit.read', org);
    return this.audit.list(orgId, f);
  }

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="audit-logs.csv"')
  async export(
    @CurrentActor() actor: Actor,
    @OrgHeader() org: number | undefined,
    @Query(new ZodPipe(filterSchema.omit({ cursor: true, limit: true })))
    f: Omit<z.infer<typeof filterSchema>, 'cursor' | 'limit'>,
  ) {
    const { orgId } = await this.access.org(actor, 'org.audit.export', org);
    const cols = [
      'createdAt',
      'action',
      'entityType',
      'entityId',
      'actorUserId',
      'actorServiceAccountId',
      'ip',
      'metadata',
    ] as const;
    const lines = [cols.join(',')];
    // shortcut: tối đa 10.000 dòng mỗi lần xuất; stream khi audit lớn (Phase 8)
    let cursor: number | undefined;
    for (let page = 0; page < 100; page++) {
      const { data, nextCursor } = await this.audit.list(orgId, { ...f, cursor, limit: 100 });
      for (const row of data) lines.push(cols.map((c) => csvCell(row[c])).join(','));
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    await this.audit.log({
      actor,
      organizationId: orgId,
      action: 'audit.export',
      entityType: 'organization',
      entityId: orgId,
      metadata: f,
    });
    return '﻿' + lines.join('\r\n');
  }
}
