import { TEST_DB } from './test-env'; // phải đứng đầu: đặt biến môi trường trước khi nạp app
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { OrgRole, ProjectRole } from '@qah/validation';
import postgres from 'postgres';
import request from 'supertest';
import { describe } from 'vitest';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { runMigrations } from '../db/migrate';
import * as schema from '../db/schema';
import { DB } from '../infra.module';
import { AuthService } from '../modules/auth/auth.service';
import { newServiceAccountToken } from '../modules/auth/crypto';
import { TargetVerifier } from '../modules/targets/targets.service';

/**
 * Harness test tích hợp: app Nest thật + Postgres thật (TEST_DATABASE_URL, không cần Docker).
 * Mỗi file test gọi createHarness() → xóa sạch schema, chạy migration, seed fixture.
 */
export { TEST_DB };

export const describeDb = TEST_DB ? describe : describe.skip;

export const ACTORS = [
  'OWNER',
  'ADMIN',
  'QA_LEAD',
  'TESTER',
  'DEVELOPER',
  'VIEWER',
  'OUTSIDER',
  'OTHER_ORG',
  'SA',
] as const;
export type ActorName = (typeof ACTORS)[number];

export interface Harness {
  app: INestApplication;
  orgId: string;
  otherOrgId: string;
  projectId: string;
  users: Record<Exclude<ActorName, 'SA'>, string>;
  tokens: Record<ActorName, string>;
  /** Gọi API với vai trò; header X-Organization-Id mặc định là org chính */
  call(
    actor: ActorName | { token: string },
    method: string,
    path: string,
    body?: unknown,
  ): request.Test;
  owner(method: string, path: string, body?: unknown): request.Test;
  issueToken(userId: string): Promise<string>;
  freshUserToken(): Promise<string>;
  freshProject(): Promise<string>;
  sql: postgres.Sql;
  close(): Promise<void>;
}

const PROJECT_ROLE: Partial<Record<OrgRole, ProjectRole>> = {
  QA_LEAD: 'QA_LEAD',
  TESTER: 'TESTER',
  DEVELOPER: 'DEVELOPER',
  VIEWER: 'VIEWER',
};

export const uniq = () => randomBytes(4).toString('hex');

export async function resetDatabase(url: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql`drop schema if exists public cascade`;
  await sql`drop schema if exists drizzle cascade`;
  await sql`create schema public`;
  await sql.end();
}

export async function createHarness(): Promise<Harness> {
  if (!TEST_DB) throw new Error('Thiếu TEST_DATABASE_URL');
  await resetDatabase(TEST_DB);
  await runMigrations(TEST_DB);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TargetVerifier)
    .useValue({ dnsTxt: async () => true, wellKnown: async () => true })
    .compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: false }));
  await app.init();

  const db = app.get(DB);
  const auth = app.get(AuthService);
  const info = { ip: '127.0.0.1', userAgent: 'vitest' };

  const mkUser = async (label: string) => {
    const [u] = await db
      .insert(schema.users)
      .values({ email: `${label.toLowerCase()}-${uniq()}@test.vn`, displayName: label })
      .returning();
    return u!.id;
  };
  const mkOrg = async (name: string) => {
    const [o] = await db
      .insert(schema.organizations)
      .values({
        name,
        slug: `${name}-${uniq()}`,
        settings: { localNetwork: { allowedCidrs: ['192.168.1.0/24'], allowLoopback: true } },
      })
      .returning();
    return o!.id;
  };

  const orgId = await mkOrg('main');
  const otherOrgId = await mkOrg('other');
  const users = {} as Harness['users'];
  for (const role of ['OWNER', 'ADMIN', 'QA_LEAD', 'TESTER', 'DEVELOPER', 'VIEWER'] as const) {
    users[role] = await mkUser(role);
    await db
      .insert(schema.organizationMembers)
      .values({ organizationId: orgId, userId: users[role], role });
  }
  users.OUTSIDER = await mkUser('OUTSIDER'); // thành viên org nhưng không thuộc project
  await db
    .insert(schema.organizationMembers)
    .values({ organizationId: orgId, userId: users.OUTSIDER, role: 'TESTER' });
  users.OTHER_ORG = await mkUser('OTHER_ORG'); // Owner của org khác
  await db
    .insert(schema.organizationMembers)
    .values({ organizationId: otherOrgId, userId: users.OTHER_ORG, role: 'OWNER' });

  const addProjectMembers = async (projectId: string) => {
    for (const [role, pr] of Object.entries(PROJECT_ROLE)) {
      await db
        .insert(schema.projectMembers)
        .values({ projectId, userId: users[role as OrgRole], role: pr! });
    }
  };
  const [project] = await db
    .insert(schema.projects)
    .values({ organizationId: orgId, key: 'MAIN', name: 'Main' })
    .returning();
  await addProjectMembers(project!.id);

  const issueToken = async (userId: string) =>
    (await auth.issueSession(db, userId, info)).accessToken;
  const tokens = {} as Harness['tokens'];
  for (const [name, id] of Object.entries(users)) tokens[name as ActorName] = await issueToken(id);
  const sa = newServiceAccountToken();
  await db.insert(schema.serviceAccounts).values({
    organizationId: orgId,
    name: 'ci',
    tokenPrefix: sa.prefix,
    tokenHash: sa.hash,
    scopes: [
      'runs:create',
      'runs:read',
      'results:import',
      'gates:read',
      'findings:read',
      'findings:write',
    ],
  });
  tokens.SA = sa.token;

  const server = app.getHttpServer();
  const call: Harness['call'] = (actor, method, path, body) => {
    const token = typeof actor === 'string' ? tokens[actor] : actor.token;
    const req = (request(server) as unknown as Record<string, (p: string) => request.Test>)[
      method.toLowerCase()
    ]!(path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', orgId);
    return body === undefined ? req : req.send(body as object);
  };

  let projectSeq = 0;
  const sql = postgres(TEST_DB, { max: 2, onnotice: () => {} });
  return {
    app,
    orgId,
    otherOrgId,
    projectId: project!.id,
    users,
    tokens,
    call,
    owner: (m, p, b) => call('OWNER', m, p, b),
    issueToken,
    freshUserToken: async () => issueToken(await mkUser('TEMP')),
    freshProject: async () => {
      const [p] = await db
        .insert(schema.projects)
        .values({
          organizationId: orgId,
          key: `P${++projectSeq}${uniq()
            .slice(0, 4)
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, 'X')}`,
          name: 'Fresh',
        })
        .returning();
      await addProjectMembers(p!.id);
      return p!.id;
    },
    sql,
    close: async () => {
      await sql.end();
      await app.close();
    },
  };
}
