import { test, expect } from '../fixtures/extension.js';

/**
 * The walking skeleton. One real click has to travel through every layer the
 * finished product needs: content script, service worker, IndexedDB, the batch
 * endpoint, Postgres, and back out through the read endpoint.
 *
 * This is deliberately one test rather than several. Per layer assertions can
 * all pass while the chain between them is broken, which is the exact failure
 * an integration phase at the end of a project discovers too late.
 */

const API = 'http://localhost:8787';
const FIXTURE = 'http://localhost:5599/click-target.html';

// Development only. Matches the device the seed script registers, and the value
// documented in .env.example.
const DEV_TOKEN = 'dev-device-token-0000000000000000';

async function readEvents(type: string) {
  const res = await fetch(`${API}/v1/events?type=${type}&limit=500`, {
    headers: { Authorization: `Bearer ${DEV_TOKEN}` },
  });
  if (!res.ok) throw new Error(`read failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { events: Array<Record<string, unknown>>; nextCursor: string | null };
}

test('a click travels from the page to Postgres and back out through the API', async ({
  context,
  serviceWorker,
}) => {
  const before = await readEvents('click');

  // Consent is off by default, which is the whole point of the design. Turn it
  // on explicitly, the way the popup toggle does.
  await serviceWorker.evaluate(() => chrome.storage.local.set({ captureEnabled: true }));

  const page = await context.newPage();
  await page.goto(FIXTURE, { waitUntil: 'load' });
  await page.click('[data-testid="click-target"]');

  // The content script buffers and flushes to the service worker on a 2 second
  // timer, so wait for the event to reach the durable queue before forcing the
  // network flush.
  await expect
    .poll(async () => serviceWorker.evaluate(() => globalThis.__contextlens.queueSize()), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  await serviceWorker.evaluate(() => globalThis.__contextlens.flushNow());

  // After a successful flush the queue is drained, which is what proves the rows
  // were acknowledged rather than merely sent.
  await expect
    .poll(async () => serviceWorker.evaluate(() => globalThis.__contextlens.queueSize()), {
      timeout: 15_000,
    })
    .toBe(0);

  const after = await readEvents('click');
  expect(after.events.length).toBeGreaterThan(before.events.length);

  const landed = after.events[0] as {
    type: string;
    payload: { tag: string; is_trusted: boolean };
  };
  expect(landed.type).toBe('click');
  // The capture path normalises tag names, so compare case insensitively rather
  // than pinning the assertion to a formatting choice.
  expect(landed.payload.tag.toLowerCase()).toBe('button');
  // Playwright dispatches through the CDP input domain, so the page sees a
  // genuinely trusted event. If this is ever false the capture path is reading
  // a synthetic event it should not trust.
  expect(landed.payload.is_trusted).toBe(true);
});

test('with consent off, clicking produces nothing', async ({ context, serviceWorker }) => {
  await serviceWorker.evaluate(() => chrome.storage.local.set({ captureEnabled: false }));

  const page = await context.newPage();
  await page.goto(FIXTURE, { waitUntil: 'load' });
  await page.click('[data-testid="click-target"]');
  await page.waitForTimeout(3_000);

  const queued = await serviceWorker.evaluate(() => globalThis.__contextlens.queueSize());
  expect(queued).toBe(0);
});
