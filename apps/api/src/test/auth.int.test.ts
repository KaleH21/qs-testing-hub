import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHarness, describeDb, type Harness } from './harness';

const cookieOf = (res: request.Response, name: string) => {
  const raw = ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith(`${name}=`));
  return raw?.split(';')[0]!.slice(name.length + 1);
};

describeDb('Auth (docs/09 §3)', () => {
  let h: Harness;
  let agent: ReturnType<typeof request>;
  beforeAll(async () => {
    h = await createHarness();
    await h.sql`delete from audit_logs`;
    agent = request(h.app.getHttpServer());
  }, 60_000);
  afterAll(() => h?.close());

  it('setup lần đầu chỉ chạy khi DB chưa có user', async () => {
    const status = await agent.get('/api/v1/setup');
    expect(status.body.needsSetup).toBe(false); // harness đã seed user
    const res = await agent.post('/api/v1/setup').send({
      email: 'late@test.vn',
      password: 'a-very-long-password',
      displayName: 'Late',
      organizationName: 'Late Org',
    });
    expect(res.status).toBe(409);
  });

  it('đăng nhập, xoay vòng refresh, phát hiện dùng lại token → thu hồi cả phiên', async () => {
    const email = 'login@test.vn';
    const added = await h.owner('POST', `/api/v1/organizations/${h.orgId}/members`, {
      email,
      displayName: 'L',
      role: 'TESTER',
    });
    const password = added.body.temporaryPassword as string;
    expect(password).toBeTruthy();

    const login = await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);
    const rt1 = cookieOf(login, 'qah_rt')!;
    const csrf = cookieOf(login, 'qah_csrf')!;
    expect(login.headers['set-cookie']!.toString()).toMatch(/qah_rt=.*HttpOnly.*SameSite=Strict/i);

    // thiếu CSRF → 403
    await agent
      .post('/api/v1/auth/refresh')
      .set('Cookie', `qah_rt=${rt1}; qah_csrf=${csrf}`)
      .expect(403);

    const r2 = await agent
      .post('/api/v1/auth/refresh')
      .set('Cookie', `qah_rt=${rt1}; qah_csrf=${csrf}`)
      .set('X-CSRF-Token', csrf)
      .expect(200);
    const access2 = r2.body.accessToken as string;
    await h.call({ token: access2 }, 'GET', '/api/v1/auth/me').expect(200);

    // dùng lại rt1 (đã bị thay) → TOKEN_REUSED và access token của phiên mất hiệu lực ngay
    const reuse = await agent
      .post('/api/v1/auth/refresh')
      .set('Cookie', `qah_rt=${rt1}; qah_csrf=${csrf}`)
      .set('X-CSRF-Token', csrf);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('TOKEN_REUSED');
    await h.call({ token: access2 }, 'GET', '/api/v1/auth/me').expect(401);

    const [audit] =
      await h.sql`select count(*)::int as n from audit_logs where action = 'auth.refresh_reuse'`;
    expect(audit!.n).toBe(1);
  });

  it('5 lần sai liên tiếp → khóa 15 phút, kể cả mật khẩu đúng; thông báo lỗi chung', async () => {
    const email = 'lock@test.vn';
    const added = await h.owner('POST', `/api/v1/organizations/${h.orgId}/members`, {
      email,
      displayName: 'K',
      role: 'TESTER',
    });
    for (let i = 0; i < 5; i++) {
      const r = await agent.post('/api/v1/auth/login').send({ email, password: 'wrong' });
      expect(r.status).toBe(401);
      expect(r.body.error.message).toBe('Email hoặc mật khẩu không đúng');
    }
    await agent
      .post('/api/v1/auth/login')
      .send({ email, password: added.body.temporaryPassword })
      .expect(401);
    const [u] =
      await h.sql`select locked_until > now() + interval '14 minutes' as locked from users where email = ${email}`;
    expect(u!.locked).toBe(true);
    // email không tồn tại cũng trả đúng thông báo đó
    const ghost = await agent
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@test.vn', password: 'x' });
    expect(ghost.body.error.message).toBe('Email hoặc mật khẩu không đúng');
  });

  it('đổi mật khẩu: chặn mật khẩu phổ biến, thu hồi các phiên khác, giữ phiên hiện tại', async () => {
    const email = 'pw@test.vn';
    const added = await h.owner('POST', `/api/v1/organizations/${h.orgId}/members`, {
      email,
      displayName: 'P',
      role: 'TESTER',
    });
    const pw = added.body.temporaryPassword as string;
    const a = (await agent.post('/api/v1/auth/login').send({ email, password: pw })).body
      .accessToken;
    const b = (await agent.post('/api/v1/auth/login').send({ email, password: pw })).body
      .accessToken;

    const weak = await h.call({ token: a }, 'POST', '/api/v1/auth/change-password', {
      currentPassword: pw,
      newPassword: '1234567890',
    });
    expect(weak.status).toBe(400);

    await h
      .call({ token: a }, 'POST', '/api/v1/auth/change-password', {
        currentPassword: pw,
        newPassword: 'mot-mat-khau-moi-dai',
      })
      .expect(204);
    await h.call({ token: a }, 'GET', '/api/v1/auth/me').expect(200);
    await h.call({ token: b }, 'GET', '/api/v1/auth/me').expect(401);
  });

  it('logout làm access token mất hiệu lực ngay', async () => {
    const token = await h.issueToken(h.users.VIEWER);
    await h.call({ token }, 'POST', '/api/v1/auth/logout').expect(204);
    await h.call({ token }, 'GET', '/api/v1/auth/me').expect(401);
  });

  it('/auth/me trả tổ chức, role và role theo dự án (cho useCan ở frontend)', async () => {
    const me = await h.call('QA_LEAD', 'GET', '/api/v1/auth/me').expect(200);
    const org = me.body.organizations.find((o: { id: number }) => o.id === h.orgId);
    expect(org.role).toBe('QA_LEAD');
    expect(org.projects).toContainEqual({ projectId: h.projectId, role: 'QA_LEAD' });
  });

  it('service account bị thu hồi không dùng được nữa', async () => {
    const created = await h
      .owner('POST', '/api/v1/service-accounts', { name: 'tmp', scopes: ['runs:read'] })
      .expect(201);
    const token = created.body.token as string;
    expect(token).toMatch(/^qah_[A-Za-z0-9]{8}_/);
    // token SA hợp lệ: được xác thực (403 vì Phase 1 chưa có route cho SA), không phải 401
    await h.call({ token }, 'GET', '/api/v1/projects').expect(403);
    await h.owner('DELETE', `/api/v1/service-accounts/${created.body.id}`).expect(204);
    await h.call({ token }, 'GET', '/api/v1/projects').expect(401);
    const list = await h.owner('GET', '/api/v1/service-accounts');
    expect(JSON.stringify(list.body)).not.toContain(token.split('_')[2]);
  });
});

