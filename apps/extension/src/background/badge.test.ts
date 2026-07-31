import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BADGE, DEFAULT_CONSENT, type ConsentState } from '@contextlens/shared';
import { applyBadge } from './badge.js';

let setBadgeText: ReturnType<typeof vi.fn>;
let setBadgeBackgroundColor: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setBadgeText = vi.fn().mockResolvedValue(undefined);
  setBadgeBackgroundColor = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { action: { setBadgeText, setBadgeBackgroundColor } });
});

function state(overrides: Partial<ConsentState>): ConsentState {
  return { ...DEFAULT_CONSENT, ...overrides };
}

describe('applyBadge', () => {
  it('sets the recording badge while capturing', async () => {
    await applyBadge(state({ granted: ['navigation'] }));
    expect(setBadgeText).toHaveBeenCalledWith({ text: BADGE.recording.text });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ color: BADGE.recording.color });
  });

  it('sets the paused badge when paused', async () => {
    await applyBadge(state({ granted: ['navigation'], paused: true }));
    expect(setBadgeText).toHaveBeenCalledWith({ text: BADGE.paused.text });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ color: BADGE.paused.color });
  });

  it('sets the off badge when nothing is granted and not paused', async () => {
    await applyBadge(state({ granted: [] }));
    expect(setBadgeText).toHaveBeenCalledWith({ text: BADGE.off.text });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ color: BADGE.off.color });
  });
});
