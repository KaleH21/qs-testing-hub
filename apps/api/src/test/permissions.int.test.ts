import { afterAll, beforeAll, expect, it } from 'vitest';
import { ACTORS, createHarness, describeDb, type Harness } from './harness';
import { MATRIX, PUBLIC_ROUTES } from './permissions.matrix';

/** Lấy danh sách route Nest đã đăng ký trên Express */
function registeredRoutes(h: Harness): string[] {
  const instance = h.app.getHttpAdapter().getInstance() as {
    router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> };
  };
  return instance.router.stack.flatMap((l) =>
    // bỏ route bắt-tất-cả của Nest (404 theo prefix, exclude health): path chứa {...}
    l.route && !l.route.path.includes('{')
      ? Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route!.path}`)
      : [],
  );
}

const DENIED = [401, 403, 404];

describeDb('Ma trận quyền (docs/09 §2)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  }, 60_000);
  afterAll(() => h?.close());

  it('mọi route có trong bảng kỳ vọng (route mới chưa khai báo → fail)', () => {
    const declared = new Set(MATRIX.map((r) => r.route));
    const missing = registeredRoutes(h).filter((r) => !declared.has(r) && !PUBLIC_ROUTES.has(r));
    expect(missing).toEqual([]);
    const stale = [...declared].filter((r) => !registeredRoutes(h).includes(r));
    expect(stale).toEqual([]);
  });

  it('không có token → 401 ở mọi route cần đăng nhập', async () => {
    const supertest = (await import('supertest')).default;
    for (const route of new Set(MATRIX.map((r) => r.route))) {
      const [method, path] = route.split(' ') as [string, string];
      const url = path.replace(/:[A-Za-z]+/g, '1');
      const res = await (
        supertest(h.app.getHttpServer()) as unknown as Record<
          string,
          (p: string) => Promise<{ status: number }>
        >
      )[method.toLowerCase()]!(url);
      expect(res.status, route).toBe(401);
    }
  });

  for (const row of MATRIX) {
    it(`${row.route}${row.name ? ` (${row.name})` : ''}`, async () => {
      const failures: string[] = [];
      for (const actor of ACTORS) {
        const s = row.setup ? await row.setup(h, actor) : {};
        const [method, routePath] = row.route.split(' ') as [string, string];
        const path = s.path ?? row.path?.(h) ?? routePath;
        const body = s.body ?? row.body?.(h);
        const res = await h.call(s.token ? { token: s.token } : actor, method, path, body);
        const allowed = row.allowed.includes(actor);
        if (allowed && DENIED.includes(res.status)) {
          failures.push(
            `${actor}: mong được phép, nhận ${res.status} ${JSON.stringify(res.body?.error ?? '')}`,
          );
        }
        if (!allowed && !DENIED.includes(res.status)) {
          failures.push(`${actor}: mong bị chặn, nhận ${res.status}`);
        }
        if (!allowed && actor === 'OTHER_ORG' && res.status === 403) {
          failures.push('OTHER_ORG: phải là 404 (không lộ dữ liệu tổ chức khác), nhận 403');
        }
      }
      expect(failures).toEqual([]);
    }, 60_000);
  }
});
