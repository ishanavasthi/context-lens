import {
  CONTENT_EVENTS_MESSAGE,
  SENSITIVE_PAGE_MESSAGE,
  eventPayloadSchemas,
  isCapturing,
  MAX_EVENTS_PER_BATCH,
  ROUTES,
  SCHEMA_VERSION,
  type EventEnvelope,
  type PendingEvent,
} from '@contextlens/shared';
import { onConsentChanged, readConsent } from '../consent/store.js';
import { isUrlDenied } from '../privacy/deny.js';
import { readPrivacySettings } from '../privacy/settings.js';
import { applyBadge } from './badge.js';
import { forgetTab, markTabSensitive } from './sensitive-tabs.js';
import { appendDelivery } from './delivery-log.js';
import { registerObservers } from './observers.js';
import { deleteEvents, enqueueEvent, queueSize, readBatch } from './queue.js';
import { purgeLocalEvents } from './retention.js';
import { captureAndUpload } from './screenshot.js';
import { allocateEventIdentity, currentSessionId, getDeviceId } from './session.js';

const ALARM_NAME = 'contextlens-flush';
const FLUSH_QUEUE_THRESHOLD = 20;
const API_BASE = import.meta.env.VITE_API_BASE_URL;
const DEVICE_TOKEN = import.meta.env.VITE_DEV_DEVICE_TOKEN;



async function enqueueIncomingEvents(
  events: PendingEvent[],
  tabId: number | undefined,
): Promise<void> {
  const deviceId = await getDeviceId();
  for (const incoming of events) {
    if (incoming.url && (await isUrlDenied(incoming.url))) {
      continue;
    }
    // Validate against the schema for this event's own type. Hardcoding one type
    // here would silently drop every other kind of event as malformed.
    const parsedPayload = eventPayloadSchemas[incoming.type].safeParse(incoming.payload);
    if (!parsedPayload.success) {
      continue;
    }
    const { sessionId, seq } = await allocateEventIdentity();
    const envelope: EventEnvelope = {
      event_id: incoming.event_id,
      session_id: sessionId,
      device_id: deviceId,
      type: incoming.type,
      ts: incoming.ts,
      tz_offset: incoming.tz_offset,
      seq,
      tab_id: tabId,
      url: incoming.url,
      schema_v: SCHEMA_VERSION,
      payload: parsedPayload.data,
    };
    await enqueueEvent(envelope);
  }
}

async function flush(): Promise<void> {
  if (!isCapturing(await readConsent())) {
    return;
  }
  const batch = await readBatch(MAX_EVENTS_PER_BATCH);
  if (batch.length === 0) {
    return;
  }
  // The flush boundary: the last point before the fetch. Local only mode must hold
  // even if some other code path calls flush directly, so it is checked here rather
  // than at the point where events are queued.
  const settings = await readPrivacySettings();
  if (settings.localOnly) {
    return;
  }
  const deviceId = await getDeviceId();
  const types = [...new Set(batch.map((event) => event.type))];
  try {
    const response = await fetch(`${API_BASE}${ROUTES.eventsBatch}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEVICE_TOKEN}`,
      },
      body: JSON.stringify({ device_id: deviceId, session_id: await currentSessionId(), events: batch }),
    });
    await appendDelivery({
      at: Date.now(),
      eventCount: batch.length,
      types,
      ok: response.ok,
      status: response.status,
    });
    if (response.ok) {
      await deleteEvents(batch.map((event) => event.event_id));
    }
  } catch (error) {
    // Leave the rows in place, the next alarm tick retries them.
    await appendDelivery({
      at: Date.now(),
      eventCount: batch.length,
      types,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === SENSITIVE_PAGE_MESSAGE) {
    const tabId = sender.tab?.id;
    if (typeof tabId === 'number') {
      void markTabSensitive(tabId, message.sensitive === true);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type !== CONTENT_EVENTS_MESSAGE) {
    return undefined;
  }
  void (async () => {
    if (!isCapturing(await readConsent())) {
      sendResponse({ ok: false });
      return;
    }
    await enqueueIncomingEvents(message.events as PendingEvent[], sender.tab?.id);
    if ((await queueSize()) > FLUSH_QUEUE_THRESHOLD) {
      await flush();
    }
    sendResponse({ ok: true });
  })();
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void flush();
    void (async () => {
      const settings = await readPrivacySettings();
      await purgeLocalEvents(settings.retentionDays);
    })();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
});

chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });

void readConsent().then(applyBadge);
onConsentChanged((state) => {
  void applyBadge(state);
});

registerObservers();

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  void captureAndUpload(details.tabId, 'navigation');
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void captureAndUpload(activeInfo.tabId, 'tab_activated');
});

declare global {
  var __contextlens: {
    queueSize: () => Promise<number>;
    flushNow: () => Promise<void>;
  };
}

globalThis.__contextlens = {
  queueSize,
  flushNow: flush,
};


// A tab that closes cannot still be showing a prompt, and leaving the flag set would
// suppress captures for whatever tab id the browser reuses next.
chrome.tabs.onRemoved.addListener((tabId) => {
  void forgetTab(tabId);
});
