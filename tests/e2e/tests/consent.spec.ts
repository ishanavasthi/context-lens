import { INDICATOR, STORAGE_KEYS, type ConsentState } from '@contextlens/shared';
import { test, expect } from '../fixtures/extension.js';

const FIXTURE = 'http://localhost:5599/click-target.html';
const API_BATCH_URL = 'http://localhost:8787/v1/events:batch';

async function setConsent(
  serviceWorker: import('@playwright/test').Worker,
  granted: ConsentState['granted'],
  paused = false,
): Promise<void> {
  const state: ConsentState = { granted, onboarded: true, paused, updatedAt: 0 };
  await serviceWorker.evaluate(
    ({ key, value }) => chrome.storage.local.set({ [key]: value }),
    { key: STORAGE_KEYS.consent, value: state },
  );
}

async function setDenyList(
  serviceWorker: import('@playwright/test').Worker,
  patterns: string[],
): Promise<void> {
  await serviceWorker.evaluate(
    ({ key, value }) => chrome.storage.local.set({ [key]: value }),
    { key: STORAGE_KEYS.denyList, value: patterns },
  );
}

test('with no consent granted, 10 clicks queue nothing and reach the network never', async ({
  context,
  serviceWorker,
}) => {
  let requestCount = 0;
  await context.route(API_BATCH_URL, (route) => {
    requestCount += 1;
    void route.abort();
  });

  await setConsent(serviceWorker, []);

  const page = await context.newPage();
  await page.goto(FIXTURE, { waitUntil: 'load' });
  for (let i = 0; i < 10; i += 1) {
    await page.click('[data-testid="click-target"]');
  }
  await page.waitForTimeout(3_000);
  await serviceWorker.evaluate(() => globalThis.__contextlens.flushNow());

  const queued = await serviceWorker.evaluate(() => globalThis.__contextlens.queueSize());
  expect(queued).toBe(0);
  expect(requestCount).toBe(0);
});

test('granting the interaction scope starts capture within one second, without a reload', async ({
  context,
  serviceWorker,
}) => {
  await setConsent(serviceWorker, []);

  const page = await context.newPage();
  await page.goto(FIXTURE, { waitUntil: 'load' });

  await setConsent(serviceWorker, ['interaction']);
  await page.waitForTimeout(1_000);

  await page.click('[data-testid="click-target"]');

  await expect
    .poll(async () => serviceWorker.evaluate(() => globalThis.__contextlens.queueSize()), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
});

test('the in page indicator is visible while recording, with the recording colour', async ({
  context,
  serviceWorker,
}) => {
  await setConsent(serviceWorker, ['interaction']);

  const page = await context.newPage();
  await page.goto(FIXTURE, { waitUntil: 'load' });

  const indicator = page.getByTestId(INDICATOR.testId);
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveCSS('background-color', INDICATOR.activeColor);
});

test('pausing switches the indicator colour and stops new events from being queued', async ({
  context,
  serviceWorker,
}) => {
  await setConsent(serviceWorker, ['interaction']);

  const page = await context.newPage();
  await page.goto(FIXTURE, { waitUntil: 'load' });

  const indicator = page.getByTestId(INDICATOR.testId);
  await expect(indicator).toHaveCSS('background-color', INDICATOR.activeColor);

  await setConsent(serviceWorker, ['interaction'], true);
  await expect(indicator).toHaveCSS('background-color', INDICATOR.pausedColor);

  const before = await serviceWorker.evaluate(() => globalThis.__contextlens.queueSize());
  await page.click('[data-testid="click-target"]');
  await page.waitForTimeout(3_000);
  const after = await serviceWorker.evaluate(() => globalThis.__contextlens.queueSize());
  expect(after).toBe(before);
});

test('on a denied host, no indicator is present and no events are queued even with consent granted', async ({
  context,
  serviceWorker,
}) => {
  await setDenyList(serviceWorker, ['localhost']);
  await setConsent(serviceWorker, ['interaction']);

  const page = await context.newPage();
  await page.goto(FIXTURE, { waitUntil: 'load' });

  const indicator = page.getByTestId(INDICATOR.testId);
  await expect(indicator).toHaveCount(0);

  await page.click('[data-testid="click-target"]');
  await page.waitForTimeout(3_000);

  const queued = await serviceWorker.evaluate(() => globalThis.__contextlens.queueSize());
  expect(queued).toBe(0);
});
