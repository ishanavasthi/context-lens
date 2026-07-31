import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A real browsing session produced 228 events carrying only 223 distinct sequence
 * numbers. Allocation read the counter, awaited, then wrote it back, so two events
 * allocated concurrently both read the same value and both wrote the same successor.
 *
 * Every existing test allocated one at a time and passed throughout. Concurrency is the
 * whole point here, so these tests fire allocations together rather than in sequence.
 */

function makeStorageStub() {
  let store: Record<string, unknown> = {};
  return {
    get: vi.fn(async (key: string) => {
      // Yield, the way a real asynchronous storage read does. Without this the race
      // cannot occur and the test passes against the broken implementation.
      await Promise.resolve();
      return { [key]: store[key] };
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      await Promise.resolve();
      store = { ...store, ...items };
    }),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('chrome', { storage: { local: makeStorageStub() } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('allocateEventIdentity', () => {
  it('never hands out the same sequence number twice under concurrency', async () => {
    const { allocateEventIdentity } = await import('./session.js');

    const results = await Promise.all(
      Array.from({ length: 50 }, () => allocateEventIdentity(Date.now())),
    );

    const seqs = results.map((r) => r.seq);
    expect(new Set(seqs).size, 'a sequence number was reused').toBe(seqs.length);
  });

  it('produces a contiguous run from 1 with no gaps', async () => {
    const { allocateEventIdentity } = await import('./session.js');

    const results = await Promise.all(
      Array.from({ length: 30 }, () => allocateEventIdentity(Date.now())),
    );

    const sorted = results.map((r) => r.seq).sort((a, b) => a - b);
    expect(sorted[0]).toBe(1);
    expect(sorted.at(-1)).toBe(sorted.length);
  });

  it('keeps every concurrent allocation in the same session', async () => {
    const { allocateEventIdentity } = await import('./session.js');

    const results = await Promise.all(
      Array.from({ length: 20 }, () => allocateEventIdentity(Date.now())),
    );

    expect(new Set(results.map((r) => r.sessionId)).size).toBe(1);
  });
});
