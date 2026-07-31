import path from 'node:path';
import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config.js';

export default defineConfig({
  // Read env from the repo root so a single .env serves the API, the database and
  // the extension. Without this, Vite looks only inside apps/extension and every
  // VITE_ variable documented in .env.example is silently undefined at build time.
  envDir: path.resolve(import.meta.dirname, '../..'),
  plugins: [crx({ manifest })],
  build: {
    outDir: 'dist',
  },
});
