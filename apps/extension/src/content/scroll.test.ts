// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startScrollTracking } from './scroll.js';

function setScrollable(scrollY: number, scrollHeight: number, innerHeight: number): void {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: scrollY });
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight });
}

beforeEach(() => {
  vi.useFakeTimers();
  setScrollable(0, 2000, 1000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('scroll', () => {
  it('emits at most once every 2 seconds and only on an increase', () => {
    const emit = vi.fn();
    startScrollTracking(emit);

    setScrollable(200, 2000, 1000);
    window.dispatchEvent(new Event('scroll'));
    expect(emit).toHaveBeenCalledTimes(1);

    setScrollable(400, 2000, 1000);
    window.dispatchEvent(new Event('scroll'));
    expect(emit).toHaveBeenCalledTimes(1);

    setScrollable(100, 2000, 1000);
    window.dispatchEvent(new Event('scroll'));
    expect(emit).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    setScrollable(600, 2000, 1000);
    window.dispatchEvent(new Event('scroll'));
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ max_scroll_pct: 60, viewport_h: 1000, doc_h: 2000 }),
    );
  });
});
