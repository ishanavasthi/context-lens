import { ulid } from 'ulid';
import {
  eventPayloadSchemas,
  mayCapture,
  SCHEMA_VERSION,
  type ConsentScope,
  type EventEnvelope,
  type EventType,
} from '@contextlens/shared';
import { onConsentChanged, readConsent } from '../consent/store.js';
import { isUrlDenied } from '../privacy/deny.js';
import { enqueueEvent } from './queue.js';
import { getDeviceId, nextSeq } from './session.js';
import { sessionId } from './service-worker.js';

async function getTabTitle(tabId: number): Promise<string | undefined> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.title;
  } catch {
    return undefined;
  }
}

async function tryEmit(
  type: EventType,
  payload: unknown,
  opts?: { url?: string; tabId?: number },
): Promise<void> {
  try {
    const state = await readConsent();
    if (!mayCapture(state, type)) return;
    if (opts?.url && (await isUrlDenied(opts.url))) return;
    const parsed = eventPayloadSchemas[type].safeParse(payload);
    if (!parsed.success) return;
    const deviceId = await getDeviceId();
    const seq = await nextSeq();
    const envelope: EventEnvelope = {
      event_id: ulid(),
      session_id: sessionId,
      device_id: deviceId,
      type,
      ts: Date.now(),
      tz_offset: -new Date().getTimezoneOffset(),
      seq,
      tab_id: opts?.tabId,
      url: opts?.url,
      schema_v: SCHEMA_VERSION,
      payload: parsed.data,
    };
    await enqueueEvent(envelope);
  } catch {
    // one malformed observer must not stop the others
  }
}

export function registerObservers(): void {
  chrome.idle.setDetectionInterval(60);

  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;
    void (async () => {
      const title = await getTabTitle(details.tabId);
      await tryEmit(
        'navigation',
        { transition_type: details.transitionType, title, is_spa: false },
        { url: details.url, tabId: details.tabId },
      );
    })();
  });

  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0) return;
    void (async () => {
      const title = await getTabTitle(details.tabId);
      await tryEmit(
        'navigation',
        { transition_type: details.transitionType, title, is_spa: true },
        { url: details.url, tabId: details.tabId },
      );
    })();
  });

  let previousTabId: number | undefined;
  chrome.tabs.onActivated.addListener((activeInfo) => {
    const fromTabId = previousTabId;
    previousTabId = activeInfo.tabId;
    void tryEmit(
      'tab_activated',
      { from_tab_id: fromTabId, window_id: activeInfo.windowId },
      { tabId: activeInfo.tabId },
    );
  });

  chrome.idle.onStateChanged.addListener((state) => {
    void tryEmit('idle_state_change', { state });
  });

  chrome.runtime.onSuspend.addListener(() => {
    void tryEmit('session_end', { reason: 'suspend' });
  });

  let previousGranted: ConsentScope[] = [];
  void (async () => {
    const state = await readConsent();
    previousGranted = state.granted;
    await tryEmit('session_start', { consent_scopes: state.granted });
  })();

  onConsentChanged((state) => {
    const from = previousGranted;
    const to = state.granted;
    previousGranted = to;
    void tryEmit('consent_change', { from, to, source: 'user' });
  });
}
