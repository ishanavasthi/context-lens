import { z } from 'zod';
import { CONSENT_SCOPES, type ConsentScope } from './events.js';

/**
 * Consent model. Capture is a privilege granted scope by scope, never a single
 * on switch, and a fresh install grants nothing.
 *
 * This replaces the earlier `captureEnabled` boolean. A boolean cannot express
 * "navigation yes, screenshots no", which is the distinction the whole privacy
 * posture rests on.
 */

export const STORAGE_KEYS = {
  consent: 'consent',
  denyList: 'denyList',
  deviceId: 'deviceId',
  sessionSeq: 'sessionSeq',
} as const;

export const consentStateSchema = z.object({
  /** Scopes the user has explicitly granted. Empty means capture nothing. */
  granted: z.array(z.enum(CONSENT_SCOPES)),
  /** True once the user has seen and answered the first run consent screen. */
  onboarded: z.boolean(),
  /** Set when the user pauses without revoking, so scopes survive a pause. */
  paused: z.boolean(),
  updatedAt: z.number().int().nonnegative(),
});

export type ConsentState = z.infer<typeof consentStateSchema>;

/** A fresh install: nothing granted, nothing captured, not yet onboarded. */
export const DEFAULT_CONSENT: ConsentState = {
  granted: [],
  onboarded: false,
  paused: false,
  updatedAt: 0,
};

/** Screenshots always require their own opt in, even after other scopes are granted. */
export const SECOND_OPT_IN_SCOPES: readonly ConsentScope[] = ['screenshots'];

/** True when anything at all may be captured right now. */
export function isCapturing(state: ConsentState): boolean {
  return !state.paused && state.granted.length > 0;
}

/** True when this specific scope may be captured right now. */
export function hasScope(state: ConsentState, scope: ConsentScope): boolean {
  return isCapturing(state) && state.granted.includes(scope);
}

/**
 * Visual contract for the in page indicator. Pinned here so the content script and
 * the tests that assert it cannot drift apart.
 */
export const INDICATOR = {
  elementId: '__contextlens_rec',
  testId: 'recording-indicator',
  activeLabel: 'REC',
  pausedLabel: 'PAUSED',
  activeColor: 'rgb(204, 0, 0)',
  pausedColor: 'rgb(107, 114, 128)',
} as const;

/** Toolbar badge states. The badge is browser chrome, outside any page's control. */
export const BADGE = {
  recording: { text: 'REC', color: '#CC0000' },
  paused: { text: 'II', color: '#6B7280' },
  off: { text: '', color: '#6B7280' },
} as const;

/**
 * Which consent scope authorises which event type. Capture code must consult this
 * rather than deciding locally, otherwise the service worker and the content script
 * can disagree about whether an event was permitted.
 *
 * Types with a null scope are lifecycle records, not user activity: they describe the
 * capture system itself and are written whenever anything at all is being captured.
 */
export const SCOPE_FOR_EVENT: Record<string, ConsentScope | null> = {
  session_start: null,
  session_end: null,
  consent_change: null,
  idle_state_change: null,
  navigation: 'navigation',
  tab_activated: 'navigation',
  page_view_end: 'dwell',
  scroll: 'dwell',
  click: 'interaction',
  input_focus: 'interaction',
  screenshot: 'screenshots',
};

/** True when the current consent permits recording this event type. */
export function mayCapture(state: ConsentState, eventType: string): boolean {
  if (!isCapturing(state)) return false;
  const scope = SCOPE_FOR_EVENT[eventType];
  if (scope === undefined) return false;
  return scope === null ? true : state.granted.includes(scope);
}
