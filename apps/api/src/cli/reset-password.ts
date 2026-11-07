// pnpm hub:reset-password --email you@company.vn
// Kiểu Cá nhân không gửi email (D-32): đặt mật khẩu tạm, mở khóa, thu hồi mọi phiên, ghi audit.
import { and, eq, isNull } from 'drizzle-orm';
import { emailSchema } from '@qah/validation';
import { auditLogs, refreshTokens, users } from '../db/schema';
import { hashPassword, temporaryPassword } from '../modules/auth/crypto';
import { args, run, withDb } from './cli';

run(async () => {
  const email = emailSchema.parse(args({ email: { type: 'string' } }).email);
  const password = temporaryPassword();
  await withDb(async (db) => {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) throw new Error(`Không có tài khoản ${email}`);
    const passwordHash = await hashPassword(password);
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, failedLoginCount: 0, lockedUntil: null, status: 'ACTIVE' })
        .where(eq(users.id, user.id));
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
      await tx.insert(auditLogs).values({
        actorUserId: user.id,
        action: 'auth.password_reset_cli',
        entityType: 'user',
        entityId: user.id,
      });
    });
  });
  console.log(
    `Đã đặt lại mật khẩu cho ${email}\nMật khẩu tạm (chỉ hiện 1 lần, đổi ngay sau khi đăng nhập): ${password}`,
  );
});
