import { AppError, type ErrorDetail } from './app-error';

// Lỗi chuẩn theo docs/05 §1.1
export const notFound = (what = 'Tài nguyên') =>
  new AppError('NOT_FOUND', 404, `${what} không tồn tại`);
export const forbidden = (msg = 'Không có quyền thực hiện thao tác này') =>
  new AppError('FORBIDDEN', 403, msg);
export const unauthenticated = (msg = 'Chưa đăng nhập hoặc phiên đã hết hạn') =>
  new AppError('UNAUTHENTICATED', 401, msg);
export const conflict = (msg: string, details?: ErrorDetail[]) =>
  new AppError('CONFLICT', 409, msg, details);
export const invalidState = (msg: string, details?: ErrorDetail[]) =>
  new AppError('INVALID_STATE', 409, msg, details);
export const validationFailed = (msg: string, details?: ErrorDetail[]) =>
  new AppError('VALIDATION_FAILED', 400, msg, details);

/** Lỗi unique của Postgres (23505) → 409 CONFLICT */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}
