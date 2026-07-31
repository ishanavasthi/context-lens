// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRIVACY_SETTINGS, STORAGE_KEYS } from '@contextlens/shared';
import { renderPrivacyControls } from './privacy-controls.js';

function makeStorageStub() {
  let store: Record<string, unknown> = { [STORAGE_KEYS.privacySettings]: DEFAULT_PRIVACY_SETTINGS };
  return {
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      store = { ...store, ...items };
    }),
  };
}

beforeEach(() => {
  const local = makeStorageStub();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local,
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
  vi.stubGlobal('fetch', vi.fn());
});

async function render(): Promise<HTMLElement> {
  const app = document.createElement('main');
  document.body.appendChild(app);
  await renderPrivacyControls(app);
  return app;
}

describe('privacy controls', () => {
  it('does not call the API on a single click of delete', async () => {
    const app = await render();
    const button = app.querySelector('[data-testid="delete-button"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    button.click();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('only fires delete after typing DELETE and clicking', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      json: async () => ({ events: 1, sessions: 2, screenshots: 3, storageObjects: 4 }),
    });

    const app = await render();
    const input = app.querySelector('[data-testid="delete-confirm-input"]') as HTMLInputElement;
    const button = app.querySelector('[data-testid="delete-button"]') as HTMLButtonElement;

    input.value = 'DELETE';
    input.dispatchEvent(new Event('input'));
    expect(button.disabled).toBe(false);

    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('DELETE');

    const status = app.querySelector('[data-testid="delete-status"]') as HTMLElement;
    expect(status.textContent).toContain('1 events');
  });

  it('persists the chosen retention value', async () => {
    const app = await render();
    const select = app.querySelector('[data-testid="retention-select"]') as HTMLSelectElement;

    select.value = '90';
    select.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const stored = await chrome.storage.local.get(STORAGE_KEYS.privacySettings);
    expect((stored[STORAGE_KEYS.privacySettings] as { retentionDays: number }).retentionDays).toBe(90);
  });

  it('persists the local only toggle', async () => {
    const app = await render();
    const toggle = app.querySelector('[data-testid="local-only-toggle"]') as HTMLInputElement;

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const stored = await chrome.storage.local.get(STORAGE_KEYS.privacySettings);
    expect((stored[STORAGE_KEYS.privacySettings] as { localOnly: boolean }).localOnly).toBe(true);
  });

  it('requests the export route with an Authorization header', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ text: async () => 'line1\nline2\n' });

    const app = await render();
    const button = app.querySelector('[data-testid="export-button"]') as HTMLButtonElement;
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/export');
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
  });
});
