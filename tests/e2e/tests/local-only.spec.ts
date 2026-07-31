import { STORAGE_KEYS, type ConsentState, type PrivacySettings } from '@contextlens/shared';
import { test, expect } from '../fixtures/extension.js';

/**
 * Local only mode is the strongest promise this product makes: capture continues, but
 * nothing ever leaves the device. A promise like that cannot be verified by reading the
 * settings back, only by driving real activity and confirming the server never sees it.
 */

const API = 'http://localhost:8787';
const FIXTURE = 'http://localhost:5599/click-target.html';
const DEV_TOKEN = 'dev-device-token-0000000000000000';

const READ_QUEUE = async (): Promise<Array<{ event_id: string; type: string }>> => {
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const request = indexedDB.open('contextlens');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return await new Promise((resolve, reject) => {
    const all = db.transaction('events', 'readonly').objectStore('events').getAll();
    all.onsuccess = () => resolve(all.result as Array<{ event_id: string; type: string }>);
    all.onerror = () => reject(all.error);
  });
};

async function serverEventIds(): Promise<Set<string>> {
  const res = await fetch(`${API}/v1/events?limit=500`, {
    headers: { Authorization: `Bearer ${DEV_TOKEN}` },
  });
  if (!res.ok) throw new Error(`read failed: ${res.status}`);
  const body = (await res.json()) as { events: Array<{ event_id: string }> };
  return new Set(body.events.map((event) => event.event_id));
}

test('local only mode captures normally and never sends anything', async ({
  context,
  serviceWorker,
}) => {
  const worker = serviceWorker as unknown as {
    evaluate: <T>(fn: (a: { key: string; value: unknown }) => T, arg: unknown) => Promise<T>;
  };
  const write = async (key: string, value: unknown) =>
    worker.evaluate(({ key: k, value: v }) => chrome.storage.local.set({ [k]: v }), { key, value });

  const consent: ConsentState = {
    granted: ['interaction'],
    onboarded: true,
    paused: false,
    updatedAt: 0,
  };
  const settings: PrivacySettings = { localOnly: true, retentionDays: 30 };
  await write(STORAGE_KEYS.consent, consent);
  await write(STORAGE_KEYS.privacySettings, settings);

  const page = await context.newPage();
  await page.goto(FIXTURE, { waitUntil: 'load' });
  for (let index = 0; index < 4; index += 1) {
    await page.click('[data-testid="click-target"]');
  }

  // Capture must continue. Local only restricts delivery, not collection.
  await expect
    .poll(
      async () => (await serviceWorker.evaluate(READ_QUEUE)).filter((e) => e.type === 'click').length,
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(4);

  const queued = await serviceWorker.evaluate(READ_QUEUE);
  const before = await serverEventIds();

  // Force the send path directly. Enforcement lives at the flush boundary, so calling
  // flush is exactly the case that must hold.
  await serviceWorker.evaluate(() => globalThis.__contextlens.flushNow());
  await page.waitForTimeout(2_000);

  const stillQueued = await serviceWorker.evaluate(READ_QUEUE);
  expect(
    stillQueued.length,
    'a flush under local only must leave the queue untouched',
  ).toBe(queued.length);

  const after = await serverEventIds();
  for (const event of queued) {
    expect(after.has(event.event_id), `event ${event.event_id} reached the server`).toBe(false);
  }
  expect(after.size).toBe(before.size);

  // Turning it off must deliver what was held, so the mode defers delivery rather than
  // discarding data the user still owns.
  await write(STORAGE_KEYS.privacySettings, { localOnly: false, retentionDays: 30 });
  await serviceWorker.evaluate(() => globalThis.__contextlens.flushNow());

  await expect
    .poll(async () => (await serviceWorker.evaluate(READ_QUEUE)).length, { timeout: 20_000 })
    .toBe(0);

  const delivered = await serverEventIds();
  for (const event of queued) {
    expect(delivered.has(event.event_id), `event ${event.event_id} was lost`).toBe(true);
  }
});
