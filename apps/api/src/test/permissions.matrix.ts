import type { ActorName, Harness } from './harness';
import { uniq } from './harness';

/**
 * Bảng kỳ vọng ma trận quyền (docs/09 §2). Mỗi route đã đăng ký phải có ít nhất một dòng;
 * route mới chưa khai báo → test fail. `setup` tạo dữ liệu mới cho mỗi lần gọi (thao tác ghi/xóa
 * không làm hỏng lần gọi sau) và có thể trả token riêng (logout).
 */
export interface MatrixRow {
  route: string; // "METHOD /api/v1/path/:param" đúng như Nest đăng ký
  name?: string;
  allowed: readonly ActorName[];
  setup?: (
    h: Harness,
    actor: ActorName,
  ) => Promise<{ path?: string; body?: unknown; token?: string }>;
  body?: (h: Harness) => unknown;
  path?: (h: Harness) => string;
}

const USERS: ActorName[] = [
  'OWNER',
  'ADMIN',
  'QA_LEAD',
  'TESTER',
  'DEVELOPER',
  'VIEWER',
  'OUTSIDER',
  'OTHER_ORG',
];
const ORG_MEMBERS: ActorName[] = [
  'OWNER',
  'ADMIN',
  'QA_LEAD',
  'TESTER',
  'DEVELOPER',
  'VIEWER',
  'OUTSIDER',
];
const PROJECT_MEMBERS: ActorName[] = ['OWNER', 'ADMIN', 'QA_LEAD', 'TESTER', 'DEVELOPER', 'VIEWER'];
const LEADS: ActorName[] = ['OWNER', 'ADMIN', 'QA_LEAD'];
const ADMINS: ActorName[] = ['OWNER', 'ADMIN'];

