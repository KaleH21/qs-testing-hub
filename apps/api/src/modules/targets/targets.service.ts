import { resolveTxt } from 'node:dns/promises';
import { Inject, Injectable } from '@nestjs/common';
import type { VerificationMethod } from '@qah/validation';
import { and, eq } from 'drizzle-orm';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/app-error';
import { conflict, invalidState, isUniqueViolation, notFound } from '../../common/errors';
import { targetHosts } from '../../db/schema';
import { DB, type Db } from '../../infra.module';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { randomToken } from '../auth/crypto';
import {
  dnsCandidates,
  normalizeCidrs,
  safeGetText,
  VERIFICATION_TXT_PREFIX,
  WELL_KNOWN_PATH,
  type IpPolicy,
} from './net';

/** Tách ra để test thay được DNS/HTTP thật */
export class TargetVerifier {
  async dnsTxt(hostPattern: string, token: string): Promise<boolean> {
    const expected = `${VERIFICATION_TXT_PREFIX}${token}`;
    for (const name of dnsCandidates(hostPattern)) {
      const records = await resolveTxt(name).catch(() => [] as string[][]);
      if (records.some((parts) => parts.join('') === expected)) return true;
    }
    return false;
  }

  async wellKnown(host: string, token: string, policy: IpPolicy): Promise<boolean> {
    for (const scheme of ['https', 'http']) {
      const body = await safeGetText(`${scheme}://${host}${WELL_KNOWN_PATH}`, policy).catch(
        () => null,
      );
      if (body?.trim() === token) return true;
    }
    return false;
  }
}

const DAY = 86_400_000;
// docs/09 §5: DNS/file kiểm lại mỗi 30 ngày; Admin duyệt hết hạn sau 180 ngày
const VALIDITY_DAYS: Record<VerificationMethod, number> = {
  DNS_TXT: 30,
  WELL_KNOWN_FILE: 30,
  ADMIN_APPROVAL: 180,
};

type TargetRow = typeof targetHosts.$inferSelect;

export function targetStatus(t: TargetRow, now = new Date()): 'PENDING' | 'VERIFIED' | 'EXPIRED' {
  if (!t.verifiedAt) return 'PENDING';
  return t.expiresAt && t.expiresAt <= now ? 'EXPIRED' : 'VERIFIED';
}

