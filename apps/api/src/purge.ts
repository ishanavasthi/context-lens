import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';
import { connectionConfig, describeTarget, loadRootEnv } from '@contextlens/db';
import { DEFAULT_RETENTION_DAYS } from '@contextlens/shared';
import { loadConfig } from './config.js';
import { purgeExpired } from './repo/privacy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(join(__dirname, '..', '..', '..', '.env'));
} catch {
  // No .env present. Real environments supply configuration directly.
}
loadRootEnv();

const config = loadConfig();
const retentionDays = process.argv[2] ? Number(process.argv[2]) : DEFAULT_RETENTION_DAYS;
if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
  console.error('retentionDays must be a positive integer');
  process.exit(1);
}

const pool = new Pool(connectionConfig(config.DATABASE_URL));
console.log(
  JSON.stringify({ level: 'info', msg: 'purge target', target: describeTarget(config.DATABASE_URL), retentionDays }),
);

try {
  const removed = await purgeExpired(pool, retentionDays);
  console.log(JSON.stringify({ level: 'info', msg: 'purge complete', removed }));
} finally {
  await pool.end();
}
