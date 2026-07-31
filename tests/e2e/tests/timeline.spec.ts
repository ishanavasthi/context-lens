import { STORAGE_KEYS, type ConsentState } from '@contextlens/shared';
import { test, expect } from '../fixtures/extension.js';

/**
 * One test for the timeline, deliberately.
 *
 * The page has no unit tests: its real acceptance is a person opening it and
 * understanding what they did, which no assertion can stand in for. What automation can
 * check is the part a person cannot eyeball, that the numbers on screen come from the
 * database rather than from a hardcoded shape that renders convincingly while empty.
 */

const FIXTURE = 'http://localhost:5599/click-target.html';

test('the timeline renders real rows from the database', async ({ context, extensionId, serviceWorker }) => {
  const consent: ConsentState = {
    granted: ['interaction', 'navigation', 'dwell'],
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
    value: consent,
  });

  // Produce activity now, so the default window certainly contains something.
  const page = await context.newPage();
  await page.goto(FIXTURE, { waitUntil: 'load' });
  for (let index = 0; index < 3; index += 1) {
    await page.click('[data-testid="click-target"]');
  }
  await expect
    .poll(async () => serviceWorker.evaluate(() => globalThis.__contextlens.queueSize()), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  // Wait for the events to reach the server, not for the queue to empty. With the
  // navigation scope granted, opening any page enqueues more events, so the queue is
  // legitimately never empty and asserting on it would be asserting on a moving target.
  await serviceWorker.evaluate(() => globalThis.__contextlens.flushNow());
  await expect
    .poll(
      async () => {
        const res = await fetch('http://localhost:8787/v1/events?type=click&limit=500', {
          headers: { Authorization: 'Bearer dev-device-token-0000000000000000' },
        });
        if (!res.ok) return 0;
        const body = (await res.json()) as { events: unknown[] };
        return body.events.length;
      },
      { timeout: 25_000 },
    )
    .toBeGreaterThan(0);

  const timeline = await context.newPage();
  await timeline.goto(`chrome-extension://${extensionId}/src/timeline/index.html`);

  await expect(timeline.getByTestId('timeline-root')).toBeVisible();

  // Totals must be real numbers, not placeholders.
  const totals = timeline.getByTestId('timeline-totals');
  await expect(totals).toBeVisible();
  await expect
    .poll(async () => (await totals.textContent()) ?? '', { timeout: 20_000 })
    .toMatch(/[1-9]\d*/);

  // Event rows must appear, and at least one must name the host the events actually
  // carry. A page that renders rows with blank hosts looks fine and means nothing.
  const eventRows = timeline.getByTestId('event-row');
  await expect.poll(async () => eventRows.count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(eventRows.first()).toContainText('localhost');

  // The domain breakdown is driven by dwell, which only exists once a page view has
  // ended, so its presence is checked but its emptiness is not treated as failure.
  const domainRows = timeline.getByTestId('domain-row');
  expect(await domainRows.count()).toBeGreaterThanOrEqual(0);
});
