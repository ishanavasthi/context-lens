import { BADGE, isCapturing, type ConsentState } from '@contextlens/shared';

export async function applyBadge(state: ConsentState): Promise<void> {
  const badge = isCapturing(state) ? BADGE.recording : state.paused ? BADGE.paused : BADGE.off;
  await chrome.action.setBadgeText({ text: badge.text });
  await chrome.action.setBadgeBackgroundColor({ color: badge.color });
}
