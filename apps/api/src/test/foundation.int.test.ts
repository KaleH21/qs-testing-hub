import { afterAll, beforeAll, expect, it } from 'vitest';
import { Vault } from '../modules/secrets/vault';
import { createHarness, describeDb, type Harness } from './harness';

describeDb('Tổ chức, môi trường, secret, allowlist', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  }, 60_000);
  afterAll(() => h?.close());

  const envs = (projectId = h.projectId) => `/api/v1/projects/${projectId}/environments`;

  it('production tắt mặc định ở cấp tổ chức; bật cần lý do và ghi audit trước/sau', async () => {
    const prod = await h
      .owner('POST', envs(), {
        name: 'Production',
        kind: 'PRODUCTION',
        webBaseUrl: 'https://shop.example.vn',
      })
      .expect(201);
    expect(prod.body.testingBlock).toMatchObject({
      code: 'PRODUCTION_TESTING_DISABLED',
      blockedBy: 'ORGANIZATION',
    });

    await h
      .owner('PATCH', `/api/v1/organizations/${h.orgId}/testing-switches`, {
        productionTesting: true,
        reason: 'ngắn',
      })
      .expect(400);
    await h
      .owner('PATCH', `/api/v1/organizations/${h.orgId}/testing-switches`, {
        productionTesting: true,
        reason: 'kiểm tra sau deploy 1.4.0',
      })
      .expect(200);
    expect(
      (await h.owner('GET', `/api/v1/environments/${prod.body.id}`)).body.testingBlock,
    ).toBeNull();

    // tắt ở cấp môi trường vẫn chặn dù tổ chức đã bật
    await h
      .owner('PATCH', `/api/v1/environments/${prod.body.id}/testing`, {
        enabled: false,
        reason: 'bảo trì cơ sở dữ liệu',
      })
      .expect(200);
    const off = await h.owner('GET', `/api/v1/environments/${prod.body.id}`);
    expect(off.body.testingBlock).toMatchObject({
      code: 'TESTING_DISABLED',
      blockedBy: 'ENVIRONMENT',
      reason: 'bảo trì cơ sở dữ liệu',
    });

    const [log] =
      await h.sql`select metadata from audit_logs where action = 'testing.switch' order by id desc limit 1`;
    expect(log!.metadata).toMatchObject({
      before: { productionTesting: false },
      after: { productionTesting: true },
      reason: 'kiểm tra sau deploy 1.4.0',
    });
    await h
      .owner('PATCH', `/api/v1/organizations/${h.orgId}/testing-switches`, {
        productionTesting: false,
        reason: 'tắt lại sau kiểm thử',
      })
      .expect(200);
  });

  it('môi trường LOCAL: localhost được phép ở kiểu Cá nhân, IP ngoài dải nội bộ bị chặn', async () => {
    await h
      .owner('POST', envs(), { name: 'Local', kind: 'LOCAL', webBaseUrl: 'http://localhost:3000' })
      .expect(201);
    await h
      .owner('POST', envs(), {
        name: 'Local LAN',
        kind: 'LOCAL',
        webBaseUrl: 'http://192.168.1.50:3000',
      })
      .expect(201);
    const denied = await h.owner('POST', envs(), {
      name: 'Local khác',
      kind: 'LOCAL',
      webBaseUrl: 'http://10.9.9.9:3000',
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('TARGET_NOT_ALLOWED');
    const metadata = await h.owner('POST', envs(), {
      name: 'Meta',
      kind: 'LOCAL',
      apiBaseUrl: 'http://169.254.169.254',
    });
    expect(metadata.body.error.code).toBe('TARGET_NOT_ALLOWED');
    // tắt allowLoopback → localhost bị chặn
    await h
      .owner('PUT', `/api/v1/organizations/${h.orgId}/local-network`, {
        allowedCidrs: ['192.168.1.0/24'],
        allowLoopback: false,
      })
      .expect(200);
    const noLoop = await h.owner('POST', envs(), {
      name: 'Local 2',
      kind: 'LOCAL',
      webBaseUrl: 'http://127.0.0.1:5173',
    });
    expect(noLoop.status).toBe(403);
    await h
      .owner('PUT', `/api/v1/organizations/${h.orgId}/local-network`, {
        allowedCidrs: ['169.254.0.0/16'],
        allowLoopback: true,
      })
      .expect(400);
    await h
      .owner('PUT', `/api/v1/organizations/${h.orgId}/local-network`, {
        allowedCidrs: ['192.168.1.0/24'],
        allowLoopback: true,
      })
      .expect(200);
  });

  it('secret: không bao giờ trả giá trị, DB chỉ có ciphertext, giải mã được bằng vault, chặn xóa khi đang dùng', async () => {
    const env = await h.owner('POST', envs(), { name: 'Staging', kind: 'STAGING' }).expect(201);
    const created = await h
      .call('QA_LEAD', 'POST', '/api/v1/secrets', {
        name: 'api_key',
        value: 'sk-very-secret',
        projectId: h.projectId,
      })
      .expect(201);
    expect(JSON.stringify(created.body)).not.toContain('sk-very-secret');
    const list = await h.call('QA_LEAD', 'GET', `/api/v1/secrets?projectId=${h.projectId}`);
    expect(JSON.stringify(list.body)).not.toContain('sk-very-secret');

    const [row] =
      await h.sql`select ciphertext, iv, auth_tag, key_version, organization_id, project_id from secrets where id = ${created.body.id}`;
    expect(Buffer.from(row!.ciphertext).toString()).not.toContain('sk-very-secret');
    const vault = new Vault([['v1', Buffer.alloc(32, 7)]]);
    const plain = vault.open(
      {
        ciphertext: Buffer.from(row!.ciphertext),
        iv: Buffer.from(row!.iv),
        authTag: Buffer.from(row!.auth_tag),
        keyVersion: row!.key_version,
      },
      Vault.aad(row!.organization_id, row!.project_id, 'api_key'),
    );
    expect(plain).toBe('sk-very-secret');

    await h
      .owner('PUT', `/api/v1/environments/${env.body.id}/variables`, [
        { key: 'API_KEY', secretId: created.body.id },
        { key: 'tenant', value: 'acme' },
      ])
      .expect(200);
    const vars = await h
      .call('VIEWER', 'GET', `/api/v1/environments/${env.body.id}/variables`)
      .expect(200);
    expect(vars.body.data).toContainEqual({
      key: 'API_KEY',
      secretId: created.body.id,
      masked: true,
    });

    const del = await h.owner('DELETE', `/api/v1/secrets/${created.body.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.details[0]).toMatchObject({
      type: 'environment_variable',
      key: 'API_KEY',
    });
  });

  it('tài khoản test: mật khẩu vào vault, API chỉ trả hasPassword', async () => {
    const env = await h.owner('POST', envs(), { name: 'Dev', kind: 'DEV' }).expect(201);
    const c = await h
      .owner('POST', `/api/v1/environments/${env.body.id}/credentials`, {
        roleName: 'admin',
        username: 'admin@shop.vn',
        password: 'Admin#2026',
      })
      .expect(201);
    expect(c.body).toMatchObject({ roleName: 'admin', hasPassword: true });
    const list = await h.call('TESTER', 'GET', `/api/v1/environments/${env.body.id}/credentials`);
    expect(JSON.stringify(list.body)).not.toContain('Admin#2026');
  });

  it('không xóa/hạ quyền được Owner cuối cùng; Admin không đụng được role Owner', async () => {
    const demote = await h.owner(
      'PATCH',
      `/api/v1/organizations/${h.orgId}/members/${h.users.OWNER}`,
      { role: 'ADMIN' },
    );
    expect(demote.status).toBe(409);
    const byAdmin = await h.call('ADMIN', 'POST', `/api/v1/organizations/${h.orgId}/members`, {
      email: 'boss@test.vn',
      displayName: 'B',
      role: 'OWNER',
    });
    expect(byAdmin.status).toBe(403);
  });

  it('allowlist: wildcard chỉ với DNS_TXT, private network bắt buộc CIDR, xác minh ghi hạn 30 ngày', async () => {
    await h
      .owner('POST', '/api/v1/targets', {
        hostPattern: '*.example.vn',
        verificationMethod: 'WELL_KNOWN_FILE',
      })
      .expect(400);
    await h
      .owner('POST', '/api/v1/targets', {
        hostPattern: 'stg.local.vn',
        verificationMethod: 'ADMIN_APPROVAL',
        allowPrivateNetwork: true,
      })
      .expect(400);
    const t = await h
      .owner('POST', '/api/v1/targets', {
        hostPattern: 'shop.example.vn',
        verificationMethod: 'DNS_TXT',
      })
      .expect(201);
    expect(t.body.instructions.dnsTxt.value).toBe(
      `qa-hub-verification=${t.body.verificationToken}`,
    );
    expect(t.body.status).toBe('PENDING');
    const v = await h.owner('POST', `/api/v1/targets/${t.body.id}/verify`).expect(200);
    expect(v.body.status).toBe('VERIFIED');
    const days = (new Date(v.body.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
    // danh sách không lộ token cho thành viên thường
    const list = await h.call('VIEWER', 'GET', '/api/v1/targets');
    expect(JSON.stringify(list.body)).not.toContain('verificationToken');
  });

  it('audit log: lọc theo action, phân trang cursor, xuất CSV chống formula injection', async () => {
    await h
      .owner('PATCH', `/api/v1/organizations/${h.orgId}`, { name: '=HYPERLINK("x")' })
      .expect(200);
    const page = await h.owner('GET', '/api/v1/audit-logs?limit=2').expect(200);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.nextCursor).toBeTruthy();
    const next = await h
      .owner('GET', `/api/v1/audit-logs?limit=2&cursor=${page.body.nextCursor}`)
      .expect(200);
    expect(next.body.data[0].id < page.body.data[1].id).toBe(true);
    const csv = await h.owner('GET', '/api/v1/audit-logs/export?action=org.update').expect(200);
    expect(csv.text).toContain('org.update');
    expect(csv.text).not.toMatch(/,=HYPERLINK/);
  });
});
