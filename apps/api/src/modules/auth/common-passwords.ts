import { readFileSync } from 'node:fs';
import path from 'node:path';

// SecLists 100k-most-used-passwords-NCSC.txt (MIT), chỉ giữ mục ≥ 10 ký tự (ngắn hơn đã bị chặn
// bởi độ dài tối thiểu, docs/09 §3) + vài mật khẩu hay gặp theo ngữ cảnh công ty.
export const COMMON_PASSWORDS = new Set(
  readFileSync(path.join(__dirname, 'common-passwords.txt'), 'utf8').split('\n').filter(Boolean),
);
