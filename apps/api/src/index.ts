import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from '@hono/node-server';
import { Pool } from 'pg';
import { connectionConfig, describeTarget } from '@contextlens/db';
import { loadConfig } from './config.js';
import { createApp } from './app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the repo root .env before reading config. Without this DATABASE_URL is
// undefined and pg silently falls back to its own defaults (localhost:5432),
// which surfaces much later as a connection refused on the first query rather
// than as a configuration error at boot.
try {
  process.loadEnvFile(join(__dirname, '..', '..', '..', '.env'));
} catch {
  // No .env present. Real environments supply configuration directly.
}
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')) as {
  version: string;
};

const config = loadConfig();
// TLS is required by hosted providers and unavailable on the local Docker instance,
// so the mode is derived from the host rather than hand configured per environment.
const pool = new Pool(connectionConfig(config.DATABASE_URL));
console.log(JSON.stringify({ level: 'info', msg: 'database target', target: describeTarget(config.DATABASE_URL) }));
const app = createApp(config, pkg.version, pool);

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(
    JSON.stringify({
      level: 'info',
      time: new Date().toISOString(),
      msg: 'server started',
      requestId: 'boot',
      port: info.port,
      nodeEnv: config.NODE_ENV,
    })
  );
});
