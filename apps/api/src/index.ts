import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from '@hono/node-server';
import { Pool } from 'pg';
import { loadConfig } from './config.js';
import { createApp } from './app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')) as {
  version: string;
};

const config = loadConfig();
const pool = new Pool({ connectionString: config.DATABASE_URL });
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