describeDb('Setup lần đầu trên DB trống (D-32)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await h.sql`truncate users, organizations cascade`;
  }, 60_000);
  afterAll(() => h?.close());

  it('tạo Owner + tổ chức, bật allowLoopback ở kiểu Cá nhân, chỉ được 1 lần', async () => {
    const agent = request(h.app.getHttpServer());
    expect((await agent.get('/api/v1/setup')).body).toEqual({
      needsSetup: true,
      deploymentMode: 'personal',
    });
    const weak = await agent.post('/api/v1/setup').send({
      email: 'o@test.vn',
      password: 'password123',
      displayName: 'O',
      organizationName: 'Công ty QS',
    });
    expect(weak.status).toBe(400);
    const body = {
      email: 'Owner@Test.vn',
      password: 'mat-khau-rat-dai-va-la',
      displayName: 'Owner',
      organizationName: 'Công ty QS',
    };
    const [a, b] = await Promise.all([
      agent.post('/api/v1/setup').send(body),
      agent.post('/api/v1/setup').send(body),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const token = (a.status === 201 ? a : b).body.accessToken;
    const me = await h.call({ token }, 'GET', '/api/v1/auth/me').expect(200);
    expect(me.body.user.email).toBe('owner@test.vn');
    const org = me.body.organizations[0];
    expect(org).toMatchObject({ role: 'OWNER', slug: 'cong-ty-qs' });
    const detail = await h
      .call({ token }, 'GET', `/api/v1/organizations/${org.id}`)
      .set('X-Organization-Id', org.id);
    expect(detail.body.localNetwork.allowLoopback).toBe(true);
    expect(detail.body.productionTestingEnabled).toBe(false);
  });
});
