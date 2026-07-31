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
    rollupOptions: {
      // Pages reachable only as web accessible resources are not discovered from the
      // manifest the way the popup and options pages are, so without declaring them here
      // Vite copies the HTML verbatim and its script tag still points at the TypeScript
      // source. The page then loads and renders nothing, with no build error at all.
      input: {
        timeline: path.resolve(import.meta.dirname, 'src/timeline/index.html'),
        transparency: path.resolve(import.meta.dirname, 'src/transparency/index.html'),
      },
    },
  },
});
