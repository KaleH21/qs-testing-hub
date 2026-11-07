import { Inject, Injectable } from '@nestjs/common';
import type { EnvironmentKind } from '@qah/validation';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Actor } from '../../common/actor';
import { conflict, isUniqueViolation, notFound, validationFailed } from '../../common/errors';
import { ENV, type Env } from '../../config/env';
import {
  environmentCredentials,
  environments,
  environmentVariables,
  organizations,
  secrets,
} from '../../db/schema';
import { DB, type Db } from '../../infra.module';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { SecretsService } from '../secrets/secrets.service';
import { assertLocalTarget, parseLocalNetwork } from '../targets/net';
import { testingBlock } from './testing-gate';

type EnvRow = typeof environments.$inferSelect;
type OrgRow = typeof organizations.$inferSelect;

interface EnvInput {
  name?: string;
  kind?: EnvironmentKind;
  webBaseUrl?: string;
  apiBaseUrl?: string;
  defaultHeaders?: Record<string, string>;
  isActive?: boolean;
}

@Injectable()
export class EnvironmentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly secrets: SecretsService,
  ) {}

  private async org(orgId: string): Promise<OrgRow> {
    const [o] = await this.db.select().from(organizations).where(eq(organizations.id, orgId));
    return o!;
  }

  private view(e: EnvRow, org: OrgRow) {
    return {
      id: e.id,
      projectId: e.projectId,
      name: e.name,
      kind: e.kind,
      webBaseUrl: e.webBaseUrl,
      apiBaseUrl: e.apiBaseUrl,
      defaultHeaders: e.defaultHeaders,
      isActive: e.isActive,
      testingEnabled: e.testingEnabled,
      testingDisabledReason: e.testingDisabledReason,
      testingToggledBy: e.testingToggledBy,
      testingToggledAt: e.testingToggledAt,
      // trạng thái hiệu lực sau khi gộp công tắc tổ chức (UI hiện badge "Đang tắt test")
      testingBlock: testingBlock(org, e),
      createdAt: e.createdAt,
    };
  }

  /** LOCAL: URL phải là localhost (kiểu Cá nhân) hoặc nằm trong dải mạng nội bộ đã bật (D-23) */
  private async checkUrls(
    org: OrgRow,
    kind: EnvironmentKind,
    urls: Array<string | null | undefined>,
  ) {
    if (kind !== 'LOCAL') return;
    const net = parseLocalNetwork(org.settings);
    for (const url of urls) if (url) await assertLocalTarget(url, this.env.DEPLOYMENT_MODE, net);
  }

  async list(actor: Actor, projectId: string) {
    const { orgId } = await this.access.project(actor, projectId, 'project.read');
    const org = await this.org(orgId);
    const rows = await this.db
      .select()
      .from(environments)
      .where(eq(environments.projectId, projectId))
      .orderBy(asc(environments.createdAt));
    return { data: rows.map((e) => this.view(e, org)) };
  }

  async create(
    actor: Actor,
    projectId: string,
    dto: EnvInput & { name: string; kind: EnvironmentKind },
  ) {
    const { orgId } = await this.access.project(
      actor,
      projectId,
      dto.kind === 'PRODUCTION' ? 'project.environments.production' : 'project.environments.manage',
    );
    const org = await this.org(orgId);
    await this.checkUrls(org, dto.kind, [dto.webBaseUrl, dto.apiBaseUrl]);
    try {
      const [e] = await this.db
        .insert(environments)
        .values({ ...dto, projectId })
        .returning();
      await this.audit.log({
        actor,
        organizationId: orgId,
        action: 'environment.create',
        entityType: 'environment',
        entityId: e!.id,
        metadata: {
          name: dto.name,
          kind: dto.kind,
          webBaseUrl: dto.webBaseUrl,
          apiBaseUrl: dto.apiBaseUrl,
        },
      });
      return this.view(e!, org);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(`Môi trường "${dto.name}" đã tồn tại`);
      throw err;
    }
  }

  async get(actor: Actor, envId: string) {
    const { orgId, env } = await this.access.environment(actor, envId, 'project.read');
    return this.view(env, await this.org(orgId));
  }

  async update(actor: Actor, envId: string, dto: EnvInput) {
    const { orgId, env } = await this.access.environment(
      actor,
      envId,
      'project.environments.manage',
    );
    const kindChanged = dto.kind !== undefined && dto.kind !== env.kind;
    if (kindChanged && (env.kind === 'PRODUCTION' || dto.kind === 'PRODUCTION')) {
      await this.access.environment(actor, envId, 'project.environments.production'); // docs/05 §3.3
    }
    const org = await this.org(orgId);
    const kind = dto.kind ?? env.kind;
    await this.checkUrls(org, kind, [
      dto.webBaseUrl ?? env.webBaseUrl,
      dto.apiBaseUrl ?? env.apiBaseUrl,
    ]);
    try {
      const [e] = await this.db
        .update(environments)
        .set(dto)
        .where(eq(environments.id, envId))
        .returning();
      await this.audit.log({
        actor,
        organizationId: orgId,
        action: 'environment.update',
        entityType: 'environment',
        entityId: envId,
        metadata: {
          before: {
            name: env.name,
            kind: env.kind,
            webBaseUrl: env.webBaseUrl,
            apiBaseUrl: env.apiBaseUrl,
            isActive: env.isActive,
          },
          after: dto,
        },
      });
      return this.view(e!, org);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(`Môi trường "${dto.name}" đã tồn tại`);
      throw err;
    }
  }

  /** shortcut: Phase 2 thêm kiểm "chưa có run" (có run thì chỉ isActive=false, docs/05 §3.3) */
  async remove(actor: Actor, envId: string) {
    const { orgId, env } = await this.access.environment(
      actor,
      envId,
      'project.environments.delete',
    );
    await this.db.transaction(async (tx) => {
      const creds = await tx
        .select({ secretId: environmentCredentials.passwordSecretId })
        .from(environmentCredentials)
        .where(eq(environmentCredentials.environmentId, envId));
      await tx.delete(environments).where(eq(environments.id, envId)); // cascade biến + credential
      if (creds.length)
        await tx.delete(secrets).where(
          inArray(
            secrets.id,
            creds.map((c) => c.secretId),
          ),
        );
      await this.audit.log(
        {
          actor,
          organizationId: orgId,
          action: 'environment.delete',
          entityType: 'environment',
          entityId: envId,
          metadata: { name: env.name, kind: env.kind },
        },
        tx,
      );
    });
  }

  /** Công tắc môi trường (D-24): PRODUCTION cần Admin, kind khác cần QA Lead */
  async setTesting(actor: Actor, envId: string, dto: { enabled: boolean; reason: string }) {
    const action = 'project.environments.testingToggle';
    const { orgId, env } = await this.access.environment(actor, envId, action);
    if (env.kind === 'PRODUCTION')
      await this.access.environment(actor, envId, 'project.environments.production');
    const [e] = await this.db
      .update(environments)
      .set({
        testingEnabled: dto.enabled,
        testingDisabledReason: dto.enabled ? null : dto.reason,
        testingToggledBy: actor.kind === 'user' ? actor.userId : null,
        testingToggledAt: new Date(),
      })
      .where(eq(environments.id, envId))
      .returning();
    await this.audit.log({
      actor,
      organizationId: orgId,
      action: 'environment.testing_toggle',
      entityType: 'environment',
      entityId: envId,
      metadata: {
        kind: env.kind,
        before: env.testingEnabled,
        after: dto.enabled,
        reason: dto.reason,
      },
    });
    return this.view(e!, await this.org(orgId));
  }

  // ---- Biến môi trường ----

  async variables(actor: Actor, envId: string) {
    await this.access.environment(actor, envId, 'project.read');
    const rows = await this.db
      .select()
      .from(environmentVariables)
      .where(eq(environmentVariables.environmentId, envId))
      .orderBy(asc(environmentVariables.key));
    return {
      data: rows.map((v) =>
        v.secretId
          ? { key: v.key, secretId: v.secretId, masked: true }
          : { key: v.key, value: v.value },
      ),
    };
  }

  async replaceVariables(
    actor: Actor,
    envId: string,
    vars: Array<{ key: string; value: string } | { key: string; secretId: string }>,
  ) {
    const { orgId, projectId } = await this.access.environment(
      actor,
      envId,
      'project.environments.manage',
    );
    const secretIds = vars.flatMap((v) => ('secretId' in v ? [v.secretId] : []));
    if (secretIds.length) {
      const found = await this.db
        .select({ id: secrets.id, projectId: secrets.projectId })
        .from(secrets)
        .where(and(eq(secrets.organizationId, orgId), inArray(secrets.id, secretIds)));
      const ok = found.filter((s) => s.projectId === null || s.projectId === projectId);
      if (ok.length !== new Set(secretIds).size)
        throw validationFailed('Secret không thuộc dự án hoặc tổ chức này');
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(environmentVariables).where(eq(environmentVariables.environmentId, envId));
      if (vars.length) {
        await tx.insert(environmentVariables).values(
          vars.map((v) => ({
            environmentId: envId,
            key: v.key,
            value: 'value' in v ? v.value : null,
            secretId: 'secretId' in v ? v.secretId : null,
          })),
        );
      }
      await this.audit.log(
        {
          actor,
          organizationId: orgId,
          action: 'environment.variables_update',
          entityType: 'environment',
          entityId: envId,
          metadata: { keys: vars.map((v) => v.key) },
        },
        tx,
      );
    });
    return this.variables(actor, envId);
  }

  // ---- Tài khoản test theo vai trò (mật khẩu lưu trong vault) ----

  async credentials(actor: Actor, envId: string) {
    await this.access.environment(actor, envId, 'project.read');
    const rows = await this.db
      .select()
      .from(environmentCredentials)
      .where(eq(environmentCredentials.environmentId, envId))
      .orderBy(asc(environmentCredentials.roleName));
    return {
      data: rows.map((c) => ({
        id: c.id,
        roleName: c.roleName,
        username: c.username,
        hasPassword: true,
        createdAt: c.createdAt,
      })),
    };
  }

  async createCredential(
    actor: Actor,
    envId: string,
    dto: { roleName: string; username: string; password: string },
  ) {
    const { orgId, projectId } = await this.access.environment(
      actor,
      envId,
      'project.environments.manage',
    );
    try {
      const c = await this.db.transaction(async (tx) => {
        const secret = await this.secrets.store(
          tx,
          actor,
          orgId,
          projectId,
          `cred.${envId}.${dto.roleName}`,
          dto.password,
        );
        const [row] = await tx
          .insert(environmentCredentials)
          .values({
            environmentId: envId,
            roleName: dto.roleName,
            username: dto.username,
            passwordSecretId: secret.id,
          })
          .returning();
        return row!;
      });
      return {
        id: c.id,
        roleName: c.roleName,
        username: c.username,
        hasPassword: true,
        createdAt: c.createdAt,
      };
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(`Vai trò "${dto.roleName}" đã có tài khoản`);
      throw err;
    }
  }

  private async credential(envId: string, id: string) {
    const [c] = await this.db
      .select()
      .from(environmentCredentials)
      .where(
        and(eq(environmentCredentials.id, id), eq(environmentCredentials.environmentId, envId)),
      );
    if (!c) throw notFound('Tài khoản test');
    return c;
  }

  async updateCredential(
    actor: Actor,
    envId: string,
    id: string,
    dto: { username?: string; password?: string },
  ) {
    const { orgId } = await this.access.environment(actor, envId, 'project.environments.manage');
    const c = await this.credential(envId, id);
    await this.db.transaction(async (tx) => {
      if (dto.username)
        await tx
          .update(environmentCredentials)
          .set({ username: dto.username })
          .where(eq(environmentCredentials.id, id));
      if (dto.password) {
        const [s] = await tx.select().from(secrets).where(eq(secrets.id, c.passwordSecretId));
        await this.secrets.rotate(tx, actor, s!, dto.password);
      }
      await this.audit.log(
        {
          actor,
          organizationId: orgId,
          action: 'environment.credential_update',
          entityType: 'environment',
          entityId: envId,
          metadata: { roleName: c.roleName, passwordChanged: !!dto.password },
        },
        tx,
      );
    });
    return {
      id,
      roleName: c.roleName,
      username: dto.username ?? c.username,
      hasPassword: true,
      createdAt: c.createdAt,
    };
  }

  async removeCredential(actor: Actor, envId: string, id: string) {
    const { orgId } = await this.access.environment(actor, envId, 'project.environments.manage');
    const c = await this.credential(envId, id);
    await this.db.transaction(async (tx) => {
      await tx.delete(environmentCredentials).where(eq(environmentCredentials.id, id));
      await tx.delete(secrets).where(eq(secrets.id, c.passwordSecretId));
      await this.audit.log(
        {
          actor,
          organizationId: orgId,
          action: 'environment.credential_delete',
          entityType: 'environment',
          entityId: envId,
          metadata: { roleName: c.roleName },
        },
        tx,
      );
    });
  }
}
