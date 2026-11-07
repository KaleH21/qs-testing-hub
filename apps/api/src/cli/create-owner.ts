// pnpm hub:create-owner --email you@company.vn [--name "Tên"] [--org "Tên tổ chức"]
// Thay cho màn /setup khi cài bằng dòng lệnh. Chỉ chạy được khi chưa có user nào.
import { count } from 'drizzle-orm';
import { emailSchema } from '@qah/validation';
import { auditLogs, organizationMembers, organizations, users } from '../db/schema';
import { slugify } from '../modules/auth/auth.service';
import { hashPassword, temporaryPassword } from '../modules/auth/crypto';
import { args, run, withDb } from './cli';

run(async () => {
  const a = args({ email: { type: 'string' }, name: { type: 'string' }, org: { type: 'string' } });
  const email = emailSchema.parse(a.email);
  const password = temporaryPassword();
  await withDb(async (db) => {
    const [row] = await db.select({ n: count() }).from(users);
    if (row!.n > 0)
      throw new Error('Hub đã có tài khoản. Quên mật khẩu: pnpm hub:reset-password --email ...');
    const passwordHash = await hashPassword(password);
    await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email, displayName: a.name ?? email, passwordHash })
        .returning();
      const orgName = a.org ?? 'Tổ chức của tôi';
      const [org] = await tx
        .insert(organizations)
        .values({
          name: orgName,
          slug: slugify(orgName),
          createdBy: user!.id,
          settings: {
            localNetwork: {
              allowedCidrs: [],
              allowLoopback: (process.env.DEPLOYMENT_MODE ?? 'personal') === 'personal',
            },
          },
        })
        .returning();
      await tx
        .insert(organizationMembers)
        .values({ organizationId: org!.id, userId: user!.id, role: 'OWNER' });
      await tx.insert(auditLogs).values({
        organizationId: org!.id,
        actorUserId: user!.id,
        action: 'org.setup',
        entityType: 'organization',
        entityId: org!.id,
        metadata: { via: 'cli' },
      });
    });
  });
  console.log(
    `Đã tạo Owner ${email}\nMật khẩu tạm (chỉ hiện 1 lần, đổi ngay sau khi đăng nhập): ${password}`,
  );
});