@Injectable()
export class TargetsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly verifier: TargetVerifier,
  ) {}

  private view(t: TargetRow) {
    return {
      id: t.id,
      projectId: t.projectId,
      hostPattern: t.hostPattern,
      allowPrivateNetwork: t.allowPrivateNetwork,
      allowedCidrs: t.allowedCidrs ?? [],
      verificationMethod: t.verificationMethod,
      status: targetStatus(t),
      verifiedAt: t.verifiedAt,
      expiresAt: t.expiresAt,
      createdAt: t.createdAt,
      instructions: this.instructions(t),
    };
  }

  private instructions(t: TargetRow) {
    const host = t.hostPattern.replace(/^\*\./, '');
    switch (t.verificationMethod) {
      case 'DNS_TXT':
        return {
          dnsTxt: { name: host, value: `${VERIFICATION_TXT_PREFIX}${t.verificationToken}` },
        };
      case 'WELL_KNOWN_FILE':
        return { file: { url: `https://${host}${WELL_KNOWN_PATH}`, content: t.verificationToken } };
      default:
        return { adminApproval: true };
    }
  }

  private async load(orgId: number, id: number) {
    const [t] = await this.db
      .select()
      .from(targetHosts)
      .where(and(eq(targetHosts.id, id), eq(targetHosts.organizationId, orgId)));
    if (!t) throw notFound('Target');
    return t;
  }

  async list(actor: Actor, orgHeader?: number) {
    const { orgId } = await this.access.org(actor, 'org.targets.read', orgHeader);
    const rows = await this.db
      .select()
      .from(targetHosts)
      .where(eq(targetHosts.organizationId, orgId));
    return { data: rows.map((t) => this.view(t)) };
  }

  async create(
    actor: Actor,
    orgHeader: number | undefined,
    dto: {
      hostPattern: string;
      projectId?: number;
      verificationMethod: VerificationMethod;
      allowPrivateNetwork: boolean;
      allowedCidrs: string[];
    },
  ) {
    const { orgId } = await this.access.org(actor, 'org.targets.manage', orgHeader);
    if (dto.projectId) {
      const p = await this.access.project(actor, dto.projectId, 'project.read');
      if (p.orgId !== orgId) throw notFound('Dự án');
    }
    try {
      const [t] = await this.db
        .insert(targetHosts)
        .values({
          organizationId: orgId,
          projectId: dto.projectId ?? null,
          hostPattern: dto.hostPattern,
          verificationMethod: dto.verificationMethod,
          allowPrivateNetwork: dto.allowPrivateNetwork,
          allowedCidrs: dto.allowPrivateNetwork ? normalizeCidrs(dto.allowedCidrs) : null,
          verificationToken: randomToken(24),
          createdBy: actor.kind === 'user' ? actor.userId : null,
        })
        .returning();
      await this.audit.log({
        actor,
        organizationId: orgId,
        action: 'target.create',
        entityType: 'target',
        entityId: t!.id,
        metadata: {
          hostPattern: dto.hostPattern,
          method: dto.verificationMethod,
          allowPrivateNetwork: dto.allowPrivateNetwork,
        },
      });
      return { ...this.view(t!), verificationToken: t!.verificationToken };
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(`Host ${dto.hostPattern} đã có trong allowlist`);
      throw err;
    }
  }

  private async markVerified(
    actor: Actor,
    t: TargetRow,
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    const now = new Date();
    const [updated] = await this.db
      .update(targetHosts)
      .set({
        verifiedAt: now,
        verifiedBy: actor.kind === 'user' ? actor.userId : null,
        expiresAt: new Date(now.getTime() + VALIDITY_DAYS[t.verificationMethod] * DAY),
      })
      .where(eq(targetHosts.id, t.id))
      .returning();
    await this.audit.log({
      actor,
      organizationId: t.organizationId,
      action,
      entityType: 'target',
      entityId: t.id,
      metadata: { hostPattern: t.hostPattern, ...extra },
    });
    return this.view(updated!);
  }

  async verify(actor: Actor, orgHeader: number | undefined, id: number) {
    const { orgId } = await this.access.org(actor, 'org.targets.manage', orgHeader);
    const t = await this.load(orgId, id);
    if (t.verificationMethod === 'ADMIN_APPROVAL')
      throw invalidState('Host này xác minh bằng Admin duyệt');
    const ok =
      t.verificationMethod === 'DNS_TXT'
        ? await this.verifier.dnsTxt(t.hostPattern, t.verificationToken)
        : await this.verifier.wellKnown(t.hostPattern, t.verificationToken, {
            allowPrivateNetwork: t.allowPrivateNetwork,
            allowedCidrs: t.allowedCidrs ?? [],
          });
    if (!ok) {
      throw new AppError('VERIFICATION_FAILED', 422, 'Chưa tìm thấy mã xác minh', [
        { instructions: this.instructions(t) },
      ]);
    }
    return this.markVerified(actor, t, 'target.verify');
  }

  async approve(actor: Actor, orgHeader: number | undefined, id: number, reason: string) {
    const { orgId } = await this.access.org(actor, 'org.targets.manage', orgHeader);
    const t = await this.load(orgId, id);
    if (t.verificationMethod !== 'ADMIN_APPROVAL') {
      throw invalidState('Host này xác minh bằng DNS hoặc file, không duyệt tay');
    }
    return this.markVerified(actor, t, 'target.approve', { reason });
  }

  async remove(actor: Actor, orgHeader: number | undefined, id: number) {
    const { orgId } = await this.access.org(actor, 'org.targets.manage', orgHeader);
    const t = await this.load(orgId, id);
    await this.db.delete(targetHosts).where(eq(targetHosts.id, t.id));
    await this.audit.log({
      actor,
      organizationId: orgId,
      action: 'target.delete',
      entityType: 'target',
      entityId: t.id,
      metadata: { hostPattern: t.hostPattern },
    });
  }
}
