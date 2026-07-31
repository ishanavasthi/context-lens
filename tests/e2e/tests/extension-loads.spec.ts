import { test, expect } from '../fixtures/extension';

test('extension loads and initialises', async ({ extensionId, serviceWorker }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);

  const name = await serviceWorker.evaluate(() => chrome.runtime.getManifest().name);
  expect(name).toBe('ContextLens');
});
