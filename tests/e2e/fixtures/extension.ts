import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';

const EXT = path.resolve(import.meta.dirname, '../../../apps/extension/dist');

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
}>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextlens-e2e-'));
    const args = [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`];
    if (process.env.HEADLESS !== 'false') args.push('--headless=new');
    const context = await chromium.launchPersistentContext(userDataDir, { headless: false, args });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },
  extensionId: async ({ serviceWorker }, use) => {
    const extensionId = new URL(serviceWorker.url()).host;
    await use(extensionId);
  },
});

export const expect = test.expect;
