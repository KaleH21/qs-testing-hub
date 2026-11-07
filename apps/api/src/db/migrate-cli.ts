import { loadEnv } from '../config/env';
import { runMigrations } from './migrate';

const env = loadEnv();
runMigrations(env.DATABASE_MIGRATOR_URL ?? env.DATABASE_URL)
  .then(() => console.log('Migration xong'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
