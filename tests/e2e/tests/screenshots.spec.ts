import { STORAGE_KEYS, SCREENSHOT_LIMITS, type ConsentState } from '@contextlens/shared';
import { test, expect } from '../fixtures/extension.js';

/**
 * Screenshot capture, verified by pixels rather than by the absence of an error.
 *
 * A capture pipeline can return a blank frame, a stale frame, or the wrong tab and still
 * report success at every layer. The only assertion that means anything is comparing what
 * was stored against what the page actually rendered.
 */

const FIXTURE = 'http://localhost:5599/click-target.html';
/** The fixture body is exactly this colour, which is what the stored image must show. */
const FIXTURE_RGB = [0, 128, 255] as const;

async function grantScreenshots(serviceWorker: {
  evaluate: (fn: (a: { key: string; value: unknown }) => unknown, arg: unknown) => Promise<void>;
}): Promise<void> {
  const state: ConsentState = {
    granted: ['navigation', 'screenshots'],
    onboarded: true,
    paused: false,
    updatedAt: 0,
  };
  await serviceWorker.evaluate(({ key, value }) => chrome.storage.local.set({ [key]: value }), {
    key: STORAGE_KEYS.consent,
    value: state,
  });
}

const READ_QUEUE = async (): Promise<Array<{ type: string; payload: Record<string, unknown> }>> => {
  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const request = indexedDB.open('contextlens');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return await new Promise((resolve, reject) => {
    const all = db.transaction('events', 'readonly').objectStore('events').getAll();
    all.onsuccess = () =>
      resolve(all.result as Array<{ type: string; payload: Record<string, unknown> }>);
    all.onerror = () => reject(all.error);
  });
};

/** Downloads the stored object using the service role key, which lives only in the test. */
async function downloadStored(storagePath: string): Promise<Buffer> {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('storage is not configured in .env');
  const res = await fetch(`${base}/storage/v1/object/screenshots/${storagePath}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

test('a captured screenshot stores the pixels the page actually rendered', async ({
  context,
  serviceWorker,
}) => {
  await grantScreenshots(serviceWorker as never);

  const page = await context.newPage();
  await page.goto(FIXTURE, { waitUntil: 'load' });
  await page.bringToFront();

  // Capture is triggered by navigation and throttled, so wait for the event rather than
  // assuming a fixed delay.
  await expect
    .poll(
      async () => (await serviceWorker.evaluate(READ_QUEUE)).filter((e) => e.type === 'screenshot').length,
      { timeout: 25_000 },
    )
    .toBeGreaterThan(0);

  const shot = (await serviceWorker.evaluate(READ_QUEUE)).find((e) => e.type === 'screenshot');
  const payload = shot?.payload as {
    storage_path: string;
    w: number;
    h: number;
    bytes: number;
    sha256: string;
  };

  expect(payload.w).toBeLessThanOrEqual(SCREENSHOT_LIMITS.maxEdge);
  expect(payload.h).toBeLessThanOrEqual(SCREENSHOT_LIMITS.maxEdge);
  expect(payload.bytes).toBeLessThanOrEqual(SCREENSHOT_LIMITS.maxBytes);

  const stored = await downloadStored(payload.storage_path);

  // The content hash must match the bytes actually in storage, which proves the object
  // was not truncated or replaced in transit.
  const { createHash } = await import('node:crypto');
  expect(createHash('sha256').update(stored).digest('hex')).toBe(payload.sha256);
  expect(stored.byteLength).toBe(payload.bytes);

  // Decode in the browser, since Node has no WebP decoder available here.
  const centre = await page.evaluate(async (dataUrl) => {
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const middle = ctx.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1);
    return { rgb: Array.from(middle.data).slice(0, 3), w: bitmap.width, h: bitmap.height };
  }, `data:image/webp;base64,${stored.toString('base64')}`);

  expect(centre.w).toBe(payload.w);
  expect(centre.h).toBe(payload.h);

  // WebP at quality 0.7 is lossy, so compare with a tolerance rather than exactly.
  for (let channel = 0; channel < 3; channel += 1) {
    expect(
      Math.abs(centre.rgb[channel] - FIXTURE_RGB[channel]),
      `channel ${channel} was ${centre.rgb[channel]}, expected near ${FIXTURE_RGB[channel]}`,
    ).toBeLessThanOrEqual(12);
  }
});

test('no screenshot is captured without the screenshots scope', async ({ context, serviceWorker }) => {
  const state: ConsentState = {
    granted: ['navigation', 'interaction', 'dwell'],
    onboarded: true,
    paused: false,
    updatedAt: 0,
  };
  await (
    serviceWorker as unknown as {
      evaluate: (fn: (a: { key: string; value: unknown }) => unknown, arg: unknown) => Promise<void>;
    }
  ).evaluate(({ key, value }) => chrome.storage.local.set({ [key]: value }), {
    key: STORAGE_KEYS.consent,
    value: state,
  });

  const page = await context.newPage();
  await page.goto(FIXTURE, { waitUntil: 'load' });
  await page.waitForTimeout(5_000);

  const shots = (await serviceWorker.evaluate(READ_QUEUE)).filter((e) => e.type === 'screenshot');
  expect(shots).toEqual([]);
});