const ok = async (res: { status: number; body: { id?: string } }, what: string) => {
  if (res.status >= 300)
    throw new Error(`setup ${what} thất bại: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string } & Record<string, unknown>;
};

const env = async (h: Harness, kind = 'DEV', projectId = h.projectId) =>
  (
    await ok(
      await h.owner('POST', `/api/v1/projects/${projectId}/environments`, {
        name: `env-${uniq()}`,
        kind,
      }),
      'env',
    )
  ).id;

const member = async (h: Harness) =>
  (
    await ok(
      await h.owner('POST', `/api/v1/organizations/${h.orgId}/members`, {
        email: `m-${uniq()}@test.vn`,
        displayName: 'M',
        role: 'TESTER',
      }),
      'member',
    )
  ).userId as number;

const sa = async (h: Harness) =>
  (
    await ok(
      await h.owner('POST', '/api/v1/service-accounts', {
        name: `sa-${uniq()}`,
        scopes: ['runs:read'],
      }),
      'sa',
    )
  ).id;

const target = async (h: Harness, method = 'DNS_TXT') =>
  (
    await ok(
      await h.owner('POST', '/api/v1/targets', {
        hostPattern: `h${uniq()}.example.vn`,
        verificationMethod: method,
      }),
      'target',
    )
  ).id;

const projectWithOutsider = async (h: Harness) => {
  const p = await h.freshProject();
  await ok(
    await h.owner('POST', `/api/v1/projects/${p}/members`, {
      userId: h.users.OUTSIDER,
      role: 'TESTER',
    }),
    'pmember',
  );
  return p;
};

export const MATRIX: MatrixRow[] = [
  // ---- Auth (tài khoản của chính mình) ----
  { route: 'GET /api/v1/auth/me', allowed: USERS },
  { route: 'PATCH /api/v1/auth/me', allowed: USERS, body: () => ({ locale: 'vi' }) },
  {
    route: 'POST /api/v1/auth/change-password',
    allowed: USERS,
    // sai mật khẩu hiện tại → 400: vẫn chứng minh được phép gọi (không phải 401/403/404)
    body: () => ({ currentPassword: 'wrong-password', newPassword: 'a-new-long-password' }),
  },
  { route: 'GET /api/v1/auth/sessions', allowed: USERS },
  {
    route: 'DELETE /api/v1/auth/sessions/:id',
    allowed: USERS,
    setup: async (h, actor) => {
      if (actor === 'SA') return { path: `/api/v1/auth/sessions/${crypto.randomUUID()}` };
      const token = await h.issueToken(h.users[actor]);
      const sid = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).sid;
      return { path: `/api/v1/auth/sessions/${sid}` };
    },
  },
  {
    route: 'POST /api/v1/auth/logout',
    allowed: USERS,
    setup: async (h, actor) =>
      actor === 'SA' ? {} : { token: await h.issueToken(h.users[actor]) },
  },
  {
    route: 'POST /api/v1/auth/logout-all',
    allowed: USERS,
    // logout-all thu hồi mọi phiên của user → dùng user tạm để không làm hỏng token của các dòng sau
    setup: async (h, actor) => (actor === 'SA' ? {} : { token: await h.freshUserToken() }),
  },

  // ---- Tổ chức ----
  { route: 'GET /api/v1/organizations', allowed: USERS },
  {
    route: 'GET /api/v1/organizations/:id',
    allowed: ORG_MEMBERS,
    path: (h) => `/api/v1/organizations/${h.orgId}`,
  },
  {
    route: 'PATCH /api/v1/organizations/:id',
    allowed: ADMINS,
    path: (h) => `/api/v1/organizations/${h.orgId}`,
    body: () => ({ name: 'Main org' }),
  },
  {
    route: 'PATCH /api/v1/organizations/:id/testing-switches',
    allowed: ADMINS,
    path: (h) => `/api/v1/organizations/${h.orgId}/testing-switches`,
    body: () => ({ productionTesting: false, reason: 'kiểm thử ma trận quyền' }),
  },
  {
    route: 'PUT /api/v1/organizations/:id/local-network',
    allowed: ADMINS,
    path: (h) => `/api/v1/organizations/${h.orgId}/local-network`,
    body: () => ({ allowedCidrs: ['192.168.1.0/24'], allowLoopback: true }),
  },
  {
    route: 'GET /api/v1/organizations/:id/members',
    allowed: ORG_MEMBERS,
    path: (h) => `/api/v1/organizations/${h.orgId}/members`,
  },
  {
    route: 'POST /api/v1/organizations/:id/members',
    allowed: ADMINS,
    path: (h) => `/api/v1/organizations/${h.orgId}/members`,
    body: () => ({ email: `n-${uniq()}@test.vn`, displayName: 'N', role: 'VIEWER' }),
  },
  {
    route: 'PATCH /api/v1/organizations/:id/members/:userId',
    allowed: ADMINS,
    setup: async (h) => ({
      path: `/api/v1/organizations/${h.orgId}/members/${await member(h)}`,
      body: { role: 'DEVELOPER' },
    }),
  },
  {
    route: 'DELETE /api/v1/organizations/:id/members/:userId',
    allowed: ADMINS,
    setup: async (h) => ({ path: `/api/v1/organizations/${h.orgId}/members/${await member(h)}` }),
  },

  // ---- Service account ----
  { route: 'GET /api/v1/service-accounts', allowed: ADMINS },
  {
    route: 'POST /api/v1/service-accounts',
    allowed: ADMINS,
    body: () => ({ name: `sa-${uniq()}`, scopes: ['runs:create'] }),
  },
  {
    route: 'PATCH /api/v1/service-accounts/:id',
    allowed: ADMINS,
    setup: async (h) => ({
      path: `/api/v1/service-accounts/${await sa(h)}`,
      body: { name: 'renamed' },
    }),
  },
  {
    route: 'POST /api/v1/service-accounts/:id/rotate',
    allowed: ADMINS,
    setup: async (h) => ({ path: `/api/v1/service-accounts/${await sa(h)}/rotate` }),
  },
  {
    route: 'DELETE /api/v1/service-accounts/:id',
    allowed: ADMINS,
    setup: async (h) => ({ path: `/api/v1/service-accounts/${await sa(h)}` }),
  },

  // ---- Dự án ----
  { route: 'GET /api/v1/projects', allowed: ORG_MEMBERS },
  {
    route: 'POST /api/v1/projects',
    allowed: ADMINS,
    body: () => ({
      key: `K${uniq()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, 'X')}`.slice(0, 9),
      name: 'New',
    }),
  },
  {
    route: 'GET /api/v1/projects/:projectId',
    allowed: PROJECT_MEMBERS,
    path: (h) => `/api/v1/projects/${h.projectId}`,
  },
  {
    route: 'PATCH /api/v1/projects/:projectId',
    allowed: LEADS,
    path: (h) => `/api/v1/projects/${h.projectId}`,
    body: () => ({ description: 'd' }),
  },
  {
    route: 'POST /api/v1/projects/:projectId/archive',
    allowed: ADMINS,
    setup: async (h) => ({ path: `/api/v1/projects/${await h.freshProject()}/archive` }),
  },
  {
    route: 'POST /api/v1/projects/:projectId/unarchive',
    allowed: ADMINS,
    setup: async (h) => ({ path: `/api/v1/projects/${await h.freshProject()}/unarchive` }),
  },
  {
    route: 'GET /api/v1/projects/:projectId/members',
    allowed: PROJECT_MEMBERS,
    path: (h) => `/api/v1/projects/${h.projectId}/members`,
  },
  {
    route: 'POST /api/v1/projects/:projectId/members',
    allowed: LEADS,
    setup: async (h) => ({
      path: `/api/v1/projects/${await h.freshProject()}/members`,
      body: { userId: h.users.OUTSIDER, role: 'VIEWER' },
    }),
  },
  {
    route: 'PATCH /api/v1/projects/:projectId/members/:userId',
    allowed: LEADS,
    setup: async (h) => ({
      path: `/api/v1/projects/${await projectWithOutsider(h)}/members/${h.users.OUTSIDER}`,
      body: { role: 'DEVELOPER' },
    }),
  },
  {
    route: 'DELETE /api/v1/projects/:projectId/members/:userId',
    allowed: LEADS,
    setup: async (h) => ({
      path: `/api/v1/projects/${await projectWithOutsider(h)}/members/${h.users.OUTSIDER}`,
    }),
  },

  // ---- Môi trường ----
  {
    route: 'GET /api/v1/projects/:projectId/environments',
    allowed: PROJECT_MEMBERS,
    path: (h) => `/api/v1/projects/${h.projectId}/environments`,
  },
  {
    route: 'POST /api/v1/projects/:projectId/environments',
    allowed: LEADS,
    path: (h) => `/api/v1/projects/${h.projectId}/environments`,
    body: () => ({ name: `dev-${uniq()}`, kind: 'DEV', webBaseUrl: 'https://dev.example.vn' }),
  },
  {
    route: 'POST /api/v1/projects/:projectId/environments',
    name: 'tạo môi trường PRODUCTION cần Admin',
    allowed: ADMINS,
    path: (h) => `/api/v1/projects/${h.projectId}/environments`,
    body: () => ({ name: `prod-${uniq()}`, kind: 'PRODUCTION' }),
  },
  {
    route: 'GET /api/v1/environments/:envId',
    allowed: PROJECT_MEMBERS,
    setup: async (h) => ({ path: `/api/v1/environments/${await env(h)}` }),
  },
  {
    route: 'PATCH /api/v1/environments/:envId',
    allowed: LEADS,
    setup: async (h) => ({
      path: `/api/v1/environments/${await env(h)}`,
      body: { isActive: false },
    }),
  },
  {
    route: 'PATCH /api/v1/environments/:envId',
    name: 'đổi kind sang PRODUCTION cần Admin',
    allowed: ADMINS,
    setup: async (h) => ({
      path: `/api/v1/environments/${await env(h)}`,
      body: { kind: 'PRODUCTION' },
    }),
  },
  {
    route: 'DELETE /api/v1/environments/:envId',
    allowed: ADMINS,
    setup: async (h) => ({ path: `/api/v1/environments/${await env(h)}` }),
  },
  {
    route: 'PATCH /api/v1/environments/:envId/testing',
    allowed: LEADS,
    setup: async (h) => ({
      path: `/api/v1/environments/${await env(h)}/testing`,
      body: { enabled: false, reason: 'bảo trì định kỳ' },
    }),
  },
  {
    route: 'PATCH /api/v1/environments/:envId/testing',
    name: 'bật/tắt test PRODUCTION cần Admin',
    allowed: ADMINS,
    setup: async (h) => ({
      path: `/api/v1/environments/${await env(h, 'PRODUCTION')}/testing`,
      body: { enabled: false, reason: 'bảo trì định kỳ' },
    }),
  },
  {
    route: 'GET /api/v1/environments/:envId/variables',
    allowed: PROJECT_MEMBERS,
    setup: async (h) => ({ path: `/api/v1/environments/${await env(h)}/variables` }),
  },
  {
    route: 'PUT /api/v1/environments/:envId/variables',
    allowed: LEADS,
    setup: async (h) => ({
      path: `/api/v1/environments/${await env(h)}/variables`,
      body: [{ key: 'tenant', value: 'acme' }],
    }),
  },
  {
    route: 'GET /api/v1/environments/:envId/credentials',
    allowed: PROJECT_MEMBERS,
    setup: async (h) => ({ path: `/api/v1/environments/${await env(h)}/credentials` }),
  },
  {
    route: 'POST /api/v1/environments/:envId/credentials',
    allowed: LEADS,
    setup: async (h) => ({
      path: `/api/v1/environments/${await env(h)}/credentials`,
      body: { roleName: 'admin', username: 'admin@x.vn', password: 'p@ss' },
    }),
  },
  {
    route: 'PATCH /api/v1/environments/:envId/credentials/:id',
    allowed: LEADS,
    setup: async (h) => {
      const e = await env(h);
      const c = await ok(
        await h.owner('POST', `/api/v1/environments/${e}/credentials`, {
          roleName: 'staff',
          username: 'u',
          password: 'p',
        }),
        'cred',
      );
      return {
        path: `/api/v1/environments/${e}/credentials/${c.id}`,
        body: { password: 'new-pass' },
      };
    },
  },
  {
    route: 'DELETE /api/v1/environments/:envId/credentials/:id',
    allowed: LEADS,
    setup: async (h) => {
      const e = await env(h);
      const c = await ok(
        await h.owner('POST', `/api/v1/environments/${e}/credentials`, {
          roleName: 'guest',
          username: 'u',
          password: 'p',
        }),
        'cred',
      );
      return { path: `/api/v1/environments/${e}/credentials/${c.id}` };
    },
  },

  // ---- Secret ----
  {
    route: 'GET /api/v1/secrets',
    allowed: LEADS,
    path: (h) => `/api/v1/secrets?projectId=${h.projectId}`,
  },
  {
    route: 'GET /api/v1/secrets',
    name: 'secret cấp tổ chức',
    allowed: LEADS,
    path: () => '/api/v1/secrets',
  },
  {
    route: 'POST /api/v1/secrets',
    allowed: LEADS,
    body: (h) => ({ name: `s${uniq()}`, value: 'v', projectId: h.projectId }),
  },
  {
    route: 'POST /api/v1/secrets',
    name: 'secret cấp tổ chức cần Admin',
    allowed: ADMINS,
    body: () => ({ name: `o${uniq()}`, value: 'v' }),
  },
  {
    route: 'PUT /api/v1/secrets/:id',
    allowed: LEADS,
    setup: async (h) => {
      const s = await ok(
        await h.owner('POST', '/api/v1/secrets', {
          name: `s${uniq()}`,
          value: 'v',
          projectId: h.projectId,
        }),
        'secret',
      );
      return { path: `/api/v1/secrets/${s.id}`, body: { value: 'rotated' } };
    },
  },
  {
    route: 'DELETE /api/v1/secrets/:id',
    allowed: ADMINS,
    setup: async (h) => {
      const s = await ok(
        await h.owner('POST', '/api/v1/secrets', {
          name: `s${uniq()}`,
          value: 'v',
          projectId: h.projectId,
        }),
        'secret',
      );
      return { path: `/api/v1/secrets/${s.id}` };
    },
  },

  // ---- Allowlist ----
  { route: 'GET /api/v1/targets', allowed: ORG_MEMBERS },
  {
    route: 'POST /api/v1/targets',
    allowed: ADMINS,
    body: () => ({ hostPattern: `n${uniq()}.example.vn`, verificationMethod: 'DNS_TXT' }),
  },
  {
    route: 'POST /api/v1/targets/:id/verify',
    allowed: ADMINS,
    setup: async (h) => ({ path: `/api/v1/targets/${await target(h)}/verify` }),
  },
  {
    route: 'POST /api/v1/targets/:id/approve',
    allowed: ADMINS,
    setup: async (h) => ({
      path: `/api/v1/targets/${await target(h, 'ADMIN_APPROVAL')}/approve`,
      body: { reason: 'staging nội bộ công ty' },
    }),
  },
  {
    route: 'DELETE /api/v1/targets/:id',
    allowed: ADMINS,
    setup: async (h) => ({ path: `/api/v1/targets/${await target(h)}` }),
  },

  // ---- Audit ----
  { route: 'GET /api/v1/audit-logs', allowed: ADMINS },
  { route: 'GET /api/v1/audit-logs/export', allowed: ['OWNER'] },
];

/** Route công khai: không cần đăng nhập, không nằm trong ma trận */
export const PUBLIC_ROUTES = new Set([
  'GET /api/v1/setup',
  'POST /api/v1/setup',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  'GET /health/live',
  'GET /health/ready',
]);
