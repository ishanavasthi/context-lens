import { STORAGE_KEYS, type ConsentState } from '@contextlens/shared';
import { test, expect } from '../fixtures/extension.js';

/**
 * Durability under Manifest V3.
 *
 * The service worker is terminated after seconds of idle and restarted on the next
 * event. Every other guarantee in this system rests on the queue surviving that, so
 * these are the tests whose failure would invalidate the most downstream work.
 */

const API = 'http://localhost:8787';
const FIXTURE = 'http://localhost:5599/click-target.html';
const DEV_TOKEN = 'dev-device-token-0000000000000000';

async function grant(
  serviceWorker: { evaluate: (fn: never, arg?: unknown) => Promise<unknown> },
  granted: ConsentState['granted'],
): Promise<void> {
  const state: ConsentState = { granted, onboarded: true, paused: false, updatedAt: 0 };
  await (
    serviceWorker as unknown as {
      evaluate: (fn: (a: { key: string; value: unknown }) => unknown, arg: unknown) => Promise<void>;
    }
  ).evaluate(({ key, value }) => chrome.storage.local.set({ [key]: value }), {
    key: STORAGE_KEYS.consent,
    value: state,
  });
}

/** Reads the worker's durable queue directly. The test hook exposes only a total. */
const READ_QUEUE = async (): Promise<Array<{ event_id: string; type: string; seq: number }>> => {
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const request = indexedDB.open('contextlens');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return await new Promise((resolve, reject) => {
    const all = db.transaction('events', 'readonly').objectStore('events').getAll();
    all.onsuccess = () => resolve(all.result as Array<{ event_id: string; type: string; seq: number }>);
    all.onerror = () => reject(all.error);
  });
};

async function apiEvents(): Promise<Array<{ event_id: string; type: string; seq: number }>> {
  const res = await fetch(`${API}/v1/events?limit=500`, {
    headers: { Authorization: `Bearer ${DEV_TOKEN}` },
  });
  if (!res.ok) throw new Error(`read failed: ${res.status}`);
  const body = (await res.json()) as { events: Array<{ event_id: string; type: string; seq: number }> };
  return body.events;
}

test('queued events live in durable storage, not in worker memory', async ({
  context,
  extensionId,
  serviceWorker,
}) => {
  // Terminating an MV3 worker on demand is not scriptable from Playwright:
  // chrome.runtime.reload() tears down the extension context and leaves no worker to
  // re-attach to. So this asserts the property that makes termination survivable
  // instead, that events are in shared durable storage rather than worker memory,
  // by reading the same database from a completely separate extension context.
  // Recovery after a failed delivery is covered by the offline test below.
  await grant(serviceWorker as never, ['interaction']);

  const page = await context.newPage();
  await page.goto(FIXTURE, { waitUntil: 'load' });
  for (let index = 0; index < 12; index += 1) {
    await page.click('[data-testid="click-target"]');
  }

  await expect
    .poll(
      async () =>
        (await serviceWorker.evaluate(READ_QUEUE)).filter((event) => event.type === 'click').length,
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(12);

  const queuedIds = (await serviceWorker.evaluate(READ_QUEUE)).map((e) => e.event_id).sort();

  // A different page in the extension origin, with its own JavaScript context that
  // shares nothing in memory with the worker.
  const optionsPage = await context.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/src/options/index.html`);
  const seenFromElsewhere = await optionsPage.evaluate(READ_QUEUE);
  expect(seenFromElsewhere.map((e) => e.event_id).sort()).toEqual(queuedIds);
  await optionsPage.close();

  await serviceWorker.evaluate(() => globalThis.__contextlens.flushNow());
  await expect
    .poll(async () => (await serviceWorker.evaluate(READ_QUEUE)).length, { timeout: 20_000 })
    .toBe(0);

  const landedIds = (await apiEvents()).map((e) => e.event_id);
  for (const id of queuedIds) {
    expect(landedIds.filter((candidate) => candidate === id)).toHaveLength(1);
  }
});

test('events queued while offline are delivered once the network returns', async ({
  context,
  serviceWorker,
}) => {
  await grant(serviceWorker as never, ['interaction']);

  const page = await context.newPage();
  await page.goto(FIXTURE, { waitUntil: 'load' });

  await context.setOffline(true);
  for (let i = 0; i < 5; i += 1) {
    await page.click('[data-testid="click-target"]');
  }
  await expect
    .poll(async () => (await serviceWorker.evaluate(READ_QUEUE)).filter((e) => e.type === 'click').length, {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(5);

  // A failed flush must leave everything in place rather than dropping it.
  await serviceWorker.evaluate(() => globalThis.__contextlens.flushNow());
  const stillQueued = await serviceWorker.evaluate(READ_QUEUE);
  expect(stillQueued.length).toBeGreaterThanOrEqual(5);

  await context.setOffline(false);
  await serviceWorker.evaluate(() => globalThis.__contextlens.flushNow());
  await expect
    .poll(async () => (await serviceWorker.evaluate(READ_QUEUE)).length, { timeout: 20_000 })
    .toBe(0);

  const landed = await apiEvents();
  for (const queued of stillQueued) {
    expect(landed.filter((e) => e.event_id === queued.event_id)).toHaveLength(1);
  }
});

test('sequence numbers within a session are contiguous, so a gap would mean a lost event', async () => {
  const events = await apiEvents();
  const bySession = new Map<string, number[]>();
  for (const event of events as Array<{ session_id?: string; seq: number }>) {
    if (!event.session_id || event.session_id.startsWith('seed-')) continue;
    const list = bySession.get(event.session_id) ?? [];
    list.push(event.seq);
    bySession.set(event.session_id, list);
  }
  expect(bySession.size).toBeGreaterThan(0);

  for (const [sessionId, seqs] of bySession) {
    const sorted = [...seqs].sort((a, b) => a - b);
    expect(new Set(sorted).size, `session ${sessionId} reused a sequence number`).toBe(sorted.length);
    expect(sorted[0], `session ${sessionId} did not start at 1`).toBe(1);
    expect(sorted.at(-1), `session ${sessionId} has a gap`).toBe(sorted.length);
  }
});
