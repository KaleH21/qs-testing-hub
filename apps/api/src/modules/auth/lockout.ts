import { MAX_FAILED_BEFORE_LOCK } from './auth.constants';

const BASE_MINUTES = 15;
const MAX_MINUTES = 24 * 60;

/**
 * docs/09 §3: 5 lần sai liên tiếp → khóa 15 phút, mỗi lần khóa sau ×2, tối đa 24 h.
 * Đếm sai không reset khi hết khóa (chỉ reset khi đăng nhập đúng) nên lần khóa thứ n
 * xảy ra ở lần sai thứ 5n. Trả 0 nếu lần sai này chưa đến ngưỡng khóa.
 */
export function lockMinutes(failedCount: number): number {
  if (failedCount <= 0 || failedCount % MAX_FAILED_BEFORE_LOCK !== 0) return 0;
  const nth = failedCount / MAX_FAILED_BEFORE_LOCK;
  return Math.min(BASE_MINUTES * 2 ** (nth - 1), MAX_MINUTES);
}
