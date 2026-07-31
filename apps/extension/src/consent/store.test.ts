import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONSENT, STORAGE_KEYS, isCapturing } from '@contextlens/shared';
import { grantScopes, readConsent, revokeScopes, setPaused } from './store.js';

function makeStorageStub() {
  let store: Record<string, unknown> = {};
  return {
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      store = { ...store, ...items };
    }),
    _setRaw(key: string, value: unknown) {
      store[key] = value;
    },
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
});

describe('consent store', () => {
  it('returns DEFAULT_CONSENT when storage is unset', async () => {
    const state = await readConsent();
    expect(state).toEqual(DEFAULT_CONSENT);
  });

  it('round trips a grant through read', async () => {
    await grantScopes(['navigation', 'interaction']);
    const state = await readConsent();
    expect(state.granted).toEqual(['navigation', 'interaction']);
  });

  it('revoke removes only the named scopes', async () => {
    await grantScopes(['navigation', 'interaction', 'dwell']);
    const state = await revokeScopes(['interaction']);
    expect(state.granted).toEqual(['navigation', 'dwell']);
  });

  it('setPaused(true) makes isCapturing false while leaving granted intact', async () => {
    await grantScopes(['navigation']);
    const state = await setPaused(true);
    expect(state.granted).toEqual(['navigation']);
    expect(isCapturing(state)).toBe(false);
  });

  it('falls back to DEFAULT_CONSENT when stored JSON is corrupt', async () => {
    const chromeStub = (globalThis as unknown as { chrome: { storage: { local: ReturnType<typeof makeStorageStub> } } })
      .chrome;
    chromeStub.storage.local._setRaw(STORAGE_KEYS.consent, { granted: 'not-an-array' });
    const state = await readConsent();
    expect(state).toEqual(DEFAULT_CONSENT);
  });
});
