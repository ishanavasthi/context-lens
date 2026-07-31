import path from 'node:path';
import { defineConfig } from '@playwright/test';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

export default defineConfig({
  testDir: './tests',
  // The suite shares one Postgres instance, so tests run serially to keep
  // assertions about row counts deterministic.
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  webServer: [
    {
      command: 'npm run dev --workspace @contextlens/api',
      cwd: REPO_ROOT,
      url: 'http://localhost:8787/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'node fixtures/serve.js',
      url: 'http://localhost:5599/click-target.html',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
