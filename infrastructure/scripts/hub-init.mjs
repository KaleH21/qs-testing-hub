#!/usr/bin/env node
// pnpm hub:init — chuẩn bị .env và khóa cho kiểu cài Cá nhân (docs/13 §5.1).
// Chỉ thêm giá trị còn thiếu hoặc còn CHANGE_ME; không bao giờ ghi đè giá trị đã có.
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envPath = path.join(root, '.env');
const secretsDir = path.join(root, 'secrets');
const masterKeyPath = path.join(secretsDir, 'qahub_master_key');

if (!existsSync(envPath)) {
  copyFileSync(path.join(root, '.env.example'), envPath);
  console.log('Đã tạo .env từ .env.example');
}

mkdirSync(secretsDir, { recursive: true });
if (!existsSync(masterKeyPath)) {
  writeFileSync(masterKeyPath, randomBytes(32).toString('base64') + '\n', { mode: 0o600 });
  try {
    chmodSync(masterKeyPath, 0o600);
  } catch {
    // Windows: bỏ qua chmod
  }
  console.log(`Đã sinh master key: ${masterKeyPath}`);
}

const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
const get = (k) =>
  lines
    .find((l) => l.startsWith(`${k}=`))
    ?.slice(k.length + 1)
    .split('#')[0]
    .trim();
const set = (k, v) => {
  const i = lines.findIndex((l) => l.startsWith(`${k}=`));
  if (i >= 0) lines[i] = `${k}=${v}`;
  else lines.push(`${k}=${v}`);
  console.log(`  ${k} đã được điền`);
};
const missing = (k) => !get(k) || get(k).startsWith('CHANGE_ME');

const random = (n) => randomBytes(n).toString('base64url');
if (missing('JWT_SECRET')) set('JWT_SECRET', random(48));
if (missing('SECRETS_MASTER_KEY_FILE') && !get('SECRETS_MASTER_KEY') && !get('SECRETS_KEYS')) {
  set('SECRETS_MASTER_KEY_FILE', masterKeyPath.replace(/\\/g, '/'));
}
if (missing('DEPLOYMENT_MODE')) set('DEPLOYMENT_MODE', 'personal');
if (missing('HUB_BIND_ADDRESS')) set('HUB_BIND_ADDRESS', '127.0.0.1');
for (const k of ['POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'S3_SECRET_KEY'])
  if (missing(k)) set(k, random(18));

writeFileSync(envPath, lines.join('\n'));
console.log(
  '\nXong. Lưu bản sao thư mục ./secrets ra nơi an toàn: mất master key = mất mọi secret trong vault.',
);
