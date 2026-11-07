// pnpm hub:backup [--out ./backups]
// Sao lưu kiểu Cá nhân (docs/13 §4.1): pg_dump định dạng custom ra 1 file.
// shortcut: chưa gồm artifact MinIO vì Phase 1 chưa có artifact; thêm `mc mirror` ở Phase 2 khi có artifact.
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import '../config/env';
import { args, run } from './cli';

run(async () => {
  const url = process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Thiếu DATABASE_URL');
  const outDir = path.resolve(
    args({ out: { type: 'string' } }).out ?? path.resolve(__dirname, '../../../../backups'),
  );
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `qahub-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
  const pgDump = process.env.PG_DUMP ?? 'pg_dump';
  const res = spawnSync(pgDump, ['--format=custom', '--no-owner', `--file=${file}`, url], {
    stdio: 'inherit',
  });
  if (res.error)
    throw new Error(
      `Không chạy được ${pgDump}: ${res.error.message}. Đặt biến PG_DUMP trỏ tới pg_dump`,
    );
  if (res.status !== 0) throw new Error(`pg_dump thoát với mã ${res.status}`);
  console.log(`Đã sao lưu: ${file} (${Math.round(statSync(file).size / 1024)} KB)`);
  console.log('Khôi phục: pg_restore --clean --if-exists --no-owner -d <DATABASE_URL> <file>');
});
