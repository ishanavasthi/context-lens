// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { getDwellSnapshot as GetDwellSnapshot, startDwellTracking as StartDwellTracking } from './dwell.js';

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

function setHasFocus(hasFocus: boolean): void {
  document.hasFocus = vi.fn(() => hasFocus);
}

async function loadFreshDwellModule(): Promise<{
  getDwellSnapshot: typeof GetDwellSnapshot;
  startDwellTracking: typeof StartDwellTracking;
}> {
  vi.resetModules();
  return import('./dwell.js');
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility('visible');
  setHasFocus(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('dwell', () => {
  it('stops accruing engaged_ms while the document is hidden but keeps dwell_ms going', async () => {
    const { getDwellSnapshot, startDwellTracking } = await loadFreshDwellModule();
    startDwellTracking(() => {}, () => 0);

    vi.advanceTimersByTime(1000);
    setVisibility('hidden');
    vi.advanceTimersByTime(5000);

    const snapshot = getDwellSnapshot();
    expect(snapshot.dwell_ms).toBe(6000);
    expect(snapshot.engaged_ms).toBe(1000);
  });

  it('fires page_view_end exactly once on pagehide', async () => {
    const { startDwellTracking } = await loadFreshDwellModule();
    const emit = vi.fn();
    startDwellTracking(emit, () => 42);

    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pagehide'));

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ max_scroll_pct: 42 }),
    );
  });
});
