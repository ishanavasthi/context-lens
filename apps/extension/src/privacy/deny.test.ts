import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DENY_PATTERNS, STORAGE_KEYS } from '@contextlens/shared';
import { isUrlDenied, readDenyPatterns, writeDenyPatterns } from './deny.js';

function stubStorage(get: () => Promise<Record<string, unknown>>) {
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get,
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('readDenyPatterns', () => {
  it('falls back to the default patterns when storage is unset', async () => {
    stubStorage(() => Promise.resolve({}));
    expect(await readDenyPatterns()).toEqual([...DEFAULT_DENY_PATTERNS]);
  });

  it('returns a stored list in place of the defaults', async () => {
    stubStorage(() => Promise.resolve({ [STORAGE_KEYS.denyList]: ['example.com', '*.evil.com'] }));
    expect(await readDenyPatterns()).toEqual(['example.com', '*.evil.com']);
  });

  it('falls back to the defaults, never an empty list, on a storage read failure', async () => {
    stubStorage(() => Promise.reject(new Error('storage unavailable')));
    expect(await readDenyPatterns()).toEqual([...DEFAULT_DENY_PATTERNS]);
  });

  it('ignores blank and whitespace only lines', async () => {
    stubStorage(() =>
      Promise.resolve({ [STORAGE_KEYS.denyList]: ['example.com', '', '   ', '  *.evil.com  '] }),
    );
    expect(await readDenyPatterns()).toEqual(['example.com', '*.evil.com']);
  });
});

describe('writeDenyPatterns', () => {
  it('persists the given patterns under the deny list key', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(), set } } });
    await writeDenyPatterns(['example.com']);
    expect(set).toHaveBeenCalledWith({ [STORAGE_KEYS.denyList]: ['example.com'] });
  });
});

describe('isUrlDenied', () => {
  it('returns true for a denied host', async () => {
    stubStorage(() => Promise.resolve({ [STORAGE_KEYS.denyList]: ['example.com'] }));
    expect(await isUrlDenied('https://example.com/path')).toBe(true);
  });

  it('returns false for a plain host that is not denied', async () => {
    stubStorage(() => Promise.resolve({ [STORAGE_KEYS.denyList]: ['example.com'] }));
    expect(await isUrlDenied('https://not-denied.test/path')).toBe(false);
  });
});
